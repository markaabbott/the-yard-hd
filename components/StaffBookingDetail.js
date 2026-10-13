import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { STATES } from '../lib/staffStates';
import { zonedTimeToUtc } from '../lib/facilityTime';
import { staffAction, cardIntent } from '../lib/staffApi';
import PaymentForm from './PaymentForm';

const RED = '#BA0C2F';
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const label = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)', marginBottom: 8 };
const LIVE = ['pending_payment', 'scheduled', 'confirmed'];

// Right-side drawer: who, when, money, and a full-refund cancel.
function localParts(d, tz) {
  const p = {};
  for (const x of new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(d))) p[x.type] = x.value;
  return { ymd: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}

const hmLabel = (hm) => { const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

export default function StaffBookingDetail({ group: g, tz, settings, cages = [], onClose, onChanged, onMoved, onConvert, onCustomer }) {
  const [mode, setMode] = useState(null); // null | 'cancel' | 'move' | 'collect'
  const [collectSecret, setCollectSecret] = useState(null);
  const isHold = g.kind === 'staff_hold';
  const owed = g.dueCents || g.balanceDueCents || 0;
  const canCollect = owed > 0 && (g.openPaymentId || g.depositPaymentId);
  const [feeMode, setFeeMode] = useState('customer');
  const start0 = localParts(g.startsAt, tz);
  const [mDate, setMDate] = useState(start0.ymd);
  const [mTime, setMTime] = useState(start0.hm);
  const [mCage, setMCage] = useState(g.rows.length === 1 ? g.rows[0].cageId : '');
  const [mNotify, setMNotify] = useState(true);
  const [working, setWorking] = useState(false);
  const confirming = mode === 'cancel';
  const setConfirming = (on) => setMode(on ? 'cancel' : null);
  const durMin = Math.round((new Date(g.endsAt) - new Date(g.startsAt)) / 60000);
  const step = settings?.slot_minutes || 30;
  const openM = settings ? toMin(settings.open_time) : 9 * 60;
  const closeM = settings ? toMin(settings.close_time) : 21 * 60;
  const timeOptions = [];
  for (let m = Math.min(openM, 6 * 60); m + durMin <= Math.max(closeM, 23 * 60); m += step) {
    const hm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    timeOptions.push({ hm, label: hmLabel(hm) + (m < openM || m + durMin > closeM ? ' (outside hours)' : '') });
  }
  if (!timeOptions.some((o) => o.hm === mTime)) timeOptions.unshift({ hm: mTime, label: hmLabel(mTime) });
  const [notice, setNotice] = useState(null);
  const st = STATES[g.payState] || STATES.unpaid;
  const live = LIVE.includes(g.status);
  const footer = live || (g.status === 'completed' && canCollect);
  const arrival = ['drop_in', 'membership', 'team', 'party'].includes(g.kind) && ['confirmed', 'completed', 'no_show'].includes(g.status);
  const started = new Date(g.startsAt) <= new Date();
  const canCheckIn = new Date(g.startsAt) - Date.now() <= 2 * 3600000;

  async function door(action, text) {
    setWorking(true);
    setNotice(null);
    try { await staffAction(action, { p_group_id: g.groupId }); setNotice({ text }); onChanged?.(); }
    catch (e) { setNotice({ error: true, text: e.message }); }
    setWorking(false);
  }

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const fmtStamp = (d) => new Date(d).toLocaleString([], { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const fullCents = Math.max(0, g.chargeCents - g.refundedCents);
  const chargeFee = g.feeCents > 0 && feeMode === 'customer';
  const refundCents = Math.max(0, fullCents - (chargeFee ? Math.min(g.feeCents, fullCents) : 0));

  async function move() {
    setWorking(true);
    setNotice(null);
    const [h, m] = mTime.split(':').map(Number);
    const startsAt = zonedTimeToUtc(mDate, h, m, tz).toISOString();
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/staff/move-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ groupId: g.groupId, startsAt, cageId: g.rows.length === 1 ? mCage : null, notify: !!g.email && mNotify }),
    });
    const body = await r.json().catch(() => ({}));
    setWorking(false);
    if (!r.ok) { setNotice({ error: true, text: body.error || 'Could not move this booking.' }); return; }
    setMode(null);
    onMoved?.(mDate, `Moved ${g.title} to ${new Date(startsAt).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' })} at ${hmLabel(mTime)}.${g.email && mNotify ? ' The customer has been emailed.' : ''}`);
  }

  async function collect(method) {
    setWorking(true);
    setNotice(null);
    try {
      if (method === 'card') {
        setCollectSecret(await cardIntent(g.openPaymentId));
      } else {
        if (g.openPaymentId) await staffAction('collect', { p_group_id: g.groupId, p_method: method });
        else await staffAction('settle', { p_deposit_payment_id: g.depositPaymentId, p_method: method });
        setMode(null);
        setNotice({ text: `${money(owed)} ${method} recorded. Paid in full.` });
        onChanged?.();
      }
    } catch (e) {
      setNotice({ error: true, text: e.message });
    }
    setWorking(false);
  }

  async function cancel() {
    setWorking(true);
    setNotice(null);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ groupId: g.groupId, reason: chargeFee ? 'canceled by staff at customer request' : 'canceled by staff', chargeFee }),
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
            : isHold ? 'Hold released. The time is open for booking.'
            : g.email ? 'Canceled. The customer has been emailed.' : 'Canceled.',
    });
    onChanged?.();
  }

  const ledger = (g.payments || []).filter((p) => p.status !== 'requires_payment').map((p) => {
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
          {isHold ? (
          <section>
            <div style={label}>Hold</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.5 }}>
              <div>Held for <strong>{g.name}</strong>. Free, no customer attached.</div>
              <div style={{ color: g.holdExpiresAt ? '#111' : 'rgba(0,0,0,.55)' }}>
                {g.holdExpiresAt && g.status !== 'canceled' ? <>Releases automatically <strong>{fmtStamp(g.holdExpiresAt)}</strong> if not booked.</> : 'Stays until staff release it.'}
              </div>
            </div>
          </section>
          ) : (<>
          <section>
            <div style={label}>Customer</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.5 }}>
              <div style={{ fontWeight: 600 }}>{g.name}</div>
              {g.userId && onCustomer && (
                <button onClick={() => onCustomer(g.userId)} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: '2px 0', cursor: 'pointer', fontSize: 13, color: RED, fontWeight: 700 }}>View profile ›</button>
              )}
              {g.contactName && g.contactName !== g.name && <div>Contact: {g.contactName}</div>}
              {g.email && <a href={`mailto:${g.email}`} style={{ color: '#111' }}>{g.email}</a>}
              {g.phone ? <a href={`tel:${g.phone.replace(/\D/g, '')}`} style={{ color: '#111' }}>{g.phone}</a> : <div style={{ color: 'rgba(0,0,0,.45)' }}>No phone on file</div>}
              {g.guestCount ? <div>{g.guestCount} guests</div> : null}
              {!g.email && <div style={{ color: 'rgba(0,0,0,.45)' }}>Walk-in, no account</div>}
            </div>
          </section>

          <section>
            <div style={label}>Payment</div>
            {ledger.length === 0 && !g.dueCents ? (
              <div style={{ fontSize: 14, color: 'rgba(0,0,0,.6)' }}>
                {g.payState === 'member' ? 'Paid with membership hours.' : g.payState === 'holding' ? 'Checkout in progress.' : g.comp ? `No charge · ${g.comp}` : 'No payment recorded.'}
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
                {g.dueCents > 0 && (
                  <div style={{ padding: '10px 12px', borderTop: ledger.length ? '1px solid rgba(0,0,0,.08)' : 'none', display: 'flex', justifyContent: 'space-between', fontSize: 14, background: '#FFF4DE' }}>
                    <span>Due at check-in</span><strong>{money(g.dueCents)}</strong>
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

          </>)}

          {arrival && (
            <section>
              <div style={label}>Arrival</div>
              {g.status === 'no_show' ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
                  <span style={{ color: RED, fontWeight: 700 }}>No-show{g.noShowAt ? ` · marked ${fmtStamp(g.noShowAt)}` : ''}</span>
                  <button disabled={working} onClick={() => door('undo_no_show', 'No-show undone. The booking is back on the schedule.')} style={linkBtn}>Undo</button>
                </div>
              ) : g.checkedInAt ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 14 }}>
                  <span style={{ color: '#14532A', fontWeight: 700 }}>✓ Checked in {fmtStamp(g.checkedInAt)}</span>
                  <button disabled={working} onClick={() => door('undo_check_in', 'Check-in undone.')} style={linkBtn}>Undo</button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)' }}>
                    {owed > 0 ? `Collect the ${money(owed)} due before checking in.` : !canCheckIn ? 'Check-in opens 2 hours before the start time.' : started ? 'Not here yet.' : 'Expected.'}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {owed === 0 && canCheckIn && <button disabled={working} onClick={() => door('check_in', 'Checked in.')} style={{ ...secondaryBtn, fontWeight: 700, color: '#fff', background: RED, border: 'none' }}>Check in</button>}
                    {started && <button disabled={working} onClick={() => door('no_show', `Marked as a no-show. The cage is open again${g.chargeCents ? '; what they paid is kept' : ''}.`)} style={{ ...secondaryBtn, fontWeight: 700, color: RED, border: `1px solid ${RED}` }}>No-show</button>}
                  </div>
                </div>
              )}
            </section>
          )}

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

        {footer && (
          <div style={{ padding: '16px 24px 22px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mode === 'cancel' && (
              <>
                {fullCents > 0 && g.feeCents > 0 ? (
                  <div role="radiogroup" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[
                      { k: 'customer', t: 'Customer asked to cancel', d: <>Refund <strong>{money(fullCents - Math.min(g.feeCents, fullCents))}</strong>. The {money(g.feeCents)} card fee is not refunded, same as canceling online.</> },
                      { k: 'yard', t: 'The Yard is canceling', d: <>Refund the full <strong>{money(fullCents)}</strong>. The Yard covers the {money(g.feeCents)} card fee.</> },
                    ].map((o) => (
                      <button key={o.k} role="radio" aria-checked={feeMode === o.k} onClick={() => setFeeMode(o.k)} style={{ textAlign: 'left', padding: '11px 13px', borderRadius: 8, cursor: 'pointer', background: feeMode === o.k ? '#FBEDEF' : '#fff', border: `1.5px solid ${feeMode === o.k ? RED : 'rgba(0,0,0,.15)'}`, display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{o.t}</span>
                        <span style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(0,0,0,.7)' }}>{o.d}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
                    {fullCents > 0 ? <>Refund the full <strong>{money(fullCents)}</strong>.</>
                      : isHold ? 'Release this hold? The time opens for booking right away.'
                      : g.kind === 'membership' ? 'Their membership hours will be returned in full.'
                      : 'There is no payment to refund.'}
                  </div>
                )}
                {g.email && <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>The customer gets a cancellation email.</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={working} onClick={() => setMode(null)} style={secondaryBtn}>Keep it</button>
                  <button disabled={working} onClick={cancel} style={{ ...primaryBtn, flex: 1.4, cursor: working ? 'default' : 'pointer' }}>
                    {working ? (isHold ? 'Releasing…' : 'Canceling…') : isHold ? 'Release hold' : refundCents > 0 ? `Cancel & refund ${money(refundCents)}` : 'Cancel booking'}
                  </button>
                </div>
              </>
            )}
            {mode === 'move' && (
              <>
                <div style={{ fontSize: 13, color: 'rgba(0,0,0,.6)', lineHeight: 1.5 }}>Same length ({durMin >= 60 ? `${durMin / 60} hr` : `${durMin} min`}), same price. No fee to the customer.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                  <label style={fieldLabel}>Date
                    <input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} style={field} />
                  </label>
                  <label style={fieldLabel}>Start time
                    <select value={mTime} onChange={(e) => setMTime(e.target.value)} style={field}>
                      {timeOptions.map((o) => <option key={o.hm} value={o.hm}>{o.label}</option>)}
                    </select>
                  </label>
                </div>
                {g.rows.length === 1 ? (
                  <label style={fieldLabel}>Cage
                    <select value={mCage} onChange={(e) => setMCage(e.target.value)} style={field}>
                      {cages.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>Stays on {g.cages.join(', ')}.</div>
                )}
                {g.email && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={mNotify} onChange={(e) => setMNotify(e.target.checked)} />
                    Email the customer the new time
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button disabled={working} onClick={() => setMode(null)} style={secondaryBtn}>Back</button>
                  <button disabled={working || !mDate} onClick={move} style={{ ...primaryBtn, flex: 1.4, background: '#000', cursor: working ? 'default' : 'pointer' }}>
                    {working ? 'Moving…' : 'Move booking'}
                  </button>
                </div>
              </>
            )}
            {mode === 'collect' && (
              collectSecret ? (
                <>
                  <div style={{ fontSize: 13.5 }}>Charge <strong>{money(owed)}</strong> to their card.</div>
                  <PaymentForm clientSecret={collectSecret} onSuccess={() => { setCollectSecret(null); setMode(null); setNotice({ text: `${money(owed)} charged. The receipt is on its way to the customer.` }); setTimeout(() => onChanged?.(), 1500); }} />
                  <button onClick={() => { setCollectSecret(null); setMode(null); }} style={{ ...secondaryBtn, flex: 'none' }}>Back</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13.5 }}>Collect <strong>{money(owed)}</strong>{g.depositPaymentId ? ' (party balance)' : ''}.</div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${g.openPaymentId ? 3 : 2}, minmax(0,1fr))`, gap: 8 }}>
                    <button disabled={working} onClick={() => collect('cash')} style={{ ...secondaryBtn, fontWeight: 700 }}>Cash</button>
                    <button disabled={working} onClick={() => collect('check')} style={{ ...secondaryBtn, fontWeight: 700 }}>Check</button>
                    {g.openPaymentId && <button disabled={working} onClick={() => collect('card')} style={{ ...secondaryBtn, fontWeight: 700 }}>Card</button>}
                  </div>
                  <button disabled={working} onClick={() => setMode(null)} style={{ ...secondaryBtn, flex: 'none' }}>Back</button>
                </>
              )
            )}
            {!mode && canCollect && (
              <button onClick={() => { setMode('collect'); setNotice(null); }} style={{ ...primaryBtn, background: '#000', cursor: 'pointer' }}>Collect {money(owed)}</button>
            )}
            {!mode && live && (
              <div style={{ display: 'flex', gap: 8 }}>
                {isHold && onConvert && <button onClick={() => onConvert(g)} style={{ ...secondaryBtn, fontWeight: 700, color: '#fff', background: RED, border: 'none' }}>Book it</button>}
                <button onClick={() => { setMode('move'); setNotice(null); }} style={{ ...secondaryBtn, fontWeight: 700, color: '#111' }}>Move</button>
                <button onClick={() => { setMode('cancel'); setNotice(null); }} style={{ ...secondaryBtn, flex: isHold ? 1 : 1.4, fontWeight: 700, color: RED, border: `1px solid ${RED}` }}>{isHold ? 'Release' : 'Cancel this booking'}</button>
              </div>
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

const secondaryBtn = { flex: 1, minHeight: 44, borderRadius: 6, border: '1px solid rgba(0,0,0,.15)', background: '#fff', fontSize: 13.5, cursor: 'pointer' };
const linkBtn = { border: 'none', background: 'none', padding: '6px 2px', cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline' };
const primaryBtn = { minHeight: 44, borderRadius: 6, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,.6)' };
const field = { minHeight: 42, padding: '0 10px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 6, fontSize: 14, background: '#fff', color: '#111', fontWeight: 400 };
