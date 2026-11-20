// /api/join — a parent following a coach's team link.
// GET  ?token=…                → { team: { name, coach }, players: [{ name, current }], onTeam: [names] }
//                                (not signed in: { team: { name, coach first name }, signedIn: false })
//                                (players = the caller's own signed players)
// POST { token, names: [...] } → adds those of the caller's players (current waiver required) to the team
import { supabaseAdmin as admin } from '../../lib/supabaseAdmin';
import { userIdFrom, latestWaivers, teamByToken, addPlayers } from '../../lib/waiverServer';

async function myPlayers(uid) {
  const latest = await latestWaivers([uid]);
  return [...latest.values()].map((w) => ({ name: w.participant_name, current: w.current }));
}

export default async function handler(req, res) {
  const uid = await userIdFrom(req);
  const token = req.method === 'GET' ? req.query.token : req.body?.token;
  const team = await teamByToken(token);
  if (!team) return res.status(404).json({ error: 'This team link is no longer active. Ask your coach for a new one.' });

  // Before sign-in, the link only reveals the team's name and the coach's first name.
  if (!uid) {
    if (req.method !== 'GET') return res.status(401).json({ error: 'not signed in' });
    const { data: coach } = await admin.from('users').select('first_name').eq('id', team.owner_id).maybeSingle();
    return res.status(200).json({ team: { name: team.name, coach: coach?.first_name || null }, signedIn: false });
  }

  if (req.method === 'GET') {
    const [{ data: coach }, players, { data: on }] = await Promise.all([
      admin.from('users').select('first_name, last_name').eq('id', team.owner_id).maybeSingle(),
      myPlayers(uid),
      admin.from('waiver_team_players').select('participant_name').eq('team_id', team.id).eq('user_id', uid).is('removed_at', null),
    ]);
    return res.status(200).json({
      team: { name: team.name, coach: [coach?.first_name, coach?.last_name].filter(Boolean).join(' ') || null },
      players,
      onTeam: (on || []).map((x) => x.participant_name),
    });
  }

  if (req.method !== 'POST') return res.status(405).end('Method not allowed');
  const names = Array.isArray(req.body?.names) ? req.body.names : [];
  const current = new Set((await myPlayers(uid)).filter((p) => p.current).map((p) => p.name.toLowerCase()));
  const allowed = names.filter((n) => current.has(String(n).trim().toLowerCase()));
  if (!allowed.length) return res.status(400).json({ error: 'Choose a player with a current waiver, or sign one first.' });
  try {
    const added = await addPlayers(team.id, uid, allowed);
    res.status(200).json({ added });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
