import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentForm from './PaymentForm';
import PhoneField from './PhoneField';
import { formatPhone, isPhoneOk } from '../lib/phone';
import { authFetch } from '../lib/authFetch';

function money(cents) { return '$' + (cents / 100).toFixed(2); }
const lenLabel = (h) => (h < 1 ? '30 min' : `${h} hr`);

// One booking checkout for a customer.
//   kind 'drop_in'    one cage, 30 min – 2 hr, paid in full
//   kind 'membership' same, paid with member hours (overage at the member rate)
//   kind 'party'      the whole facility, 2 or 3 hr package, 25% deposit now
export default function BookingPanel({ kind = 'drop_in', cages, startsAt, settings, userId, onClose, onBooked }) {
  const isParty = kind === 'party';
  const partyHours = Object.keys(settings?.party_packages || { 120: 1, 180: 1 }).map((m) => Number(m) / 60).sort((a, b) => a - b);
  const lengths = isParty ? partyHours : [0.5, 1, 1.5, 2];
  const maxGuests = settings?.party_max_guests ?? 30;
  const depositPct = settings?.party_deposit_percent ?? 25;

  const [hours, setHours] = useState(isParty ? partyHours[0] : 1);
  const [partyName, setPartyName] = useState('');
  const [guests, setGuests] = useState('');
  const [phone, setPhone] = useState('');
  const [partyNotes, setPartyNotes] = useState('');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(true);
  const [booking, setBooking] = useState(false);
  const [err, setErr] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [result, setResult] = useState(null);
  const [paid, setPaid] = useState(false);
  const [closing, setClosing] = useState(false);

  // Kept in a ref so the unmount cleanup can read the live values without
  // re-running the effect every render.
  const holdRef = useRef({ groupId: null, paid: false });
  holdRef.current = { groupId, paid };

  const endsAt = new Date(startsAt.getTime() + hours * 3600000);
  const cageIds = cages.map((c) => c.id);

  // Only the modal scrolls while it's open.
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
      authFetch('/api/release-hold', { method: 'POST', keepalive: true, body: JSON.stringify({ groupId: g }) }).catch(() => {});
    }
    window.addEventListener('pagehide', bail);
    return () => { window.removeEventListener('pagehide', bail); bail(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQuoting(true);
    setErr(null);
    supabase.rpc('quote_window', {
      p_cage_ids: cageIds,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_kind: kind,
      p_user_id: userId
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(error.message); setQuote(null); }
      else setQuote(Array.isArray(data) ? data[0] : data);
      setQuoting(false);
    });
    return () => { cancelled = true; };
  }, [cageIds.join(','), hours, startsAt.getTime(), kind]);

  const gross = quote?.out_gross_cents ?? 0;
  const covered = Number(quote?.out_hours_covered || 0);
  const dueNow = isParty && gross > 0 ? Math.max(Math.floor((gross * depositPct) / 100), 1) : gross;
  const guestsOk = !isParty || (Number(guests) >= 1 && Number(guests) <= maxGuests);
  const phoneOk = !isParty || (phone.trim() && isPhoneOk(phone));
  const ready = !quoting && !err && (!isParty || (partyName.trim() && guestsOk && phoneOk));

  async function confirm() {
    setBooking(true);
    setErr(null);
    const { data, error } = await supabase.rpc('book_hold', {
      p_cage_ids: cageIds,
      p_starts_at: startsAt.toISOString(),
      p_ends_at: endsAt.toISOString(),
      p_kind: kind,
      p_user_id: userId,
      ...(isParty ? {
        p_party_name: partyName.trim(), p_guest_count: Number(guests),
        p_contact_phone: formatPhone(phone) || null, p_notes: partyNotes.trim() || null,
      } : {})
    });
    if (error) { setBooking(false); setErr(error.message); return; }

    const r = Array.isArray(data) ? data[0] : data;
    setGroupId(r.group_id);
    setResult(r);

    if (r.due_now_cents > 0 && r.payment_id) {
      const res = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: r.payment_id })
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
  // the open PaymentIntent — so the slot reopens.
  async function dismiss() {
    if (paid) { onBooked ? onBooked(groupId) : onClose(); return; }
    if (!groupId) { onClose(); return; }

    setClosing(true);
    try {
      const r = await authFetch('/api/release-hold', { method: 'POST', body: JSON.stringify({ groupId }) });
      if (!r.ok) console.error('[booking] release refused', r.status);
    } catch (e) {
      console.error('[booking] release failed', e);
    }
    holdRef.current = { groupId: null, paid: false };
    onClose();
  }

  const dateLine = startsAt.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const timeLine = startsAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const where = isParty ? 'Whole facility + mezzanine' : cages.map((c) => c.name).join(', ');
  const paidCents = result?.due_now_cents ?? dueNow;
  const balance = result?.balance_due_cents ?? (isParty ? gross - dueNow : 0);

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget && !clientSecret && !closing) dismiss(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.4)', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
    >
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, margin: 'auto', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '24px 26px 0' }}>
            <div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.02em' }}>
                {paid ? (isParty ? 'Your party is booked' : "You're booked") : isParty ? 'Book a party' : where}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginTop: 4 }}>
                {paid || isParty ? `${where} · ` : ''}{dateLine} · {timeLine}
              </div>
            </div>
            <button onClick={dismiss} disabled={closing} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 22, lineHeight: 1, cursor: closing ? 'default' : 'pointer', color: 'rgba(0,0,0,.4)', padding: 0, marginTop: -2 }}>×</button>
          </div>

          <div style={{ padding: '18px 26px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {paid ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(20,120,60,.07)', border: '1px solid rgba(20,120,60,.22)', borderRadius: 9, padding: '13px 15px' }}>
                  <span style={{ color: '#14783C', fontSize: 15, fontWeight: 700 }}>✓</span>
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(0,0,0,.75)' }}>
                    {paidCents > 0 ? 'Payment received. ' : ''}A confirmation email is on its way.
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 14 }}>
                  {isParty && <Row k="Party" v={`${partyName.trim()} · ${guests} guests`} />}
                  {covered > 0 && <Row k="Member hours used" v={`${covered} hr`} />}
                  <Row k={isParty ? 'Deposit paid' : 'Paid'} v={money(paidCents)} bold />
                  {isParty && balance > 0 && <Row k="Balance due at the party" v={money(balance)} />}
                </div>
                <button onClick={dismiss} style={primaryBtn}>Done</button>
              </>
            ) : clientSecret ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderBottom: '1px solid rgba(0,0,0,.08)', paddingBottom: 14 }}>
                  <span style={{ color: 'rgba(0,0,0,.6)' }}>{isParty ? `${lenLabel(hours)} party · deposit due now` : `${lenLabel(hours)} · due now`}</span>
                  <span style={{ fontWeight: 700 }}>{money(result?.due_now_cents ?? dueNow)}</span>
                </div>
                <PaymentForm clientSecret={clientSecret} onSuccess={() => setPaid(true)} />
                <button onClick={dismiss} disabled={closing} style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', cursor: closing ? 'default' : 'pointer', textDecoration: 'underline', padding: 0 }}>
                  {closing ? 'Releasing your hold…' : 'Cancel and release this time'}
                </button>
              </>
            ) : (
              <>
                {isParty && (
                  <div style={{ fontSize: 13, lineHeight: 1.6, padding: '10px 12px', borderRadius: 8, background: '#FBEDEF' }}>
                    Your party gets <strong>every cage plus the mezzanine</strong>. Food and drinks stay on the mezzanine, and no cleats anywhere.
                  </div>
                )}
                <div>
                  <label style={labelStyle}>{isParty ? 'Package' : 'Duration'}</label>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {lengths.map((h) => (
                      <button key={h} onClick={() => setHours(h)}
                        style={{ padding: '8px 14px', borderRadius: 7, border: hours === h ? '1.5px solid #BA0C2F' : '1px solid rgba(0,0,0,.15)', background: hours === h ? 'rgba(186,12,47,.06)' : '#fff', cursor: 'pointer', fontSize: 13.5, fontWeight: 600 }}>
                        {lenLabel(h)}
                      </button>
                    ))}
                  </div>
                </div>

                {isParty && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px', gap: 10 }}>
                    <label style={labelStyle}>Party name
                      <input value={partyName} onChange={(e) => setPartyName(e.target.value)} placeholder="e.g. Jaden's 10th" maxLength={60} style={inputStyle} />
                    </label>
                    <label style={labelStyle}>Guests
                      <input type="number" min="1" max={maxGuests} value={guests} onChange={(e) => setGuests(e.target.value)} placeholder={`Up to ${maxGuests}`} style={{ ...inputStyle, ...(guests && !guestsOk ? { borderColor: '#BA0C2F' } : null) }} />
                    </label>
                    {guests && !guestsOk && <div style={{ gridColumn: '1 / -1', fontSize: 12.5, color: '#BA0C2F' }}>Parties are limited to {maxGuests} guests.</div>}
                    <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Phone on the day
                      <PhoneField value={phone} onChange={setPhone} placeholder="(760) 555-0100" style={inputStyle} />
                    </label>
                    <label style={{ ...labelStyle, gridColumn: '1 / -1' }}>Anything we should know? (optional)
                      <textarea value={partyNotes} onChange={(e) => setPartyNotes(e.target.value)} rows={2} maxLength={500}
                        placeholder="e.g. Birthday for Jaden, turning 10. Bringing a cake to the mezzanine." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                    </label>
                  </div>
                )}

                <div style={{ borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14 }}>
                  {kind === 'membership' && covered > 0 && <Row k="From your membership" v={`${covered} hr`} />}
                  <Row k={isParty ? 'Party package' : 'Total'} v={quoting ? '…' : money(gross)} bold={!isParty} />
                  {isParty && <Row k={`Deposit now (${depositPct}%)`} v={quoting ? '…' : money(dueNow)} bold />}
                  {isParty && <Row k="Balance at the party" v={quoting ? '…' : money(gross - dueNow)} />}
                </div>

                {err && <div style={{ fontSize: 12.5, color: '#BA0C2F', lineHeight: 1.6 }}>{err.charAt(0).toUpperCase() + err.slice(1)}</div>}

                <button onClick={confirm} disabled={!ready || booking} style={{ ...primaryBtn, cursor: !ready || booking ? 'default' : 'pointer', opacity: !ready || booking ? 0.6 : 1 }}>
                  {booking ? 'Booking…' : gross === 0 && !quoting ? 'Confirm booking' : isParty ? 'Continue to deposit' : 'Confirm booking'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, bold }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'rgba(0,0,0,.6)' }}>{k}</span>
      <span style={{ fontWeight: bold ? 700 : 400 }}>{v}</span>
    </div>
  );
}

const labelStyle = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' };
const inputStyle = { padding: '10px 11px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#111', minWidth: 0 };
const primaryBtn = {
  padding: '13px 16px', borderRadius: 7, border: 'none',
  background: '#BA0C2F', color: '#fff',
  fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15,
  letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer'
};
