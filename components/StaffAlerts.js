import React, { useEffect, useState } from 'react';
import { getAlerts, saveAlerts } from '../lib/staffApi';

// Small modal: which staff alert emails this person gets.
const RED = '#BA0C2F';
const ITEMS = [
  { k: 'new_bookings', t: 'New online bookings', d: 'A customer books and pays on the website.' },
  { k: 'cancellations', t: 'Cancellations', d: 'Any confirmed booking is canceled, by the customer or by staff.' },
  { k: 'staff_bookings', t: 'Bookings made by other staff', d: 'Someone on staff books for a customer.' },
  { k: 'blocks', t: 'Blocks', d: 'Time is blocked or a block is removed, including repeating blocks.' },
];

export default function StaffAlerts({ onClose }) {
  const [prefs, setPrefs] = useState(null);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getAlerts().then((b) => { setPrefs(b.prefs); setEmail(b.email); }).catch((e) => setErr(e.message)); }, []);

  async function save() {
    setSaving(true); setErr(null);
    try { await saveAlerts(prefs); onClose('Email alerts saved.'); }
    catch (e) { setErr(e.message); setSaving(false); }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Email alerts" onClick={() => onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ padding: '20px 22px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, textTransform: 'uppercase', letterSpacing: '.02em' }}>Email alerts</div>
            {email && <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginTop: 2 }}>Sent to {email}. You never get alerts for things you did yourself.</div>}
          </div>
          <button onClick={() => onClose()} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'rgba(0,0,0,.5)', minWidth: 44, minHeight: 44 }}>✕</button>
        </div>
        <div style={{ padding: '6px 22px' }}>
          {!prefs ? <div style={{ fontSize: 14, color: err ? RED : 'rgba(0,0,0,.4)', padding: '12px 0' }}>{err || 'Loading\u2026'}</div> : ITEMS.map((i) => (
            <label key={i.k} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid rgba(0,0,0,.07)', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!prefs[i.k]} onChange={(e) => setPrefs({ ...prefs, [i.k]: e.target.checked })} style={{ width: 18, height: 18, marginTop: 1, accentColor: RED, flex: '0 0 auto' }} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{i.t}</span>
                <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.45 }}>{i.d}</span>
              </span>
            </label>
          ))}
        </div>
        {prefs && err && <div style={{ padding: '0 22px', fontSize: 13, color: RED }}>{err}</div>}
        <div style={{ padding: '14px 22px 20px', display: 'flex', gap: 8, borderTop: '1px solid rgba(0,0,0,.08)', marginTop: 8 }}>
          <button onClick={() => onClose()} style={{ flex: 1, minHeight: 44, borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Cancel</button>
          <button disabled={!prefs || saving} onClick={save} style={{ flex: 1.4, minHeight: 44, borderRadius: 7, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700, opacity: !prefs || saving ? 0.5 : 1 }}>{saving ? 'Saving\u2026' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
