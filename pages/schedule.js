import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabaseClient';
import BookingPanel from '../components/BookingPanel';
import NamePrompt from '../components/NamePrompt';
import MyBookings from '../components/MyBookings';
import TeamPanel from '../components/TeamPanel';
import MembershipSection from '../components/MembershipSection';
import MyTeams from '../components/MyTeams';
import { localParts } from '../lib/facilityTime';

const MODES = [
  { k: 'drop', t: 'Drop-in', sub: 'One cage, 30 min – 2 hr' },
  { k: 'party', t: 'Party', sub: 'Whole facility, 2 or 3 hr' },
  { k: 'team', t: 'Team practice', sub: 'Weekly, whole facility' },
  { k: 'member', t: 'Membership', sub: 'Monthly cage hours' },
];

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
  const [needsName, setNeedsName] = useState(false);
  const [bookingsKey, setBookingsKey] = useState(0);
  const [isStaff, setIsStaff] = useState(false);
  const [mode, setMode] = useState('drop');
  const [member, setMember] = useState(false);
  const [teamsKey, setTeamsKey] = useState(0);

  const tz = settings?.timezone || FALLBACK_TZ;

  useEffect(() => {
    if (!loading && !user) router.replace('/signin');
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    supabase.from('users').select('needs_name').eq('id', user.id).single()
      .then(({ data }) => setNeedsName(!!data?.needs_name));
    supabase.from('user_roles').select('role').eq('user_id', user.id).in('role', ['coach', 'admin', 'owner'])
      .then(({ data }) => setIsStaff(!!data?.length));
  }, [user]);

  // Members spend their hours on drop-in bookings automatically.
  const loadMember = useCallback(() => {
    if (!user) return;
    supabase.from('v_membership_balance').select('hours_remaining, expires_at')
      .eq('user_id', user.id).gt('expires_at', new Date().toISOString()).maybeSingle()
      .then(({ data }) => setMember(!!data));
  }, [user]);
  useEffect(() => { loadMember(); }, [loadMember]);

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

  const wholeFacility = mode === 'party' || mode === 'team';
  // A start time only counts as open when the shortest party package (or a
  // 1-hour practice) fits: every cage free for the whole span, before closing.
  const minSpan = mode === 'party'
    ? Math.min(...Object.keys(settings?.party_packages || { 120: 1 }).map(Number))
    : 60;
  function isFacilityTaken(slotStart) {
    const step = settings?.slot_minutes || 30;
    const last = slots.length ? slots[slots.length - 1].getTime() + step * 60000 : 0;
    if (slotStart.getTime() + minSpan * 60000 > last) return true;
    for (let t = 0; t < minSpan; t += step) {
      const at = new Date(slotStart.getTime() + t * 60000);
      if (cages.some((c) => isTaken(c.id, at))) return true;
    }
    return false;
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isStaff && (
            <a href="/staff" style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.1em', textTransform: 'uppercase', background: '#000', color: '#fff', padding: '7px 14px', borderRadius: 5, textDecoration: 'none' }}>
              Staff schedule
            </a>
          )}
          <button onClick={() => signOut()} style={{ border: 'none', background: 'none', color: 'rgba(0,0,0,.5)', cursor: 'pointer', fontSize: 13 }}>
            Sign out
          </button>
        </div>
      </div>

      {settings && <MyBookings key={bookingsKey} userId={user.id} settings={settings} tz={tz} onChange={load} />}
      <MyTeams userId={user.id} tz={tz} refreshKey={teamsKey} />

      <div role="tablist" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, marginBottom: 18 }}>
        {MODES.map((m) => {
          const on = mode === m.k;
          return (
            <button key={m.k} role="tab" aria-selected={on} onClick={() => setMode(m.k)}
              style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 9, cursor: 'pointer', background: on ? '#111' : '#fff', color: on ? '#fff' : '#111', border: `1px solid ${on ? '#111' : 'rgba(0,0,0,.15)'}` }}>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 16, textTransform: 'uppercase', letterSpacing: '.03em' }}>{m.t}</div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>{m.k === 'drop' && member ? 'Uses your member hours' : m.sub}</div>
            </button>
          );
        })}
      </div>

      {mode === 'member' && settings && (
        <MembershipSection userId={user.id} settings={settings} tz={tz} onChange={loadMember} />
      )}

      {mode !== 'member' && (<>
      {wholeFacility && (
        <div style={{ fontSize: 13.5, lineHeight: 1.6, padding: '10px 14px', borderRadius: 8, background: '#FBEDEF', marginBottom: 14 }}>
          {mode === 'party'
            ? <>Parties get <strong>every cage plus the mezzanine</strong>. Pick a start time where the whole facility is open. 2 hours {money(settings?.party_packages?.['120'])}, 3 hours {money(settings?.party_packages?.['180'])}, up to {settings?.party_max_guests ?? 30} guests, {settings?.party_deposit_percent ?? 25}% deposit today.</>
            : <>Team practice reserves the <strong>whole facility</strong> at the same time every week. Pick your first practice; you'll pay for four weeks at a time.</>}
        </div>
      )}

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
          <div style={{ display: 'grid', gridTemplateColumns: wholeFacility ? '90px minmax(200px, 1fr)' : `90px repeat(${cages.length}, minmax(140px, 1fr))`, minWidth: wholeFacility ? 290 : 90 + cages.length * 140 }}>
            <div style={cellHead} />
            {wholeFacility
              ? <div style={cellHead}>Whole facility</div>
              : cages.map((c) => <div key={c.id} style={cellHead}>{c.name}</div>)}
            {slots.map((s) => (
              <React.Fragment key={s.toISOString()}>
                <div style={{ ...cellTime }}>
                  {s.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' })}
                </div>
                {wholeFacility ? (() => {
                  const taken = isFacilityTaken(s);
                  const disabled = taken || s < now;
                  return (
                    <button disabled={disabled} onClick={() => setSelected({ kind: mode, cages, startsAt: s })}
                      style={{ ...cellSlot, background: disabled ? 'rgba(0,0,0,.05)' : '#fff', color: disabled ? 'rgba(0,0,0,.25)' : '#111', cursor: disabled ? 'not-allowed' : 'pointer' }}>
                      {s < now ? '—' : cages.some((c) => isTaken(c.id, s)) ? 'Booked' : taken ? `Needs ${minSpan / 60} hr free` : 'Open'}
                    </button>
                  );
                })() : cages.map((c) => {
                  const taken = isTaken(c.id, s);
                  const past = s < now;
                  const disabled = taken || past;
                  return (
                    <button
                      key={c.id}
                      disabled={disabled}
                      onClick={() => setSelected({ kind: member ? 'membership' : 'drop_in', cages: [c], startsAt: s })}
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

      </>)}

      {needsName && <NamePrompt onDone={() => setNeedsName(false)} />}

      {selected && selected.kind === 'team' && (() => {
        const lp = localParts(selected.startsAt, tz);
        return (
          <TeamPanel
            startsAt={selected.startsAt} ymd={lp.ymd} hm={lp.hm} tz={tz} settings={settings}
            onClose={() => { setSelected(null); load(); }}
            onBooked={() => { setSelected(null); load(); setTeamsKey((k) => k + 1); }}
          />
        );
      })()}

      {selected && selected.kind !== 'team' && (
        <BookingPanel
          kind={selected.kind}
          cages={selected.cages}
          startsAt={selected.startsAt}
          settings={settings}
          userId={user.id}
          onClose={() => { setSelected(null); load(); loadMember(); }}
          onBooked={() => { setSelected(null); load(); loadMember(); setBookingsKey((k) => k + 1); }}
        />
      )}
    </main>
  );
}

const money = (c) => (c == null ? '' : `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`);
const navBtn = { width: 34, height: 34, borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer', fontSize: 16 };
const cellHead = { padding: '10px 12px', fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid rgba(0,0,0,.1)', background: '#faf9f7' };
const cellTime = { padding: '8px 10px', fontSize: 12, color: 'rgba(0,0,0,.55)', borderTop: '1px solid rgba(0,0,0,.06)', display: 'flex', alignItems: 'center' };
const cellSlot = { border: 'none', borderTop: '1px solid rgba(0,0,0,.06)', borderLeft: '1px solid rgba(0,0,0,.06)', padding: '8px 6px', fontSize: 12 };
