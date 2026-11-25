import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { authFetch } from '../lib/authFetch';
import { accountLabel } from './SignedInAs';
import {
  WAIVER_VERSION, WAIVER_TITLE, WAIVER_INTRO, WAIVER_SECTIONS, AGREE_READ, AGREE_SUE,
} from '../lib/waiverText';

const RED = '#BA0C2F';
const blank = () => ({ name: '', dob: '', relationship: '' });

// Date of birth typed as MM/DD/YYYY (Safari's date box greys in today's date,
// which reads like an answer). Returns 'YYYY-MM-DD' or null.
function typeDob(raw) {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
function isoDob(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  const [, mm, dd, yyyy] = m.map(Number);
  const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd || yyyy < 1900 || dt.getTime() > Date.now()) return null;
  return `${m[3]}-${m[1]}-${m[2]}`;
}
// "Facility rules. The Participant will…" → bold lead-in + text.
function lead(t) {
  const i = t.indexOf('. ');
  return i > 0 && i < 32 ? [t.slice(0, i + 1), t.slice(i + 1)] : [null, t];
}

// The liability waiver, in two steps: 1) read it (Continue unlocks at the end),
// 2) list the players, check two boxes, type a name.
export default function WaiverPanel({ userId, reason, teamToken, onSigned, onClose }) {
  const [step, setStep] = useState('read');
  const [readToEnd, setReadToEnd] = useState(false);
  const [atEnd, setAtEnd] = useState(false);
  const [people, setPeople] = useState([blank()]);
  const [agreeRead, setAgreeRead] = useState(false);
  const [agreeSue, setAgreeSue] = useState(false);
  const [signature, setSignature] = useState('');
  const [account, setAccount] = useState({ name: '', label: '' });
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);
  const scroller = useRef(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (!userId) return;
    supabase.from('users').select('first_name, last_name').eq('id', userId).single()
      .then(({ data }) => {
        const n = `${data?.first_name || ''} ${data?.last_name || ''}`.trim();
        if (n) setSignature((s) => s || n);
        setAccount((a) => ({ ...a, name: n }));
      });
    supabase.auth.getUser().then(({ data }) => setAccount((a) => ({ ...a, label: accountLabel(data?.user) })));
  }, [userId]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    setAtEnd(end);
    if (end) setReadToEnd(true);
  }
  useEffect(() => { if (step === 'read') onScroll(); }, [step]);

  const set = (i, k, v) => setPeople((xs) => xs.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const badDob = people.some((p) => p.dob.length === 10 && !isoDob(p.dob));
  const ready = agreeRead && agreeSue && signature.trim().split(/\s+/).length >= 2
    && people.every((p) => p.name.trim() && isoDob(p.dob) && p.relationship);

  async function sign() {
    setWorking(true);
    setErr(null);
    try {
      const participants = people.map((p) => ({ ...p, dob: isoDob(p.dob) }));
      const r = await authFetch('/api/sign-waiver', {
        method: 'POST',
        body: JSON.stringify({ version: WAIVER_VERSION, signatureName: signature, agreeRead, agreeSue, participants, ...(teamToken ? { teamToken } : {}) }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.error || 'Could not save the waiver. Try again.'); setWorking(false); return; }
      onSigned?.(body.signed || [], body.team || null);
    } catch (e) {
      setErr('Could not save the waiver. Check your connection and try again.');
      setWorking(false);
    }
  }

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose?.(); }} className="wv-back"
      style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onMouseDown={(e) => e.stopPropagation()} className="wv-card" role="dialog" aria-modal="true" aria-label="Liability waiver"
        style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 760, height: 'min(880px, calc(100vh - 48px))', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.25)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '22px 30px 16px', borderBottom: '1px solid rgba(0,0,0,.08)', flex: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: RED }}>
                Step {step === 'read' ? 1 : 2} of 2 · {step === 'read' ? 'Read the waiver' : 'Players and signature'}
              </div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 22, textTransform: 'uppercase', letterSpacing: '.02em', marginTop: 4 }}>Liability waiver</div>
              <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)', marginTop: 4, lineHeight: 1.5 }}>
                {reason || 'Required for every player before booking. Good for one year.'}
              </div>
            </div>
            <button onClick={onClose} disabled={working} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 26, lineHeight: 1, cursor: 'pointer', color: 'rgba(0,0,0,.45)', padding: 0 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
            <span style={{ flex: 1, height: 4, borderRadius: 2, background: RED }} />
            <span style={{ flex: 1, height: 4, borderRadius: 2, background: step === 'sign' ? RED : 'rgba(0,0,0,.1)' }} />
          </div>
        </div>

        {step === 'read' ? (
          <>
            {/* The waiver itself, on a "paper" sheet that fills the window */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, background: '#F3F1ED' }}>
              <div ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="Waiver text"
                style={{ position: 'absolute', inset: 0, overflowY: 'scroll', padding: '20px 22px 40px' }}>
                <article className="wv-paper" style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 6, boxShadow: '0 1px 3px rgba(0,0,0,.06)', padding: '30px 34px 34px', fontFamily: 'Georgia, "Times New Roman", serif', fontSize: 15.5, lineHeight: 1.75, color: '#1d1d1d', maxWidth: 640, margin: '0 auto' }}>
                  <h2 style={{ fontFamily: 'inherit', fontSize: 19, lineHeight: 1.35, margin: '0 0 6px', textAlign: 'center' }}>{WAIVER_TITLE}</h2>
                  <p style={{ margin: '0 0 22px', textAlign: 'center', fontSize: 13, color: 'rgba(0,0,0,.55)', fontFamily: 'system-ui, sans-serif' }}>{WAIVER_INTRO[0]}</p>
                  <p style={{ margin: '0 0 14px', fontWeight: 700 }}>{WAIVER_INTRO[1]}</p>
                  {WAIVER_INTRO.slice(2).map((t, i) => <p key={i} style={{ margin: '0 0 14px' }}>{t}</p>)}
                  {WAIVER_SECTIONS.map((s) => (
                    <section key={s.title} style={{ marginTop: 26, paddingTop: 18, borderTop: '1px solid rgba(0,0,0,.08)' }}>
                      <h3 style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14.5, fontWeight: 800, letterSpacing: '.02em', textTransform: 'uppercase', margin: '0 0 10px', color: '#111' }}>{s.title}</h3>
                      {(s.paras || []).map((t, i) => <p key={i} style={{ margin: '0 0 12px' }}>{t}</p>)}
                      {s.bullets && (
                        <ul style={{ margin: '0 0 12px', paddingLeft: 22 }}>
                          {s.bullets.map((b, i) => { const [h, rest] = lead(b); return <li key={i} style={{ marginBottom: 8, paddingLeft: 4 }}>{h && <strong>{h}</strong>}{rest}</li>; })}
                        </ul>
                      )}
                      {s.after && <p style={{ margin: '0 0 12px' }}>{s.after}</p>}
                    </section>
                  ))}
                  <p style={{ margin: '28px 0 0', textAlign: 'center', fontSize: 12.5, color: 'rgba(0,0,0,.45)', fontFamily: 'system-ui, sans-serif' }}>— End of waiver · version {WAIVER_VERSION} —</p>
                </article>
              </div>
              {!atEnd && (
                <div aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 90, background: 'linear-gradient(rgba(243,241,237,0), #F3F1ED 75%)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 12, pointerEvents: 'none' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,.6)', background: '#fff', border: '1px solid rgba(0,0,0,.12)', borderRadius: 999, padding: '6px 14px', boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>Scroll to read ↓</span>
                </div>
              )}
            </div>
            <div style={{ padding: '14px 30px 18px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', flex: 'none' }}>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,.55)' }}>{readToEnd ? 'Thanks for reading. Next, list your players and sign.' : 'Read to the end to continue.'}</span>
              <button onClick={() => setStep('sign')} disabled={!readToEnd} style={{ ...primary, opacity: readToEnd ? 1 : 0.45, cursor: readToEnd ? 'pointer' : 'default' }}>Continue</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 30px 24px', display: 'flex', flexDirection: 'column', gap: 24 }}>
              <button onClick={() => setStep('read')} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: 0, color: 'rgba(0,0,0,.6)', fontSize: 13.5, cursor: 'pointer', textDecoration: 'underline' }}>← Back to the waiver</button>

              <div>
                <div style={label}>Who is playing?</div>
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', margin: '4px 0 12px', lineHeight: 1.5 }}>
                  List every player you'll bring. Adults 18 and over sign their own waiver from their own account.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {people.map((p, i) => (
                    <div key={i} className="wv-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.1fr) 30px', gap: 10, alignItems: 'start', padding: 12, borderRadius: 9, background: '#FAF9F7', border: '1px solid rgba(0,0,0,.07)' }}>
                      <label style={fieldLabel}>Player name
                        <input value={p.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="First and last" maxLength={120} style={input} />
                      </label>
                      <label style={fieldLabel}>Date of birth
                        <input value={p.dob} onChange={(e) => set(i, 'dob', typeDob(e.target.value))} placeholder="MM/DD/YYYY" inputMode="numeric" autoComplete="off" maxLength={10}
                          style={{ ...input, borderColor: p.dob.length === 10 && !isoDob(p.dob) ? RED : 'rgba(0,0,0,.15)' }} />
                      </label>
                      <label style={fieldLabel}>This player is
                        <select value={p.relationship} onChange={(e) => set(i, 'relationship', e.target.value)} style={input}>
                          <option value="">Choose…</option>
                          <option value="self">Me</option>
                          <option value="parent">My child</option>
                          <option value="guardian">In my legal care</option>
                        </select>
                      </label>
                      <button onClick={() => setPeople((xs) => xs.filter((_, j) => j !== i))} disabled={people.length === 1}
                        aria-label={`Remove ${p.name || 'player'}`} style={{ marginTop: 26, height: 40, border: 'none', background: 'none', fontSize: 20, color: people.length === 1 ? 'transparent' : 'rgba(0,0,0,.4)', cursor: people.length === 1 ? 'default' : 'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
                {badDob && <div style={{ fontSize: 12.5, color: RED, marginTop: 8 }}>Check the date of birth (MM/DD/YYYY, not in the future).</div>}
                <button onClick={() => setPeople((xs) => [...xs, blank()])} style={{ marginTop: 12, border: 'none', background: 'none', padding: 0, color: RED, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>+ Add another player</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px', borderRadius: 9, border: '1px solid rgba(0,0,0,.1)' }}>
                <label style={check}><input type="checkbox" checked={agreeRead} onChange={(e) => setAgreeRead(e.target.checked)} style={box} />{AGREE_READ}</label>
                <label style={check}><input type="checkbox" checked={agreeSue} onChange={(e) => setAgreeSue(e.target.checked)} style={box} />{AGREE_SUE}</label>
              </div>

              <div>
                <label style={fieldLabel}>Type your full name to sign
                  <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="First and last name" maxLength={120} autoComplete="name"
                    style={{ ...input, fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontSize: 24, height: 54, padding: '10px 14px', borderWidth: '0 0 2px', borderRadius: 0, background: '#FAF9F7' }} />
                </label>
                <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', marginTop: 8, lineHeight: 1.5 }}>
                  {account.name || account.label ? <>Signing as <strong style={{ color: '#111' }}>{account.name || 'this account'}</strong>{account.label ? ` · ${account.label}` : ''}. </> : null}
                  Your typed name is your signature. We save it with the date, time, and this version of the waiver.
                </div>
              </div>

              {err && <div style={{ fontSize: 13.5, color: RED, lineHeight: 1.5 }}>{err}</div>}
            </div>
            <div style={{ padding: '14px 30px 18px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', justifyContent: 'flex-end', flex: 'none' }}>
              <button onClick={sign} disabled={!ready || working} style={{ ...primary, opacity: ready && !working ? 1 : 0.45, cursor: ready && !working ? 'pointer' : 'default' }}>
                {working ? 'Saving…' : 'Sign waiver'}
              </button>
            </div>
          </>
        )}
      </div>
      <style>{`
        @media (max-width: 600px) {
          .wv-back { padding: 0 !important; }
          .wv-card { max-width: none !important; height: 100dvh !important; border-radius: 0 !important; }
          .wv-paper { padding: 22px 18px 26px !important; font-size: 15px !important; }
          .wv-row { grid-template-columns: 1fr 1fr 30px !important; }
          .wv-row > label:first-child { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  );
}

const primary = { padding: '13px 26px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase' };
const label = { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' };
const fieldLabel = { ...label, display: 'flex', flexDirection: 'column', gap: 6 };
const input = { padding: '10px 11px', height: 42, borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 15, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#111', background: '#fff', minWidth: 0, width: '100%', boxSizing: 'border-box' };
const check = { display: 'flex', gap: 12, alignItems: 'flex-start', fontSize: 14.5, lineHeight: 1.5, cursor: 'pointer' };
const box = { width: 20, height: 20, marginTop: 1, accentColor: RED, flex: 'none' };
