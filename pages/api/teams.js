// /api/teams — a coach's team waiver lists.
// GET                                   → { teams: [...] } (the caller's lists, with players + status)
// POST { action: 'create', name }       → new list with its own link
// POST { action: 'rename', teamId, name }
// POST { action: 'newLink', teamId }    → replaces the link; the old one stops working
// POST { action: 'removePlayer', teamId, playerId }  (the parent keeps their waiver)
// POST { action: 'archive', teamId }    → hides the list; its link stops working
import { supabaseAdmin as admin } from '../../lib/supabaseAdmin';
import { userIdFrom, newToken, teamsWithPlayers } from '../../lib/waiverServer';

const MAX_TEAMS = 20;

export default async function handler(req, res) {
  const uid = await userIdFrom(req);
  if (!uid) return res.status(401).json({ error: 'not signed in' });

  if (req.method === 'GET') {
    return res.status(200).json({ teams: await teamsWithPlayers([uid], { forCoach: true }) });
  }
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const { action, teamId, name, playerId } = req.body || {};
  const cleanName = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 80);

  if (action === 'create') {
    if (!cleanName) return res.status(400).json({ error: 'Give the team a name.' });
    const { count } = await admin.from('waiver_teams').select('id', { count: 'exact', head: true }).eq('owner_id', uid).is('archived_at', null);
    if ((count || 0) >= MAX_TEAMS) return res.status(400).json({ error: `You can have up to ${MAX_TEAMS} teams.` });
    const { error } = await admin.from('waiver_teams').insert({ owner_id: uid, name: cleanName, invite_token: newToken() });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ teams: await teamsWithPlayers([uid], { forCoach: true }) });
  }

  // Everything else acts on one of the caller's own lists.
  const { data: team } = await admin.from('waiver_teams').select('id, owner_id').eq('id', teamId || '').is('archived_at', null).maybeSingle();
  if (!team || team.owner_id !== uid) return res.status(404).json({ error: 'Team not found.' });

  let error = null;
  if (action === 'rename') {
    if (!cleanName) return res.status(400).json({ error: 'Give the team a name.' });
    ({ error } = await admin.from('waiver_teams').update({ name: cleanName }).eq('id', team.id));
  } else if (action === 'newLink') {
    ({ error } = await admin.from('waiver_teams').update({ invite_token: newToken() }).eq('id', team.id));
  } else if (action === 'removePlayer') {
    ({ error } = await admin.from('waiver_team_players').update({ removed_at: new Date().toISOString(), removed_by: uid })
      .eq('id', playerId || '').eq('team_id', team.id).is('removed_at', null));
  } else if (action === 'archive') {
    ({ error } = await admin.from('waiver_teams').update({ archived_at: new Date().toISOString(), invite_token: newToken() }).eq('id', team.id));
  } else {
    return res.status(400).json({ error: 'Unknown action.' });
  }
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ teams: await teamsWithPlayers([uid], { forCoach: true }) });
}
