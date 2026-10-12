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
    groupId ? supabase.from('reservations').select('starts_at, ends_at, cages(name, sort_order)').eq('group_id', groupId) : { data: [] },
  ]);

  const list = res || [];
  const starts = list.map((r) => r.starts_at).sort()[0] || ref.starts_at;
  const ends = list.map((r) => r.ends_at).sort().slice(-1)[0] || null;
  const cages = [...new Map(list.filter((r) => r.cages).map((r) => [r.cages.name, r.cages.sort_order])).entries()]
    .sort((a, b) => a[1] - b[1]).map(([name]) => name);

  return {
    firstName: user?.first_name || '',
    startsAt: starts,
    endsAt: ends,
    cages: cages.length ? cages : ['Batting cage'],
    amount: ref.amount,
    balanceDue: ref.balance_due,
    refund: ref.refund,
    fee: ref.fee,
    hoursReturned: ref.hours_returned,
    timezone: facility.timezone,
    policy: { freeHours: facility.cancel_free_hours, halfHours: facility.cancel_half_hours },
    facility,
    siteUrl: SITE_URL,
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
