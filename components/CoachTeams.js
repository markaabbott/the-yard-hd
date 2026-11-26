import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../lib/authFetch';

const RED = '#BA0C2F';
const DAY = 86400000;
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const STATUS = {
  current: { t: 'Current', bg: '#E8F0EA', fg: '#14783C' },
  expiring: { t: 'Expires soon', bg: '#FFF4DE', fg: '#8A5A00' },
  expired: { t: 'Needs re-signing', bg: '#FBEDEF', fg: RED },
  missing: { t: 'No waiver', bg: '#FBEDEF', fg: RED },
};
// Current waivers that run out within 30 days count as "needs attention" too.
const statusOf = (p) => (p.status === 'current' && p.expiresAt && new Date(p.expiresAt).getTime() - Date.now() < 30 * DAY ? 'expiring' : p.status);
const needsAttention = (p) => statusOf(p) !== 'current';

// "Team waivers": a coach's team lists. Each team is a collapsed card (name,
// count, Copy link); open it to see players, problems first.
export default function CoachTeams({ embedded = false, onSummary } = {}) {
  const [teams, setTeams] = useState(null);
  const [open, setOpen] = useState(false);
  const [openTeam, setOpenTeam] = useState(null);
  const [howOpen, setHowOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind, teamId, playerId?, label }

  const load = useCallback(async () => {
    const r = await authFetch('/api/teams');
    const body = await r.json().catch(() => ({}));
    if (r.ok) setTeams((prev) => { if (prev === null && (body.teams || []).length) setOpen(true); return body.teams || []; });
  }, []);
  useEffect(() => { load(); }, [load]);
  // Parents sign on their own phones: refresh when the coach comes back to this tab.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => { document.removeEventListener('visibilitychange', onFocus); window.removeEventListener('focus', onFocus); };
  }, [load]);

  async function act(payload, okText) {
    setErr(null);
    const r = await authFetch('/api/teams', { method: 'POST', body: JSON.stringify(payload) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(body.error || 'Something went wrong.'); return false; }
    setTeams(body.teams || []);
    setNotice(okText || null);
    return true;
  }

  async function create() {
    const name = newName.trim();
    if (!name || creating === 'saving') return;
    setCreating('saving');
    const ok = await act({ action: 'create', name }, `Team "${name}" created. Copy its link and send it to your players' families.`);
    if (ok) { setNewName(''); setCreating(false); } else setCreating(true);
  }

  const linkFor = (t) => `${typeof window !== 'undefined' ? window.location.origin : 'https://app.theyardhd.com'}/join/${t.token}`;
  async function copy(t) {
    const url = linkFor(t);
    try { await navigator.clipboard.writeText(url); setNotice(`Link for ${t.name} copied. Paste it into a text or email to your families.`); }
    catch (e) { window.prompt('Copy this link:', url); }
  }

  const attentionTotal = (teams || []).reduce((a, t) => a + t.players.filter(needsAttention).length, 0);
  useEffect(() => { if (teams) onSummary?.({ teams: teams.length, attention: attentionTotal }); }, [teams, attentionTotal, onSummary]);
  if (!teams) return null;
  const isOpen = embedded || open;

  return (
    <section style={embedded ? {} : { marginBottom: 18, border: '1px solid rgba(0,0,0,.08)', borderRadius: 10, background: '#fff' }}>
      {!embedded && <button onClick={() => setOpen((o) => !o)} aria-expanded={open} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span>
          <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase' }}>Team waivers</span>
          <span style={{ display: 'block', fontSize: 12.5, color: 'rgba(0,0,0,.55)', marginTop: 2 }}>
            {teams.length
              ? <>{teams.length} team{teams.length === 1 ? '' : 's'} · {teams.reduce((a, t) => a + t.currentCount, 0)} players current{attentionTotal ? <span style={{ color: RED, fontWeight: 700 }}> · {attentionTotal} need{attentionTotal === 1 ? 's' : ''} attention</span> : null}</>
              : 'Coaching a team? Send families one link to sign their players’ waivers.'}
          </span>
        </span>
        <Chevron open={open} />
      </button>}

      {isOpen && (
        <div style={{ padding: embedded ? 0 : '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(!teams.length || howOpen) && (
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'rgba(0,0,0,.65)' }}>
              As the coach, you're responsible for making sure every player has a signed waiver before they play. Send your team's link to each family. When a parent signs through it, their player shows up on your list. Remove players who leave the team.
            </p>
          )}
          {notice && <div style={{ fontSize: 13, padding: '9px 12px', borderRadius: 8, background: '#E8F0EA' }}>{notice}</div>}
          {err && <div style={{ fontSize: 13, color: RED }}>{err}</div>}

          {teams.map((t) => (
            <TeamCard key={t.id} t={t} expanded={openTeam === t.id}
              onToggle={() => { setOpenTeam((x) => (x === t.id ? null : t.id)); setConfirm(null); }}
              link={linkFor(t)} onCopy={() => copy(t)} confirm={confirm && confirm.teamId === t.id ? confirm : null}
              setConfirm={setConfirm} act={act} />
          ))}

          {creating ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} placeholder="Team name, e.g. Crushers 12U" maxLength={80}
                style={{ flex: '1 1 200px', minWidth: 0, padding: '10px 11px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14 }} />
              <button onClick={create} disabled={!newName.trim() || creating === 'saving'} style={{ ...smallRed, opacity: newName.trim() && creating !== 'saving' ? 1 : 0.55 }}>{creating === 'saving' ? 'Creating…' : 'Create'}</button>
              <button onClick={() => { setCreating(false); setNewName(''); }} style={smallGhost}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCreating(true)} style={{ ...linkBtn, color: RED, fontWeight: 700, textDecoration: 'none' }}>+ New team link</button>
              {teams.length > 0 && <button onClick={() => setHowOpen((x) => !x)} style={linkBtn}>{howOpen ? 'Hide how team links work' : 'How team links work'}</button>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function TeamCard({ t, expanded, onToggle, link, onCopy, confirm, setConfirm, act }) {
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const attention = t.players.filter(needsAttention).length;
  const shown = [...t.players]
    .filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) || (p.signedBy || '').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (needsAttention(b) - needsAttention(a)) || a.name.localeCompare(b.name));

  return (
    <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 9, background: expanded ? '#fff' : '#FAF9F7' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <button onClick={onToggle} aria-expanded={expanded} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
          <Chevron open={expanded} small />
          <span style={{ minWidth: 0 }}>
            <strong style={{ fontSize: 15, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</strong>
            <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.6)' }}>
              {t.currentCount} of {t.players.length} current
              {attention > 0 && <span style={{ color: RED, fontWeight: 700 }}> · ⚠ {attention} need{attention === 1 ? 's' : ''} attention</span>}
            </span>
          </span>
        </button>
        <button onClick={onCopy} style={smallRed}>Copy link</button>
      </div>

      {expanded && (
        <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={`Link for ${t.name}`}
              style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,.12)', fontSize: 12.5, color: 'rgba(0,0,0,.65)', background: '#FAF9F7' }} />
            {typeof navigator !== 'undefined' && navigator.share && (
              <button onClick={() => navigator.share({ title: `${t.name} at The Yard HD`, text: "Please sign The Yard HD's waiver for our player before practice:", url: link }).catch(() => {})} style={smallGhost}>Share</button>
            )}
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMenu((m) => !m)} aria-label={`More for ${t.name}`} style={{ ...smallGhost, padding: '7px 11px', fontSize: 16, lineHeight: 1 }}>⋯</button>
              {menu && (
                <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 5, background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4, minWidth: 170 }}>
                  <button style={menuItem} onClick={() => { setMenu(false); setConfirm({ kind: 'newLink', teamId: t.id, label: `Make a new link for ${t.name}? The old link stops working. Players already on the list stay.` }); }}>New link</button>
                  <button style={{ ...menuItem, color: RED }} onClick={() => { setMenu(false); setConfirm({ kind: 'archive', teamId: t.id, label: `Delete the ${t.name} list? Its link stops working. Families keep their waivers.` }); }}>Delete team list</button>
                </div>
              )}
            </div>
          </div>

          {confirm && (
            <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FBEDEF', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {confirm.label}
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={async () => { const c = confirm; setConfirm(null); await act({ action: c.kind, teamId: c.teamId, playerId: c.playerId }, c.kind === 'newLink' ? 'New link made. Send it to families; the old one no longer works.' : null); }} style={smallRed}>Yes</button>
                <button onClick={() => setConfirm(null)} style={smallGhost}>Cancel</button>
              </div>
            </div>
          )}

          {t.players.length > 10 && (
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a player" aria-label="Find a player"
              style={{ padding: '8px 10px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 13.5 }} />
          )}

          {t.players.length === 0
            ? <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>No players yet. They appear here once a parent signs through the link.</div>
            : (
              <div style={{ maxHeight: 360, overflowY: 'auto', borderTop: '1px solid rgba(0,0,0,.06)' }}>
                {shown.map((p) => {
                  const k = statusOf(p);
                  const st = STATUS[k];
                  const showDate = k !== 'current' && p.expiresAt;
                  return (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                        <span style={{ padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', background: st.bg, color: st.fg }}>{st.t}</span>
                        <span style={{ fontSize: 12, color: 'rgba(0,0,0,.5)' }}>
                          {p.signedBy ? `Signed by ${p.signedBy}` : ''}{showDate ? `${p.signedBy ? ' · ' : ''}${k === 'expired' ? 'expired' : 'expires'} ${fmt(p.expiresAt)}` : ''}
                        </span>
                      </div>
                      <button onClick={() => setConfirm({ kind: 'removePlayer', teamId: t.id, playerId: p.id, label: `Remove ${p.name} from ${t.name}? Their family keeps their waiver.` })}
                        aria-label={`Remove ${p.name}`} title="Remove from team" style={{ border: 'none', background: 'none', padding: '2px 6px', fontSize: 17, lineHeight: 1, color: 'rgba(0,0,0,.35)', cursor: 'pointer' }}>×</button>
                    </div>
                  );
                })}
                {shown.length === 0 && <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', padding: '8px 2px' }}>No players match “{q}”.</div>}
              </div>
            )}
        </div>
      )}
    </div>
  );
}

function Chevron({ open, small }) {
  return <span aria-hidden style={{ display: 'inline-block', fontSize: small ? 13 : 16, color: 'rgba(0,0,0,.4)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', width: 12, textAlign: 'center', flex: 'none' }}>›</span>;
}

const smallRed = { padding: '8px 13px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' };
const smallGhost = { padding: '8px 13px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', color: '#111', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' };
const linkBtn = { border: 'none', background: 'none', padding: 0, fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline', cursor: 'pointer' };
const menuItem = { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '8px 10px', fontSize: 13.5, cursor: 'pointer', borderRadius: 6 };
