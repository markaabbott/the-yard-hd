-- Run once in the Supabase SQL editor.
--
-- Staff tools on the /staff schedule:
--   * staff_book            book for a customer (account or walk-in) and take
--                           card, cash, check, pay-at-facility, or no charge
--   * staff_collect_payment settle a pay-at-facility booking in cash or check
--   * staff_hold            reserve cages for nobody yet, optional auto-release
--   * save_block / delete_block   closures and cage maintenance (admin/owner)
-- expire_holds() now also releases staff holds whose auto-release time passed.

-- ============================================================================
-- BOOK ON BEHALF OF A CUSTOMER
-- ============================================================================

create or replace function staff_book(
  p_cage_ids    uuid[],
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_kind        reservation_kind default 'drop_in',
  p_user_id     uuid default null,
  p_guest_name  text default null,
  p_guest_phone text default null,
  p_party_name  text default null,
  p_guest_count int  default null,
  p_notes       text default null,
  p_payment     text default 'card',   -- card | cash | check | later | comp
  p_comp_memo   text default null,
  p_notify      boolean default true,
  p_from_hold   uuid default null      -- convert this staff hold into the booking
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s          facility_settings := fs();
  actor      uuid := auth.uid();
  gid        uuid := gen_random_uuid();
  q          record;
  purpose    payment_purpose;
  gross      int;
  due_now    int;
  deposit    boolean := false;
  pay_id     uuid;
  new_status reservation_status := 'confirmed';
  hold_until timestamptz;
  cid        uuid;
  u          users;
  amt_label  text;
  amt_text   text;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_kind not in ('drop_in','party','membership') then
    raise exception 'book drop-ins, parties, or membership time here' using errcode = '22023';
  end if;
  if p_payment not in ('card','cash','check','later','comp') then
    raise exception 'unknown payment option' using errcode = '22023';
  end if;
  if array_length(p_cage_ids, 1) is null then
    raise exception 'pick at least one cage' using errcode = '22023';
  end if;

  p_guest_name := nullif(btrim(p_guest_name), '');
  if p_user_id is null and p_guest_name is null then
    raise exception 'pick a customer or enter a walk-in name' using errcode = '22023';
  end if;
  if p_kind = 'membership' and p_user_id is null then
    raise exception 'membership time needs the member''s account' using errcode = '22023';
  end if;
  if p_payment = 'comp' and nullif(btrim(p_comp_memo), '') is null then
    raise exception 'add a note saying why this booking is free' using errcode = '22023';
  end if;
  if p_user_id is not null then
    select * into u from users where id = p_user_id;
    if not found then raise exception 'unknown customer' using errcode = '22023'; end if;
  end if;

  -- Converting a hold: free its cages inside this same transaction so nobody
  -- can slip into the gap.
  if p_from_hold is not null then
    update reservations set
      status = 'canceled', canceled_at = now(), canceled_by = actor, hold_expires_at = null,
      notes = coalesce(notes || ' · ', '') || 'converted to a booking'
    where group_id = p_from_hold and kind = 'staff_hold' and status = 'confirmed';
    if not found then
      raise exception 'that hold is no longer active' using errcode = '22023';
    end if;
  end if;

  perform assert_bookable(p_starts_at, p_ends_at, true);

  select * into q from quote_window(p_cage_ids, p_starts_at, p_ends_at, p_kind, p_user_id);
  gross := q.out_gross_cents;
  purpose := case p_kind when 'membership' then 'membership'::payment_purpose
                         when 'party' then 'party'::payment_purpose
                         else 'drop_in'::payment_purpose end;

  -- Parties paid now take the deposit; pay-later parties owe the whole total at the door.
  if p_payment = 'comp' then
    due_now := 0;
  elsif p_kind = 'party' and gross > 0 and p_payment <> 'later' then
    deposit := true;
    due_now := greatest((gross * s.party_deposit_percent) / 100, 1);
  else
    due_now := gross;
  end if;

  -- Card taken by staff: a short hold while they key it in. Everything else is booked outright.
  if due_now > 0 and p_payment = 'card' then
    new_status := 'pending_payment';
    hold_until := now() + interval '20 minutes';
  end if;

  begin
    foreach cid in array p_cage_ids loop
      insert into reservations (
        cage_id, starts_at, ends_at, group_id, kind, status, user_id,
        guest_name, guest_phone, party_name, guest_count, hold_expires_at, notes, created_by
      ) values (
        cid, p_starts_at, p_ends_at, gid, p_kind, new_status, p_user_id,
        p_guest_name, nullif(btrim(p_guest_phone), ''), nullif(btrim(p_party_name), ''),
        p_guest_count, hold_until, nullif(btrim(p_notes), ''), actor
      );
    end loop;
  exception when exclusion_violation then
    if sqlerrm like '%block%' then
      raise exception 'that time is blocked (closure or cage maintenance)' using errcode = '23P01';
    end if;
    raise exception 'that time is already booked on one of those cages' using errcode = '23P01';
  end;

  if p_kind = 'membership' and q.out_hours_covered > 0 then
    insert into membership_hour_entries (period_id, entry_type, hours, reservation_group_id, created_by, memo)
    values (q.out_period_id, 'debit', -q.out_hours_covered, gid, actor, 'booked by staff');
  end if;

  if p_payment = 'comp' and gross > 0 then
    insert into payments (entry_type, amount_cents, purpose, reservation_group_id, user_id,
                          status, method, recorded_by, memo)
    values ('comp', 0, purpose, gid, p_user_id, 'succeeded', 'cash', actor, btrim(p_comp_memo))
    returning id into pay_id;
  elsif due_now > 0 then
    insert into payments (
      entry_type, amount_cents, purpose, reservation_group_id, user_id, status, method,
      is_deposit, balance_due_cents, recorded_by, memo
    ) values (
      'charge', due_now, purpose, gid, p_user_id,
      case when p_payment in ('cash','check') then 'succeeded' else 'requires_payment' end::payment_status,
      case when p_payment in ('cash','check') then p_payment else 'card' end::payment_method,
      deposit, case when deposit then gross - due_now else 0 end, actor,
      case p_payment when 'later' then 'to be paid at the facility'
                     when 'card'  then 'card taken by staff'
                     else 'collected by staff' end
    ) returning id into pay_id;
  end if;

  -- Card receipts come from confirm_payment once Stripe clears. Everything else is emailed now.
  if p_notify and u.email is not null and (p_payment <> 'card' or due_now = 0) then
    if p_payment = 'later' then
      amt_label := 'Due at check-in'; amt_text := money_str(due_now);
    elsif p_payment = 'comp' then
      amt_label := 'Price'; amt_text := 'No charge';
    elsif due_now = 0 and q.out_hours_covered > 0 then
      amt_label := 'Paid with'; amt_text := trim(to_char(q.out_hours_covered, 'FM990.0#')) || ' membership hours';
    elsif due_now = 0 then
      amt_label := 'Price'; amt_text := 'No charge';
    else
      amt_label := null; amt_text := money_str(due_now);
    end if;
    perform queue_notification(
      case when deposit then 'party_deposit_receipt' else 'booking_receipt' end,
      p_user_id, u.email,
      jsonb_build_object('amount', amt_text, 'amount_label', amt_label, 'purpose', purpose,
                         'group_id', gid, 'starts_at', p_starts_at,
                         'balance_due', money_str(case when deposit then gross - due_now else 0 end)),
      'receipt:staff:' || gid
    );
  end if;

  return jsonb_build_object(
    'group_id', gid, 'status', new_status, 'payment_id', pay_id,
    'gross_cents', gross, 'due_now_cents', due_now, 'is_deposit', deposit,
    'hours_covered', q.out_hours_covered, 'hold_expires_at', hold_until
  );
end $$;

-- Pay-at-facility booking settled at the counter. Card goes through Stripe instead
-- (create-payment-intent on the same open row; the webhook confirms it).
create or replace function staff_collect_payment(
  p_group_id uuid,
  p_method   payment_method default 'cash'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_method not in ('cash','check') then
    raise exception 'record cash or check here; take cards through Stripe' using errcode = '22023';
  end if;

  select * into p from payments
  where reservation_group_id = p_group_id and entry_type = 'charge' and status = 'requires_payment'
  order by created_at limit 1 for update;
  if not found then
    raise exception 'nothing is owed on this booking' using errcode = '22023';
  end if;

  update payments set
    status = 'succeeded', method = p_method, recorded_by = auth.uid(),
    memo = coalesce(memo || ' · ', '') || 'collected at the facility (' || p_method || ')'
  where id = p.id;

  return jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents, 'method', p_method);
end $$;

-- ============================================================================
-- STAFF HOLDS
-- ============================================================================

-- Takes cages off the market for nobody in particular (a lesson, a team still
-- deciding). Free, no customer, no email. p_release_at puts it back on sale
-- automatically; the minute sweeper does the release.
create or replace function staff_hold(
  p_cage_ids   uuid[],
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_label      text,
  p_notes      text default null,
  p_release_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  gid uuid := gen_random_uuid();
  cid uuid;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if array_length(p_cage_ids, 1) is null then
    raise exception 'pick at least one cage' using errcode = '22023';
  end if;
  if nullif(btrim(p_label), '') is null then
    raise exception 'say who or what the hold is for' using errcode = '22023';
  end if;
  if p_release_at is not null and p_release_at <= now() then
    raise exception 'the auto-release time has already passed' using errcode = '22007';
  end if;
  if p_release_at is not null and p_release_at > p_starts_at then
    raise exception 'auto-release has to be before the hold starts' using errcode = '22007';
  end if;

  perform assert_bookable(p_starts_at, p_ends_at, true);

  begin
    foreach cid in array p_cage_ids loop
      insert into reservations (cage_id, starts_at, ends_at, group_id, kind, status,
                                guest_name, hold_expires_at, notes, created_by)
      values (cid, p_starts_at, p_ends_at, gid, 'staff_hold', 'confirmed',
              left(btrim(p_label), 80), p_release_at, nullif(btrim(p_notes), ''), auth.uid());
    end loop;
  exception when exclusion_violation then
    if sqlerrm like '%block%' then
      raise exception 'that time is blocked (closure or cage maintenance)' using errcode = '23P01';
    end if;
    raise exception 'that time is already booked on one of those cages' using errcode = '23P01';
  end;

  return jsonb_build_object('group_id', gid, 'release_at', p_release_at);
end $$;

-- Cron (already scheduled every minute): checkout holds AND auto-release staff holds.
create or replace function expire_holds() returns int
language plpgsql security definer set search_path = public as $$
declare g uuid; total int := 0; n int;
begin
  for g in
    select distinct group_id from reservations
    where status = 'pending_payment' and hold_expires_at < now()
  loop
    total := total + release_group(g, 'hold expired');
    update payments set status = 'failed', memo = 'hold expired before payment'
    where reservation_group_id = g and status = 'requires_payment';
  end loop;

  update reservations set
    status = 'canceled', canceled_at = now(), hold_expires_at = null,
    notes = coalesce(notes || ' · ', '') || 'staff hold auto-released'
  where kind = 'staff_hold' and status = 'confirmed' and hold_expires_at < now();
  get diagnostics n = row_count;

  return total + n;
end $$;

-- ============================================================================
-- BLOCKS  (admin / owner — same as the blocks RLS policy)
-- ============================================================================

-- Create (p_id null) or edit a block. Refuses to cover live bookings and returns
-- them instead, so staff move or cancel them first; nothing is canceled silently.
-- p_cage_ids null = whole facility. On edit the scope stays as it was.
create or replace function save_block(
  p_id        uuid,
  p_cage_ids  uuid[],
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  p_reason    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b         blocks;
  cages_in  uuid[];
  conflicts jsonb;
  cid       uuid;
  ids       uuid[] := '{}';
  nid       uuid;
begin
  if not is_admin() then
    raise exception 'only admins and owners can block time' using errcode = '42501';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'end time must be after start time' using errcode = '22007';
  end if;

  if p_id is not null then
    select * into b from blocks where id = p_id for update;
    if not found then raise exception 'that block no longer exists' using errcode = '22023'; end if;
    cages_in := case when b.scope = 'facility' then null else array[b.cage_id] end;
  else
    cages_in := case when array_length(p_cage_ids, 1) is null then null else p_cage_ids end;
  end if;

  -- Stop new bookings landing between the check and the insert.
  lock table reservations in share mode;

  select jsonb_agg(c order by c->>'starts_at') into conflicts from (
    select jsonb_build_object(
      'group_id', r.group_id,
      'title', coalesce(min(r.team_name), min(r.party_name), min(r.guest_name),
                        nullif(trim(min(u.first_name) || ' ' || min(u.last_name)), ''), 'Booking'),
      'kind', min(r.kind::text),
      'starts_at', min(r.starts_at), 'ends_at', max(r.ends_at),
      'cages', string_agg(distinct cg.name, ', ')
    ) as c
    from reservations r
    join cages cg on cg.id = r.cage_id
    left join users u on u.id = r.user_id
    where r.status in ('pending_payment','scheduled','confirmed')
      and tstzrange(r.starts_at, r.ends_at) && tstzrange(p_starts_at, p_ends_at)
      and (cages_in is null or r.cage_id = any (cages_in))
    group by r.group_id
  ) x;

  if conflicts is not null then
    return jsonb_build_object('ok', false, 'conflicts', conflicts);
  end if;

  if p_id is not null then
    update blocks set starts_at = p_starts_at, ends_at = p_ends_at,
                      reason = nullif(btrim(p_reason), '')
    where id = p_id;
    ids := array[p_id];
  elsif cages_in is null then
    insert into blocks (scope, starts_at, ends_at, reason, created_by)
    values ('facility', p_starts_at, p_ends_at, nullif(btrim(p_reason), ''), auth.uid())
    returning id into nid;
    ids := array[nid];
  else
    foreach cid in array cages_in loop
      insert into blocks (scope, cage_id, starts_at, ends_at, reason, created_by)
      values ('cage', cid, p_starts_at, p_ends_at, nullif(btrim(p_reason), ''), auth.uid())
      returning id into nid;
      ids := ids || nid;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'ids', to_jsonb(ids));
end $$;

create or replace function delete_block(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'only admins and owners can remove blocks' using errcode = '42501';
  end if;
  delete from blocks where id = p_id;
end $$;

-- Live grid updates when a block changes.
do $$ begin
  alter publication supabase_realtime add table blocks;
exception when duplicate_object then null; when undefined_object then null;
end $$;

notify pgrst, 'reload schema';
