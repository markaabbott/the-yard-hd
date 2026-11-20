// GET /api/waiver-pdf?id=<waiver id>  (Authorization: Bearer <token>)
// The signed waiver as a PDF. Only the account that signed it, or staff,
// can download it. Coaches see their team's status but not the PDF.
import { supabaseAdmin as admin } from '../../lib/supabaseAdmin';
import { userIdFrom, isStaffUser } from '../../lib/waiverServer';
import { buildWaiverPdf } from '../../lib/waiverPdf';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end('Method not allowed');
  const uid = await userIdFrom(req);
  if (!uid) return res.status(401).json({ error: 'not signed in' });

  const id = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'bad waiver id' });
  const { data: w } = await admin.from('waivers').select('*').eq('id', id).maybeSingle();
  if (!w) return res.status(404).json({ error: 'Waiver not found.' });
  if (w.user_id !== uid && !(await isStaffUser(uid))) return res.status(403).json({ error: 'Not your waiver.' });

  const [{ data: u }, { data: fs }] = await Promise.all([
    admin.from('users').select('email').eq('id', w.user_id).maybeSingle(),
    admin.from('facility_settings').select('timezone').eq('id', 1).single(),
  ]);
  const pdf = buildWaiverPdf({ ...w, account_email: u?.email }, { facilityTz: fs?.timezone || 'America/Los_Angeles' });
  const file = `Waiver - ${w.participant_name.replace(/[^A-Za-z0-9 .-]/g, '')} - ${String(w.signed_at).slice(0, 10)}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).send(pdf);
}
