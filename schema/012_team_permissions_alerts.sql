-- Run once in the Supabase SQL editor (after 011).
--
-- 1. Coach permissions. Admins and owners can always do everything; these
--    switches decide what coaches can do. Set on /staff → Team.
-- 2. Permission checks wrap staff_book, cancel_reservation_group and
--    move_reservation_group (originals renamed *_core, not callable directly).
--    NOTE: a future migration that redefines one of those three must redefine
--    the *_core function instead, or the check is lost.
-- 3. Staff email alerts: per-person switches; triggers queue a staff_alert
--    email for new bookings, cancellations, staff bookings, and blocks.

-- ============================================================================
-- COACH PERMISSIONS
-- ============================================================================

alter table facility_settings
  add column if not exists coach_can_comp           boolean not null default false,
  add column if not exists coach_can_refund         boolean not null default false,
  add column if not exists coach_can_move           boolean not null default true,
  add column if not exists coach_can_edit_customers boolean not null default true,
  add column if not exists coach_can_reports        boolean not null default false;

create or replace function staff_can(p_perm text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare s facility_settings := fs();
begin
  if is_admin() then return true; end if;
  if not is_staff() then return false; end if;
  return case p_perm
    when 'comp'           then s.coach_can_comp
    when 'refund'         then s.coach_can_refund
    when 'move'           then s.coach_can_move
    when 'edit_customers' then s.coach_can_edit_customers
    when 'reports'        then s.coach_can_reports
    else false end;
end $$;
grant execute on function staff_can(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_proc where proname = 'staff_book_core') then
    alter function staff_book(uuid[], timestamptz, timestamptz, reservation_kind, uuid, text, text, text, int, text, text, text, boolean, uuid)
      rename to staff_book_core;
  end if;
  if not exists (select 1 from pg_proc where proname = 'cancel_reservation_group_core') then
    alter function cancel_reservation_group(uuid, text, boolean) rename to cancel_reservation_group_core;
  end if;
  if not exists (select 1 from pg_proc where proname = 'move_reservation_group_core') then
    alter function move_reservation_group(uuid, timestamptz, uuid, boolean) rename to move_reservation_group_core;
  end if;
end $$;

revoke all on function staff_book_core from public, anon, authenticated;
revoke all on function cancel_reservation_group_core from public, anon, authenticated;
revoke all on function move_reservation_group_core from public, anon, authenticated;

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
  p_payment     text default 'card',
  p_comp_memo   text default null,
  p_notify      boolean default true,
  p_from_hold   uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_payment = 'comp' and not staff_can('comp') then
    raise exception 'only an admin can book at no charge' using errcode = '42501';
  end if;
  return staff_book_core(p_cage_ids, p_starts_at, p_ends_at, p_kind, p_user_id, p_guest_name, p_guest_phone,
                         p_party_name, p_guest_count, p_notes, p_payment, p_comp_memo, p_notify, p_from_hold);
end $$;

create or replace function cancel_reservation_group(
  p_group_id   uuid,
  p_reason     text default null,
  p_charge_fee boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if is_staff() and not staff_can('refund')
     and not exists (select 1 from reservations where group_id = p_group_id and user_id = auth.uid())
     and exists (select 1 from payments where reservation_group_id = p_group_id
                 and entry_type = 'charge' and status = 'succeeded' and amount_cents > 0) then
    raise exception 'this booking is paid, so an admin has to cancel it (it issues a refund)' using errcode = '42501';
  end if;
  return cancel_reservation_group_core(p_group_id, p_reason, p_charge_fee);
end $$;

create or replace function move_reservation_group(
  p_group_id      uuid,
  p_new_starts_at timestamptz,
  p_cage_id       uuid default null,
  p_notify        boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not staff_can('move') then
    raise exception 'only an admin can move bookings' using errcode = '42501';
  end if;
  return move_reservation_group_core(p_group_id, p_new_starts_at, p_cage_id, p_notify);
end $$;

grant execute on function staff_book               to authenticated;
grant execute on function cancel_reservation_group to authenticated;
grant execute on function move_reservation_group   to authenticated;

-- ============================================================================
-- STAFF EMAIL ALERTS
-- ============================================================================

-- No row = role default: admins and owners get new bookings + cancellations,
-- coaches get nothing until they turn something on.
create table if not exists staff_alert_prefs (
  user_id        uuid primary key references users(id) on delete cascade,
  new_bookings   boolean not null default false,
  cancellations  boolean not null default false,
  staff_bookings boolean not null default false,
  blocks         boolean not null default false,
  updated_at     timestamptz not null default now()
);
alter table staff_alert_prefs enable row level security;
do $$ begin
  create policy alert_prefs_own on staff_alert_prefs for all
    using (user_id = auth.uid()) with check (user_id = auth.uid() and is_staff());
exception when duplicate_object then null;
end $$;

-- Everyone on staff who wants this kind of alert, except whoever caused it.
create or replace function staff_alert_recipients(p_kind text)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = public as $$
  select u.id, u.email
  from users u
  join (select ur.user_id, bool_or(ur.role in ('admin','owner')) as senior
        from user_roles ur where ur.role in ('coach','admin','owner') group by ur.user_id) r on r.user_id = u.id
  left join staff_alert_prefs p on p.user_id = u.id
  where u.email is not null
    and u.id is distinct from auth.uid()
    and case p_kind
          when 'new_bookings'   then coalesce(p.new_bookings, r.senior)
          when 'cancellations'  then coalesce(p.cancellations, r.senior)
          when 'staff_bookings' then coalesce(p.staff_bookings, false)
          when 'blocks'         then coalesce(p.blocks, false)
          else false end;
$$;

create or replace function actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), email)
  from users where id = auth.uid();
$$;

create or replace function alert_on_reservation() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ev    text;
  pref  text;
  by_staff boolean;
  rc    record;
begin
  if new.kind = 'staff_hold' then return new; end if;

  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status = 'pending_payment') then
    by_staff := new.created_by is not null and exists (
      select 1 from user_roles where user_id = new.created_by and role in ('coach','admin','owner'));
    ev := 'booked';
    pref := case when by_staff then 'staff_bookings' else 'new_bookings' end;
  elsif tg_op = 'UPDATE' and new.status = 'canceled' and old.status in ('scheduled','confirmed') then
    ev := 'canceled';
    pref := 'cancellations';
    by_staff := new.canceled_by is not null and new.canceled_by is distinct from new.user_id;
  else
    return new;
  end if;

  for rc in select * from staff_alert_recipients(pref) loop
    perform queue_notification('staff_alert', rc.user_id, rc.email,
      jsonb_build_object('event', ev, 'group_id', new.group_id, 'starts_at', new.starts_at,
                         'by_staff', by_staff,
                         'actor', case when by_staff then (select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), email)
                                                           from users where id = case when ev = 'booked' then new.created_by else new.canceled_by end)
                                       end),
      'alert:' || ev || ':' || new.group_id || ':' || rc.user_id);
  end loop;
  return new;
end $$;

drop trigger if exists reservations_staff_alert on reservations;
create trigger reservations_staff_alert
  after insert or update of status on reservations
  for each row execute function alert_on_reservation();

create or replace function alert_on_block() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b    blocks := case when tg_op = 'DELETE' then old else new end;
  ev   text := case when tg_op = 'DELETE' then 'unblocked' else 'blocked' end;
  key  text;
  rc   record;
begin
  -- One email per save or remove, however many rows (cages, repeat dates) it touched.
  key := coalesce(b.repeat_id::text, b.starts_at::text || '|' || b.ends_at::text) || ':' || extract(epoch from now())::bigint;
  for rc in select * from staff_alert_recipients('blocks') loop
    perform queue_notification('staff_alert', rc.user_id, rc.email,
      jsonb_build_object('event', ev, 'starts_at', b.starts_at, 'ends_at', b.ends_at,
                         'reason', b.reason, 'scope', b.scope, 'repeat_id', b.repeat_id,
                         'repeat_rule', b.repeat_rule, 'actor', actor_name(),
                         'cage', (select name from cages where id = b.cage_id)),
      'alert:' || ev || ':' || key || ':' || rc.user_id);
  end loop;
  return null;
end $$;

drop trigger if exists blocks_staff_alert on blocks;
create trigger blocks_staff_alert
  after insert or delete on blocks
  for each row execute function alert_on_block();

notify pgrst, 'reload schema';
