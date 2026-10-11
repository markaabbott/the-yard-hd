import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// One-time "what should we call you?" for accounts that signed up without a
// name (Apple, email link). Shown over the schedule until answered; there is
// no close button because the name goes on waivers, receipts and the front
// desk roster.
export default function NamePrompt({ onDone }) {
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const firstRef = useRef(null);

  useEffect(() => {
    firstRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) { setErr('Please enter your first and last name.'); return; }
    setSaving(true);
    setErr(null);
    const { error } = await supabase.rpc('set_my_name', { p_first: first, p_last: last });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    onDone({ first_name: first.trim(), last_name: last.trim() });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,.4)', overflowY: 'auto' }}>
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <form
          onSubmit={save}
          style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 400, padding: '28px 26px', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}
        >
          <div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.02em' }}>
              What should we call you?
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(0,0,0,.6)', marginTop: 6 }}>
              We use your name on bookings and at the front desk. You only need to do this once.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
            <label style={labelStyle}>
              First name
              <input ref={firstRef} value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="given-name" maxLength={60} style={inputStyle} />
            </label>
            <label style={labelStyle}>
              Last name
              <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="family-name" maxLength={60} style={inputStyle} />
            </label>
          </div>

          {err && <div style={{ fontSize: 12.5, color: '#BA0C2F', lineHeight: 1.6 }}>{err}</div>}

          <button
            type="submit"
            disabled={saving}
            style={{ padding: '13px 16px', borderRadius: 7, border: 'none', background: '#BA0C2F', color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' };
const inputStyle = { padding: '11px 12px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#111', minWidth: 0 };
