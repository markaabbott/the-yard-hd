import { useEffect, useState } from 'react';
import { zonedTimeToUtc, todayYmd, addDaysYmd } from '../lib/facilityTime';
import { getReport, downloadReportCsv } from '../lib/staffApi';

const RED = '#BA0C2F';
const money = (c) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const label = { fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)' };
const card = { border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' };

function range(preset, tz) {
  const t = todayYmd(tz);
  const dow = (new Date(`${t}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const [y, m] = t.split('-').map(Number);
  const first = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  switch (preset) {
    case 'today': return [t, t];
    case 'week': return [addDaysYmd(t, -dow), t];
    case 'lastweek': return [addDaysYmd(t, -dow - 7), addDaysYmd(t, -dow - 1)];
    case 'month': return [first(y, m), t];
    case 'lastmonth': { const lm = m === 1 ? [y - 1, 12] : [y, m - 1]; return [first(...lm), addDaysYmd(first(y, m), -1)]; }
    default: return null;
  }
}
const PRESETS = [['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Custom']];

export default function StaffReports({ tz }) {
  const [preset, setPreset] = useState('week');
  const [[from, to], setRange] = useState(() => range('week', tz));
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (preset !== 'custom') setRange(range(preset, tz)); }, [preset, tz]);

  const valid = from && to && from <= to;
  const iso = () => [zonedTimeToUtc(from, 0, 0, tz).toISOString(), zonedTimeToUtc(addDaysYmd(to, 1), 0, 0, tz).toISOString()];

  useEffect(() => {
    if (!valid) return;
    let live = true;
    setR(null); setErr(null);
    getReport(...iso()).then((b) => live && setR(b)).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [from, to, tz]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportCsv() {
    setExporting(true); setErr(null);
    try { await downloadReportCsv(...iso(), `the-yard-${from}-to-${to}.csv`); } catch (e) { setErr(e.message); }
    setExporting(false);
  }

  const dayLabel = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const kpi = (title, value, sub, color) => (
    <div style={{ ...card, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={label}>{title}</span>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 30, lineHeight: 1, color: color || '#111' }}>{value}</span>
      {sub && <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.55)', lineHeight: 1.45 }}>{sub}</span>}
    </div>
  );
  const row = (cells, i, strong) => (
    <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 10, padding: '9px 14px', borderTop: i ? '1px solid rgba(0,0,0,.07)' : 'none', fontSize: 13.5, fontWeight: strong ? 700 : 400, background: strong ? '#faf9f7' : 'transparent' }}>
      {cells.map((c, j) => <span key={j} style={{ textAlign: j ? 'right' : 'left', fontVariantNumeric: 'tabular-nums' }}>{c}</span>)}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)} style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700, border: `1px solid ${preset === k ? '#000' : 'rgba(0,0,0,.15)'}`, background: preset === k ? '#000' : '#fff', color: preset === k ? '#fff' : '#111' }}>{l}</button>
          ))}
          {preset === 'custom' && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="date" value={from} onChange={(e) => setRange([e.target.value, to])} style={dateField} />
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,.5)' }}>to</span>
              <input type="date" value={to} onChange={(e) => setRange([from, e.target.value])} style={dateField} />
            </span>
          )}
        </div>
        <button disabled={!valid || exporting} onClick={exportCsv} style={{ minHeight: 38, padding: '0 14px', borderRadius: 7, border: '1px solid rgba(0,0,0,.18)', background: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
          {exporting ? 'Exporting…' : 'Export payments (CSV)'}
        </button>
      </div>

      {!valid && <div style={{ fontSize: 13.5, color: RED }}>The start date has to be on or before the end date.</div>}
      {err && <div style={{ fontSize: 13.5, padding: '10px 14px', borderRadius: 8, background: 'rgba(186,12,47,.07)', color: RED }}>{err}</div>}
      {valid && !r && !err && <div style={{ fontSize: 14, color: 'rgba(0,0,0,.4)' }}>Loading report…</div>}

      {r && (<>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {kpi('Net revenue', money(r.money.netCents), `${money(r.money.grossCents)} collected · ${money(r.money.refundsCents)} refunds · ${money(r.money.feesCents)} card fees`)}
          {kpi('By method', money(r.money.grossCents), `Card ${money(r.money.method.card)} · Cash ${money(r.money.method.cash)} · Check ${money(r.money.method.check)}`)}
          {kpi('Bookings', r.bookings.total, `${r.bookings.noShows} no-shows · ${r.bookings.canceled} canceled`)}
          {kpi('Still owed', money(r.owed.cents), r.owed.count ? `On ${r.owed.count} booking${r.owed.count === 1 ? '' : 's'} still on the books, any date` : 'Nothing outstanding', r.owed.cents ? '#8A5A00' : null)}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 12, alignItems: 'start' }}>
          <section style={card}>
            <div style={{ ...label, padding: '14px 14px 10px' }}>By day</div>
            {row(['Day', 'Collected', 'Refunds', 'Card fees', 'Net'], 0, true)}
            {r.byDay.length === 0 && <div style={{ padding: '12px 14px', fontSize: 13.5, color: 'rgba(0,0,0,.5)', borderTop: '1px solid rgba(0,0,0,.07)' }}>No payments in this range.</div>}
            {r.byDay.map((d, i) => row([dayLabel(d.day), money(d.collected), money(d.refunds), money(d.fees), money(d.net)], i + 1))}
          </section>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <section style={{ ...card, padding: '14px' }}>
              <div style={{ ...label, marginBottom: 10 }}>Revenue by type</div>
              {r.byPurpose.length === 0 && <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.5)' }}>None.</div>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {r.byPurpose.map((p) => (
                  <div key={p.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{p.label}</span><strong style={{ fontVariantNumeric: 'tabular-nums' }}>{money(p.cents)}</strong></div>
                ))}
                {r.money.comps > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(0,0,0,.55)' }}><span>No-charge bookings</span><span>{r.money.comps}</span></div>}
                {r.money.donationsCents > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'rgba(0,0,0,.55)' }}><span>Donations (not in revenue)</span><span>{money(r.money.donationsCents)}</span></div>}
              </div>
            </section>

            <section style={{ ...card, padding: '14px' }}>
              <div style={{ ...label, marginBottom: 4 }}>Cage use</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,.5)', marginBottom: 12 }}>Booked hours out of {r.openHoursPerCage} open hours per cage. Holds, no-shows and canceled time don&rsquo;t count.</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {r.cageUse.map((c) => (
                  <div key={c.name} style={{ display: 'grid', gridTemplateColumns: '80px minmax(0,1fr) 92px', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ fontWeight: 700 }}>{c.name}</span>
                    <span style={{ height: 10, borderRadius: 5, background: '#F2F0ED', overflow: 'hidden' }}>
                      <span style={{ display: 'block', height: '100%', width: `${Math.min(100, c.pct)}%`, background: RED }} />
                    </span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'rgba(0,0,0,.65)' }}>{c.hours} hr · {c.pct}%</span>
                  </div>
                ))}
              </div>
            </section>

            {r.bookings.byKind.length > 0 && (
              <section style={{ ...card, padding: '14px' }}>
                <div style={{ ...label, marginBottom: 10 }}>Bookings by type</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {r.bookings.byKind.map((k) => <div key={k.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}><span>{k.label}</span><strong>{k.n}</strong></div>)}
                </div>
              </section>
            )}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.5)', lineHeight: 1.5 }}>
          Money is counted on the day it was taken or refunded. Bookings and cage use are counted by the day they start. Card fees are Stripe&rsquo;s processing fees on card charges.
        </div>
      </>)}
    </div>
  );
}

const dateField = { minHeight: 36, padding: '0 8px', border: '1px solid rgba(0,0,0,.2)', borderRadius: 6, fontSize: 13.5, background: '#fff' };
