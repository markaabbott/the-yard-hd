import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/authFetch';

const RED = '#BA0C2F';
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const STATUS = {
  current: { t: 'Current', bg: '#E8F0EA', fg: '#14783C' },
  expired: { t: 'Needs re-signing', bg: '#FFF4DE', fg: '#8A5A00' },
  missing: { t: 'No waiver', bg: '#FFF4DE', fg: '#8A5A00' },
};

// "Team waivers": a coach's team lists. Each list has a link the coach sends
// to families; players signed through it show up here with their status.
export default function CoachTeams() {
  const [teams, setTeams] = useState(null);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, teamId, playerId?, label }

  const load = useCallback(async () => {
    const r = await authFetch('/api/teams');
    const body = await r.json().catch(() => ({}));
    if (r.ok) { setTeams(body.teams || []); if ((body.teams || []).length) setOpen(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(payload, okText) {
    setErr(null);
    const r = await authFetch('/api/teams', { method: 'POST', body: JSON.stringify(payload) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(body.error || 'Something went wrong.'); return false; }
    setTeams(body.teams || []);
    if (okText) setNotice(okText);
    return true;
  }

  async function create() {
    if (!newName.trim()) return;
    if (await act({ action: 'create', name: newName }, `Team "${newName.trim()}" created. Copy its link and send it to your players' families.`)) {
      setNewName(''); setCreating(false);
    }
  }

  const linkFor = (t) => `${typeof window !== 'undefined' ? window.location.origin : 'https://app.theyardhd.com'}/join/${t.token}`;
  async function copy(t) {
    const url = linkFor(t);
    try { await navigator.clipboard.writeText(url); setNotice(`Link for ${t.name} copied. Paste it into a text or email to your families.`); }
    catch (e) { window.prompt('Copy this link:', url); }
  }
  async function share(t) {
    try {
      await navigator.share({ title: `${t.name} at The Yard HD`, text: `Please sign The Yard HD's waiver for our player before practice:`, url: linkFor(t) });
    } catch (e) { /* closed the share sheet */ }
  }

  if (!teams) return null;

  return (
    <section style={{ marginBottom: 18, border: '1px solid rgba(0,0,0,.08)', borderRadius: 10, background: '#fff' }}>
      <button onClick={() => setOpen((o) => !o)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span>
          <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase' }}>Team waivers</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(0,0,0,.55)', marginTop: 2 }}>
            {teams.length ? `${teams.length} team${teams.length === 1 ? '' : 's'} · ${teams.reduce((a, t) => a + t.currentCount, 0)} players with a current waiver` : 'Coaching a team? Send families one link to sign their players’ waivers.'}
          </span>
        </span>
        <span aria-hidden style={{ fontSize: 18, color: 'rgba(0,0,0,.4)' }}>{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.65)' }}>
            As the coach, you're responsible for making sure every player has a signed waiver before they play. Send your team's link to each family. When a parent signs through it, their player shows up below. Remove players who leave the team.
          </p>
          {notice && <div style={{ fontSize: 13, padding: '9px 12px', borderRadius: 8, background: '#E8F0EA' }}>{notice}</div>}
          {err && <div style={{ fontSize: 13, color: RED }}>{err}</div>}

          {teams.map((t) => (
            <div key={t.id} style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 9, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 15 }}>{t.name}</strong>
                <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.6)' }}>{t.currentCount} of {t.players.length} player{t.players.length === 1 ? '' : 's'} current</span>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input readOnly value={linkFor(t)} onFocus={(e) => e.target.select()} aria-label={`Link for ${t.name}`}
                  style={{ flex: '1 1 220px', minWidth: 0, padding: '9px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 12.5, color: 'rgba(0,0,0,.7)', background: '#FAF9F7' }} />
                <button onClick={() => copy(t)} style={smallRed}>Copy link</button>
                {typeof navigator !== 'undefined' && navigator.share && <button onClick={() => share(t)} style={smallGhost}>Share</button>}
              </div>

              {t.players.length === 0
                ? <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>No players yet. They appear here once a parent signs through the link.</div>
                : <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {t.players.map((p) => {
                      const st = STATUS[p.status];
                      return (
                        <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(0,0,0,.06)', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                            <span style={{ fontSize: 14, fontWeight: 600 }}>
                              {p.name}
                              <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', background: st.bg, color: st.fg }}>{st.t}</span>
                            </span>
                            {p.signedBy && <span style={{ fontSize: 12, color: 'rgba(0,0,0,.55)' }}>Signed by {p.signedBy}{p.expiresAt ? ` · expires ${fmt(p.expiresAt)}` : ''}</span>}
                          </div>
                          <button onClick={() => setConfirm({ kind: 'removePlayer', teamId: t.id, playerId: p.id, label: `Remove ${p.name} from ${t.name}? Their family keeps their waiver.` })} style={linkBtn}>Remove</button>
                        </div>
                      );
                    })}
                  </div>}

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <button onClick={() => setConfirm({ kind: 'newLink', teamId: t.id, label: `Make a new link for ${t.name}? The old link stops working. Players already on the list stay.` })} style={linkBtn}>New link</button>
                <button onClick={() => setConfirm({ kind: 'archive', teamId: t.id, label: `Delete the ${t.name} list? Its link stops working. Families keep their waivers.` })} style={linkBtn}>Delete team list</button>
              </div>

              {confirm && confirm.teamId === t.id && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FBEDEF', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {confirm.label}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={async () => { const c = confirm; setConfirm(null); await act({ action: c.kind, teamId: c.teamId, playerId: c.playerId }, c.kind === 'newLink' ? 'New link made. Send it to families; the old one no longer works.' : null); }} style={smallRed}>Yes</button>
                    <button onClick={() => setConfirm(null)} style={smallGhost}>Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {creating ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="Team name, e.g. Crushers 12U" maxLength={80}
                style={{ flex: '1 1 200px', minWidth: 0, padding: '10px 11px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14 }} />
              <button onClick={create} disabled={!newName.trim()} style={{ ...smallRed, opacity: newName.trim() ? 1 : 0.55 }}>Create</button>
              <button onClick={() => { setCreating(false); setNewName(''); }} style={smallGhost}>Cancel</button>
            </div>
          ) : (
            <button onClick={() => setCreating(true)} style={{ ...linkBtn, color: RED, fontWeight: 700, alignSelf: 'flex-start' }}>+ New team link</button>
          )}
        </div>
      )}
    </section>
  );
}

const smallRed = { padding: '9px 14px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const smallGhost = { padding: '9px 14px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', color: '#111', fontWeight: 700, fontSize: 13, cursor: 'pointer' };
const linkBtn = { border: 'none', background: 'none', padding: 0, fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline', cursor: 'pointer' };
