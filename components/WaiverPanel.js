import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { authFetch } from '../lib/authFetch';
import {
  WAIVER_VERSION, WAIVER_TITLE, WAIVER_INTRO, WAIVER_SECTIONS, AGREE_READ, AGREE_SUE,
} from '../lib/waiverText';

const RED = '#BA0C2F';
const blank = () => ({ name: '', dob: '', relationship: '' });

// The liability waiver: read it, list the players, check two boxes, type a
// name. Shown before a customer's first booking (and again when it expires or
// the wording changes), and from "Add a player" on the schedule page.
export default function WaiverPanel({ userId, reason, teamToken, onSigned, onClose }) {
  const [people, setPeople] = useState([blank()]);
  const [agreeRead, setAgreeRead] = useState(false);
  const [agreeSue, setAgreeSue] = useState(false);
  const [signature, setSignature] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);

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
      });
  }, [userId]);

  const set = (i, k, v) => setPeople((xs) => xs.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  const ready = agreeRead && agreeSue && signature.trim().split(/\s+/).length >= 2
    && people.every((p) => p.name.trim() && p.dob && p.relationship);

  async function sign() {
    setWorking(true);
    setErr(null);
    try {
      const r = await authFetch('/api/sign-waiver', {
        method: 'POST',
        body: JSON.stringify({ version: WAIVER_VERSION, signatureName: signature, agreeRead, agreeSue, participants: people, ...(teamToken ? { teamToken } : {}) }),
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
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.45)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 560, margin: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '24px 26px 0' }}>
            <div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.02em' }}>Liability waiver</div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,.6)', marginTop: 4, lineHeight: 1.5 }}>
                {reason || 'Required for every player before booking. Good for one year.'}
              </div>
            </div>
            <button onClick={onClose} disabled={working} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'rgba(0,0,0,.4)', padding: 0 }}>×</button>
          </div>

          <div style={{ padding: '16px 26px 26px', display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div tabIndex={0} aria-label="Waiver text" style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, padding: '14px 16px', background: '#FAF9F7', fontSize: 13, lineHeight: 1.6, color: '#222' }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{WAIVER_TITLE}</div>
              {WAIVER_INTRO.map((t, i) => <p key={i} style={{ margin: '0 0 10px' }}>{t}</p>)}
              {WAIVER_SECTIONS.map((s) => (
                <div key={s.title}>
                  <div style={{ fontWeight: 700, margin: '14px 0 6px' }}>{s.title}</div>
                  {(s.paras || []).map((t, i) => <p key={i} style={{ margin: '0 0 8px' }}>{t}</p>)}
                  {s.bullets && <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>{s.bullets.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}</ul>}
                  {s.after && <p style={{ margin: '0 0 8px' }}>{s.after}</p>}
                </div>
              ))}
            </div>

            <div>
              <div style={label}>Who is playing?</div>
              <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', margin: '4px 0 10px', lineHeight: 1.5 }}>
                List every player you'll bring. Adults 18 and over sign their own waiver from their own account.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {people.map((p, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) 28px', gap: 8, alignItems: 'end' }} className="waiver-row">
                    <label style={fieldLabel}>Player name
                      <input value={p.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder="First and last" maxLength={120} style={input} />
                    </label>
                    <label style={fieldLabel}>Date of birth
                      <input type="date" value={p.dob} onChange={(e) => set(i, 'dob', e.target.value)} max={new Date().toISOString().slice(0, 10)} style={input} />
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
                      aria-label={`Remove ${p.name || 'player'}`} style={{ height: 40, border: 'none', background: 'none', fontSize: 18, color: people.length === 1 ? 'transparent' : 'rgba(0,0,0,.4)', cursor: people.length === 1 ? 'default' : 'pointer' }}>×</button>
                  </div>
                ))}
              </div>
              <button onClick={() => setPeople((xs) => [...xs, blank()])} style={{ marginTop: 10, border: 'none', background: 'none', padding: 0, color: RED, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>+ Add another player</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={check}><input type="checkbox" checked={agreeRead} onChange={(e) => setAgreeRead(e.target.checked)} style={box} />{AGREE_READ}</label>
              <label style={check}><input type="checkbox" checked={agreeSue} onChange={(e) => setAgreeSue(e.target.checked)} style={box} />{AGREE_SUE}</label>
            </div>

            <label style={fieldLabel}>Type your full name to sign
              <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="First and last name" maxLength={120} autoComplete="name"
                style={{ ...input, fontFamily: "'Brush Script MT', 'Segoe Script', cursive", fontSize: 20 }} />
              <span style={{ fontSize: 11.5, color: 'rgba(0,0,0,.5)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                Your typed name is your signature. We save it with the date, time, and this version of the waiver.
              </span>
            </label>

            {err && <div style={{ fontSize: 13, color: RED, lineHeight: 1.5 }}>{err}</div>}

            <button onClick={sign} disabled={!ready || working}
              style={{ padding: '13px 16px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', cursor: ready && !working ? 'pointer' : 'default', opacity: ready && !working ? 1 : 0.55 }}>
              {working ? 'Saving…' : 'Sign waiver'}
            </button>
          </div>
        </div>
      </div>
      <style>{`@media (max-width: 520px) { .waiver-row { grid-template-columns: 1fr 1fr 28px !important; } .waiver-row > label:first-child { grid-column: 1 / -1; } }`}</style>
    </div>
  );
}

const label = { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' };
const fieldLabel = { ...label, display: 'flex', flexDirection: 'column', gap: 6 };
const input = { padding: '10px 11px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#111', background: '#fff', minWidth: 0, width: '100%', boxSizing: 'border-box' };
const check = { display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.5, cursor: 'pointer' };
const box = { width: 18, height: 18, marginTop: 1, accentColor: RED, flex: 'none' };
