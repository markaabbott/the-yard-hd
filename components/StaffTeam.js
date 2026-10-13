import React, { useEffect, useState } from 'react';
import { team } from '../lib/staffApi';

// Team tab (admins and owners): who's on staff, invites, and what coaches can do.
const RED = '#BA0C2F';
const ROLES = [
  { k: 'coach', t: 'Coach', d: 'Schedule, book and hold, collect payments, no-shows' },
  { k: 'admin', t: 'Admin', d: 'Everything, plus blocks, reports, and managing coaches' },
  { k: 'owner', t: 'Owner', d: 'Everything, plus managing admins and owners' },
];
const PERMS = [
  { k: 'move', t: 'Move bookings', d: 'Change a booking\u2019s time or cage. No money moves.' },
  { k: 'edit_customers', t: 'Edit customer details', d: 'Change a customer\u2019s name or phone. Notes are always open to staff.' },
  { k: 'comp', t: 'Book at no charge', d: 'Use the No charge payment option.' },
  { k: 'refund', t: 'Cancel paid bookings', d: 'Cancelling a paid booking refunds the customer. Unpaid ones can always be canceled.' },
  { k: 'reports', t: 'See reports', d: 'Revenue, bookings, and cage use, plus CSV export.' },
];
const label = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.55)' };
const field = { minHeight: 40, padding: '0 12px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', fontSize: 14, background: '#fff', boxSizing: 'border-box' };
const btn = { minHeight: 40, padding: '0 16px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', color: '#111', cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const card = { border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' };
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function StaffTeam() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('coach');
  const [confirm, setConfirm] = useState(null); // userId pending removal

  useEffect(() => { team.list().then(setD).catch((e) => setErr(e.message)); }, []);

  const owner = d?.myRole === 'owner';
  const canTouch = (r) => owner || r === 'coach';
  const roleOpts = owner ? ROLES : ROLES.filter((r) => r.k === 'coach');

  async function run(key, fn, ok) {
    setBusy(key); setErr(null); setMsg(null);
    try { const next = await fn(); setD((p) => ({ ...p, ...next })); if (ok) setMsg(typeof ok === 'function' ? ok(next) : ok); }
    catch (e) { setErr(e.message); }
    setBusy(null);
  }

  const add = () => run('add', () => team.add(email.trim(), role), (r) => {
    const who = email.trim(); setEmail('');
    return r.added === 'invite' ? `Invite sent to ${who}. They get staff access the first time they sign in.` : `${who} now has ${role} access. We emailed them.`;
  });

  if (!d) return <div style={{ color: err ? RED : 'rgba(0,0,0,.4)', fontSize: 14 }}>{err || 'Loading team\u2026'}</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 20, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {(err || msg) && (
          <div style={{ fontSize: 13.5, padding: '10px 14px', borderRadius: 8, background: err ? 'rgba(186,12,47,.06)' : '#E8F0EA', color: err ? RED : '#14532A' }}>{err || msg}</div>
        )}

        <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={label}>Add someone</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address" type="email" style={{ ...field, flex: '1 1 220px' }} />
            <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...field, flex: '0 0 auto' }}>
              {roleOpts.map((r) => <option key={r.k} value={r.k}>{r.t}</option>)}
            </select>
            <button disabled={!email.trim() || busy === 'add'} onClick={add} style={{ ...btn, background: RED, color: '#fff', border: 'none', opacity: !email.trim() || busy === 'add' ? 0.5 : 1 }}>
              {busy === 'add' ? 'Adding\u2026' : 'Add'}
            </button>
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.5 }}>
            {ROLES.find((r) => r.k === role).d}. If they already have an account they get access now; otherwise it waits for their first sign-in with this email.
            {!owner && ' Only an owner can add admins or owners.'}
          </div>
        </section>

        <section style={card}>
          <div style={{ ...label, padding: '16px 18px 10px' }}>Staff ({d.members.length})</div>
          {d.members.map((m) => (
            <div key={m.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderTop: '1px solid rgba(0,0,0,.07)', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name}{m.isYou && <span style={{ fontWeight: 400, color: 'rgba(0,0,0,.5)' }}> (you)</span>}</div>
                <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.email} · since {fmtDate(m.since)}</div>
              </div>
              {confirm === m.userId ? (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 12.5 }}>Remove staff access?</span>
                  <button onClick={() => setConfirm(null)} style={{ ...btn, minHeight: 34 }}>Keep</button>
                  <button disabled={busy === m.userId} onClick={() => { setConfirm(null); run(m.userId, () => team.remove(m.userId), `${m.name} no longer has staff access. Their customer account is unchanged.`); }}
                    style={{ ...btn, minHeight: 34, color: '#fff', background: RED, border: 'none' }}>Remove</button>
                </div>
              ) : m.isYou || !canTouch(m.role) ? (
                <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(0,0,0,.6)' }}>{m.role}</span>
              ) : (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {owner ? (
                    <select value={m.role} disabled={busy === m.userId} onChange={(e) => run(m.userId, () => team.setRole(m.userId, e.target.value), `${m.name} is now ${e.target.value === 'admin' ? 'an admin' : `a ${e.target.value}`}.`)} style={{ ...field, minHeight: 34 }}>
                      {ROLES.map((r) => <option key={r.k} value={r.k}>{r.t}</option>)}
                    </select>
                  ) : <span style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'rgba(0,0,0,.6)' }}>{m.role}</span>}
                  <button onClick={() => setConfirm(m.userId)} style={{ ...btn, minHeight: 34, color: RED }}>Remove</button>
                </div>
              )}
            </div>
          ))}
          {d.invites.length > 0 && <>
            <div style={{ ...label, padding: '16px 18px 10px', borderTop: '1px solid rgba(0,0,0,.07)' }}>Waiting for first sign-in</div>
            {d.invites.map((i) => (
              <div key={i.email + i.role} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderTop: '1px solid rgba(0,0,0,.07)', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0, fontSize: 14 }}>{i.email}<div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>{i.role} · invited {fmtDate(i.created_at)}</div></div>
                {canTouch(i.role) && <button disabled={busy === i.email} onClick={() => run(i.email, () => team.revoke(i.email), `Invite for ${i.email} revoked.`)} style={{ ...btn, minHeight: 34 }}>Revoke</button>}
              </div>
            ))}
          </>}
        </section>
      </div>

      <section style={{ ...card, padding: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={label}>What coaches can do</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,.6)', lineHeight: 1.5, marginBottom: 8 }}>
          Coaches can always see the schedule, book and hold time, collect payments, mark no-shows, and keep customer notes. Blocks and this Team page stay with admins and owners.
        </div>
        {PERMS.map((p) => (
          <label key={p.k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid rgba(0,0,0,.07)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!d.permissions[p.k]} disabled={busy === 'perm'}
              onChange={(e) => run('perm', () => team.setPermissions({ [p.k]: e.target.checked }))}
              style={{ width: 18, height: 18, marginTop: 1, accentColor: RED, flex: '0 0 auto' }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{p.t}</span>
              <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.45 }}>{p.d}</span>
            </span>
          </label>
        ))}
      </section>
    </div>
  );
}
