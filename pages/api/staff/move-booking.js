// Vercel serverless function — POST /api/staff/move-booking
// Body: { groupId, startsAt: ISO, cageId?: uuid, notify?: boolean }
// Staff-only (the database checks is_staff()). No money moves.
import { createClient } from '@supabase/supabase-js';
import { drainNotifications } from '../../../lib/notifications';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  const { groupId, startsAt, cageId, notify = true } = req.body || {};
  if (!groupId || !startsAt) return res.status(400).json({ error: 'groupId and startsAt required' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await asUser.rpc('move_reservation_group', {
    p_group_id: groupId,
    p_new_starts_at: startsAt,
    p_cage_id: cageId || null,
    p_notify: !!notify,
  });
  if (error) {
    const status = error.code === '42501' ? 403 : ['22023', '22007', '23P01'].includes(error.code) ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }

  try { await drainNotifications(); } catch (e) { console.error('[move-booking] email drain', e.message); }
  res.status(200).json({ moved: true, startsAt: data?.starts_at, endsAt: data?.ends_at });
}
