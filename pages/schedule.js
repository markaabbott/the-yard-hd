import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import BookingPanel from '../components/BookingPanel';

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

export default function Schedule() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState(() => new Date());
  const [settings, setSettings] = useState(null);
  const [cages, setCages] = useState([]);
  const [busy, setBusy] = useState([]); // [{cage_id, starts_at, ends_at}]
  const [blocks, setBlocks] = useState([]);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [selected, setSelected] = useState(null); // { cage, startsAt }

  useEffect(() => {
    if (!loading && !user) router.replace('/signin');
  }, [loading, user, router]);

  useEffect(() => {
    supabase.from('facility_settings').select('*').eq('id', 1).single()
      .then(({ data }) => setSettings(data));
    supabase.from('cages').select('*').eq('active', true).order('sort_order')
      .then(({ data }) => setCages(data || []));
  }, []);

  const dayStart = useMemo(() => { const d = new Date(date); d.setHours(0,0,0,0); return d; }, [date]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);

  const loadGrid = useCallback(async () => {
    setLoadingGrid(true);
    const [{ data: res }, { data: blk }] = await Promise.all([
      supabase.from('v_public_schedule').select('cage_id, starts_at, ends_at')
        .lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString()),
      supabase.from('blocks').select('cage_id, scope, starts_at, ends_at')
        .lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString())
    ]);
    setBusy(res || []);
    setBlocks(blk || []);
    setLoadingGrid(false);
  }, [dayStart, dayEnd]);

  useEffect(() => { loadGrid(); }, [loadGrid]);

  // Real-time: any reservation change on this cage set triggers a grid refetch.
  // (Subscribed to the base table for change notifications; identity is never read client-side.)
  useEffect(() => {
    const channel = supabase.channel('reservations-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => loadGrid())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [loadGrid]);

  if (loading || !user) return null;

  const slots = [];
  if (settings) {
    const [oh, om] = settings.open_time.split(':').map(Number);
    const [ch, cm] = settings.close_time.split(':').map(Number);
    let t = new Date(dayStart); t.setHours(oh, om, 0, 0);
    const end = new Date(dayStart); end.setHours(ch, cm, 0, 0);
    while (t < end) { slots.push(new Date(t)); t = new Date(t.getTime() + settings.slot_minutes * 60000); }
  }

  function isTaken(cageId, slotStart) {
    const slotEnd = new Date(slotStart.getTime() + (settings?.slot_minutes || 30) * 60000);
    const hit = (r) => (r.cage_id === cageId || r.scope === 'facility') &&
      new Date(r.starts_at) < slotEnd && new Date(r.ends_at) > slotStart;
    return busy.some(hit) || blocks.some(hit);
  }

  const now = new Date();

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22, flexWrap: 'wrap', gap: 12 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 26, textTransform: 'uppercase', letterSpacing: '.03em' }}>
          Book a session
        </div>
        <button onClick={() => signOut()} style={{ border: 'none', background: 'none', color: 'rgba(0,0,0,.5)', cursor: 'pointer', fontSize: 13 }}>
          Sign out
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <button onClick={() => setDate(addDays(date, -1))} style={navBtn}>‹</button>
        <div style={{ fontWeight: 700, fontSize: 15, minWidth: 190, textAlign: 'center' }}>
          {date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
        <button onClick={() => setDate(addDays(date, 1))} style={navBtn}>›</button>
      </div>

      {loadingGrid || !settings ? (
        <div style={{ color: 'rgba(0,0,0,.4)', fontSize: 14 }}>Loading schedule…</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${cages.length}, 140px)`, minWidth: 90 + cages.length * 140 }}>
            <div style={cellHead} />
            {cages.map((c) => <div key={c.id} style={cellHead}>{c.name}</div>)}
            {slots.map((s) => (
              <React.Fragment key={s.toISOString()}>
                <div style={{ ...cellTime }}>{s.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
                {cages.map((c) => {
                  const taken = isTaken(c.id, s);
                  const past = s < now;
                  const disabled = taken || past;
                  return (
                    <button
                      key={c.id}
                      disabled={disabled}
                      onClick={() => setSelected({ cage: c, startsAt: s })}
                      style={{
                        ...cellSlot,
                        background: disabled ? 'rgba(0,0,0,.05)' : '#fff',
                        color: disabled ? 'rgba(0,0,0,.25)' : '#111',
                        cursor: disabled ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {taken ? 'Booked' : past ? '—' : 'Open'}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <BookingPanel
          cage={selected.cage}
          startsAt={selected.startsAt}
          slotMinutes={settings.slot_minutes}
          userId={user.id}
          onClose={() => setSelected(null)}
          onBooked={(groupId) => router.push(`/booking/confirmed?group=${groupId}`)}
        />
      )}
    </main>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer', fontSize: 16 };
const cellHead = { padding: '10px 12px', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(0,0,0,.1)', background: '#faf9f7' };
const cellTime = { padding: '8px 10px', fontSize: 12, color: 'rgba(0,0,0,.55)', borderTop: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center' };
const cellSlot = { border: 'none', borderTop: '1px solid rgba(0,0,0,.06)', borderLeft: '1px solid rgba(0,0,0,.06)', padding: '8px 6px', fontSize: 12 };
