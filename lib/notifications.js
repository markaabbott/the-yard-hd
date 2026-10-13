// Server-only. Drains the notifications queue (filled by confirm_payment,
// cancel_reservation_group, etc.) and sends each through Resend.
// Templates without a renderer stay queued until one is added.
import { supabaseAdmin as supabase } from './supabaseAdmin';
import { renderEmail, TEMPLATES } from './emailTemplates';
import { sendEmail } from './email';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://app.theyardhd.com';

async function buildData(n, facility) {
  const ref = n.subject_ref || {};
  // booking_canceled doesn't carry group_id in its ref; its dedupe key does.
  const groupId = ref.group_id || (n.dedupe_key?.startsWith('cancel:') ? n.dedupe_key.slice(7) : null);

  const [{ data: user }, { data: res }] = await Promise.all([
    n.user_id ? supabase.from('users').select('first_name').eq('id', n.user_id).maybeSingle() : { data: null },
    groupId ? supabase.from('reservations').select('starts_at, ends_at, kind, user_id, guest_name, team_name, party_name, cages(name, sort_order)').eq('group_id', groupId) : { data: [] },
  ]);

  const list = res || [];
  const starts = list.map((r) => r.starts_at).sort()[0] || ref.starts_at;
  const ends = list.map((r) => r.ends_at).sort().slice(-1)[0] || null;
  const cages = [...new Map(list.filter((r) => r.cages).map((r) => [r.cages.name, r.cages.sort_order])).entries()]
    .sort((a, b) => a[1] - b[1]).map(([name]) => name);

  const staff = n.template === 'staff_alert' ? await staffAlertData(ref, list, groupId) : null;

  return {
    ref, staff,
    firstName: user?.first_name || '',
    startsAt: starts,
    endsAt: ends,
    cages: cages.length ? cages : ['Batting cage'],
    amount: ref.amount,
    amountLabel: ref.amount_label || null,
    balanceDue: ref.balance_due,
    refund: ref.refund,
    fee: ref.fee,
    hoursReturned: ref.hours_returned,
    oldStartsAt: ref.old_starts_at,
    oldEndsAt: ref.old_ends_at,
    timezone: facility.timezone,
    policy: { freeHours: facility.cancel_free_hours, halfHours: facility.cancel_half_hours },
    facility,
    siteUrl: SITE_URL,
  };
}

const KIND = { drop_in: 'Drop-in', membership: 'Member hours', team: 'Team', party: 'Party', clinic: 'Clinic', donated: 'Donated' };
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;

// Who the booking is for and where the money stands, read at send time so the
// payment row written in the same transaction is already there.
async function staffAlertData(ref, list, groupId) {
  if (ref.event === 'blocked' || ref.event === 'unblocked') {
    let dates = 1, cages = ref.scope === 'facility' ? ['Whole facility'] : [ref.cage].filter(Boolean), last = null;
    if (ref.event === 'blocked') {
      const q = supabase.from('blocks').select('starts_at, scope, cages(name, sort_order)');
      const { data: bl } = ref.repeat_id ? await q.eq('repeat_id', ref.repeat_id) : await q.eq('starts_at', ref.starts_at).eq('ends_at', ref.ends_at);
      if (bl?.length) {
        dates = new Set(bl.map((b) => b.starts_at)).size;
        last = bl.map((b) => b.starts_at).sort().slice(-1)[0];
        cages = bl.some((b) => b.scope === 'facility') ? ['Whole facility']
          : [...new Map(bl.filter((b) => b.cages).map((b) => [b.cages.name, b.cages.sort_order])).entries()].sort((a, b) => a[1] - b[1]).map(([nm]) => nm);
      }
    }
    return { cages, dates, lastStartsAt: last };
  }
  const r = list[0] || {};
  const [{ data: cust }, { data: pays }] = await Promise.all([
    r.user_id ? supabase.from('users').select('first_name, last_name, email, phone').eq('id', r.user_id).maybeSingle() : { data: null },
    groupId ? supabase.from('payments').select('entry_type, amount_cents, status, method, is_deposit, balance_due_cents').eq('reservation_group_id', groupId) : { data: [] },
  ]);
  const custName = cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || cust.email : r.guest_name || 'Walk-in';
  const p = pays || [];
  const paid = p.find((x) => x.entry_type === 'charge' && x.status === 'succeeded');
  const open = p.find((x) => x.entry_type === 'charge' && x.status === 'requires_payment');
  const refund = p.filter((x) => x.entry_type === 'refund' && x.status === 'succeeded').reduce((a, x) => a - x.amount_cents, 0);
  const money_ = p.some((x) => x.entry_type === 'comp') ? 'No charge'
    : paid ? `${money(paid.amount_cents)} paid${paid.method !== 'card' ? ` (${paid.method})` : ''}${paid.is_deposit && paid.balance_due_cents > 0 ? `, ${money(paid.balance_due_cents)} due at the party` : ''}`
    : open ? `${money(open.amount_cents)} due at check-in`
    : r.kind === 'membership' ? 'Member hours' : null;
  return {
    title: r.team_name || r.party_name || custName,
    customer: custName + (r.user_id ? '' : ' (walk-in)'),
    contact: cust ? [cust.email, cust.phone].filter(Boolean).join(' · ') : null,
    kind: KIND[r.kind] || r.kind,
    money: money_,
    refund: ref.event === 'canceled' ? (refund ? money(refund) : 'None') : null,
  };
}

export async function drainNotifications(limit = 25) {
  const { data: queued, error } = await supabase.from('notifications')
    .select('*').eq('status', 'queued').eq('channel', 'email')
    .in('template', Object.keys(TEMPLATES))
    .order('created_at').limit(limit);
  if (error) throw error;
  if (!queued.length) return { sent: 0, failed: 0 };

  const { data: facility } = await supabase.from('facility_settings')
    .select('timezone, street, city, state, zip, phone, landmark, cancel_free_hours, cancel_half_hours')
    .eq('id', 1).single();

  let sent = 0, failed = 0;
  for (const n of queued) {
    try {
      const email = renderEmail(n.template, await buildData(n, facility));
      // Idempotency key = notification id, so two overlapping drains never double-send.
      const id = await sendEmail({ to: n.to_address, ...email, idempotencyKey: n.id });
      await supabase.from('notifications').update({ status: 'sent', provider_id: id, sent_at: new Date().toISOString(), error: null }).eq('id', n.id);
      sent++;
    } catch (e) {
      console.error('[notifications]', n.template, n.id, e.message);
      await supabase.from('notifications').update({ status: 'failed', error: e.message }).eq('id', n.id);
      failed++;
    }
  }
  return { sent, failed };
}
