import { useEffect, useState } from 'react';
import { searchCustomers, getCustomer, updateCustomer } from '../lib/staffApi';

const RED = '#BA0C2F';
const GREEN = '#14532A';
const money = (c) => `$${(Math.abs(c) / 100).toFixed(2)}`;
const label = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)', marginBottom: 8 };
const STATUS = { confirmed: 'Booked', scheduled: 'Scheduled', completed: 'Done', canceled: 'Canceled', no_show: 'No-show', pending_payment: 'Checking out' };

// Right-side drawer: find a customer, then their profile, history, and staff notes.
export default function StaffCustomer({ initialId = null, tz, onClose, onBook, onOpenBooking }) {
  const [id, setId] = useState(initialId);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [c, setC] = useState(null);
  const [err, setErr] = useState(null);
  const [notes, setNotes] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [edit, setEdit] = useState(null);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    if (id) return;
    if (q.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(() => searchCustomers(q).then(setResults).catch((e) => setErr(e.message)), 250);
    return () => clearTimeout(t);
  }, [q, id]);

  useEffect(() => {
    if (!id) return;
    setC(null); setErr(null); setEdit(null); setShowPast(false);
    getCustomer(id).then((b) => { setC(b.customer); setNotes(b.customer.notes); }).catch((e) => setErr(e.message));
  }, [id]);

  const fmtDay = (d) => new Date(d).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  async function saveNotes() {
    setSavingNotes(true); setErr(null);
    try { const b = await updateCustomer(id, { notes }); setC(b.customer); } catch (e) { setErr(e.message); }
    setSavingNotes(false);
  }
  async function saveEdit() {
    setErr(null);
    try { const b = await updateCustomer(id, edit); setC(b.customer); setEdit(null); } catch (e) { setErr(e.message); }
  }

  const booking = (g) => (
    <button key={g.groupId} onClick={() => onOpenBooking(g)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%', padding: '10px 12px', border: 'none', borderTop: '1px solid rgba(0,0,0,.07)', background: 'none', textAlign: 'left', cursor: 'pointer' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#111', textDecoration: g.status === 'canceled' ? 'line-through' : 'none' }}>{fmtDay(g.startsAt)} · {fmtTime(g.startsAt)}</span>
        <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>{g.kindLabel}{g.title ? ` · ${g.title}` : ''} · {g.cages.join(', ')}</span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: g.status === 'no_show' ? RED : g.checkedInAt ? GREEN : 'rgba(0,0,0,.55)' }}>{g.checkedInAt && g.status !== 'no_show' ? 'Checked in' : STATUS[g.status] || g.status}</span>
        {g.owedCents > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#8A5A00' }}>Owes {money(g.owedCents)}</span>}
      </span>
    </button>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,.35)' }} />
      <aside style={{ position: 'fixed', zIndex: 51, top: 0, right: 0, bottom: 0, width: 440, maxWidth: '100vw', background: '#fff', boxShadow: '-8px 0 32px rgba(0,0,0,.18)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(0,0,0,.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            {id && !initialId
              ? <button onClick={() => { setId(null); setC(null); }} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.6)' }}>‹ Search</button>
              : <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: RED }}>Customer</span>}
            <button onClick={onClose} aria-label="Close" style={{ width: 32, height: 32, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'rgba(0,0,0,.45)' }}>✕</button>
          </div>
          {!id && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, or phone" style={field} />
          )}
          {c && !edit && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, lineHeight: 1.15, textTransform: 'uppercase', letterSpacing: '.02em' }}>{c.name}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 14, lineHeight: 1.5 }}>
                <a href={`mailto:${c.email}`} style={{ color: '#111' }}>{c.email}</a>
                {c.phone ? <a href={`tel:${c.phone.replace(/\D/g, '')}`} style={{ color: '#111' }}>{c.phone}</a> : <span style={{ color: 'rgba(0,0,0,.45)' }}>No phone on file</span>}
                <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.5)' }}>Customer since {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>
              </div>
              <button onClick={() => setEdit({ firstName: c.firstName, lastName: c.lastName, phone: c.phone || '' })} style={{ alignSelf: 'flex-start', border: 'none', background: 'none', padding: '4px 0', cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline' }}>Edit name or phone</button>
            </div>
          )}
          {c && edit && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 8 }}>
                <label style={fieldLabel}>First name<input value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} style={field} /></label>
                <label style={fieldLabel}>Last name<input value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} style={field} /></label>
              </div>
              <label style={fieldLabel}>Phone<input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} style={field} /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setEdit(null)} style={secondaryBtn}>Cancel</button>
                <button onClick={saveEdit} style={{ ...secondaryBtn, background: '#000', color: '#fff', border: 'none', fontWeight: 700 }}>Save</button>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '18px 24px 28px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1 }}>
          {err && <div style={{ fontSize: 13.5, padding: '10px 12px', borderRadius: 8, background: 'rgba(186,12,47,.07)', color: RED }}>{err}</div>}

          {!id && (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {q.trim().length >= 2 && results.length === 0 && <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.5)' }}>No customers match.</div>}
              {results.map((r) => (
                <button key={r.id} onClick={() => setId(r.id)} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '11px 4px', border: 'none', borderBottom: '1px solid rgba(0,0,0,.07)', background: 'none', textAlign: 'left', cursor: 'pointer' }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: '#111' }}>{r.name}</span>
                  <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>{r.email}{r.phone ? ` · ${r.phone}` : ''}{r.memberHours != null ? ` · Member, ${r.memberHours} hr left` : ''}</span>
                </button>
              ))}
            </div>
          )}

          {id && !c && !err && <div style={{ fontSize: 14, color: 'rgba(0,0,0,.4)' }}>Loading…</div>}

          {c && (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 1, background: 'rgba(0,0,0,.08)', border: '1px solid rgba(0,0,0,.08)', borderRadius: 8, overflow: 'hidden' }}>
              {[
                [c.stats.bookings, 'Bookings'],
                [c.stats.noShows, 'No-shows', c.stats.noShows ? RED : null],
                [money(c.stats.spentCents), 'Paid'],
              ].map(([v, l, col]) => (
                <div key={l} style={{ background: '#fff', padding: '12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 22, lineHeight: 1.1, color: col || '#111' }}>{v}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)' }}>{l}</span>
                </div>
              ))}
            </div>
            {(c.stats.owedCents > 0 || c.memberHours != null) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: -8 }}>
                {c.stats.owedCents > 0 && <div style={{ fontSize: 14, padding: '10px 12px', borderRadius: 8, background: '#FFF4DE', display: 'flex', justifyContent: 'space-between' }}><span>Owes on upcoming bookings</span><strong>{money(c.stats.owedCents)}</strong></div>}
                {c.memberHours != null && <div style={{ fontSize: 14, padding: '10px 12px', borderRadius: 8, background: '#FBEDEF', display: 'flex', justifyContent: 'space-between' }}><span>Membership hours left</span><strong>{c.memberHours} hr · until {new Date(c.memberExpires).toLocaleDateString(undefined, { timeZone: tz, month: 'short', day: 'numeric' })}</strong></div>}
              </div>
            )}

            <button onClick={() => onBook({ id: c.id, name: c.name, email: c.email, phone: c.phone, memberHours: c.memberHours, memberExpires: c.memberExpires })}
              style={{ minHeight: 44, borderRadius: 6, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
              Book for {c.firstName || c.name}
            </button>

            <section>
              <div style={label}>Staff notes</div>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Only staff see these. e.g. Prefers Cage 2, brings own machine."
                style={{ ...field, width: '100%', boxSizing: 'border-box', padding: '10px', minHeight: 80, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
                  {c.notesUpdatedAt ? `Updated ${new Date(c.notesUpdatedAt).toLocaleDateString(undefined, { timeZone: tz, month: 'short', day: 'numeric' })}${c.notesBy ? ` by ${c.notesBy}` : ''}` : ''}
                </span>
                {notes !== c.notes && <button disabled={savingNotes} onClick={saveNotes} style={{ minHeight: 34, padding: '0 14px', borderRadius: 6, border: 'none', background: '#000', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>{savingNotes ? 'Saving…' : 'Save notes'}</button>}
              </div>
            </section>

            <section>
              <div style={label}>Upcoming</div>
              {c.upcoming.length
                ? <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, overflow: 'hidden', marginTop: -1 }}>{c.upcoming.map(booking)}</div>
                : <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.5)' }}>Nothing booked.</div>}
            </section>

            {c.past.length > 0 && (
              <section>
                <div style={label}>History</div>
                <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 8, overflow: 'hidden' }}>{(showPast ? c.past : c.past.slice(0, 5)).map(booking)}</div>
                {c.past.length > 5 && !showPast && (
                  <button onClick={() => setShowPast(true)} style={{ border: 'none', background: 'none', padding: '8px 0', cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline' }}>Show {c.past.length - 5} more</button>
                )}
              </section>
            )}
          </>)}
        </div>
      </aside>
    </>
  );
}

const secondaryBtn = { flex: 1, minHeight: 42, borderRadius: 6, border: '1px solid rgba(0,0,0,.15)', background: '#fff', fontSize: 13.5, cursor: 'pointer' };
const fieldLabel = { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12, fontWeight: 600, color: 'rgba(0,0,0,.6)' };
const field = { minHeight: 42, padding: '0 10px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 6, fontSize: 14, background: '#fff', color: '#111', fontWeight: 400 };
