// GET /api/staff/reports?start=ISO&end=ISO[&format=csv]   admin / owner, or coaches if allowed on Team
// Money is counted when it moved (payment created in the range). Bookings and
// cage use are counted by when the booking starts.
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff } from '../../../lib/staffAuth';

const KIND = { drop_in: 'Drop-in', membership: 'Membership', team: 'Team', party: 'Party', clinic: 'Clinic', donation: 'Donation', donated: 'Donated' };
const USED = ['scheduled', 'confirmed', 'completed'];

async function all(make) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

function ymdIn(d, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
const hmIn = (d, tz) => new Date(d).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const dollars = (c) => (c / 100).toFixed(2);
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  const who = await requireStaff(req, res);
  if (!who) return;
  if (!who.perms.reports) return res.status(403).json({ error: 'Ask an admin for access to reports.' });

  const { start, end, format } = req.query;
  if (!start || !end || !(new Date(end) > new Date(start))) return res.status(400).json({ error: 'Pick a valid date range.' });

  try {
    const [{ data: s }, { data: cages }, pays, resv] = await Promise.all([
      admin.from('facility_settings').select('*').eq('id', 1).single(),
      admin.from('cages').select('id, name, sort_order').eq('active', true).order('sort_order'),
      all(() => admin.from('payments')
        .select('id, entry_type, amount_cents, purpose, method, status, processing_fee_cents, is_deposit, reservation_group_id, user_id, memo, created_at')
        .in('status', ['succeeded']).in('entry_type', ['charge', 'refund', 'comp', 'donation'])
        .gte('created_at', start).lt('created_at', end).order('created_at')),
      all(() => admin.from('reservations')
        .select('group_id, cage_id, starts_at, ends_at, kind, status, checked_in_at, user_id, guest_name, party_name, team_name')
        .neq('kind', 'staff_hold').gte('starts_at', start).lt('starts_at', end).order('starts_at')),
    ]);
    const tz = s.timezone;

    if (format === 'csv') {
      const gids = [...new Set(pays.map((p) => p.reservation_group_id).filter(Boolean))];
      const uids = [...new Set(pays.map((p) => p.user_id).filter(Boolean))];
      const [g, u] = await Promise.all([
        gids.length ? all(() => admin.from('reservations').select('group_id, starts_at, guest_name, party_name, team_name').in('group_id', gids)) : [],
        uids.length ? all(() => admin.from('users').select('id, first_name, last_name, email').in('id', uids)) : [],
      ]);
      const gm = new Map();
      for (const x of g) { const c = gm.get(x.group_id); if (!c || x.starts_at < c.starts_at) gm.set(x.group_id, x); }
      const um = new Map(u.map((x) => [x.id, x]));
      const head = ['Date', 'Time', 'Type', 'For', 'Method', 'Amount', 'Card fee', 'Net', 'Customer', 'Email', 'Booking date', 'Booking', 'Memo', 'Payment ID'];
      const lines = [head.join(',')];
      for (const p of pays) {
        const cu = p.user_id ? um.get(p.user_id) : null;
        const bk = p.reservation_group_id ? gm.get(p.reservation_group_id) : null;
        const fee = p.entry_type === 'charge' && p.method === 'card' ? p.processing_fee_cents || 0 : 0;
        lines.push([
          ymdIn(p.created_at, tz), hmIn(p.created_at, tz),
          p.entry_type === 'charge' && p.is_deposit ? 'deposit' : p.entry_type,
          KIND[p.purpose] || p.purpose, p.method, dollars(p.amount_cents), dollars(fee), dollars(p.amount_cents - fee),
          cu ? `${cu.first_name} ${cu.last_name}`.trim() : bk?.guest_name || '', cu?.email || '',
          bk ? ymdIn(bk.starts_at, tz) : '', bk ? bk.team_name || bk.party_name || '' : '', p.memo || '', p.id,
        ].map(csvCell).join(','));
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="the-yard-${ymdIn(start, tz)}-to-${ymdIn(new Date(new Date(end) - 1), tz)}.csv"`);
      return res.status(200).send(lines.join('\n'));
    }

    // Money
    const method = { card: 0, cash: 0, check: 0 };
    const byPurpose = {};
    const byDay = {};
    let gross = 0, refunds = 0, fees = 0, comps = 0, donations = 0;
    for (const p of pays) {
      const day = ymdIn(p.created_at, tz);
      byDay[day] = byDay[day] || { collected: 0, refunds: 0, fees: 0 };
      if (p.entry_type === 'comp') { comps += 1; continue; }
      if (p.entry_type === 'donation') { donations += p.amount_cents; continue; }
      if (p.entry_type === 'charge') {
        gross += p.amount_cents;
        if (p.method in method) method[p.method] += p.amount_cents;
        byDay[day].collected += p.amount_cents;
        if (p.method === 'card') { fees += p.processing_fee_cents || 0; byDay[day].fees += p.processing_fee_cents || 0; }
      } else {
        refunds += p.amount_cents;
        byDay[day].refunds += p.amount_cents;
      }
      const k = p.purpose;
      byPurpose[k] = byPurpose[k] || { label: KIND[k] || k, cents: 0 };
      byPurpose[k].cents += p.amount_cents;
    }

    // Bookings and cage use
    const groups = new Map();
    const usedMin = new Map();
    for (const r of resv) {
      if (r.status === 'pending_payment') continue;
      if (!groups.has(r.group_id)) groups.set(r.group_id, { kind: r.kind, status: r.status, checkedIn: !!r.checked_in_at });
      if (USED.includes(r.status)) usedMin.set(r.cage_id, (usedMin.get(r.cage_id) || 0) + (new Date(r.ends_at) - new Date(r.starts_at)) / 60000);
    }
    const gl = [...groups.values()];
    const kindCount = {};
    for (const g of gl) if (g.status !== 'canceled') kindCount[g.kind] = (kindCount[g.kind] || 0) + 1;

    const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000));
    const openMinPerCage = days * (toMin(s.close_time) - toMin(s.open_time));
    const cageUse = (cages || []).map((c) => ({
      name: c.name, hours: Math.round((usedMin.get(c.id) || 0) / 6) / 10,
      pct: openMinPerCage ? Math.round(((usedMin.get(c.id) || 0) / openMinPerCage) * 100) : 0,
    }));

    // Owed right now on bookings that are still on the books (not limited to the range)
    const open = await all(() => admin.from('payments')
      .select('reservation_group_id, amount_cents, status, is_deposit, balance_due_cents, balance_settled_at')
      .eq('entry_type', 'charge')
      .or('status.eq.requires_payment,and(is_deposit.eq.true,balance_settled_at.is.null,status.eq.succeeded)'));
    const openIds = [...new Set(open.map((x) => x.reservation_group_id).filter(Boolean))];
    const liveIds = new Set();
    for (let i = 0; i < openIds.length; i += 200) {
      const { data } = await admin.from('reservations').select('group_id')
        .in('group_id', openIds.slice(i, i + 200)).in('status', ['scheduled', 'confirmed', 'completed']);
      for (const x of data || []) liveIds.add(x.group_id);
    }
    let owedCents = 0, owedCount = 0;
    const counted = new Set();
    for (const x of open) {
      if (!liveIds.has(x.reservation_group_id)) continue;
      const c = x.status === 'requires_payment' ? x.amount_cents : x.balance_due_cents;
      if (c > 0) { owedCents += c; if (!counted.has(x.reservation_group_id)) { counted.add(x.reservation_group_id); owedCount += 1; } }
    }

    res.status(200).json({
      tz,
      money: { grossCents: gross, refundsCents: refunds, feesCents: fees, netCents: gross + refunds - fees, method, comps, donationsCents: donations },
      byPurpose: Object.values(byPurpose).sort((a, b) => b.cents - a.cents),
      byDay: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, v]) => ({ day, ...v, net: v.collected + v.refunds - v.fees })),
      bookings: {
        total: gl.filter((g) => g.status !== 'canceled').length,
        canceled: gl.filter((g) => g.status === 'canceled').length,
        noShows: gl.filter((g) => g.status === 'no_show').length,
        checkedIn: gl.filter((g) => g.checkedIn).length,
        byKind: Object.entries(kindCount).map(([k, n]) => ({ label: KIND[k] || k, n })).sort((a, b) => b.n - a.n),
      },
      cageUse,
      openHoursPerCage: Math.round(openMinPerCage / 6) / 10,
      owed: { cents: owedCents, count: owedCount },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
