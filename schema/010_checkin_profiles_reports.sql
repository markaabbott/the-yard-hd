-- Run once in the Supabase SQL editor (after 009).
--
--   * Check-in at the door: staff_check_in / staff_undo_check_in (any staff)
--   * No-shows: staff_no_show / staff_undo_no_show. The deposit (or anything
--     already paid) is kept; an uncollected pay-at-check-in charge is voided.
--   * customer_notes: private staff notes on a customer profile
-- Reports read with the service key from /api/staff/reports (admin/owner only).

alter table reservations
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by uuid references users(id),
  add column if not exists no_show_at    timestamptz,
  add column if not exists no_show_by    uuid references users(id);

create index if not exists reservations_starts_idx on reservations(starts_at);

create table if not exists customer_notes (
  user_id     uuid primary key references users(id) on delete cascade,
  notes       text not null default '',
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);
alter table customer_notes enable row level security;
do $$ begin
  create policy customer_notes_staff on customer_notes for all using (is_staff()) with check (is_staff());
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- CHECK-IN
-- ============================================================================

create or replace function staff_check_in(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  first_start timestamptz;
  owed        int;
  n           int;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select min(starts_at) into first_start from reservations
  where group_id = p_group_id and status in ('confirmed','completed')
    and kind in ('drop_in','membership','team','party');
  if first_start is null then
    raise exception 'this booking can''t be checked in' using errcode = '22023';
  end if;
  if first_start > now() + interval '2 hours' then
    raise exception 'check-in opens 2 hours before the booking starts' using errcode = '22023';
  end if;

  select coalesce(sum(case when status = 'requires_payment' then amount_cents
                           when is_deposit and balance_settled_at is null and status = 'succeeded' then balance_due_cents
                           else 0 end), 0)
    into owed
  from payments where reservation_group_id = p_group_id and entry_type = 'charge';
  if owed > 0 then
    raise exception 'collect the % due before checking in', money_str(owed) using errcode = '22023';
  end if;

  update reservations set checked_in_at = now(), checked_in_by = auth.uid()
  where group_id = p_group_id and status in ('confirmed','completed') and checked_in_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'already checked in' using errcode = '22023';
  end if;

  return jsonb_build_object('group_id', p_group_id, 'checked_in_at', now());
end $$;

create or replace function staff_undo_check_in(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  update reservations set checked_in_at = null, checked_in_by = null
  where group_id = p_group_id and checked_in_at is not null;
end $$;

-- ============================================================================
-- NO-SHOW  (frees the cage; keeps whatever was paid)
-- ============================================================================

create or replace function staff_no_show(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  first_start timestamptz;
  arrived     boolean;
  voided      int;
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;

  select min(starts_at), bool_or(checked_in_at is not null) into first_start, arrived
  from reservations
  where group_id = p_group_id and status in ('confirmed','completed')
    and kind in ('drop_in','membership','team','party');
  if first_start is null then
    raise exception 'this booking can''t be marked as a no-show' using errcode = '22023';
  end if;
  if arrived then
    raise exception 'they''re checked in. Undo the check-in first' using errcode = '22023';
  end if;
  if first_start > now() then
    raise exception 'wait until the start time to mark a no-show' using errcode = '22023';
  end if;

  update reservations set
    status = 'no_show', no_show_at = now(), no_show_by = auth.uid(),
    notes = coalesce(notes || ' · ', '') || 'no-show'
  where group_id = p_group_id and status in ('confirmed','completed');

  update payments set status = 'failed', memo = coalesce(memo || ' · ', '') || 'no-show, not collected'
  where reservation_group_id = p_group_id and entry_type = 'charge' and status = 'requires_payment';
  get diagnostics voided = row_count;

  return jsonb_build_object('group_id', p_group_id, 'voided_charges', voided);
end $$;

create or replace function staff_undo_no_show(p_group_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then
    raise exception 'staff only' using errcode = '42501';
  end if;
  begin
    update reservations set
      status = case when ends_at > now() then 'confirmed' else 'completed' end::reservation_status,
      no_show_at = null, no_show_by = null,
      notes = nullif(regexp_replace(coalesce(notes, ''), '( · )?no-show$', ''), '')
    where group_id = p_group_id and status = 'no_show';
  exception when exclusion_violation then
    raise exception 'that time has been booked since. Move this booking instead' using errcode = '23P01';
  end;

  update payments set status = 'requires_payment',
    memo = nullif(regexp_replace(coalesce(memo, ''), '( · )?no-show, not collected$', ''), '')
  where reservation_group_id = p_group_id and entry_type = 'charge' and status = 'failed'
    and memo like '%no-show, not collected';
end $$;

grant execute on function staff_check_in      to authenticated;
grant execute on function staff_undo_check_in to authenticated;
grant execute on function staff_no_show       to authenticated;
grant execute on function staff_undo_no_show  to authenticated;

notify pgrst, 'reload schema';
