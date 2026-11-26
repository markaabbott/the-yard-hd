import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentForm from './PaymentForm';
import { authFetch } from '../lib/authFetch';

const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const LEAGUES = [{ k: 'rec', t: 'Rec' }, { k: 'school', t: 'School' }, { k: 'travel', t: 'Travel' }];

// Weekly team practice: the whole facility, same day and time every week.
// Billed in 4-week cycles (always four practices), held two months out (series_horizon_months).
export default function TeamPanel({ startsAt, ymd, hm, tz, settings, onClose, onBooked }) {
  const weeks = settings?.series_cycle_weeks ?? 4;
  const rate = (h) => (h === 1 ? settings?.team_1hr_rate_cents ?? 14000 : settings?.team_2hr_rate_cents ?? 12000);
  const cycle = (h) => rate(h) * h * weeks;

  const [hours, setHours] = useState(1);
  const [team, setTeam] = useState('');
  const [division, setDivision] = useState('');
  const [league, setLeague] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);
  const [signup, setSignup] = useState(null); // { series_id, payment_id, cycle_cents }
  const [clientSecret, setClientSecret] = useState(null);
  const [paid, setPaid] = useState(false);

  const live = useRef({ seriesId: null, paid: false });
  live.current = { seriesId: signup?.series_id || null, paid };

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Closing the tab mid-checkout frees the weekly slot right away (the minute
  // sweeper would do it after 20 minutes anyway).
  useEffect(() => {
    function bail() {
      const { seriesId, paid: p } = live.current;
      if (!seriesId || p) return;
      authFetch('/api/release-hold', { method: 'POST', keepalive: true, body: JSON.stringify({ seriesId }) }).catch(() => {});
    }
    window.addEventListener('pagehide', bail);
    return () => { window.removeEventListener('pagehide', bail); bail(); };
  }, []);

  const hzm = settings?.series_horizon_months ?? 2;
  const horizon = `${['zero','one','two','three','four','five','six'][hzm] || hzm} month${hzm === 1 ? '' : 's'}`;
  const fmtDate = (d) => d.toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (d) => d.toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const dates = Array.from({ length: weeks }, (_, i) => new Date(startsAt.getTime() + i * 7 * 86400000));
  const weekday = startsAt.toLocaleDateString(undefined, { timeZone: tz, weekday: 'long' });
  const endT = new Date(startsAt.getTime() + hours * 3600000);

  async function start() {
    setWorking(true);
    setErr(null);
    const { data, error } = await supabase.rpc('customer_team_signup', {
      p_team_name: team.trim(), p_first_date: ymd, p_start_time: hm, p_weekly_hours: hours,
      p_age_division: division.trim() || null, p_league: league || null,
    });
    if (error) { setWorking(false); setErr(error.message); return; }
    const r = Array.isArray(data) ? data[0] : data;
    setSignup(r);
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: r.payment_id })
    });
    const json = await res.json();
    setWorking(false);
    if (json.error) { setErr(json.error); return; }
    setClientSecret(json.clientSecret);
  }

  async function dismiss() {
    if (paid) { onBooked?.(); return; }
    if (signup?.series_id) {
      setWorking(true);
      try {
        await authFetch('/api/release-hold', { method: 'POST', body: JSON.stringify({ seriesId: signup.series_id }) });
      } catch (e) { console.error('[team] release failed', e); }
      live.current = { seriesId: null, paid: false };
    }
    onClose();
  }

  const later = signup?.later_conflicts || [];

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget && !clientSecret && !working) dismiss(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.4)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
        <div onMouseDown={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 460, margin: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '24px 26px 0' }}>
            <div>
              <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase', letterSpacing: '.02em' }}>
                {paid ? "Your team is set" : 'Team practice'}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginTop: 4 }}>
                Whole facility · every {weekday} · {fmtTime(startsAt)} – {fmtTime(endT)}
              </div>
            </div>
            <button onClick={dismiss} disabled={working} aria-label="Close" style={{ border: 'none', background: 'none', fontSize: 22, lineHeight: 1, cursor: 'pointer', color: 'rgba(0,0,0,.4)', padding: 0 }}>×</button>
          </div>

          <div style={{ padding: '18px 26px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {paid ? (
              <>
                <div style={{ display: 'flex', gap: 10, background: 'rgba(20,120,60,.07)', border: '1px solid rgba(20,120,60,.22)', borderRadius: 9, padding: '13px 15px', fontSize: 13.5, lineHeight: 1.6 }}>
                  <span style={{ color: '#14783C', fontWeight: 700 }}>✓</span>
                  <span>Paid. Your first {weeks} practices are confirmed and your weekly slot is held {horizon} out. We'll email you 7 days before the next cycle is due.</span>
                </div>
                <DateList dates={dates} fmtDate={fmtDate} />
                <button onClick={dismiss} style={primaryBtn}>Done</button>
              </>
            ) : clientSecret ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, borderBottom: '1px solid rgba(0,0,0,.08)', paddingBottom: 14 }}>
                  <span style={{ color: 'rgba(0,0,0,.6)' }}>{team.trim()} · first {weeks} weeks</span>
                  <span style={{ fontWeight: 700 }}>{money(signup.cycle_cents)}</span>
                </div>
                {later.length > 0 && (
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, padding: '9px 11px', borderRadius: 8, background: '#FFF4DE' }}>
                    Heads up: {later.length} later week{later.length === 1 ? ' is' : 's are'} already taken ({later.map((c) => c.date).join(', ')}). We'll hold every other week.
                  </div>
                )}
                <PaymentForm clientSecret={clientSecret} onSuccess={() => setPaid(true)} />
                <button onClick={dismiss} disabled={working} style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
                  {working ? 'Releasing…' : 'Cancel and release this slot'}
                </button>
              </>
            ) : (
              <>
                <div>
                  <div style={label}>Practice length</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
                    {[1, 2].map((h) => (
                      <button key={h} onClick={() => setHours(h)} style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer', border: hours === h ? '1.5px solid #BA0C2F' : '1px solid rgba(0,0,0,.15)', background: hours === h ? 'rgba(186,12,47,.06)' : '#fff' }}>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>{h} hr / week</div>
                        <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.6)' }}>{money(cycle(h))} per {weeks} weeks · {money(rate(h) * h)}/session</div>
                      </button>
                    ))}
                  </div>
                </div>

                <label style={fieldLabel}>Team name
                  <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. High Desert Crushers 12U" maxLength={80} style={input} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.2fr)', gap: 10 }}>
                  <label style={fieldLabel}>Age division
                    <input value={division} onChange={(e) => setDivision(e.target.value)} placeholder="e.g. 12U" maxLength={20} style={input} />
                  </label>
                  <label style={fieldLabel}>League
                    <select value={league} onChange={(e) => setLeague(e.target.value)} style={input}>
                      <option value="">—</option>
                      {LEAGUES.map((l) => <option key={l.k} value={l.k}>{l.t}</option>)}
                    </select>
                  </label>
                </div>

                <div>
                  <div style={label}>This payment covers</div>
                  <DateList dates={dates} fmtDate={fmtDate} />
                </div>

                <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'rgba(0,0,0,.6)' }}>
                  Your slot is held {horizon} out. Each {weeks}-week cycle is billed {money(cycle(hours))}, with a reminder 7 days before it's due. A cycle unpaid more than {settings?.series_grace_days ?? 5} days past due releases the slot.
                </div>

                {err && <div style={{ fontSize: 12.5, color: '#BA0C2F', lineHeight: 1.6 }}>{err.charAt(0).toUpperCase() + err.slice(1)}</div>}

                <button onClick={start} disabled={working || !team.trim()} style={{ ...primaryBtn, opacity: working || !team.trim() ? 0.6 : 1, cursor: working || !team.trim() ? 'default' : 'pointer' }}>
                  {working ? 'Checking the dates…' : `Continue to payment · ${money(cycle(hours))}`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DateList({ dates, fmtDate }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 6, marginTop: 8 }}>
      {dates.map((d) => (
        <div key={d.toISOString()} style={{ fontSize: 13, padding: '7px 10px', borderRadius: 7, background: '#F2F0ED' }}>{fmtDate(d)}</div>
      ))}
    </div>
  );
}

const label = { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' };
const fieldLabel = { ...label, display: 'flex', flexDirection: 'column', gap: 6 };
const input = { padding: '10px 11px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14, fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: '#111', background: '#fff', minWidth: 0 };
const primaryBtn = { padding: '13px 16px', borderRadius: 7, border: 'none', background: '#BA0C2F', color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };
