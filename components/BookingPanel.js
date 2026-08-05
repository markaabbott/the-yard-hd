import { useEffect, useState } from 'react';
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

  const endsAt = new Date(startsAt.getTime() + hours * 3600000);

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
    setBooking(false);
    if (error) { setErr(error.message); return; }

    const result = Array.isArray(data) ? data[0] : data;
    setGroupId(result.group_id);

    if (result.due_now_cents > 0 && result.payment_id) {
      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: result.payment_id })
      });
      const json = await res.json();
      if (json.error) { setErr(json.error); return; }
      setClientSecret(json.clientSecret);
    } else {
      onBooked(result.group_id);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 20 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 26, width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase' }}>{cage.name}</div>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginTop: 4 }}>
              {startsAt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer', color: 'rgba(0,0,0,.4)' }}>×</button>
        </div>

        {clientSecret ? (
          <PaymentForm
            clientSecret={clientSecret}
            onSuccess={() => onBooked(groupId)}
          />
        ) : (
          <>
            <div>
              <label style={{ fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' }}>Duration</label>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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

            {err && <div style={{ fontSize: 12.5, color: '#BA0C2F' }}>{err}</div>}

            <button
              onClick={confirm}
              disabled={quoting || booking}
              style={{ padding: '13px 16px', borderRadius: 7, border: 'none', background: '#BA0C2F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: quoting || booking ? 'default' : 'pointer', opacity: quoting || booking ? 0.6 : 1 }}
            >
              {booking ? 'Booking…' : 'Confirm booking'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
