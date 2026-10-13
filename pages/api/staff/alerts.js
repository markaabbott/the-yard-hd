// /api/staff/alerts   any staff member, for their own email alerts
// GET  → { prefs, defaults }    PUT { prefs } → { prefs }
// No saved row means the role default (admins/owners: bookings + cancellations).
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff } from '../../../lib/staffAuth';

const KEYS = ['new_bookings', 'cancellations', 'staff_bookings', 'blocks'];
const defaults = (role) => {
  const senior = role === 'admin' || role === 'owner';
  return { new_bookings: senior, cancellations: senior, staff_bookings: false, blocks: false };
};

export default async function handler(req, res) {
  const who = await requireStaff(req, res);
  if (!who) return;

  if (req.method === 'GET') {
    const { data } = await admin.from('staff_alert_prefs').select(KEYS.join(', ')).eq('user_id', who.user.id).maybeSingle();
    return res.status(200).json({ prefs: data || defaults(who.role), email: who.user.email });
  }
  if (req.method === 'PUT') {
    const p = req.body?.prefs || {};
    const row = { user_id: who.user.id, updated_at: new Date().toISOString() };
    for (const k of KEYS) row[k] = !!p[k];
    const { data, error } = await admin.from('staff_alert_prefs').upsert(row).select(KEYS.join(', ')).single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ prefs: data, email: who.user.email });
  }
  res.status(405).end('Method not allowed');
}
