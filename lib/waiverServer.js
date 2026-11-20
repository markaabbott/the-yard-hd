// Server-only helpers for waivers and team waiver lists. Import from
// /pages/api routes only (uses the service key).
import crypto from 'crypto';
import { supabaseAdmin as admin } from './supabaseAdmin';

// The signed-in user's id from the request's bearer token, or null.
export async function userIdFrom(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data?.user?.id || null;
}

export async function isStaffUser(uid) {
  const { data } = await admin.from('user_roles').select('role').eq('user_id', uid).in('role', ['coach', 'admin', 'owner']);
  return !!data?.length;
}

export async function currentWaiverVersion() {
  const { data } = await admin.from('facility_settings').select('waiver_version').eq('id', 1).single();
  return data?.waiver_version || null;
}

// 22-character URL-safe random token for team links.
export const newToken = () => crypto.randomBytes(16).toString('base64url');

const key = (userId, name) => `${userId}|${String(name).trim().toLowerCase()}`;

// Latest waiver per (account, player) for the given accounts, each marked
// current (this version and not expired) or not.
export async function latestWaivers(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const [version, { data }] = await Promise.all([
    currentWaiverVersion(),
    admin.from('waivers')
      .select('id, user_id, participant_name, is_minor, guardian_relationship, signature_name, waiver_version, signed_at, expires_at')
      .in('user_id', ids).order('signed_at', { ascending: false }).limit(5000),
  ]);
  const now = Date.now();
  for (const w of data || []) {
    const k = key(w.user_id, w.participant_name);
    if (out.has(k)) continue;
    out.set(k, { ...w, current: w.waiver_version === version && (!w.expires_at || new Date(w.expires_at).getTime() > now) });
  }
  return out;
}

// A coach's team lists with each active player's latest waiver.
// forCoach: leave out what coaches don't get (waiver ids for the PDF).
export async function teamsWithPlayers(ownerIds, { forCoach = false } = {}) {
  const ids = [...new Set(ownerIds.filter(Boolean))];
  if (!ids.length) return [];
  const { data: teams } = await admin.from('waiver_teams')
    .select('id, owner_id, name, invite_token, created_at').in('owner_id', ids).is('archived_at', null).order('created_at');
  if (!teams?.length) return [];
  const { data: players } = await admin.from('waiver_team_players')
    .select('id, team_id, user_id, participant_name, added_at').in('team_id', teams.map((t) => t.id)).is('removed_at', null).order('added_at');
  const latest = await latestWaivers((players || []).map((p) => p.user_id));
  return teams.map((t) => {
    const list = (players || []).filter((p) => p.team_id === t.id).map((p) => {
      const w = latest.get(key(p.user_id, p.participant_name));
      return {
        id: p.id, name: p.participant_name, addedAt: p.added_at,
        status: !w ? 'missing' : w.current ? 'current' : 'expired',
        signedBy: w ? `${w.signature_name}${w.guardian_relationship ? `, ${w.guardian_relationship}` : ''}` : null,
        expiresAt: w?.expires_at || null,
        ...(forCoach ? {} : { waiverId: w?.id || null, isMinor: !!w?.is_minor }),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return {
      id: t.id, ownerId: t.owner_id, name: t.name, createdAt: t.created_at,
      ...(forCoach ? { token: t.invite_token } : {}),
      players: list,
      currentCount: list.filter((p) => p.status === 'current').length,
    };
  });
}

// ---- Team links ----

export async function teamByToken(token) {
  if (!token || !/^[A-Za-z0-9_-]{10,64}$/.test(String(token))) return null;
  const { data } = await admin.from('waiver_teams').select('id, owner_id, name').eq('invite_token', token).is('archived_at', null).maybeSingle();
  return data || null;
}

// Adds (account, player) pairs to a team, skipping ones already on it.
export async function addPlayers(teamId, userId, names) {
  const { data: existing } = await admin.from('waiver_team_players').select('participant_name')
    .eq('team_id', teamId).eq('user_id', userId).is('removed_at', null);
  const have = new Set((existing || []).map((x) => x.participant_name.toLowerCase()));
  const rows = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))]
    .filter((n) => !have.has(n.toLowerCase()))
    .map((n) => ({ team_id: teamId, user_id: userId, participant_name: n }));
  if (!rows.length) return 0;
  const { error } = await admin.from('waiver_team_players').insert(rows);
  if (error) throw error;
  return rows.length;
}
