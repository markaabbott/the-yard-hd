// /api/staff/team   admins and owners
// GET                         staff list, pending invites, coach permissions
// POST   { email, role }      add someone (existing account now, or invite for first sign-in)
// PATCH  { userId, role }     change a role
// DELETE { userId } | { email }  remove from staff (account stays as a customer) / revoke invite
// PUT    { permissions }      coach permission switches
// Admins manage coaches only; owners manage everyone. Nobody changes their own role.
import { supabaseAdmin as admin } from '../../../lib/supabaseAdmin';
import { requireStaff, STAFF_ROLES, PERMS } from '../../../lib/staffAuth';
import { drainNotifications } from '../../../lib/notifications';

const name = (u) => `${u.first_name || ''} ${u.last_name || ''}`.trim();
const topRole = (roles) => ['owner', 'admin', 'coach'].find((r) => roles.includes(r)) || null;

async function list(me) {
  const [r, i, s] = await Promise.all([
    admin.from('user_roles').select('user_id, role, created_at').in('role', STAFF_ROLES),
    admin.from('pending_role_invites').select('email, role, created_at').in('role', STAFF_ROLES).order('created_at'),
    admin.from('facility_settings').select(PERMS.map((p) => `coach_can_${p}`).join(', ')).eq('id', 1).single(),
  ]);
  const byUser = new Map();
  for (const x of r.data || []) {
    const m = byUser.get(x.user_id) || { roles: [], since: x.created_at };
    m.roles.push(x.role); if (x.created_at < m.since) m.since = x.created_at;
    byUser.set(x.user_id, m);
  }
  const ids = [...byUser.keys()];
  const { data: users } = ids.length ? await admin.from('users').select('id, first_name, last_name, email').in('id', ids) : { data: [] };
  const rank = { owner: 0, admin: 1, coach: 2 };
  const members = (users || []).map((u) => ({
    userId: u.id, email: u.email, name: name(u) || u.email, role: topRole(byUser.get(u.id).roles),
    since: byUser.get(u.id).since, isYou: u.id === me,
  })).sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  const permissions = Object.fromEntries(PERMS.map((p) => [p, !!s.data?.[`coach_can_${p}`]]));
  return { members, invites: i.data || [], permissions };
}

// May `who` put `target` (current role, or null) into `next` (role, or null = remove)?
function allowed(who, current, next) {
  if (who.role === 'owner') return true;
  return (current === null || current === 'coach') && (next === null || next === 'coach');
}

async function ownerCount() {
  const { count } = await admin.from('user_roles').select('id', { count: 'exact', head: true }).eq('role', 'owner');
  return count || 0;
}

async function setRole(userId, role, grantedBy) {
  await admin.from('user_roles').delete().eq('user_id', userId).in('role', STAFF_ROLES);
  if (role) {
    const { error } = await admin.from('user_roles').insert({ user_id: userId, role, granted_by: grantedBy });
    if (error) throw error;
  }
}

async function rolesOf(userId) {
  const { data } = await admin.from('user_roles').select('role').eq('user_id', userId);
  return topRole((data || []).map((x) => x.role));
}

export default async function handler(req, res) {
  const who = await requireStaff(req, res);
  if (!who) return;
  if (!who.perms.team) return res.status(403).json({ error: 'Only admins and owners manage the team.' });
  const body = req.body || {};

  try {
    if (req.method === 'GET') return res.status(200).json({ ...(await list(who.user.id)), myRole: who.role });

    if (req.method === 'PUT') {
      const p = body.permissions || {};
      const patch = Object.fromEntries(PERMS.filter((k) => typeof p[k] === 'boolean').map((k) => [`coach_can_${k}`, p[k]]));
      const { error } = await admin.from('facility_settings').update(patch).eq('id', 1);
      if (error) throw error;
      return res.status(200).json(await list(who.user.id));
    }

    if (req.method === 'POST') {
      const email = String(body.email || '').trim().toLowerCase();
      const role = body.role;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
      if (!STAFF_ROLES.includes(role)) return res.status(400).json({ error: 'Pick a role.' });

      const { data: u } = await admin.from('users').select('id, first_name').eq('email', email).maybeSingle();
      if (u) {
        if (u.id === who.user.id) return res.status(400).json({ error: 'You can\u2019t change your own role.' });
        const current = await rolesOf(u.id);
        if (current === role) return res.status(409).json({ error: `They\u2019re already ${role === 'admin' ? 'an admin' : `a ${role}`}.` });
        if (!allowed(who, current, role)) return res.status(403).json({ error: 'Only an owner can add or change admins and owners.' });
        await setRole(u.id, role, who.user.id);
      } else {
        if (!allowed(who, null, role)) return res.status(403).json({ error: 'Only an owner can invite admins and owners.' });
        await admin.from('pending_role_invites').delete().eq('email', email).in('role', STAFF_ROLES);
        const { error } = await admin.from('pending_role_invites').insert({ email, role, invited_by: who.user.id });
        if (error) throw error;
      }

      const { data: me } = await admin.from('users').select('first_name, last_name, email').eq('id', who.user.id).single();
      await admin.rpc('queue_notification', {
        p_template: 'staff_invite', p_user_id: u?.id || null, p_to: email,
        p_ref: { role, invited_by: name(me || {}) || me?.email || 'The Yard HD', has_account: !!u },
        p_dedupe_key: `invite:${email}:${role}:${Date.now()}`,
      });
      try { await drainNotifications(); } catch (e) { console.error('[staff/team] email drain', e.message); }
      return res.status(200).json({ ...(await list(who.user.id)), added: u ? 'member' : 'invite' });
    }

    if (req.method === 'PATCH' || req.method === 'DELETE') {
      if (req.method === 'DELETE' && body.email && !body.userId) {
        const { data: inv } = await admin.from('pending_role_invites').select('role').eq('email', body.email).in('role', STAFF_ROLES);
        if ((inv || []).some((x) => !allowed(who, x.role, null))) return res.status(403).json({ error: 'Only an owner can revoke that invite.' });
        await admin.from('pending_role_invites').delete().eq('email', body.email).in('role', STAFF_ROLES);
        return res.status(200).json(await list(who.user.id));
      }
      const { userId } = body;
      const next = req.method === 'DELETE' ? null : body.role;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      if (next !== null && !STAFF_ROLES.includes(next)) return res.status(400).json({ error: 'Pick a role.' });
      if (userId === who.user.id) return res.status(400).json({ error: 'You can\u2019t change your own role. Ask another owner.' });
      const current = await rolesOf(userId);
      if (!current || !STAFF_ROLES.includes(current)) return res.status(404).json({ error: 'They\u2019re not on staff.' });
      if (!allowed(who, current, next)) return res.status(403).json({ error: 'Only an owner can change admins and owners.' });
      if (current === 'owner' && next !== 'owner' && (await ownerCount()) <= 1) return res.status(409).json({ error: 'There has to be at least one owner.' });
      await setRole(userId, next, who.user.id);
      return res.status(200).json(await list(who.user.id));
    }
  } catch (e) {
    console.error('[staff/team]', e.message);
    return res.status(500).json({ error: e.message });
  }
  res.status(405).end('Method not allowed');
}
