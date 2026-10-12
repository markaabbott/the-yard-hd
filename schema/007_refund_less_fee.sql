-- Customer cancellations refund less the card processing fee, per Facility
-- Policies §8. Stripe keeps its fee on refunds, so the fee is deducted from
-- every customer refund (full or 50%). Staff cancellations stay whole.

create or replace function cancel_reservation_group(
  p_group_id uuid,
  p_reason   text default null
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
    if not staff and pay.method = 'card' then
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
          to_char(frac * 100, 'FM990') || '% per cancellation policy' ||
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
