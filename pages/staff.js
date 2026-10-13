import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { zonedTimeToUtc, todayYmd, addDaysYmd, labelYmd } from '../lib/facilityTime';
import { STATES, LEGEND } from '../lib/staffStates';
import StaffBookingDetail from '../components/StaffBookingDetail';
import StaffNew from '../components/StaffNew';
import StaffBlockDetail from '../components/StaffBlockDetail';

const RED = '#BA0C2F';
const FALLBACK_TZ = 'America/Los_Angeles';
const ROW_H = 30;
const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', coach: 'Coach' };

export default function Staff() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();
  const [tz, setTz] = useState(FALLBACK_TZ);
  const [dayYmd, setDayYmd] = useState(() => todayYmd(FALLBACK_TZ));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const [flash, setFlash] = useState(null);
  const [newOpen, setNewOpen] = useState(null); // { tab, cageId?, startsAt?, fromHold? }
  const [blockOpen, setBlockOpen] = useState(null);

  useEffect(() => { if (!loading && !user) router.replace('/signin'); }, [loading, user, router]);

  const load = useCallback(async () => {
    const start = zonedTimeToUtc(dayYmd, 0, 0, tz);
    const end = zonedTimeToUtc(addDaysYmd(dayYmd, 1), 0, 0, tz);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const r = await fetch(`/api/staff/day?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (r.status === 403) { router.replace('/schedule'); return; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setError(body.error || 'Could not load the schedule.'); return; }
    setError(null);
    setData(body);
    if (body.settings?.timezone && body.settings.timezone !== tz) setTz(body.settings.timezone);
  }, [dayYmd, tz, router]);

  useEffect(() => { if (user) load(); }, [user, load]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('staff-reservations')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'blocks' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [user, load]);

  const grid = useMemo(() => {
    if (!data?.settings) return null;
    const s = data.settings;
    const slotMs = s.slot_minutes * 60000;
    const [oh, om] = s.open_time.split(':').map(Number);
    const [ch, cm] = s.close_time.split(':').map(Number);
    const open = zonedTimeToUtc(dayYmd, oh, om, tz).getTime();
    let gStart = open;
    let gEnd = zonedTimeToUtc(dayYmd, ch, cm, tz).getTime();
    const groups = data.groups.filter((g) => showCanceled || g.status !== 'canceled');
    const dayStart = zonedTimeToUtc(dayYmd, 0, 0, tz).getTime();
    const dayEnd = zonedTimeToUtc(addDaysYmd(dayYmd, 1), 0, 0, tz).getTime();
    for (const g of groups) for (const r of g.rows) {
      const a = Math.max(new Date(r.startsAt).getTime(), dayStart);
      const b = Math.min(new Date(r.endsAt).getTime(), dayEnd);
      if (a < gStart) gStart = open - Math.ceil((open - a) / slotMs) * slotMs;
      if (b > gEnd) gEnd = open + Math.ceil((b - open) / slotMs) * slotMs;
    }
    const n = Math.max(1, Math.round((gEnd - gStart) / slotMs));
    const slots = Array.from({ length: n }, (_, i) => new Date(gStart + i * slotMs));
    const col = new Map(data.cages.map((c, i) => [c.id, i + 2]));
    const place = (startsAt, endsAt) => {
      const a = Math.max(new Date(startsAt).getTime(), gStart);
      const b = Math.min(new Date(endsAt).getTime(), gEnd);
      const row = Math.floor((a - gStart) / slotMs) + 2;
      return { row, span: Math.max(1, Math.ceil((b - a) / slotMs)) };
    };
    const items = [];
    for (const g of groups) for (const r of g.rows) {
      if (!col.has(r.cageId)) continue;
      items.push({ key: r.id, g, col: col.get(r.cageId), ...place(r.startsAt, r.endsAt) });
    }
    const blockItems = [];
    for (const b of data.blocks) {
      const cols = b.scope === 'facility' ? data.cages.map((c) => col.get(c.id)) : [col.get(b.cage_id)].filter(Boolean);
      for (const c of cols) blockItems.push({ key: `${b.id}-${c}`, b, col: c, ...place(b.starts_at, b.ends_at) });
    }
    const live = data.groups.filter((g) => g.status !== 'canceled');
    return { slots, items, blockItems, liveCount: live.length, canceledCount: data.groups.length - live.length };
  }, [data, dayYmd, tz, showCanceled]);

  if (loading || !user) return null;

  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const open = openId && data?.groups.find((g) => g.groupId === openId);
  const openBlock = blockOpen && data?.blocks.find((b) => b.id === blockOpen);
  const done = (text, ymd) => {
    setNewOpen(null); setBlockOpen(null); setOpenId(null); setFlash(text);
    if (ymd && ymd !== dayYmd) setDayYmd(ymd); else load();
  };
  const isToday = dayYmd === todayYmd(tz);
  const cages = data?.cages || [];

  return (
    <main style={{ maxWidth: 1240, margin: '0 auto', padding: '20px 20px 80px' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', paddingBottom: 16, marginBottom: 22, borderBottom: '1px solid rgba(0,0,0,.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/email-logo.png" alt="The Yard HD" style={{ height: 30, width: 'auto', display: 'block' }} />
          {data?.role && (
            <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', background: '#000', color: '#fff', padding: '5px 11px', borderRadius: 5 }}>
              {ROLE_LABEL[data.role]}
            </span>
          )}
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 13 }}>
          <Link href="/schedule" style={{ color: 'rgba(0,0,0,.6)' }}>Customer booking</Link>
          <button onClick={() => signOut()} style={{ border: 'none', background: 'none', padding: 0, color: 'rgba(0,0,0,.6)', cursor: 'pointer', fontSize: 13 }}>Sign out</button>
        </nav>
      </header>

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 28, textTransform: 'uppercase', letterSpacing: '.03em', lineHeight: 1.1 }}>Schedule</div>
          <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.55)' }}>Click an open slot to book, hold, or block it. Click anything on the grid for details.</div>
          {data && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button onClick={() => setNewOpen({ tab: 'booking' })} style={{ ...newBtn, background: RED, color: '#fff', border: 'none' }}>+ Book for a customer</button>
              <button onClick={() => setNewOpen({ tab: 'hold' })} style={newBtn}>Hold time</button>
              {data.canBlock && <button onClick={() => setNewOpen({ tab: 'block' })} style={newBtn}>Block time</button>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setDayYmd(addDaysYmd(dayYmd, -1))} style={navBtn} aria-label="Previous day">‹</button>
          <div style={{ fontWeight: 700, fontSize: 15, minWidth: 200, textAlign: 'center' }}>{labelYmd(dayYmd)}</div>
          <button onClick={() => setDayYmd(addDaysYmd(dayYmd, 1))} style={navBtn} aria-label="Next day">›</button>
          {!isToday && <button onClick={() => setDayYmd(todayYmd(tz))} style={{ ...navBtn, width: 'auto', padding: '0 14px', fontSize: 13, fontWeight: 600 }}>Today</button>}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {LEGEND.map((k) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
              <span style={{ width: 12, height: 12, borderRadius: 3, background: STATES[k].bg, border: STATES[k].border || 'none', boxSizing: 'border-box' }} />
              {STATES[k].label}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: 'repeating-linear-gradient(45deg,#D9D6D1 0 3px,#EFEDE9 3px 6px)' }} />
            Blocked
          </div>
        </div>
        {grid && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(0,0,0,.65)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showCanceled} onChange={(e) => setShowCanceled(e.target.checked)} />
            Show canceled ({grid.canceledCount})
          </label>
        )}
      </div>

      {flash && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13.5, padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: '#E8F0EA', color: '#14532A' }}>
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} aria-label="Dismiss" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#14532A', fontSize: 14 }}>✕</button>
        </div>
      )}

      {error ? (
        <div style={{ border: '1px solid rgba(186,12,47,.35)', borderRadius: 10, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ fontSize: 14, color: RED, fontWeight: 600 }}>Couldn&rsquo;t load the schedule.</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', fontFamily: 'ui-monospace, monospace' }}>{error}</div>
          <button onClick={load} style={{ padding: '10px 20px', border: 'none', borderRadius: 6, background: RED, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>Try again</button>
        </div>
      ) : !grid ? (
        <div style={{ color: 'rgba(0,0,0,.4)', fontSize: 14 }}>Loading schedule…</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
          <div style={{
            display: 'grid', position: 'relative',
            gridTemplateColumns: `72px repeat(${cages.length}, minmax(130px, 1fr))`,
            gridTemplateRows: `40px repeat(${grid.slots.length}, ${ROW_H}px)`,
            minWidth: 72 + cages.length * 130,
          }}>
            <div style={{ ...head, gridColumn: 1, gridRow: 1 }} />
            {cages.map((c, i) => <div key={c.id} style={{ ...head, gridColumn: i + 2, gridRow: 1 }}>{c.name}</div>)}
            {grid.slots.map((s, r) => (
              <React.Fragment key={s.toISOString()}>
                <div style={{ gridColumn: 1, gridRow: r + 2, borderTop: '1px solid rgba(0,0,0,.06)', fontSize: 11.5, color: 'rgba(0,0,0,.5)', padding: '0 10px', display: 'flex', alignItems: 'center' }}>
                  {s.getUTCMinutes() === 0 || r === 0 ? fmtTime(s) : ''}
                </div>
                {cages.map((c, i) => (
                  <div key={c.id} role="button" tabIndex={-1} aria-label={`New at ${fmtTime(s)}, ${c.name}`}
                    onClick={() => setNewOpen({ tab: 'booking', cageId: c.id, startsAt: s })}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(186,12,47,.06)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    style={{ gridColumn: i + 2, gridRow: r + 2, cursor: 'pointer', borderTop: `1px solid rgba(0,0,0,${s.getUTCMinutes() === 0 ? '.08' : '.035'})`, borderLeft: '1px solid rgba(0,0,0,.06)' }} />
                ))}
              </React.Fragment>
            ))}
            {grid.blockItems.map((x) => (
              <button key={x.key} onClick={() => setBlockOpen(x.b.id)} title={x.b.reason || 'Blocked'} style={{ gridColumn: x.col, gridRow: `${x.row} / span ${x.span}`, margin: 2, zIndex: 2, border: 'none', cursor: 'pointer', textAlign: 'left', alignSelf: 'stretch', display: 'block', borderRadius: 5, background: 'repeating-linear-gradient(45deg,#D9D6D1 0 6px,#EFEDE9 6px 12px)', fontSize: 11.5, fontWeight: 600, color: 'rgba(0,0,0,.6)', padding: '6px 8px', overflow: 'hidden' }}>
                {x.b.reason || 'Blocked'}
              </button>
            ))}
            {grid.items.map((x) => {
              const st = STATES[x.g.payState] || STATES.unpaid;
              return (
                <button key={x.key} onClick={() => setOpenId(x.g.groupId)} style={{
                  gridColumn: x.col, gridRow: `${x.row} / span ${x.span}`, margin: 2, zIndex: x.g.status === 'canceled' ? 1 : 2,
                  borderRadius: 5, background: st.bg, color: st.fg, border: st.border || 'none', boxSizing: 'border-box',
                  padding: '5px 8px', textAlign: 'left', cursor: 'pointer', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: 1, opacity: x.g.status === 'canceled' ? 0.85 : 1,
                  textDecoration: x.g.status === 'canceled' ? 'line-through' : 'none',
                }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{x.g.title}</span>
                  {x.span > 1 && (
                    <span style={{ fontSize: 11, lineHeight: 1.3, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                      {fmtTime(x.g.startsAt)}–{fmtTime(x.g.endsAt)} · {st.label}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {grid.liveCount === 0 && (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'rgba(0,0,0,.5)', borderTop: '1px solid rgba(0,0,0,.08)' }}>No bookings this day.</div>
          )}
        </div>
      )}

      {open && <StaffBookingDetail
          key={open.groupId} group={open} tz={tz} settings={data.settings} cages={cages}
          onClose={() => setOpenId(null)} onChanged={load}
          onMoved={(ymd, text) => { setOpenId(null); setFlash(text); if (ymd !== dayYmd) setDayYmd(ymd); else load(); }}
          onConvert={(g) => { setOpenId(null); setNewOpen({ tab: 'booking', fromHold: g }); }}
        />}
      {newOpen && data && <StaffNew
          initial={newOpen} tz={tz} settings={data.settings} cages={cages} canBlock={data.canBlock}
          onClose={() => setNewOpen(null)} onDone={done}
        />}
      {openBlock && <StaffBlockDetail
          key={openBlock.id} block={openBlock} cages={cages} tz={tz} step={data.settings.slot_minutes} canEdit={data.canBlock}
          onClose={() => setBlockOpen(null)} onDone={(text) => done(text)}
        />}
    </main>
  );
}

const navBtn = { width: 36, height: 36, borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer', fontSize: 16 };
const newBtn = { minHeight: 38, padding: '0 14px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', color: '#111', cursor: 'pointer', fontSize: 13, fontWeight: 700 };
const head = { padding: '0 12px', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(0,0,0,.1)', background: '#faf9f7', display: 'flex', alignItems: 'center', position: 'sticky', top: 0 };
