// GET  /api/staff/customers?q=smith   find customers by name, email, or phone
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

export default async function handler(req, res) {
  const who = await requireStaff(req, res);
  if (!who) return;

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
