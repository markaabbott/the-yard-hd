import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { STATES } from '../lib/staffStates';

const RED = '#BA0C2F';
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const label = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)', marginBottom: 8 };
const LIVE = ['pending_payment', 'scheduled', 'confirmed'];

// Right-side drawer: who, when, money, and a full-refund cancel.
export default function StaffBookingDetail({ group: g, tz, phone, onClose, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(null);
  const st = STATES[g.payState] || STATES.unpaid;
  const live = LIVE.includes(g.status);

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const fmtStamp = (d) => new Date(d).toLocaleString([], { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const refundCents = Math.max(0, g.chargeCents - g.refundedCents);

  async function cancel() {
    setWorking(true);
    setNotice(null);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ groupId: g.groupId, reason: 'canceled by staff' }),
    });
    const body = await r.json().catch(() => ({}));
    setWorking(false);
    setConfirming(false);
    if (!r.ok) { setNotice({ error: true, text: body.error || 'Could not cancel this booking.' }); return; }
    setNotice({
      error: !!body.refundError,
      text: body.refundError
        ? 'Canceled, but the Stripe refund failed. Issue it from the Stripe dashboard. The customer was not emailed.'
        : body.refundCents > 0
          ? `Canceled. ${money(body.refundCents)} refunded to the customer's card, and they've been emailed.`
          : body.hoursReturned > 0
            ? `Canceled. ${body.hoursReturned} membership hours returned, and the customer has been emailed.`
            : 'Canceled. The customer has been emailed.',
    });
    onChanged?.();
  }

  const ledger = (g.payments || []).map((p) => {
    const what = p.entry_type === 'charge' ? `Charged${p.is_deposit ? ' (deposit)' : ''} · ${p.method}`
      : p.entry_type === 'refund' ? 'Refunded'
      : p.entry_type.replace(/_/g, ' ');
    return { id: p.id, what, amount: p.amount_cents, status: p.status, when: p.created_at, memo: p.memo, refundId: p.stripe_refund_id };
  });

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <aside style={{ position: 'fixed', zIndex: 51, top: 0, right: 0, bottom: 0, width: 420, maxWidth: '100vw', background: '#fff', boxShadow: '-8px 0 32px rgba(0,0,0,.18)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 18px', borderBottom: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: RED }}>{g.kindLabel}</span>
              <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', background: st.bg, color: st.fg, border: st.border || 'none' }}>{st.label}</span>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'rgba(0,0,0,.45)' }}>✕</button>
          </div>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, lineHeight: 1.15, textTransform: 'uppercase', letterSpacing: '.02em' }}>{g.title}</div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <strong>{fmtDate(g.startsAt)}</strong><br />
            {fmtTime(g.startsAt)} – {fmtTime(g.endsAt)} · {g.cages.join(', ')}
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
          <section>
            <div style={label}>Customer</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600 }}>{g.name}</div>
              {g.contactName && g.contactName !== g.name && <div>Contact: {g.contactName}</div>}
              {g.email && <a href={`mailto:${g.email}`} style={{ color: '#111' }}>{g.email}</a>}
              {g.phone ? <a href={`tel:${g.phone.replace(/\D/g, '')}`} style={{ color: '#111' }}>{g.phone}</a> : <div style={{ color: 'rgba(0,0,0,.45)' }}>No phone on file</div>}
              {g.guestCount ? <div>{g.guestCount} guests</div> : null}
            </div>
          </section>

          <section>
            <div style={label}>Payment</div>
            {ledger.length === 0 ? (
              <div style={{ fontSize: 14, color: 'rgba(0,0,0,.6)' }}>
                {g.payState === 'member' ? 'Paid with membership hours.' : g.payState === 'holding' ? 'Customer is checking out now.' : 'No payment recorded.'}
              </div>
            ) : (
              <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 8 }}>
                {ledger.map((l, i) => (
                  <div key={l.id} style={{ padding: '10px 12px', borderTop: i ? '1px solid rgba(0,0,0,.08)' : 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14 }}>
                      <span style={{ textTransform: 'capitalize' }}>{l.what}</span>
                      <strong style={{ color: l.status === 'failed' ? RED : '#111' }}>{l.amount < 0 ? '−' : ''}{money(l.amount)}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: l.status === 'failed' ? RED : 'rgba(0,0,0,.5)', lineHeight: 1.45 }}>
                      {fmtStamp(l.when)}{l.status !== 'succeeded' ? ` · ${l.status.replace(/_/g, ' ')}` : ''}{l.memo ? ` · ${l.memo}` : ''}
                    </div>
                  </div>
                ))}
                {g.feeCents > 0 && (
                  <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>
                    <span>Stripe processing fee</span><span>{money(g.feeCents)}</span>
                  </div>
                )}
                {g.balanceDueCents > 0 && (
                  <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', justifyContent: 'space-between', fontSize: 14, background: '#FFF4DE' }}>
                    <span>Balance due at the facility</span><strong>{money(g.balanceDueCents)}</strong>
                  </div>
                )}
              </div>
            )}
            {g.stripePaymentIntent && (
              <a href={`https://dashboard.stripe.com/payments/${g.stripePaymentIntent}`} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 10, fontSize: 13, color: '#111' }}>
                Open in Stripe ↗
              </a>
            )}
          </section>

          {g.notes && (
            <section>
              <div style={label}>Notes</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(0,0,0,.7)' }}>{g.notes}</div>
            </section>
          )}

          {g.status === 'canceled' && g.canceledAt && (
            <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)' }}>Canceled {fmtStamp(g.canceledAt)}.</div>
          )}

          {notice && (
            <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '10px 12px', borderRadius: 8, background: notice.error ? 'rgba(186,12,47,.07)' : '#E8F0EA', color: notice.error ? RED : '#14532A' }}>
              {notice.text}
            </div>
          )}
        </div>

        {live && (
          <div style={{ padding: '16px 24px 22px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {confirming ? (
              <>
                <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                  {refundCents > 0
                    ? <>Staff cancellations refund in full. <strong>{money(refundCents)}</strong> goes back to the customer&rsquo;s card. You absorb the {money(g.feeCents)} Stripe fee.</>
                    : g.kind === 'membership' ? 'Their membership hours will be returned in full.'
                    : 'There is no payment to refund.'}
                  {g.email ? ' The customer gets a cancellation email.' : ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={working} onClick={() => setConfirming(false)} style={{ flex: 1, minHeight: 44, borderRadius: 6, border: '1px solid rgba(0,0,0,.15)', background: '#fff', fontSize: 13.5, cursor: 'pointer' }}>
                    Keep it
                  </button>
                  <button disabled={working} onClick={cancel} style={{ flex: 1.4, minHeight: 44, borderRadius: 6, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', cursor: working ? 'default' : 'pointer' }}>
                    {working ? 'Canceling…' : refundCents > 0 ? 'Cancel & refund' : 'Cancel booking'}
                  </button>
                </div>
              </>
            ) : (
              <button onClick={() => { setConfirming(true); setNotice(null); }} style={{ minHeight: 44, borderRadius: 6, border: `1px solid ${RED}`, background: '#fff', color: RED, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
                Cancel this booking
              </button>
            )}
          </div>
        )}
        {g.refundFailed && (
          <div style={{ padding: '0 24px 22px', fontSize: 12.5, color: RED, lineHeight: 1.5 }}>
            A refund on this booking failed in Stripe. Issue it from the Stripe dashboard.
          </div>
        )}
      </aside>
    </>
  );
}
