// Server-only. Verifies the caller's Supabase token and that they hold a staff
// role. Responds 401/403 itself and returns null when they don't.
import { supabaseAdmin as admin } from './supabaseAdmin';

const RANK = { coach: 1, admin: 2, owner: 3 };

export async function requireStaff(req, res) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'not signed in' }); return null; }
  const { data: { user } = {}, error } = await admin.auth.getUser(token);
  if (error || !user) { res.status(401).json({ error: 'not signed in' }); return null; }
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  const role = (roles || []).map((r) => r.role).filter((r) => RANK[r]).sort((x, y) => RANK[y] - RANK[x])[0];
  if (!role) { res.status(403).json({ error: 'staff only' }); return null; }
  return { user, role };
}
