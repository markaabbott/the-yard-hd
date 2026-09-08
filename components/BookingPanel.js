import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentForm from './PaymentForm';

function money(cents) { return '$' + (cents / 100).toFixed(2); }

export default function BookingPanel({ cage, startsAt, slotMinutes, userId, onClose, onBooked }) {
  const [hours, setHours] = useState(1);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(true);
  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [paid, setPaid] = useState(false);
  const [closing, setClosing] = useState(false);

  // Kept in a ref so the unmount cleanup can read the live values without
  // re-running the effect every render.
  const holdRef = useRef({ groupId: null, paid: false });
  holdRef.current = { groupId, paid };

  const endsAt = new Date(startsAt.getTime() + hours * 3600000);

  // Only the modal scrolls while it's open; the schedule grid behind it stays
  // put instead of stealing the wheel.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Last-resort release: the customer closed the tab or hit back with an
  // unpaid hold open. Fires and forgets — keepalive lets it survive unload.
  useEffect(() => {
    function bail() {
      const { groupId: g, paid: p } = holdRef.current;
      if (!g || p) return;
      supabase.auth.getSession().then(({ data }) => {
        const token = data?.session?.access_token;
        if (!token) return;
        fetch('/api/release-hold', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ groupId: g })
        }).catch(() => {});
      });
    }
    window.addEventListener('pagehide', bail);
    return () => { window.removeEventListener('pagehide', bail); bail(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQuoting(true);
    setErr(null);
    supabase.rpc('quote_window', {
      p_cage_ids: [cage.id],
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_kind: 'drop_in',
      p_user_id: userId
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setQuote(Array.isArray(data) ? data[0] : data);
      setQuoting(false);
    });
    return () => { cancelled = true; };
  }, [cage.id, hours, startsAt.getTime()]);

  async function confirm() {
    setBooking(true);
    setErr(null);
    const { data, error } = await supabase.rpc('book_hold', {
      p_cage_ids: [cage.id],
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_kind: 'drop_in',
      p_user_id: userId
    });
    if (error) { setBooking(false); setErr(error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    setGroupId(result.group_id);

    if (result.due_now_cents > 0 && result.payment_id) {
      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: result.payment_id })
      });
      const json = await res.json();
      setBooking(false);
      if (json.error) { setErr(json.error); return; }
      setClientSecret(json.clientSecret);
    } else {
      setBooking(false);
      setPaid(true);
    }
  }

  // Dismiss. An unpaid hold gets released here — both the reservation row and
  // the open PaymentIntent — so the slot reopens and Stripe doesn't collect a
  // pile of Incomplete payments.
  async function dismiss() {
    if (paid) { onBooked ? onBooked(groupId) : onClose(); return; }
    if (!groupId) { onClose(); return; }

    setClosing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      await fetch('/api/release-hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupId })
      });
    } catch (e) {
      console.error('[booking] release failed', e);
    }
    holdRef.current = { groupId: null, paid: false };
    onClose();
  }

  const dateLine = startsAt.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  const timeLine = startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !clientSecret && !closing) dismiss(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 20,
        background: 'rgba(0,0,0,.4)',
        overflowY: 'auto', WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain'
      }}
    >
      {/* min-height + auto margins: centered when the card is short, top-aligned
          and scrollable the moment it's taller than the viewport. */}
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440,
            margin: 'auto', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 60px rgba(0,0,0,.22)'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '24px 26px 0' }}>
            <div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.02em' }}>
                {paid ? "You're booked" : cage.name}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginTop: 4 }}>
                {paid ? `${cage.name} · ` : ''}{dateLine} · {timeLine}
              </div>
            </div>
            <button
              onClick={dismiss}
              disabled={closing}
              aria-label="Close"
              style={{
                border: 'none', background: 'none', fontSize: 22, lineHeight: 1,
                cursor: closing ? 'default' : 'pointer', color: 'rgba(0,0,0,.4)',
                padding: 0, marginTop: -2
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: '18px 26px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {paid ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(20,120,60,.07)', border: '1px solid rgba(20,120,60,.22)', borderRadius: 9, padding: '13px 15px' }}>
                  <span style={{ color: '#14783C', fontSize: 15, fontWeight: 700 }}>✓</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(0,0,0,.75)' }}>
                    Payment received. A confirmation email is on its way.
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 14 }}>
                  <span style={{ color: 'rgba(0,0,0,.6)' }}>Paid</span>
                  <span style={{ fontWeight: 700 }}>{money(quote?.out_gross_cents ?? 0)}</span>
                </div>
                <button onClick={dismiss} style={primaryBtn}>Done</button>
              </>
            ) : clientSecret ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderBottom: '1px solid rgba(0,0,0,.08)', paddingBottom: 14 }}>
                  <span style={{ color: 'rgba(0,0,0,.6)' }}>{hours} hr · due now</span>
                  <span style={{ fontWeight: 700 }}>{money(quote?.out_gross_cents ?? 0)}</span>
                </div>
                <PaymentForm clientSecret={clientSecret} onSuccess={() => setPaid(true)} />
                <button
                  onClick={dismiss}
                  disabled={closing}
                  style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', cursor: closing ? 'default' : 'pointer', textDecoration: 'underline', padding: 0 }}
                >
                  {closing ? 'Releasing your hold…' : 'Cancel and release this time'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <label style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' }}>Duration</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {[1, 1.5, 2, 3].map((h) => (
                      <button key={h} onClick={() => setHours(h)}
                        style={{ padding: '8px 14px', borderRadius: 7, border: hours === h ? '1.5px solid #BA0C2F' : '1px solid rgba(0,0,0,.15)', background: hours === h ? 'rgba(186,12,47,.06)' : '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
                        {h} hr
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 14, display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: 'rgba(0,0,0,.6)' }}>Total</span>
                  <span style={{ fontWeight: 700 }}>{quoting ? '…' : money(quote?.out_gross_cents ?? 0)}</span>
                </div>

                {err && <div style={{ fontSize: 12.5, color: '#BA0C2F', lineHeight: 1.6 }}>{err}</div>}

                <button
                  onClick={confirm}
                  disabled={quoting || booking}
                  style={{ ...primaryBtn, cursor: quoting || booking ? 'default' : 'pointer', opacity: quoting || booking ? 0.6 : 1 }}
                >
                  {booking ? 'Booking…' : 'Confirm booking'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const primaryBtn = {
  padding: '13px 16px', borderRadius: 7, border: 'none',
  background: '#BA0C2F', color: '#fff',
  fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15,
  letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer'
};
