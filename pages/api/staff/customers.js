// GET  /api/staff/customers?q=smith      find accounts, walk-ins, and teams by name, email, phone, or team/party name
// GET  /api/staff/customers?id=uuid      full account profile (bookings, money, notes)
// GET  /api/staff/customers?walkin=name  walk-in profile (bookings made without an account under that name)
// PATCH /api/staff/customers             { id, notes?, firstName?, lastName?, phone? }
// POST /api/staff/customers              { firstName, lastName, email, phone }
//   creates an account for someone booking over the phone. They sign in later
//   with that email (magic link / Google / Apple) and the booking is already theirs.
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff } from '../../../lib/staffAuth';

const COLS = 'id, first_name, last_name, email, phone, needs_name';
const RCOLS = 'group_id, cage_id, starts_at, ends_at, kind, status, user_id, guest_name, guest_phone, party_name, team_name, guest_count, no_show_at, hold_expires_at';
const KIND = { drop_in: 'Drop-in', membership: 'Membership', team: 'Team', party: 'Party', clinic: 'Clinic', donated: 'Donated' };
const LIVE = ['pending_payment', 'scheduled', 'confirmed', 'completed'];
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const fullName = (u) => (u.needs_name ? u.email : `${u.first_name} ${u.last_name}`.trim());

async function withHours(list) {
  if (!list.length) return [];
  const { data: bal } = await admin.from('v_membership_balance')
    .select('user_id, hours_remaining, expires_at')
    .in('user_id', list.map((u) => u.id)).gt('expires_at', new Date().toISOString());
  const hours = new Map((bal || []).map((b) => [b.user_id, b]));
  return list.map((u) => ({
    type: 'account',
    id: u.id,
    name: fullName(u),
    email: u.email,
    phone: u.phone,
    memberHours: hours.has(u.id) ? Number(hours.get(u.id).hours_remaining) : null,
    memberExpires: hours.get(u.id)?.expires_at || null,
  }));
}

// Reservation rows + their payments -> upcoming / history / totals.
async function history(rows) {
  const now = Date.now();
  rows = rows.filter((x) => !(x.status === 'pending_payment' && x.hold_expires_at && new Date(x.hold_expires_at) < now));
  const gids = [...new Set(rows.map((x) => x.group_id))];
  const [cg, p] = await Promise.all([
    admin.from('cages').select('id, name'),
    gids.length ? admin.from('payments')
      .select('reservation_group_id, entry_type, amount_cents, status, is_deposit, balance_due_cents, balance_settled_at')
      .in('reservation_group_id', gids.slice(0, 300)) : { data: [] },
  ]);
  const cageName = new Map((cg.data || []).map((x) => [x.id, x.name]));
  const pays = p.data || [];

  const groups = new Map();
  for (const x of rows) {
    let g = groups.get(x.group_id);
    if (!g) {
      g = { groupId: x.group_id, kind: x.kind, kindLabel: KIND[x.kind] || x.kind, status: x.status,
        title: x.team_name || x.party_name || null, guestCount: x.guest_count,
        startsAt: x.starts_at, endsAt: x.ends_at, cages: [], noShowAt: x.no_show_at };
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
  const list = [...groups.values()].sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
  const upcoming = list.filter((g) => LIVE.includes(g.status) && new Date(g.endsAt) > now).reverse();
  const past = list.filter((g) => !upcoming.includes(g)).slice(0, 40);
  const spent = pays.filter((x) => x.status === 'succeeded' && ['charge', 'refund'].includes(x.entry_type))
    .reduce((a, x) => a + x.amount_cents, 0);
  const teams = [...new Set(list.map((g) => g.title).filter(Boolean))];
  return {
    upcoming, past, teams,
    stats: {
      bookings: list.filter((g) => !['canceled', 'pending_payment'].includes(g.status)).length,
      noShows: list.filter((g) => g.status === 'no_show').length,
      canceled: list.filter((g) => g.status === 'canceled').length,
      spentCents: spent, owedCents: owed,
    },
  };
}

async function accountProfile(id) {
  const [u, r, n] = await Promise.all([
    admin.from('users').select(`${COLS}, created_at`).eq('id', id).maybeSingle(),
    admin.from('reservations').select(RCOLS).eq('user_id', id).neq('kind', 'staff_hold')
      .order('starts_at', { ascending: false }).limit(600),
    admin.from('customer_notes').select('notes, updated_at, updated_by').eq('user_id', id).maybeSingle(),
  ]);
  if (u.error) throw u.error;
  if (!u.data) return null;
  const [c] = await withHours([u.data]);
  let notesBy = null;
  if (n.data?.updated_by) {
    const { data: by } = await admin.from('users').select('first_name').eq('id', n.data.updated_by).maybeSingle();
    notesBy = by?.first_name || null;
  }
  return {
    ...c, ...(await history(r.data || [])),
    firstName: u.data.first_name, lastName: u.data.last_name, createdAt: u.data.created_at,
    notes: n.data?.notes || '', notesUpdatedAt: n.data?.updated_at || null, notesBy,
  };
}

async function walkinProfile(name) {
  const nm = String(name || '').trim();
  if (!nm) return null;
  const { data, error } = await admin.from('reservations').select(RCOLS)
    .is('user_id', null).ilike('guest_name', likeEsc(nm)).neq('kind', 'staff_hold')
    .order('starts_at', { ascending: false }).limit(600);
  if (error) throw error;
  if (!data?.length) return null;
  const phones = [...new Set(data.map((x) => x.guest_phone).filter(Boolean))];
  const first = data[data.length - 1];
  return {
    type: 'walkin', id: `walkin:${nm.toLowerCase()}`, name: data[0].guest_name,
    phone: phones[0] || null, phones, createdAt: first.starts_at,
    ...(await history(data)),
  };
}

async function search(q) {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const t = tokens[0];
  const digits = q.replace(/\D/g, '');
  const tail = digits.length >= 3 ? digits.slice(-4) : null;

  const uOrs = [`first_name.ilike.%${t}%`, `last_name.ilike.%${t}%`, `email.ilike.%${t}%`];
  if (tail) uOrs.push(`phone.ilike.%${tail}%`);
  const rOrs = [`guest_name.ilike.%${t}%`, `team_name.ilike.%${t}%`, `party_name.ilike.%${t}%`];
  if (tail) rOrs.push(`guest_phone.ilike.%${tail}%`, `contact_phone.ilike.%${tail}%`);

  const [u, r] = await Promise.all([
    admin.from('users').select(COLS).or(uOrs.join(',')).limit(40),
    admin.from('reservations').select('user_id, guest_name, guest_phone, contact_phone, team_name, party_name, starts_at, group_id, status')
      .or(rOrs.join(',')).neq('kind', 'staff_hold').neq('status', 'pending_payment')
      .order('starts_at', { ascending: false }).limit(500),
  ]);
  if (u.error) throw u.error;
  if (r.error) throw r.error;

  const matches = (hay) => tokens.every((tk) => { const dg = tk.replace(/\D/g, ''); return hay.includes(tk) || (dg.length >= 3 && hay.includes(dg)); });

  // Accounts matched directly
  const users = new Map();
  for (const x of u.data || []) {
    if (matches(`${x.first_name} ${x.last_name} ${x.email} ${digitsOf(x.phone)}`.toLowerCase())) users.set(x.id, x);
  }

  // Walk-ins (no account) and team/party names on account bookings
  const walk = new Map();
  const teamsByUser = new Map();
  for (const x of r.data || []) {
    const hay = `${x.guest_name || ''} ${x.team_name || ''} ${x.party_name || ''} ${digitsOf(x.guest_phone)} ${digitsOf(x.contact_phone)}`.toLowerCase();
    if (!matches(hay)) continue;
    const label = x.team_name || x.party_name;
    if (x.user_id) {
      if (label) { const s = teamsByUser.get(x.user_id) || new Set(); s.add(label); teamsByUser.set(x.user_id, s); }
      continue;
    }
    if (!x.guest_name) continue;
    const key = x.guest_name.trim().toLowerCase();
    const w = walk.get(key) || { type: 'walkin', id: `walkin:${key}`, name: x.guest_name.trim(), phone: x.guest_phone || null, groups: new Set(), lastAt: x.starts_at, teams: new Set() };
    w.groups.add(x.group_id);
    if (!w.phone && x.guest_phone) w.phone = x.guest_phone;
    if (label) w.teams.add(label);
    walk.set(key, w);
  }
  const missing = [...teamsByUser.keys()].filter((id) => !users.has(id));
  if (missing.length) {
    const { data } = await admin.from('users').select(COLS).in('id', missing.slice(0, 20));
    for (const x of data || []) users.set(x.id, x);
  }

  const accounts = (await withHours([...users.values()]))
    .map((c) => ({ ...c, teams: [...(teamsByUser.get(c.id) || [])] }))
    .sort((a, b) => b.teams.length - a.teams.length || a.name.localeCompare(b.name));
  const walkins = [...walk.values()]
    .map((w) => ({ type: 'walkin', id: w.id, name: w.name, phone: w.phone, bookings: w.groups.size, lastAt: w.lastAt, teams: [...w.teams] }))
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  return [...accounts.slice(0, 8), ...walkins.slice(0, 6)];
}

export default async function handler(req, res) {
  const who = await requireStaff(req, res);
  if (!who) return;

  if (req.method === 'GET' && (req.query.id || req.query.walkin)) {
    try {
      const c = req.query.id ? await accountProfile(String(req.query.id)) : await walkinProfile(String(req.query.walkin));
      if (!c) return res.status(404).json({ error: 'No bookings found for that customer.' });
      return res.status(200).json({ customer: c });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === 'GET') {
    const q = String(req.query.q || '').replace(/[,()%*\\]/g, ' ').trim();
    if (q.length < 2) return res.status(200).json({ customers: [] });
    try { return res.status(200).json({ customers: await search(q) }); }
    catch (e) { return res.status(500).json({ error: e.message }); }
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
      if (!who.perms.edit_customers) return res.status(403).json({ error: 'Ask an admin to change customer details.' });
      const first = String(firstName || '').trim().slice(0, 60);
      const last = String(lastName || '').trim().slice(0, 60);
      if (!first || !last) return res.status(400).json({ error: 'First and last name are required.' });
      const { error } = await admin.from('users')
        .update({ first_name: first, last_name: last, phone: String(phone || '').trim() || null, needs_name: false })
        .eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
    }
    try { return res.status(200).json({ customer: await accountProfile(id) }); }
    catch (e) { return res.status(500).json({ error: e.message }); }
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
