// POST /api/staff/action  { action, args }
// Runs one staff function AS the signed-in user, so the database's own
// is_staff() / is_admin() checks decide, then sends any emails it queued.
import { createClient } from '@supabase/supabase-js';
import { drainNotifications } from '../../../lib/notifications';

const ACTIONS = {
  book: 'staff_book',                 // book on behalf of a customer
  collect: 'staff_collect_payment',   // pay-at-facility booking paid in cash/check
  settle: 'settle_deposit_balance',   // party balance paid at the facility
  hold: 'staff_hold',
  block_save: 'save_block',
  block_delete: 'delete_block',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  const { action, args = {} } = req.body || {};
  const fn = ACTIONS[action];
  if (!fn) return res.status(400).json({ error: 'unknown action' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await asUser.rpc(fn, args);
  if (error) {
    const status = error.code === '42501' ? 403 : ['22023', '22007', '23P01'].includes(error.code) ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }

  if (['book', 'collect', 'settle'].includes(action)) {
    try { await drainNotifications(); } catch (e) { console.error('[staff/action] email drain', e.message); }
  }
  res.status(200).json({ result: data ?? null });
}
