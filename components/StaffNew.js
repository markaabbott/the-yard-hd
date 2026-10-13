import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { zonedTimeToUtc, localParts, hmLabel, todayYmd, addDaysYmd } from '../lib/facilityTime';
import { staffAction, searchCustomers, createCustomer, cardIntent, releaseHold } from '../lib/staffApi';
import PaymentForm from './PaymentForm';

// Right-side drawer for anything staff put on the grid themselves:
// a booking for a customer, a staff hold, or a block.
const RED = '#BA0C2F';
const money = (c) => `$${(c / 100).toFixed(2)}`;
const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const hmOf = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const durLabel = (m) => (m < 60 ? `${m} min` : `${m / 60} hr`);
const at = (ymd, hm, tz) => { const [h, m] = hm.split(':').map(Number); return zonedTimeToUtc(ymd, h, m, tz); };

const TABS = [
  { k: 'booking', t: 'Booking' },
  { k: 'hold', t: 'Hold' },
  { k: 'block', t: 'Block' },
];
const TITLES = { booking: 'Book for a customer', hold: 'Hold time', block: 'Block time' };
const KINDS = [
  { k: 'drop_in', t: 'Drop-in' },
  { k: 'party', t: 'Party' },
  { k: 'membership', t: 'Member hours' },
];
const PAYS = [
  { k: 'card', t: 'Card now' },
  { k: 'cash', t: 'Cash' },
  { k: 'check', t: 'Check' },
  { k: 'later', t: 'At check-in' },
  { k: 'comp', t: 'No charge' },
];

export default function StaffNew({ initial = {}, tz, settings, cages = [], canBlock, onClose, onDone }) {
  const fromHold = initial.fromHold || null;
  const step = settings?.slot_minutes || 30;
  const openM = toMin(settings?.open_time || '09:00');
  const closeM = toMin(settings?.close_time || '21:00');
  const depositPct = settings?.party_deposit_percent ?? 25;

  const seedStart = fromHold?.startsAt || initial.startsAt;
  const start0 = seedStart ? localParts(seedStart, tz) : { ymd: todayYmd(tz), hm: hmOf(openM) };
  const dur0 = fromHold ? Math.round((new Date(fromHold.endsAt) - new Date(fromHold.startsAt)) / 60000) : 60;

  const [tab, setTab] = useState(fromHold ? 'booking' : initial.tab || 'booking');
  const [date, setDate] = useState(start0.ymd);
  const [time, setTime] = useState(start0.hm);
  const [dur, setDur] = useState(dur0);
  const [cageIds, setCageIds] = useState(fromHold ? fromHold.rows.map((r) => r.cageId) : initial.cageId ? [initial.cageId] : []);
  const [err, setErr] = useState(null);
  const [working, setWorking] = useState(false);

  // Booking
  const [who, setWho] = useState('account'); // account | new | guest
  const [cust, setCust] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [nc, setNc] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [guest, setGuest] = useState({ name: '', phone: '' });
  const [kind, setKind] = useState('drop_in');
  const [party, setParty] = useState({ name: '', count: '' });
  const [pay, setPay] = useState('card');
  const [compMemo, setCompMemo] = useState('');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(true);
  const [quote, setQuote] = useState(null);
  const [quoteErr, setQuoteErr] = useState(null);
  const [card, setCard] = useState(null); // { clientSecret, groupId, amount, name }
  const cardRef = useRef(null);
  cardRef.current = card;

  // Hold
  const [label, setLabel] = useState('');
  const [holdNotes, setHoldNotes] = useState('');
  const [autoRel, setAutoRel] = useState(false);
  const [relDate, setRelDate] = useState(addDaysYmd(start0.ymd, -1));
  const [relTime, setRelTime] = useState(start0.hm);

  // Block
  const [scope, setScope] = useState(initial.cageId ? 'cages' : 'facility');
  const [allDay, setAllDay] = useState(!initial.startsAt);
  const [endDate, setEndDate] = useState(start0.ymd);
  const [endTime, setEndTime] = useState(hmOf(Math.min(toMin(start0.hm) + 60, 23 * 60 + 30)));
  const [reason, setReason] = useState('');
  const [conflicts, setConflicts] = useState(null);

  const startsAt = useMemo(() => at(date, time, tz), [date, time, tz]);
  const endsAt = new Date(startsAt.getTime() + dur * 60000);
  const memberOk = who !== 'guest' && cust?.memberHours != null;

  useEffect(() => { if (kind === 'membership' && !memberOk) setKind('drop_in'); }, [memberOk, kind]);
  useEffect(() => { setErr(null); setConflicts(null); }, [tab]);

  useEffect(() => {
    if (who !== 'account' || cust || query.trim().length < 2) { setResults([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchCustomers(query.trim()).then((r) => { if (live) setResults(r); })
        .catch(() => { if (live) setResults([]); })
        .finally(() => { if (live) setSearching(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, who, cust]);

  useEffect(() => {
    if (tab !== 'booking' || !cageIds.length || (kind === 'membership' && !cust)) { setQuote(null); return; }
    let live = true;
    setQuoteErr(null);
    supabase.rpc('quote_window', {
      p_cage_ids: cageIds, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
      p_kind: kind, p_user_id: who === 'guest' ? null : cust?.id || null,
    }).then(({ data, error }) => {
      if (!live) return;
      if (error) { setQuote(null); setQuoteErr(error.message); } else setQuote(Array.isArray(data) ? data[0] : data);
    });
    return () => { live = false; };
  }, [tab, cageIds.join(','), startsAt.getTime(), dur, kind, cust?.id, who]);

  // An unpaid card checkout must not strand the slot.
  useEffect(() => () => { const c = cardRef.current; if (c && !c.paid) releaseHold(c.groupId); }, []);

  const gross = quote?.out_gross_cents ?? 0;
  const deposit = kind === 'party' && gross > 0 && !['later', 'comp'].includes(pay);
  const due = pay === 'comp' ? 0 : deposit ? Math.max(Math.floor((gross * depositPct) / 100), 1) : gross;

  const timeOpts = [];
  for (let m = Math.min(openM, 6 * 60); m + (tab === 'block' ? 0 : step) <= Math.max(closeM, 23 * 60); m += step) {
    timeOpts.push({ hm: hmOf(m), label: hmLabel(hmOf(m)) + (tab !== 'block' && (m < openM || m + dur > closeM) ? ' (outside hours)' : '') });
  }
  if (!timeOpts.some((o) => o.hm === time)) timeOpts.unshift({ hm: time, label: hmLabel(time) });
  const allTimes = Array.from({ length: (24 * 60) / step }, (_, i) => hmOf(i * step));
  const durOpts = Array.from({ length: Math.floor((8 * 60) / step) }, (_, i) => (i + 1) * step);
  if (!durOpts.includes(dur)) durOpts.push(dur);

  const cageName = (id) => cages.find((c) => c.id === id)?.name || 'Cage';
  const cageList = cageIds.map(cageName).join(', ');
  const shortDate = (ymd) => new Date(at(ymd, '12:00', tz)).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const toggleCage = (id) => setCageIds((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));

  const custEmail = who === 'guest' ? null : who === 'new' ? nc.email.trim() : cust?.email;
  const whoReady = who === 'account' ? !!cust : who === 'new' ? nc.firstName.trim() && nc.lastName.trim() && nc.email.trim() : guest.name.trim();
  const canBook = cageIds.length && whoReady && (pay !== 'comp' || compMemo.trim()) && !quoteErr;
  const canHold = cageIds.length && label.trim();
  const canBlockNow = scope === 'facility' || cageIds.length;

  async function run(fn) {
    setWorking(true);
    setErr(null);
    try { await fn(); } catch (e) { setErr(e.message); }
    setWorking(false);
  }

  const book = () => run(async () => {
    let c = cust;
    if (who === 'new') {
      const r = await createCustomer(nc);
      c = r.customer;
      setCust(c);
      setWho('account');
    }
    const name = who === 'guest' ? guest.name.trim() : c.name;
    const r = await staffAction('book', {
      p_cage_ids: cageIds, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
      p_kind: kind, p_user_id: who === 'guest' ? null : c.id,
      p_guest_name: who === 'guest' ? guest.name.trim() : null,
      p_guest_phone: who === 'guest' ? guest.phone.trim() || null : null,
      p_party_name: kind === 'party' ? party.name.trim() || null : null,
      p_guest_count: kind === 'party' && party.count ? Number(party.count) : null,
      p_notes: notes.trim() || null, p_payment: pay,
      p_comp_memo: pay === 'comp' ? compMemo.trim() : null,
      p_notify: !!custEmail && notify, p_from_hold: fromHold?.groupId || null,
    });
    if (r.status === 'pending_payment' && r.payment_id) {
      try {
        const clientSecret = await cardIntent(r.payment_id);
        setCard({ clientSecret, groupId: r.group_id, amount: r.due_now_cents, name });
      } catch (e) {
        await releaseHold(r.group_id);
        throw e;
      }
      return;
    }
    const paid = r.due_now_cents || 0;
    const payText = pay === 'comp' ? 'No charge.'
      : paid === 0 ? (r.hours_covered > 0 ? `${Number(r.hours_covered)} member hours used.` : 'Nothing owed.')
      : pay === 'later' ? `${money(paid)} due at check-in.`
      : `${money(paid)} ${pay} recorded${r.is_deposit ? ' as the deposit' : ''}.`;
    onDone(`Booked ${name} · ${shortDate(date)} at ${hmLabel(time)}. ${payText}${custEmail && notify ? ' Confirmation emailed.' : ''}`, date);
  });

  const hold = () => run(async () => {
    const rel = autoRel ? at(relDate, relTime, tz) : null;
    await staffAction('hold', {
      p_cage_ids: cageIds, p_starts_at: startsAt.toISOString(), p_ends_at: endsAt.toISOString(),
      p_label: label.trim(), p_notes: holdNotes.trim() || null, p_release_at: rel ? rel.toISOString() : null,
    });
    onDone(`Held ${cageList} for ${label.trim()} · ${shortDate(date)} at ${hmLabel(time)}.${rel ? ` Releases ${shortDate(relDate)} at ${hmLabel(relTime)} if not booked.` : ''}`, date);
  });

  const block = () => run(async () => {
    const s = allDay ? at(date, '00:00', tz) : startsAt;
    const e = allDay ? at(addDaysYmd(endDate, 1), '00:00', tz) : at(endDate, endTime, tz);
    if (e <= s) throw new Error('The block has to end after it starts.');
    setConflicts(null);
    const r = await staffAction('block_save', {
      p_id: null, p_cage_ids: scope === 'facility' ? null : cageIds,
      p_starts_at: s.toISOString(), p_ends_at: e.toISOString(), p_reason: reason.trim() || null,
    });
    if (!r.ok) { setConflicts(r.conflicts || []); return; }
    onDone(`Blocked ${scope === 'facility' ? 'the whole facility' : cageList}${reason.trim() ? ` (${reason.trim()})` : ''}.`, date);
  });

  function close() {
    if (card && !card.paid) releaseHold(card.groupId);
    cardRef.current = null;
    onClose();
  }

  const fmtRange = (s, e) => {
    const d = new Date(s).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
    const t = (x) => new Date(x).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
    return `${d} · ${t(s)}–${t(e)}`;
  };

  return (
    <>
      <div onClick={card ? undefined : close} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <aside style={{ position: 'fixed', zIndex: 51, top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100vw', background: '#fff', boxShadow: '-8px 0 32px rgba(0,0,0,.18)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: RED }}>{fromHold ? 'Convert hold' : 'New'}</span>
              <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, lineHeight: 1.15, textTransform: 'uppercase', letterSpacing: '.02em' }}>
                {card ? 'Take payment' : fromHold ? `Book ${fromHold.title}'s time` : TITLES[tab]}
              </span>
            </div>
            <button onClick={close} aria-label="Close" style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'rgba(0,0,0,.45)' }}>✕</button>
          </div>
          {!fromHold && !card && (
            <div role="tablist" style={{ display: 'grid', gridTemplateColumns: `repeat(${canBlock ? 3 : 2}, minmax(0,1fr))`, gap: 4, padding: 4, background: '#F2F0ED', borderRadius: 8 }}>
              {TABS.filter((t) => canBlock || t.k !== 'block').map((t) => (
                <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)} style={{ minHeight: 36, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: tab === t.k ? '#fff' : 'transparent', color: tab === t.k ? '#111' : 'rgba(0,0,0,.55)', boxShadow: tab === t.k ? '0 1px 3px rgba(0,0,0,.12)' : 'none' }}>{t.t}</button>
              ))}
            </div>
          )}
        </div>

        {card ? (
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, lineHeight: 1.5 }}>
              <strong>{card.name}</strong>
              <span>{fmtRange(startsAt, endsAt)} · {cageList}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderTop: '1px solid rgba(0,0,0,.08)', borderBottom: '1px solid rgba(0,0,0,.08)', padding: '12px 0' }}>
              <span style={{ color: 'rgba(0,0,0,.6)' }}>{deposit ? `Deposit (${depositPct}%)` : 'Due now'}</span>
              <strong>{money(card.amount)}</strong>
            </div>
            <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.5 }}>The time is held for 20 minutes while you enter the card.{custEmail ? ' The receipt goes to the customer.' : ''}</div>
            <PaymentForm clientSecret={card.clientSecret} onSuccess={() => {
              cardRef.current = { ...card, paid: true };
              onDone(`Booked ${card.name} · ${shortDate(date)} at ${hmLabel(time)}. ${money(card.amount)} charged to their card.${custEmail ? ' Receipt emailed.' : ''}`, date);
            }} />
            <button onClick={close} style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', cursor: 'pointer', textDecoration: 'underline', padding: 0, alignSelf: 'flex-start' }}>Cancel and release this time</button>
          </div>
        ) : (
          <>
            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
              {tab === 'booking' && (
                <section>
                  <div style={label_}>Customer</div>
                  {who === 'account' && cust ? (
                    <div style={{ border: '1px solid rgba(0,0,0,.12)', borderRadius: 8, padding: '11px 13px', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 13.5, lineHeight: 1.45, minWidth: 0 }}>
                        <strong style={{ fontSize: 14 }}>{cust.name}</strong>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{cust.email}</span>
                        {cust.phone && <span>{cust.phone}</span>}
                        {cust.memberHours != null && <span style={{ color: RED, fontWeight: 600 }}>Member · {cust.memberHours} hrs left</span>}
                      </div>
                      <button onClick={() => { setCust(null); setQuery(''); }} style={linkBtn}>Change</button>
                    </div>
                  ) : who === 'account' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, or phone" style={field} />
                      {query.trim().length >= 2 && (
                        <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, overflow: 'hidden' }}>
                          {results.map((r, i) => (
                            <button key={r.id} onClick={() => setCust(r)} style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', borderTop: i ? '1px solid rgba(0,0,0,.07)' : 'none', background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: '#111' }}>{r.name}{r.memberHours != null ? <span style={{ color: RED, fontWeight: 600 }}> · member</span> : null}</span>
                              <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>{[r.email, r.phone].filter(Boolean).join(' · ')}</span>
                            </button>
                          ))}
                          {!results.length && <div style={{ padding: '10px 12px', fontSize: 13, color: 'rgba(0,0,0,.5)' }}>{searching ? 'Searching…' : 'No one matches.'}</div>}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <button onClick={() => setWho('new')} style={linkBtn}>+ New customer account</button>
                        <button onClick={() => setWho('guest')} style={linkBtn}>Walk-in, no account</button>
                      </div>
                    </div>
                  ) : who === 'new' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={grid2}>
                        <input value={nc.firstName} onChange={(e) => setNc({ ...nc, firstName: e.target.value })} placeholder="First name" style={field} />
                        <input value={nc.lastName} onChange={(e) => setNc({ ...nc, lastName: e.target.value })} placeholder="Last name" style={field} />
                      </div>
                      <input type="email" value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} placeholder="Email" style={field} />
                      <input type="tel" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder="Phone (optional)" style={field} />
                      <div style={hint}>They can sign in later with this email and the booking will be in their account.</div>
                      <button onClick={() => setWho('account')} style={{ ...linkBtn, alignSelf: 'flex-start' }}>← Search existing customers</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={grid2}>
                        <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} placeholder="Name" style={field} />
                        <input type="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} placeholder="Phone" style={field} />
                      </div>
                      <div style={hint}>No account and no email. Nothing is sent to them.</div>
                      <button onClick={() => setWho('account')} style={{ ...linkBtn, alignSelf: 'flex-start' }}>← Search existing customers</button>
                    </div>
                  )}
                </section>
              )}

              {tab === 'hold' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={label_}>Held for</div>
                  <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Coach Ramirez lessons, Hesperia 12U tryout" maxLength={80} style={field} />
                  <textarea value={holdNotes} onChange={(e) => setHoldNotes(e.target.value)} placeholder="Notes (optional)" rows={2} style={{ ...field, padding: '10px', resize: 'vertical' }} />
                  <div style={hint}>Free and private. Customers just see the time as taken.</div>
                </section>
              )}

              {tab === 'block' ? (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={label_}>Blocking</div>
                  <div style={{ ...grid2, gap: 6 }}>
                    {[{ k: 'facility', t: 'Whole facility' }, { k: 'cages', t: 'Specific cages' }].map((o) => (
                      <button key={o.k} onClick={() => setScope(o.k)} style={choice(scope === o.k)}>{o.t}</button>
                    ))}
                  </div>
                  {scope === 'cages' && <CageChips cages={cages} on={cageIds} toggle={toggleCage} />}
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. Net repair, Closed for Thanksgiving" maxLength={80} style={field} />
                  <div style={hint}>Shown on the grid. Customers just see the time as unavailable.</div>
                </section>
              ) : (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={label_}>Cages</div>
                  <CageChips cages={cages} on={cageIds} toggle={toggleCage} />
                </section>
              )}

              <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={label_}>When</div>
                {tab === 'block' ? (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
                    </label>
                    <div style={grid2}>
                      <label style={fieldLabel}>{allDay ? 'From' : 'Starts'}
                        <input type="date" value={date} onChange={(e) => { setDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value); }} style={field} />
                      </label>
                      {!allDay && <label style={fieldLabel}>&nbsp;
                        <select value={time} onChange={(e) => setTime(e.target.value)} style={field}>{allTimes.map((t) => <option key={t} value={t}>{hmLabel(t)}</option>)}</select>
                      </label>}
                      <label style={fieldLabel}>{allDay ? 'Through' : 'Ends'}
                        <input type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} style={field} />
                      </label>
                      {!allDay && <label style={fieldLabel}>&nbsp;
                        <select value={endTime} onChange={(e) => setEndTime(e.target.value)} style={field}>{allTimes.map((t) => <option key={t} value={t}>{hmLabel(t)}</option>)}</select>
                      </label>}
                    </div>
                  </>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) minmax(0,.8fr)', gap: 8 }}>
                    <label style={fieldLabel}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={field} /></label>
                    <label style={fieldLabel}>Start
                      <select value={time} onChange={(e) => setTime(e.target.value)} style={field}>{timeOpts.map((o) => <option key={o.hm} value={o.hm}>{o.label}</option>)}</select>
                    </label>
                    <label style={fieldLabel}>Length
                      <select value={dur} onChange={(e) => setDur(Number(e.target.value))} style={field}>{durOpts.map((d) => <option key={d} value={d}>{durLabel(d)}</option>)}</select>
                    </label>
                  </div>
                )}
              </section>

              {tab === 'hold' && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={autoRel} onChange={(e) => setAutoRel(e.target.checked)} /> Release automatically if not booked
                  </label>
                  {autoRel && (
                    <div style={grid2}>
                      <input type="date" value={relDate} max={date} onChange={(e) => setRelDate(e.target.value)} style={field} />
                      <select value={relTime} onChange={(e) => setRelTime(e.target.value)} style={field}>{allTimes.map((t) => <option key={t} value={t}>{hmLabel(t)}</option>)}</select>
                    </div>
                  )}
                </section>
              )}

              {tab === 'booking' && (
                <>
                  <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={label_}>Type</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
                      {KINDS.map((k) => {
                        const off = k.k === 'membership' && !memberOk;
                        return <button key={k.k} disabled={off} onClick={() => setKind(k.k)} title={off ? 'Pick a customer with an active membership' : undefined} style={{ ...choice(kind === k.k), opacity: off ? 0.4 : 1, cursor: off ? 'default' : 'pointer' }}>{k.t}</button>;
                      })}
                    </div>
                    {kind === 'party' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px', gap: 8 }}>
                        <input value={party.name} onChange={(e) => setParty({ ...party, name: e.target.value })} placeholder="Party name, e.g. Jaden's 10th" style={field} />
                        <input type="number" min="1" value={party.count} onChange={(e) => setParty({ ...party, count: e.target.value })} placeholder="Guests" style={field} />
                      </div>
                    )}
                  </section>

                  <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={label_}>Payment</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 6 }}>
                      {PAYS.map((p) => <button key={p.k} onClick={() => setPay(p.k)} style={choice(pay === p.k)}>{p.t}</button>)}
                    </div>
                    {pay === 'comp' && <input value={compMemo} onChange={(e) => setCompMemo(e.target.value)} placeholder="Why is it free? (required)" style={field} />}
                    <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, fontSize: 14 }}>
                      {quoteErr ? (
                        <div style={{ padding: '10px 12px', color: RED, fontSize: 13 }}>{quoteErr}</div>
                      ) : (
                        <>
                          <div style={sumRow}><span>{cageIds.length ? `${durLabel(dur)} × ${cageIds.length} cage${cageIds.length > 1 ? 's' : ''}` : 'Pick a cage'}</span><span>{quote ? money(gross) : '—'}</span></div>
                          {kind === 'membership' && quote?.out_hours_covered > 0 && <div style={{ ...sumRow, ...sub }}><span>{Number(quote.out_hours_covered)} hrs from their membership</span><span>covered</span></div>}
                          {deposit && <div style={{ ...sumRow, ...sub }}><span>Balance at the party</span><span>{money(gross - due)}</span></div>}
                          <div style={{ ...sumRow, fontWeight: 700, borderTop: '1px solid rgba(0,0,0,.08)' }}>
                            <span>{pay === 'later' ? 'Due at check-in' : pay === 'comp' ? 'Customer pays' : deposit ? `Deposit now (${depositPct}%)` : 'Due now'}</span>
                            <span>{quote ? money(due) : '—'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </section>

                  <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for staff (optional)" rows={2} style={{ ...field, padding: '10px', resize: 'vertical' }} />
                    {custEmail && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={pay === 'card'} />
                        {pay === 'card' ? 'Stripe receipt is emailed to the customer' : 'Email the customer a confirmation'}
                      </label>
                    )}
                  </section>
                </>
              )}

              {conflicts && (
                <div style={{ border: `1px solid rgba(186,12,47,.35)`, borderRadius: 8, padding: '12px 13px', display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(186,12,47,.04)' }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: RED }}>
                    {conflicts.length} booking{conflicts.length === 1 ? ' is' : 's are'} in the way. Move or cancel {conflicts.length === 1 ? 'it' : 'them'} first.
                  </div>
                  {conflicts.map((c) => (
                    <div key={c.group_id} style={{ fontSize: 13, lineHeight: 1.45 }}>
                      <strong>{c.title}</strong>{c.kind === 'staff_hold' ? ' (hold)' : ''}<br />
                      <span style={{ color: 'rgba(0,0,0,.6)' }}>{fmtRange(c.starts_at, c.ends_at)} · {c.cages}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ padding: '16px 24px 22px', borderTop: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10, position: 'sticky', bottom: 0, background: '#fff' }}>
              {err && <div style={{ fontSize: 13, color: RED, lineHeight: 1.5 }}>{err}</div>}
              {tab === 'booking' && (
                <button disabled={working || !canBook} onClick={book} style={primary(working || !canBook)}>
                  {working ? 'Booking…' : pay === 'card' && due > 0 ? `Continue to card · ${money(due)}` : pay === 'cash' || pay === 'check' ? `Book · ${money(due)} ${pay}` : 'Book it'}
                </button>
              )}
              {tab === 'hold' && <button disabled={working || !canHold} onClick={hold} style={primary(working || !canHold, '#000')}>{working ? 'Holding…' : 'Hold this time'}</button>}
              {tab === 'block' && <button disabled={working || !canBlockNow} onClick={block} style={primary(working || !canBlockNow, '#000')}>{working ? 'Checking…' : 'Block this time'}</button>}
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function CageChips({ cages, on, toggle }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {cages.map((c) => {
        const sel = on.includes(c.id);
        return (
          <button key={c.id} onClick={() => toggle(c.id)} aria-pressed={sel} style={{ minHeight: 36, padding: '0 13px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600, background: sel ? '#111' : '#fff', color: sel ? '#fff' : '#111', border: `1px solid ${sel ? '#111' : 'rgba(0,0,0,.18)'}` }}>{c.name}</button>
        );
      })}
    </div>
  );
}

const label_ = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)', marginBottom: 2 };
const field = { minHeight: 42, padding: '0 10px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 6, fontSize: 14, background: '#fff', color: '#111', fontWeight: 400, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,.6)', minWidth: 0 };
const grid2 = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 };
const hint = { fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.5 };
const linkBtn = { border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#111', textDecoration: 'underline', textUnderlineOffset: 3 };
const sumRow = { display: 'flex', justifyContent: 'space-between', gap: 12, padding: '9px 12px' };
const sub = { fontSize: 12.5, color: 'rgba(0,0,0,.55)', paddingTop: 0 };
const choice = (on) => ({ minHeight: 40, padding: '0 8px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: on ? '#FBEDEF' : '#fff', color: '#111', border: `1.5px solid ${on ? RED : 'rgba(0,0,0,.15)'}` });
const primary = (off, bg = RED) => ({ minHeight: 46, borderRadius: 6, border: 'none', background: bg, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14.5, letterSpacing: '.08em', textTransform: 'uppercase', cursor: off ? 'default' : 'pointer', opacity: off ? 0.45 : 1 });
