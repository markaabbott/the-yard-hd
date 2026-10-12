-- Staff cancel gets a choice: The Yard covers the card fee (full refund), or
-- the customer asked for it and pays the fee like a self-serve cancel.
-- Staff can also move a booking to a new time/cage with no fee at all.

drop function if exists cancel_reservation_group(uuid, text);

create or replace function cancel_reservation_group(
  p_group_id   uuid,
  p_reason     text default null,
  p_charge_fee boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  actor    uuid := auth.uid();
  staff    boolean := is_staff();
  r        reservations;
  frac     numeric;
  pay      payments;
  refund   int := 0;
  fee      int := 0;
  hrs_back numeric := 0;
  u        users;
begin
  select * into r from reservations
  where group_id = p_group_id
    and status in ('pending_payment','scheduled','confirmed')
  order by starts_at limit 1;
  if not found then
    raise exception 'nothing to cancel' using errcode = '22023';
  end if;
  if not staff and r.user_id is distinct from actor then
    raise exception 'not your reservation' using errcode = '42501';
  end if;

  frac := case when staff then 1.0 else refund_fraction(r.starts_at) end;

  select * into pay from payments
  where reservation_group_id = p_group_id
    and entry_type = 'charge' and status = 'succeeded'
  order by created_at limit 1;

  if found and frac > 0 then
    refund := round(pay.amount_cents * frac)::int;
    if (not staff or p_charge_fee) and pay.method = 'card' then
      fee := least(coalesce(pay.processing_fee_cents, 0), refund);
      refund := refund - fee;
    end if;

    if refund > 0 then
      insert into payments (
        entry_type, amount_cents, purpose, reservation_group_id, user_id,
        parent_payment_id, status, method, recorded_by, memo
      ) values (
        'refund', -refund, pay.purpose, p_group_id, pay.user_id,
        pay.id, 'succeeded', pay.method, actor,
        coalesce(p_reason, 'canceled') || ' · ' ||
          case when staff and not p_charge_fee then 'full refund, fee absorbed'
               else to_char(frac * 100, 'FM990') || '% per cancellation policy' end ||
          case when fee > 0 then ' less ' || money_str(fee) || ' card fee' else '' end
      );
    end if;
  end if;

  if frac >= 1.0 then
    select coalesce(-sum(hours), 0) into hrs_back
    from membership_hour_entries
    where reservation_group_id = p_group_id and entry_type = 'debit';

    if hrs_back > 0 then
      insert into membership_hour_entries (period_id, entry_type, hours, reservation_group_id, created_by, memo)
      select period_id, 'credit', hrs_back, p_group_id, actor, 'canceled inside free window'
      from membership_hour_entries
      where reservation_group_id = p_group_id and entry_type = 'debit'
      limit 1;
    end if;
  else
    hrs_back := 0;
  end if;

  update reservations set
    status = 'canceled', canceled_at = now(), canceled_by = actor,
    hold_expires_at = null,
    notes = coalesce(notes || ' · ', '') || coalesce(p_reason, 'canceled')
  where group_id = p_group_id
    and status in ('pending_payment','scheduled','confirmed');

  select * into u from users where id = r.user_id;
  perform queue_notification('booking_canceled', r.user_id, u.email,
    jsonb_build_object('starts_at', r.starts_at, 'refund', money_str(refund),
                       'fee', money_str(fee), 'hours_returned', hrs_back),
    'cancel:' || p_group_id);

  return jsonb_build_object(
    'group_id', p_group_id,
    'refund_cents', refund,
    'fee_cents', fee,
    'refund_fraction', frac,
    'hours_returned', hrs_back
  );
end $$;

-- Staff-only. Shifts the whole group by the same amount (duration and price
-- unchanged). A new cage is allowed only for single-cage bookings.
create or replace function move_reservation_group(
  p_group_id      uuid,
  p_new_starts_at timestamptz,
  p_cage_id       uuid default null,
  p_notify        boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n      int;
  old_s  timestamptz;
  old_e  timestamptz;
  delta  interval;
  r      reservations;
  u      users;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select count(*), min(starts_at), max(ends_at) into n, old_s, old_e
  from reservations
  where group_id = p_group_id and status in ('pending_payment','scheduled','confirmed');
  if n = 0 then
    raise exception 'nothing to move' using errcode = '22023';
  end if;
  if p_cage_id is not null and n > 1 then
    raise exception 'this booking covers more than one cage; move it without changing the cage' using errcode = '22023';
  end if;
  if p_cage_id is not null and not exists (select 1 from cages where id = p_cage_id and active) then
    raise exception 'unknown cage' using errcode = '22023';
  end if;

  delta := p_new_starts_at - old_s;
  if delta = interval '0' and (p_cage_id is null or exists (
    select 1 from reservations where group_id = p_group_id and cage_id = p_cage_id
      and status in ('pending_payment','scheduled','confirmed'))) then
    raise exception 'that is the same time and cage' using errcode = '22023';
  end if;

  perform assert_bookable(p_new_starts_at, old_e + delta, true);

  begin
    update reservations set
      starts_at = starts_at + delta,
      ends_at   = ends_at + delta,
      cage_id   = coalesce(p_cage_id, cage_id),
      notes     = coalesce(notes || ' · ', '') || 'moved by staff from ' ||
                  to_char(local_ts(old_s), 'Mon FMDD FMHH12:MI AM')
    where group_id = p_group_id and status in ('pending_payment','scheduled','confirmed');
  exception when exclusion_violation then
    if sqlerrm like '%block%' then
      raise exception 'that time is blocked (closure or cage maintenance)' using errcode = '23P01';
    end if;
    raise exception 'that time is already booked on that cage' using errcode = '23P01';
  end;

  select * into r from reservations where group_id = p_group_id order by starts_at limit 1;
  if p_notify and r.user_id is not null then
    select * into u from users where id = r.user_id;
    perform queue_notification('booking_moved', r.user_id, u.email,
      jsonb_build_object('group_id', p_group_id, 'starts_at', r.starts_at,
                         'old_starts_at', old_s, 'old_ends_at', old_e),
      'move:' || p_group_id || ':' || extract(epoch from clock_timestamp())::bigint);
  end if;

  return jsonb_build_object('group_id', p_group_id, 'starts_at', p_new_starts_at, 'ends_at', old_e + delta);
end $$;

notify pgrst, 'reload schema';
