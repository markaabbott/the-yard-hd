import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import PaymentForm from './PaymentForm';

const RED = '#BA0C2F';
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

// Membership plans and the member's current term. Hours are spent on the
// Drop-in tab automatically; extra time bills at the plan's member rate.
export default function MembershipSection({ userId, settings, tz, onChange }) {
  const [plans, setPlans] = useState([]);
  const [term, setTerm] = useState(undefined); // undefined = loading, null = none
  const [buying, setBuying] = useState(null); // plan
  const [clientSecret, setClientSecret] = useState(null);
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState(null);
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: t }] = await Promise.all([
      supabase.from('membership_plans').select('*').eq('active', true).order('sort_order'),
      supabase.from('v_membership_balance').select('*').eq('user_id', userId).gt('expires_at', new Date().toISOString()).maybeSingle(),
    ]);
    setPlans(p || []);
    setTerm(t || null);
    return t || null;
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  async function buy(plan) {
    setWorking(true); setErr(null); setBuying(plan);
    const { data, error } = await supabase.rpc('start_membership', { p_plan_id: plan.id });
    if (error) { setWorking(false); setBuying(null); setErr(error.message); return; }
    const r = Array.isArray(data) ? data[0] : data;
    const res = await fetch('/api/create-payment-intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: r.payment_id })
    });
    const json = await res.json();
    setWorking(false);
    if (json.error) { setBuying(null); setErr(json.error); return; }
    setClientSecret(json.clientSecret);
  }

  // The term starts when Stripe's webhook lands; poll briefly until it shows.
  async function paid() {
    const before = Number(term?.hours_granted || 0);
    setClientSecret(null);
    setWaiting(true);
    for (let i = 0; i < 12; i++) {
      const t = await load();
      if (t && Number(t.hours_granted) > before) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    setWaiting(false);
    setBuying(null);
    onChange?.();
  }

  const fmt = (d) => new Date(d).toLocaleDateString(undefined, { timeZone: tz, month: 'long', day: 'numeric' });
  const days = settings?.membership_term_days ?? 31;

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {term === undefined ? (
        <div style={{ fontSize: 14, color: 'rgba(0,0,0,.4)' }}>Loading…</div>
      ) : term ? (
        <div style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: RED }}>Your membership</div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <Stat n={`${Number(term.hours_remaining)} hr`} l={`left of ${Number(term.hours_granted)}`} />
            <Stat n={fmt(term.expires_at)} l="Hours expire" />
            <Stat n={`${money(term.member_hourly_rate_cents)}/hr`} l="Extra time" />
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6, color: 'rgba(0,0,0,.65)' }}>
            Book on the <strong>Drop-in</strong> tab. Your hours are used first; anything past them bills at your member rate.
            Unused hours expire at the end of the term.
          </div>
        </div>
      ) : null}
      {term !== undefined && (
        <>
          <div style={{ fontSize: 14, lineHeight: 1.6, color: 'rgba(0,0,0,.7)' }}>
            {term
              ? <><strong>Running low?</strong> Buy another plan any time. Its hours are added to what you have left, and your {days} days start over from today.</>
              : <>Buy a block of cage hours for the next {days} days, then book any open cage on the Drop-in tab. Extra time is billed at your member rate.</>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {plans.map((p) => (
              <div key={p.id} style={{ background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase' }}>{p.name}</div>
                <div style={{ fontSize: 26, fontWeight: 700 }}>{money(p.price_cents)}</div>
                <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)', lineHeight: 1.5 }}>
                  {Number(p.hours)} cage hours for {days} days<br />Extra time {money(p.member_hourly_rate_cents)}/hr
                </div>
                <button disabled={working || !!clientSecret || waiting} onClick={() => buy(p)}
                  style={{ marginTop: 8, padding: '11px 14px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', opacity: working || clientSecret || waiting ? 0.6 : 1 }}>
                  {working && buying?.id === p.id ? 'Starting…' : term ? 'Add these hours' : 'Buy plan'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {err && <div style={{ fontSize: 13, color: RED }}>{err.charAt(0).toUpperCase() + err.slice(1)}</div>}
      {waiting && <div style={{ fontSize: 13.5, color: 'rgba(0,0,0,.6)' }}>Payment received. {term ? 'Adding your hours…' : 'Starting your membership…'}</div>}

      {clientSecret && buying && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 20, background: 'rgba(0,0,0,.4)', overflowY: 'auto' }}>
          <div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px' }}>
            <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 440, padding: '24px 26px', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 24px 60px rgba(0,0,0,.22)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 20, textTransform: 'uppercase' }}>{buying.name}</div>
                <div style={{ fontWeight: 700 }}>{money(buying.price_cents)}</div>
              </div>
              <PaymentForm clientSecret={clientSecret} onSuccess={paid} />
              <button onClick={() => { setClientSecret(null); setBuying(null); }} style={{ border: 'none', background: 'none', fontSize: 13, color: 'rgba(0,0,0,.5)', textDecoration: 'underline', cursor: 'pointer', padding: 0, alignSelf: 'flex-start' }}>
                Never mind
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ n, l }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, lineHeight: 1.1 }}>{n}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(0,0,0,.5)' }}>{l}</span>
    </div>
  );
}
