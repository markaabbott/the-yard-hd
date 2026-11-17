import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentForm from './PaymentForm';

const RED = '#BA0C2F';
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The customer's weekly team slots: paid through, next cycle, and a Pay button
// whenever a cycle invoice is open.
export default function MyTeams({ userId, tz, refreshKey }) {
  const [teams, setTeams] = useState([]);
  const [paying, setPaying] = useState(null); // { team, payment, clientSecret }
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [{ data: ser }, { data: open }] = await Promise.all([
      supabase.from('reservation_series')
        .select('id, team_name, weekday, local_start_time, duration_minutes, paid_through, next_invoice_on, cycle_rate_cents, status, grace_days')
        .eq('user_id', userId).in('status', ['active', 'past_due']).not('paid_through', 'is', null)
        .order('created_at'),
      supabase.from('payments').select('id, series_id, amount_cents, period_start, period_end')
        .eq('user_id', userId).eq('purpose', 'team').eq('status', 'requires_payment'),
    ]);
    setTeams((ser || []).map((s) => ({ ...s, open: (open || []).find((p) => p.series_id === s.id) || null })));
  }, [userId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  async function pay(t) {
    setErr(null);
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: t.open.id })
    });
    const json = await res.json();
    if (json.error) { setErr(json.error); return; }
    setPaying({ team: t, clientSecret: json.clientSecret });
  }

  async function paid() {
    const name = paying.team.team_name;
    setPaying(null);
    setNotice(`Paid. ${name}'s next four practices are confirmed.`);
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 1500)); await load(); }
  }

  if (!teams.length) return null;

  const fmtDate = (ymd) => new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const fmtTime = (hms) => { const [h, m] = hms.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Your teams</div>
      {notice && <div style={{ fontSize: 13.5, padding: '10px 14px', borderRadius: 8, marginBottom: 10, background: 'rgba(20,120,60,.07)' }}>{notice}</div>}
      {err && <div style={{ fontSize: 13.5, padding: '10px 14px', borderRadius: 8, marginBottom: 10, background: 'rgba(186,12,47,.07)', color: RED }}>{err}</div>}
      <div style={{ border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
        {teams.map((t, i) => (
          <div key={t.id} style={{ borderTop: i ? '1px solid rgba(0,0,0,.08)' : 'none', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>
                {t.team_name}
                {t.status === 'past_due' && <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', background: '#FFF4DE', color: '#8A5A00' }}>Payment due</span>}
              </span>
              <span style={{ fontSize: 13, color: 'rgba(0,0,0,.6)' }}>
                {DAYS[t.weekday]}s at {fmtTime(t.local_start_time)} · {t.duration_minutes / 60} hr · whole facility
              </span>
              <span style={{ fontSize: 12.5, color: 'rgba(0,0,0,.5)' }}>
                Paid through {fmtDate(t.paid_through)} · next cycle {money(t.cycle_rate_cents)} due {fmtDate(t.next_invoice_on)}
              </span>
            </div>
            {t.open && (
              <button onClick={() => pay(t)} style={{ padding: '9px 16px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' }}>
                Pay {money(t.open.amount_cents)}
              </button>
            )}
          </div>
        ))}
      </div>

      {paying && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.4)', overflowY: 'auto' }}>
          <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 18, textTransform: 'uppercase' }}>{paying.team.team_name}</div>
                <div style={{ fontWeight: 700 }}>{money(paying.team.open.amount_cents)}</div>
              </div>
              <div style={{ fontSize: 13, color: 'rgba(0,0,0,.6)' }}>
                Covers {fmtDate(paying.team.open.period_start)} – {fmtDate(paying.team.open.period_end)} (four practices)
              </div>
              <PaymentForm clientSecret={paying.clientSecret} onSuccess={paid} />
              <button onClick={() => setPaying(null)} style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', textDecoration: 'underline', cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}>Not now</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
