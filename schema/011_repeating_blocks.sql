-- Run once in the Supabase SQL editor (after 010).
--
-- Repeating blocks: every week or every other week on chosen weekdays, through
-- an end date. The browser works out each date on the facility's wall clock
-- (so DST never shifts the time) and sends the list; every date becomes its own
-- block row sharing a repeat_id, so one date can be edited or removed alone.

alter table blocks
  add column if not exists repeat_id   uuid,
  add column if not exists repeat_rule text;
create index if not exists blocks_repeat_idx on blocks(repeat_id) where repeat_id is not null;

create or replace function save_block_repeat(
  p_cage_ids       uuid[],
  p_starts         timestamptz[],
  p_ends           timestamptz[],
  p_reason         text default null,
  p_rule           text default null,
  p_skip_conflicts boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n         int := coalesce(array_length(p_starts, 1), 0);
  cages_in  uuid[] := case when array_length(p_cage_ids, 1) is null then null else p_cage_ids end;
  conflicts jsonb;
  skip      int[];
  rid       uuid := gen_random_uuid();
  made      int := 0;
  i         int;
  cid       uuid;
begin
  if not is_admin() then
    raise exception 'only admins and owners can block time' using errcode = '42501';
  end if;
  if n = 0 or n <> coalesce(array_length(p_ends, 1), 0) then
    raise exception 'no dates to block' using errcode = '22023';
  end if;
  if n > 260 then
    raise exception 'that''s too many dates at once. Shorten the repeat' using errcode = '22023';
  end if;
  for i in 1..n loop
    if p_ends[i] <= p_starts[i] then
      raise exception 'end time must be after start time' using errcode = '22007';
    end if;
  end loop;

  lock table reservations in share mode;

  select jsonb_agg(c order by c->>'starts_at'), array_agg(distinct (c->>'occurrence')::int)
    into conflicts, skip
  from (
    select jsonb_build_object(
      'occurrence', o.i,
      'group_id', r.group_id,
      'title', coalesce(min(r.team_name), min(r.party_name), min(r.guest_name),
                        nullif(trim(min(u.first_name) || ' ' || min(u.last_name)), ''), 'Booking'),
      'kind', min(r.kind::text),
      'starts_at', min(r.starts_at), 'ends_at', max(r.ends_at),
      'cages', string_agg(distinct cg.name, ', ')
    ) as c
    from unnest(p_starts, p_ends) with ordinality as o(s, e, i)
    join reservations r
      on tstzrange(r.starts_at, r.ends_at) && tstzrange(o.s, o.e)
     and r.status in ('pending_payment','scheduled','confirmed')
     and (cages_in is null or r.cage_id = any (cages_in))
    join cages cg on cg.id = r.cage_id
    left join users u on u.id = r.user_id
    group by o.i, r.group_id
  ) x;

  if conflicts is not null and not p_skip_conflicts then
    return jsonb_build_object('ok', false, 'conflicts', conflicts, 'total', n);
  end if;

  for i in 1..n loop
    continue when skip is not null and i = any (skip);
    if cages_in is null then
      insert into blocks (scope, starts_at, ends_at, reason, created_by, repeat_id, repeat_rule)
      values ('facility', p_starts[i], p_ends[i], nullif(btrim(p_reason), ''), auth.uid(), rid, p_rule);
    else
      foreach cid in array cages_in loop
        insert into blocks (scope, cage_id, starts_at, ends_at, reason, created_by, repeat_id, repeat_rule)
        values ('cage', cid, p_starts[i], p_ends[i], nullif(btrim(p_reason), ''), auth.uid(), rid, p_rule);
      end loop;
    end if;
    made := made + 1;
  end loop;

  if made = 0 then
    raise exception 'every date has a booking in the way' using errcode = '23P01';
  end if;

  return jsonb_build_object('ok', true, 'repeat_id', rid, 'made', made,
                            'skipped', coalesce(array_length(skip, 1), 0));
end $$;

-- Remove a whole repeat, or this date and everything after it (p_from).
create or replace function delete_block_repeat(p_repeat_id uuid, p_from timestamptz default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then
    raise exception 'only admins and owners can remove blocks' using errcode = '42501';
  end if;
  delete from blocks where repeat_id = p_repeat_id and (p_from is null or starts_at >= p_from);
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function save_block_repeat   to authenticated;
grant execute on function delete_block_repeat to authenticated;

notify pgrst, 'reload schema';
