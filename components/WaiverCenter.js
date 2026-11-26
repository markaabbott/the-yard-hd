import { useCallback, useEffect, useRef, useState } from 'react';
import CoachTeams from './CoachTeams';
import { downloadWaiverPdf } from '../lib/downloadWaiver';

const RED = '#BA0C2F';
const GREEN = '#14783C';
const SOON_DAYS = 30;
const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Waivers that need attention: none on file yet, or one running out soon.
export function waiverAlert(waivers) {
  if (!waivers) return null;
  if (!waivers.length) return { kind: 'none' };
  const soon = waivers.filter((w) => new Date(w.expires_at).getTime() - Date.now() < SOON_DAYS * 86400000);
  return soon.length ? { kind: 'soon', names: soon.map((w) => w.participant_name), date: fmt(Math.min(...soon.map((w) => new Date(w.expires_at).getTime()))) } : null;
}

// The yellow bar, shown only when something needs doing.
export function WaiverAlertBar({ waivers, onSign }) {
  const a = waiverAlert(waivers);
  if (!a) return null;
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', padding: '10px 14px', marginBottom: 16, borderRadius: 9, background: '#FFF4DE', border: '1px solid rgba(138,90,0,.2)', fontSize: 13.5, lineHeight: 1.5 }}>
      <span>
        {a.kind === 'none'
          ? <><strong>Liability waiver needed.</strong> Sign once for your players before your first booking.</>
          : <><strong>{a.names.join(', ')}</strong>{a.names.length === 1 ? '’s waiver expires' : '’ waivers expire'} {a.date}. Re-sign to keep booking.</>}
      </span>
      <button onClick={onSign} style={{ border: 'none', background: 'none', padding: 0, color: RED, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
        {a.kind === 'none' ? 'Sign the waiver' : 'Re-sign now'}
      </button>
    </div>
  );
}

// Header chips ("✓ Waivers", "Teams") and the panel they open: the waiver
// list with PDFs, Add a player, and the coach's team waiver lists.
export default function WaiverCenter({ waivers, onAddPlayer }) {
  const [open, setOpen] = useState(null); // null | 'waivers' | 'teams'
  const [summary, setSummary] = useState({ teams: 0, attention: 0 });
  const [err, setErr] = useState(null);
  const wrap = useRef(null);
  const teamsRef = useRef(null);
  const onSummary = useCallback((s) => setSummary(s), []);
  const [phoneTop, setPhoneTop] = useState(null); // on phones the panel is fixed just under the chips
  useEffect(() => {
    if (!open || !wrap.current) return;
    const narrow = window.matchMedia('(max-width: 600px)').matches;
    setPhoneTop(narrow ? Math.round(wrap.current.getBoundingClientRect().bottom + 8) : null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(null); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  useEffect(() => { if (open === 'teams') teamsRef.current?.scrollIntoView({ block: 'start' }); }, [open]);

  if (!waivers) return null;
  const alert = waiverAlert(waivers);
  const has = waivers.length > 0;

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'flex', gap: 8, alignItems: 'center' }}>
      <button onClick={() => setOpen((o) => (o === 'waivers' ? null : 'waivers'))} aria-expanded={open === 'waivers'} title="Your waivers"
        style={{ ...chip, borderColor: alert ? 'rgba(138,90,0,.35)' : 'rgba(20,120,60,.3)', background: alert ? '#FFF4DE' : '#F1F7F2', color: alert ? '#8A5A00' : GREEN }}>
        <span aria-hidden>{alert ? '!' : '✓'}</span> Waivers{has ? ` · ${waivers.length}` : ''}
      </button>
      {summary.teams > 0 && (
        <button onClick={() => setOpen((o) => (o === 'teams' ? null : 'teams'))} aria-expanded={open === 'teams'} title="Your team waiver lists"
          style={{ ...chip, borderColor: 'rgba(0,0,0,.15)', background: '#fff', color: '#111', position: 'relative' }}>
          Teams
          {summary.attention > 0 && <span aria-label={`${summary.attention} need attention`} style={{ marginLeft: 4, minWidth: 18, height: 18, borderRadius: 9, background: RED, color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{summary.attention}</span>}
        </button>
      )}

      {/* Always mounted (hidden) so the Teams chip knows whether this person coaches. */}
      <div role="dialog" aria-label="Waivers and teams" className="wc-panel"
        style={{ display: open ? 'block' : 'none', zIndex: 25, ...(phoneTop != null
          ? { position: 'fixed', left: 16, right: 16, top: phoneTop, maxHeight: `calc(100dvh - ${phoneTop + 16}px)` }
          : { position: 'absolute', right: 0, top: 'calc(100% + 10px)', width: 'min(560px, calc(100vw - 32px))', maxHeight: '75vh' }), overflowY: 'auto', background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 12, boxShadow: '0 18px 48px rgba(0,0,0,.18)', padding: '16px 18px', textAlign: 'left' }}>
        <div style={head}>Waivers on file</div>
        {has ? (
          <div style={{ display: 'flex', flexDirection: 'column', margin: '8px 0 10px' }}>
            {waivers.map((w) => {
              const soon = new Date(w.expires_at).getTime() - Date.now() < SOON_DAYS * 86400000;
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '8px 0', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{w.participant_name}</span>
                    <span style={{ fontSize: 12, color: soon ? '#8A5A00' : 'rgba(0,0,0,.5)', marginLeft: 8 }}>{soon ? 'expires' : 'good through'} {fmt(w.expires_at)}</span>
                  </span>
                  <button onClick={() => downloadWaiverPdf(w.id, w.participant_name).catch((e) => setErr(e.message))} style={linkBtn}>PDF</button>
                </div>
              );
            })}
          </div>
        ) : (
          <p style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)', margin: '6px 0 10px' }}>No waiver yet. Sign once for your players before your first booking.</p>
        )}
        {err && <div style={{ fontSize: 13, color: RED, marginBottom: 8 }}>{err}</div>}
        <button onClick={() => { setOpen(null); onAddPlayer(); }} style={{ ...linkBtn, color: RED, fontWeight: 700, textDecoration: 'none' }}>
          {has ? '+ Add a player' : 'Sign the waiver'}
        </button>

        <div ref={teamsRef} style={{ borderTop: '1px solid rgba(0,0,0,.08)', marginTop: 16, paddingTop: 14 }}>
          <div style={{ ...head, marginBottom: 8 }}>Team waivers</div>
          <CoachTeams embedded onSummary={onSummary} />
        </div>
      </div>
    </div>
  );
}

const chip = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999, border: '1px solid', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' };
const head = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(0,0,0,.65)' };
const linkBtn = { border: 'none', background: 'none', padding: 0, fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline', cursor: 'pointer' };
