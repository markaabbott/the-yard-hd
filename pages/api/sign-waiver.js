// Vercel serverless function — POST /api/sign-waiver
// Auth: Authorization: Bearer <supabase access token>
// Body: { version, signatureName, agreeRead: true, agreeSue: true,
//         participants: [{ name, dob: 'YYYY-MM-DD', relationship: 'self' | 'parent' | 'guardian' }] }
//
// Writes one waivers row per participant, stamped with the signer's typed
// name, the waiver version, IP address, device, and a one-year expiry.
// Waivers are append-only: re-signing adds new rows, nothing is edited.
import { supabaseAdmin as admin } from '../../lib/supabaseAdmin';
import { WAIVER_VERSION, WAIVER_YEARS } from '../../lib/waiverText';

const REL = ['self', 'parent', 'guardian'];

function ageOn(dobYmd, today) {
  const [y, m, d] = dobYmd.split('-').map(Number);
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age -= 1;
  return age;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });
  const { data: authData, error: authErr } = await admin.auth.getUser(token);
  const uid = authData?.user?.id;
  if (authErr || !uid) return res.status(401).json({ error: 'not signed in' });

  const { version, signatureName, agreeRead, agreeSue, participants } = req.body || {};

  const { data: fs } = await admin.from('facility_settings').select('waiver_version').eq('id', 1).single();
  if (version !== WAIVER_VERSION || fs?.waiver_version !== WAIVER_VERSION) {
    return res.status(409).json({ error: 'The waiver was just updated. Reload the page to read and sign the current version.' });
  }
  if (agreeRead !== true || agreeSue !== true) return res.status(400).json({ error: 'Please check both boxes to sign.' });

  const sig = String(signatureName || '').trim().replace(/\s+/g, ' ');
  if (sig.split(' ').length < 2 || sig.length > 120) return res.status(400).json({ error: 'Type your full first and last name to sign.' });

  if (!Array.isArray(participants) || participants.length === 0 || participants.length > 20) {
    return res.status(400).json({ error: 'Add at least one participant.' });
  }

  const today = new Date();
  const rows = [];
  let selfCount = 0;
  for (const p of participants) {
    const name = String(p?.name || '').trim().replace(/\s+/g, ' ');
    const dob = String(p?.dob || '');
    const rel = String(p?.relationship || '');
    if (!name || name.length > 120) return res.status(400).json({ error: 'Every participant needs a name.' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob))) return res.status(400).json({ error: `Add a date of birth for ${name}.` });
    const age = ageOn(dob, today);
    if (age < 0 || age > 110) return res.status(400).json({ error: `Check the date of birth for ${name}.` });
    if (!REL.includes(rel)) return res.status(400).json({ error: `Choose how you're related to ${name}.` });
    const minor = age < 18;
    if (rel === 'self') {
      if (minor) return res.status(400).json({ error: 'You must be 18 or older to sign. A parent or guardian signs for anyone under 18.' });
      selfCount += 1;
    } else if (!minor) {
      return res.status(400).json({ error: `${name} is 18 or older and must sign their own waiver from their own account.` });
    }
    rows.push({
      user_id: uid,
      participant_name: name,
      participant_dob: dob,
      is_minor: minor,
      guardian_relationship: minor ? rel : null,
      waiver_version: WAIVER_VERSION,
      signature_name: sig,
      ip_address: (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket?.remoteAddress || null,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 400) || null,
      expires_at: new Date(today.getTime() + WAIVER_YEARS * 365 * 86400000).toISOString(),
    });
  }
  if (selfCount > 1) return res.status(400).json({ error: 'List yourself only once.' });

  const { data, error } = await admin.from('waivers').insert(rows).select('id, participant_name, is_minor, signed_at, expires_at');
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ signed: data });
}
