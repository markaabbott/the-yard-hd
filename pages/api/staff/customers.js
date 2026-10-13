// GET  /api/staff/customers?q=smith   find customers by name, email, or phone
// GET  /api/staff/customers?id=uuid   full profile (bookings, money, notes)
// PATCH /api/staff/customers          { id, notes?, firstName?, lastName?, phone? }
// POST /api/staff/customers           { firstName, lastName, email, phone }
//   creates an account for someone booking over the phone. They sign in later
//   with that email (magic link / Google / Apple) and the booking is already theirs.
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff } from '../../../lib/staffAuth';

const COLS = 'id, first_name, last_name, email, phone, needs_name';

async function withHours(list) {
  if (!list.length) return [];
  const { data: bal } = await admin.from('v_membership_balance')
    .select('user_id, hours_remaining, expires_at')
    .in('user_id', list.map((u) => u.id)).gt('expires_at', new Date().toISOString());
  const hours = new Map((bal || []).map((b) => [b.user_id, b]));
  return list.map((u) => ({
    id: u.id,
    name: u.needs_name ? u.email : `${u.first_name} ${u.last_name}`.trim(),
    email: u.email,
    phone: u.phone,
    memberHours: hours.has(u.id) ? Number(hours.get(u.id).hours_remaining) : null,
    memberExpires: hours.get(u.id)?.expires_at || null,
  }));
}

const KIND = { drop_in: 'Drop-in', membership: 'Membership', team: 'Team', party: 'Party', clinic: 'Clinic', donated: 'Donated' };
const LIVE = ['pending_payment', 'scheduled', 'confirmed', 'completed'];

// Full profile for the staff drawer: contact, membership, bookings, money, notes.
async function profile(id) {
  const [u, r, p, n, cg] = await Promise.all([
    admin.from('users').select(`${COLS}, created_at`).eq('id', id).maybeSingle(),
    admin.from('reservations')
      .select('group_id, cage_id, starts_at, ends_at, kind, status, party_name, team_name, guest_count, checked_in_at, no_show_at, hold_expires_at')
      .eq('user_id', id).neq('kind', 'staff_hold').order('starts_at', { ascending: false }).limit(600),
    admin.from('payments')
      .select('reservation_group_id, entry_type, amount_cents, status, is_deposit, balance_due_cents, balance_settled_at')
      .eq('user_id', id),
    admin.from('customer_notes').select('notes, updated_at, updated_by').eq('user_id', id).maybeSingle(),
    admin.from('cages').select('id, name'),
  ]);
  if (u.error) throw u.error;
  if (!u.data) return null;
  const [c] = await withHours([u.data]);
  const cageName = new Map((cg.data || []).map((x) => [x.id, x.name]));
  const pays = p.data || [];
  const now = Date.now();

  const groups = new Map();
  for (const x of r.data || []) {
    if (x.status === 'pending_payment' && x.hold_expires_at && new Date(x.hold_expires_at) < now) continue;
    let g = groups.get(x.group_id);
    if (!g) {
      g = { groupId: x.group_id, kind: x.kind, kindLabel: KIND[x.kind] || x.kind, status: x.status,
        title: x.team_name || x.party_name || null, guestCount: x.guest_count,
        startsAt: x.starts_at, endsAt: x.ends_at, cages: [], checkedInAt: x.checked_in_at, noShowAt: x.no_show_at };
      groups.set(x.group_id, g);
    }
    if (x.starts_at < g.startsAt) g.startsAt = x.starts_at;
    if (x.ends_at > g.endsAt) g.endsAt = x.ends_at;
    const nm = cageName.get(x.cage_id);
    if (nm && !g.cages.includes(nm)) g.cages.push(nm);
  }
  let owed = 0;
  for (const g of groups.values()) {
    const gp = pays.filter((x) => x.reservation_group_id === g.groupId && x.entry_type === 'charge');
    g.owedCents = LIVE.includes(g.status) && g.status !== 'pending_payment'
      ? gp.reduce((a, x) => a + (x.status === 'requires_payment' ? x.amount_cents
        : x.is_deposit && x.status === 'succeeded' && !x.balance_settled_at ? x.balance_due_cents : 0), 0)
      : 0;
    owed += g.owedCents;
  }
  const list = [...groups.values()];
  const upcoming = list.filter((g) => LIVE.includes(g.status) && new Date(g.endsAt) > now).reverse();
  const past = list.filter((g) => !upcoming.includes(g)).slice(0, 40);
  const spent = pays.filter((x) => x.status === 'succeeded' && ['charge', 'refund'].includes(x.entry_type))
    .reduce((a, x) => a + x.amount_cents, 0);

  let notesBy = null;
  if (n.data?.updated_by) {
    const { data: by } = await admin.from('users').select('first_name').eq('id', n.data.updated_by).maybeSingle();
    notesBy = by?.first_name || null;
  }
  return {
    ...c,
    firstName: u.data.first_name, lastName: u.data.last_name, createdAt: u.data.created_at,
    stats: {
      bookings: list.filter((g) => !['canceled', 'pending_payment'].includes(g.status)).length,
      noShows: list.filter((g) => g.status === 'no_show').length,
      canceled: list.filter((g) => g.status === 'canceled').length,
      spentCents: spent, owedCents: owed,
    },
    upcoming, past,
    notes: n.data?.notes || '', notesUpdatedAt: n.data?.updated_at || null, notesBy,
  };
}

export default async function handler(req, res) {
  const who = await requireStaff(req, res);
  if (!who) return;

  if (req.method === 'GET' && req.query.id) {
    try {
      const c = await profile(String(req.query.id));
      if (!c) return res.status(404).json({ error: 'That customer no longer exists.' });
      return res.status(200).json({ customer: c });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'PATCH') {
    const { id, notes, firstName, lastName, phone } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id required' });
    if (typeof notes === 'string') {
      const { error } = await admin.from('customer_notes').upsert({
        user_id: id, notes: notes.slice(0, 4000), updated_by: who.user.id, updated_at: new Date().toISOString(),
      });
      if (error) return res.status(500).json({ error: error.message });
    }
    if (firstName !== undefined || lastName !== undefined || phone !== undefined) {
      const first = String(firstName || '').trim().slice(0, 60);
      const last = String(lastName || '').trim().slice(0, 60);
      if (!first || !last) return res.status(400).json({ error: 'First and last name are required.' });
      const { error } = await admin.from('users')
        .update({ first_name: first, last_name: last, phone: String(phone || '').trim() || null, needs_name: false })
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    }
    try { return res.status(200).json({ customer: await profile(id) }); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }

  if (req.method === 'GET') {
    const q = String(req.query.q || '').replace(/[,()%*\\]/g, ' ').trim();
    if (q.length < 2) return res.status(200).json({ customers: [] });
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    const t = tokens[0];
    const digits = q.replace(/\D/g, '');
    const ors = [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `email.ilike.%${t}%`];
    if (digits.length >= 3) ors.push(`phone.ilike.%${digits.slice(-4)}%`);
    const { data, error } = await admin.from('users').select(COLS).or(ors.join(',')).limit(40);
    if (error) return res.status(500).json({ error: error.message });
    const hay = (u) => `${u.first_name} ${u.last_name} ${u.email} ${(u.phone || '').replace(/\D/g, '')}`.toLowerCase();
    const match = (u, tk) => { const h = hay(u); const dg = tk.replace(/\D/g, ''); return h.includes(tk) || (dg.length >= 3 && h.includes(dg)); };
    const matched = (data || [])
      .filter((u) => tokens.every((tk) => match(u, tk)))
      .sort((a, b) => `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`))
      .slice(0, 8);
    return res.status(200).json({ customers: await withHours(matched) });
  }

  if (req.method === 'POST') {
    const { firstName, lastName, email, phone } = req.body || {};
    const first = String(firstName || '').trim().slice(0, 60);
    const last = String(lastName || '').trim().slice(0, 60);
    const mail = String(email || '').trim().toLowerCase();
    if (!first || !last) return res.status(400).json({ error: 'First and last name are required.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return res.status(400).json({ error: 'Enter a valid email, or book them as a walk-in instead.' });

    const { data: existing } = await admin.from('users').select(COLS).eq('email', mail).maybeSingle();
    if (existing) {
      const [c] = await withHours([existing]);
      return res.status(200).json({ customer: c, existed: true });
    }

    const { data: created, error } = await admin.auth.admin.createUser({
      email: mail, email_confirm: true, user_metadata: { full_name: `${first} ${last}` },
    });
    if (error) return res.status(400).json({ error: error.message });

    const { data: row, error: upErr } = await admin.from('users')
      .update({ first_name: first, last_name: last, phone: String(phone || '').trim() || null, needs_name: false })
      .eq('id', created.user.id).select(COLS).single();
    if (upErr) return res.status(500).json({ error: upErr.message });
    const [c] = await withHours([row]);
    return res.status(200).json({ customer: c, existed: false });
  }

  res.status(405).end('Method not allowed');
}
