import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import BookingPanel from '../components/BookingPanel';

const FALLBACK_TZ = 'America/Los_Angeles';

// --- Timezone-correct day math ---------------------------------------------
// The facility's day runs on facility_settings.timezone, not on the visitor's
// clock. A player in Phoenix and a coach in Apple Valley must see the same
// grid, so every boundary is resolved in the facility zone and stored as an
// absolute instant.

function tzOffsetMs(utcDate, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const p = {};
  for (const part of dtf.formatToParts(utcDate)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    p.hour === '24' ? 0 : +p.hour, +p.minute, +p.second
  );
  return asUTC - Math.floor(utcDate.getTime() / 1000) * 1000;
}

// Absolute instant for a wall-clock time in `tz`. Resolved twice so the answer
// stays correct when the guess lands on the far side of a DST transition.
function zonedTimeToUtc(ymd, hours, minutes, tz) {
  const [y, m, d] = ymd.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, hours, minutes, 0);
  let ms = guess - tzOffsetMs(new Date(guess), tz);
  ms = guess - tzOffsetMs(new Date(ms), tz);
  return new Date(ms);
}

function todayYmd(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function addDaysYmd(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

function labelYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric'
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function Schedule() {
  const { user, loading, signOut } = useAuth();
  const router = useRouter();

  const [settings, setSettings] = useState(null);
  const [cages, setCages] = useState([]);
  const [busy, setBusy] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loadingGrid, setLoadingGrid] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dayYmd, setDayYmd] = useState(() => todayYmd(FALLBACK_TZ));

  const tz = settings?.timezone || FALLBACK_TZ;

  useEffect(() => {
    if (!loading && !user) router.replace('/signin');
  }, [loading, user, router]);

  const dayStart = useMemo(() => zonedTimeToUtc(dayYmd, 0, 0, tz), [dayYmd, tz]);
  const dayEnd = useMemo(() => zonedTimeToUtc(addDaysYmd(dayYmd, 1), 0, 0, tz), [dayYmd, tz]);

  const load = useCallback(async () => {
    setLoadingGrid(true);
    setError(null);

    const [settingsRes, cagesRes, scheduleRes, blocksRes] = await Promise.all([
      supabase.from('facility_settings').select('*').eq('id', 1).single(),
      supabase.from('cages').select('*').eq('active', true).order('sort_order'),
      supabase.from('v_public_schedule').select('cage_id, starts_at, ends_at')
        .lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString()),
      supabase.from('blocks').select('cage_id, scope, starts_at, ends_at')
        .lt('starts_at', dayEnd.toISOString()).gt('ends_at', dayStart.toISOString())
    ]);

    const failure = [settingsRes, cagesRes, scheduleRes, blocksRes].find((r) => r.error);
    if (failure) {
      // Surface it. A silent failure here used to leave the page spinning
      // forever, which reads to a customer as "this business is broken".
      console.error('[schedule] load failed', failure.error);
      setError(failure.error.message || 'Could not load the schedule.');
      setLoadingGrid(false);
      return;
    }

    if (!settingsRes.data) {
      setError('Facility hours are not configured yet.');
      setLoadingGrid(false);
      return;
    }

    setSettings(settingsRes.data);
    setCages(cagesRes.data || []);
    setBusy(scheduleRes.data || []);
    setBlocks(blocksRes.data || []);
    setLoadingGrid(false);
  }, [dayStart, dayEnd]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const channel = supabase.channel('reservations-watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reservations' }, () => load())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [load]);

  if (loading || !user) return null;

  const slots = [];
  if (settings) {
    const [oh, om] = settings.open_time.split(':').map(Number);
    const [ch, cm] = settings.close_time.split(':').map(Number);
    let t = zonedTimeToUtc(dayYmd, oh, om, tz);
    const end = zonedTimeToUtc(dayYmd, ch, cm, tz);
    while (t < end) {
      slots.push(new Date(t));
      t = new Date(t.getTime() + settings.slot_minutes * 60000);
    }
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
        <button onClick={() => setDayYmd(addDaysYmd(dayYmd, -1))} style={navBtn}>‹</button>
        <div style={{ fontWeight: 700, fontSize: 15, minWidth: 190, textAlign: 'center' }}>
          {labelYmd(dayYmd)}
        </div>
        <button onClick={() => setDayYmd(addDaysYmd(dayYmd, 1))} style={navBtn}>›</button>
      </div>

      {error ? (
        <div style={{ border: '1px solid rgba(186,12,47,.35)', background: '#fff', borderRadius: 10, padding: '22px 24px' }}>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 16, letterSpacing: '.06em', textTransform: 'uppercase', color: '#BA0C2F', marginBottom: 8 }}>
            Schedule unavailable
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'rgba(0,0,0,.7)', marginBottom: 16 }}>
            We couldn&rsquo;t load today&rsquo;s availability. This is on us, not you &mdash; try again, or call
            {' '}{settings?.phone || '(760) 553-5996'} and we&rsquo;ll book you over the phone.
          </div>
          <div style={{ fontSize: 11.5, color: 'rgba(0,0,0,.4)', marginBottom: 16, fontFamily: 'ui-monospace, monospace' }}>{error}</div>
          <button onClick={() => load()} style={{ padding: '11px 22px', border: 'none', borderRadius: 6, background: '#BA0C2F', color: '#fff', cursor: 'pointer', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase' }}>
            Try again
          </button>
        </div>
      ) : loadingGrid || !settings ? (
        <div style={{ color: 'rgba(0,0,0,.4)', fontSize: 14 }}>Loading schedule…</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: `90px repeat(${cages.length}, 140px)`, minWidth: 90 + cages.length * 140 }}>
            <div style={cellHead} />
            {cages.map((c) => <div key={c.id} style={cellHead}>{c.name}</div>)}
            {slots.map((s) => (
              <React.Fragment key={s.toISOString()}>
                <div style={{ ...cellTime }}>
                  {s.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' })}
                </div>
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
          onClose={() => { setSelected(null); load(); }}
          onBooked={() => { setSelected(null); load(); }}
        />
      )}
    </main>
  );
}

const navBtn = { width: 34, height: 34, borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer', fontSize: 16 };
const cellHead = { padding: '10px 12px', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(0,0,0,.1)', background: '#faf9f7' };
const cellTime = { padding: '8px 10px', fontSize: 12, color: 'rgba(0,0,0,.55)', borderTop: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center' };
const cellSlot = { border: 'none', borderTop: '1px solid rgba(0,0,0,.06)', borderLeft: '1px solid rgba(0,0,0,.06)', padding: '8px 6px', fontSize: 12 };
