// GET /api/staff/day?start=ISO&end=ISO
// Everything the staff schedule needs for one day: cages, blocks, and every
// booking with its customer and payment ledger. Runs with the service key
// (after a staff check) so coaches see paid status without ledger RLS access.
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff } from '../../../lib/staffAuth';

const KIND = { drop_in: 'Drop-in', membership: 'Membership', team: 'Team', party: 'Party', clinic: 'Clinic', staff_hold: 'Staff hold', donated: 'Donated' };

function payState(g, charge) {
  if (g.status === 'canceled') return 'canceled';
  if (g.status === 'pending_payment') return 'holding';
  if (g.kind === 'clinic') return 'clinic';
  if (g.kind === 'staff_hold') return 'hold';
  if (g.kind === 'donated') return 'donated';
  if (charge) return charge.is_deposit && charge.balance_due_cents > 0 && !charge.balance_settled_at ? 'balance' : 'paid';
  if (g.kind === 'membership') return 'member';
  return 'unpaid';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  const who = await requireStaff(req, res);
  if (!who) return;

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end required' });

  const [s, c, r, b] = await Promise.all([
    admin.from('facility_settings').select('*').eq('id', 1).single(),
    admin.from('cages').select('id, name, sort_order').eq('active', true).order('sort_order'),
    admin.from('reservations')
      .select('id, group_id, cage_id, starts_at, ends_at, kind, status, user_id, guest_name, guest_phone, team_name, party_name, contact_name, contact_phone, guest_count, notes, hold_expires_at, canceled_at, created_at')
      .in('status', ['pending_payment', 'scheduled', 'confirmed', 'completed', 'canceled'])
      .lt('starts_at', end).gt('ends_at', start).order('starts_at'),
    admin.from('blocks').select('id, cage_id, scope, starts_at, ends_at, reason').lt('starts_at', end).gt('ends_at', start),
  ]);
  const failed = [s, c, r, b].find((x) => x.error);
  if (failed) return res.status(500).json({ error: failed.error.message });

  const now = Date.now();
  const rows = (r.data || []).filter((x) => x.status !== 'pending_payment' || !x.hold_expires_at || new Date(x.hold_expires_at) > now);
  const userIds = [...new Set(rows.map((x) => x.user_id).filter(Boolean))];
  const groupIds = [...new Set(rows.map((x) => x.group_id))];

  const [u, p] = await Promise.all([
    userIds.length ? admin.from('users').select('id, first_name, last_name, email, phone').in('id', userIds) : { data: [] },
    groupIds.length ? admin.from('payments')
      .select('id, reservation_group_id, entry_type, amount_cents, method, status, processing_fee_cents, is_deposit, balance_due_cents, balance_settled_at, stripe_payment_intent_id, stripe_refund_id, memo, created_at')
      .in('reservation_group_id', groupIds).order('created_at') : { data: [] },
  ]);
  const users = new Map((u.data || []).map((x) => [x.id, x]));
  const cageName = new Map((c.data || []).map((x) => [x.id, x.name]));

  const groups = new Map();
  for (const x of rows) {
    let g = groups.get(x.group_id);
    if (!g) {
      const cust = x.user_id ? users.get(x.user_id) : null;
      const name = cust ? `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || cust.email : x.guest_name || 'Guest';
      g = {
        groupId: x.group_id, kind: x.kind, kindLabel: KIND[x.kind] || x.kind, status: x.status,
        startsAt: x.starts_at, endsAt: x.ends_at, rows: [], cages: [],
        title: x.team_name || x.party_name || name, name,
        email: cust?.email || null, phone: cust?.phone || x.guest_phone || x.contact_phone || null,
        contactName: x.contact_name, guestCount: x.guest_count, notes: x.notes,
        canceledAt: x.canceled_at, createdAt: x.created_at, holdExpiresAt: x.hold_expires_at,
      };
      groups.set(x.group_id, g);
    }
    if (x.starts_at < g.startsAt) g.startsAt = x.starts_at;
    if (x.ends_at > g.endsAt) g.endsAt = x.ends_at;
    g.rows.push({ id: x.id, cageId: x.cage_id, startsAt: x.starts_at, endsAt: x.ends_at });
    const cn = cageName.get(x.cage_id);
    if (cn && !g.cages.includes(cn)) g.cages.push(cn);
  }

  const pays = p.data || [];
  for (const g of groups.values()) {
    g.payments = pays.filter((x) => x.reservation_group_id === g.groupId);
    const charge = g.payments.find((x) => x.entry_type === 'charge' && x.status === 'succeeded');
    g.chargeCents = charge?.amount_cents || 0;
    g.method = charge?.method || null;
    g.feeCents = charge?.method === 'card' ? charge.processing_fee_cents || 0 : 0;
    g.balanceDueCents = charge?.is_deposit && !charge.balance_settled_at ? charge.balance_due_cents || 0 : 0;
    g.refundedCents = g.payments.filter((x) => x.entry_type === 'refund' && x.status === 'succeeded').reduce((a, x) => a - x.amount_cents, 0);
    g.refundFailed = g.payments.some((x) => x.entry_type === 'refund' && x.status === 'failed');
    g.stripePaymentIntent = charge?.stripe_payment_intent_id || null;
    g.payState = payState(g, charge);
  }

  res.status(200).json({
    role: who.role,
    settings: s.data,
    cages: c.data || [],
    blocks: b.data || [],
    groups: [...groups.values()],
  });
}
