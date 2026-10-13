import { useEffect, useMemo, useState } from 'react';
import { STATES } from '../lib/staffStates';
import { staffAction } from '../lib/staffApi';

const RED = '#BA0C2F';
const money = (c) => `$${(c / 100).toFixed(2)}`;
const ELIGIBLE = ['drop_in', 'membership', 'team', 'party'];
const ON_BOOKS = ['confirmed', 'completed', 'no_show'];

// One day's bookings as a list: who's expected, who owes, who didn't show.
export default function StaffBookings({ groups = [], tz, onOpen, onChanged }) {
  const [now, setNow] = useState(Date.now());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  const rows = useMemo(() => groups
    .filter((g) => ELIGIBLE.includes(g.kind) && ON_BOOKS.includes(g.status))
    .map((g) => ({ g, owed: g.status === 'no_show' ? 0 : g.dueCents || g.balanceDueCents || 0, noShow: g.status === 'no_show', started: new Date(g.startsAt).getTime() <= now }))
    .sort((a, b) => new Date(a.g.startsAt) - new Date(b.g.startsAt)), [groups, now]);

  const shown = rows.filter(({ g }) => {
    const t = q.trim().toLowerCase();
    return !t || `${g.title} ${g.name} ${g.phone || ''} ${g.cages.join(' ')}`.toLowerCase().includes(t);
  });
  const noShows = rows.filter((r) => r.noShow).length;
  const owedTotal = rows.reduce((a, r) => a + r.owed, 0);

  async function act(action, g) {
    setBusy(g.groupId + action); setErr(null);
    try { await staffAction(action, { p_group_id: g.groupId }); onChanged?.(); }
    catch (e) { setErr(`${g.title}: ${e.message}`); }
    setBusy(null);
  }

  const stat = (n, label, color) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 90 }}>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 26, lineHeight: 1, color: color || '#111' }}>{n}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)' }}>{label}</span>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', padding: '16px 18px', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
          {stat(rows.length - noShows, 'Expected')}
          {stat(noShows, 'No-shows', noShows ? RED : undefined)}
          {owedTotal > 0 && stat(money(owedTotal), 'To collect')}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a name, phone, or cage"
          style={{ minHeight: 40, minWidth: 240, flex: '0 1 300px', padding: '0 12px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 7, fontSize: 14 }} />
      </div>

      {err && <div style={{ fontSize: 13.5, padding: '10px 14px', borderRadius: 8, background: 'rgba(186,12,47,.07)', color: RED }}>{err}</div>}

      <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
        {shown.length === 0 && (
          <div style={{ padding: '18px', fontSize: 13.5, color: 'rgba(0,0,0,.5)' }}>{rows.length ? 'Nobody matches that search.' : 'No bookings this day.'}</div>
        )}
        {shown.map(({ g, owed, noShow, started }, i) => {
          const st = STATES[g.payState] || STATES.unpaid;
          const b = (k) => busy === g.groupId + k;
          return (
            <div key={g.groupId} style={{ display: 'grid', gridTemplateColumns: '92px minmax(0,1fr) auto', alignItems: 'center', gap: 14, padding: '12px 16px', borderTop: i ? '1px solid rgba(0,0,0,.07)' : 'none', background: noShow ? '#FAF9F7' : '#fff' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fmtTime(g.startsAt)}</span>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,.5)' }}>to {fmtTime(g.endsAt)}</span>
              </div>
              <button onClick={() => onOpen(g.groupId)} style={{ border: 'none', background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#111', textDecoration: noShow ? 'line-through' : 'none' }}>{g.title}</span>
                  <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', background: st.bg, color: st.fg, border: st.border || 'none' }}>{st.label}</span>
                </span>
                <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)' }}>
                  {g.kindLabel} · {g.cages.join(', ')}{g.guestCount ? ` · ${g.guestCount} guests` : ''}{g.title !== g.name ? ` · ${g.name}` : ''}{g.phone ? ` · ${g.phone}` : ''}
                </span>
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {noShow ? <>
                  <span style={{ fontSize: 13, fontWeight: 700, color: RED }}>No-show</span>
                  <button disabled={!!busy} onClick={() => act('undo_no_show', g)} style={linkBtn}>{b('undo_no_show') ? 'Undoing…' : 'Undo'}</button>
                </> : <>
                  {started && <button disabled={!!busy} onClick={() => act('no_show', g)} style={{ ...btn, color: RED, border: `1px solid ${RED}` }}>{b('no_show') ? 'Marking…' : 'No-show'}</button>}
                  {owed > 0 && <button onClick={() => onOpen(g.groupId)} style={{ ...btn, background: '#000', color: '#fff', border: 'none' }}>Collect {money(owed)}</button>}
                </>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.5)', lineHeight: 1.5 }}>
        A no-show frees the cage and keeps what was already paid (deposits included). An unpaid pay-at-check-in balance is dropped.
      </div>
    </div>
  );
}

const btn = { minHeight: 40, padding: '0 14px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', color: '#111', cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const linkBtn = { border: 'none', background: 'none', padding: '8px 4px', cursor: 'pointer', fontSize: 13, color: 'rgba(0,0,0,.6)', textDecoration: 'underline' };
