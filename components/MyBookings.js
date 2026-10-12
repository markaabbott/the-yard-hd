import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const RED = '#BA0C2F';
const money = (c) => `$${(c / 100).toFixed(2)}`;

// Upcoming bookings for the signed-in customer, with a cancel flow that shows
// the refund before they commit.
export default function MyBookings({ userId, settings, tz, onChange }) {
  const [groups, setGroups] = useState([]);
  const [confirming, setConfirming] = useState(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    const [{ data: res }, { data: pays }] = await Promise.all([
      supabase.from('reservations').select('group_id, starts_at, ends_at, cages(name, sort_order)')
        .eq('user_id', userId).eq('status', 'confirmed').gt('starts_at', new Date().toISOString())
        .order('starts_at'),
      supabase.from('payments').select('reservation_group_id, amount_cents, method, processing_fee_cents')
        .eq('user_id', userId).eq('entry_type', 'charge').eq('status', 'succeeded'),
    ]);
    const paid = new Map((pays || []).map((p) => [p.reservation_group_id, p]));
    const byGroup = new Map();
    for (const r of res || []) {
      const g = byGroup.get(r.group_id) || { groupId: r.group_id, startsAt: r.starts_at, endsAt: r.ends_at, cages: [] };
      if (r.starts_at < g.startsAt) g.startsAt = r.starts_at;
      if (r.ends_at > g.endsAt) g.endsAt = r.ends_at;
      if (r.cages && !g.cages.includes(r.cages.name)) g.cages.push(r.cages.name);
      const p = paid.get(r.group_id);
      g.paidCents = p?.amount_cents || 0;
      g.feeCents = p?.method === 'card' ? p.processing_fee_cents || 0 : 0;
      byGroup.set(r.group_id, g);
    }
    setGroups([...byGroup.values()]);
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  function refundFor(g) {
    const hrs = (new Date(g.startsAt) - Date.now()) / 3.6e6;
    const frac = hrs >= settings.cancel_free_hours ? 1 : hrs >= settings.cancel_half_hours ? 0.5 : 0;
    const gross = Math.round(g.paidCents * frac);
    const fee = frac > 0 ? Math.min(g.feeCents, gross) : 0;
    return { frac, cents: gross - fee, fee };
  }

  async function cancel(g) {
    setWorking(true);
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch('/api/cancel-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ groupId: g.groupId }),
    });
    const body = await r.json().catch(() => ({}));
    setWorking(false);
    setConfirming(null);
    if (!r.ok) { setNotice({ error: true, text: body.error || 'Could not cancel. Please call us.' }); return; }
    setNotice({
      text: body.refundError
        ? `Canceled. Your refund is being processed by staff; call ${settings.phone} with questions.`
        : body.refundCents > 0
          ? `Canceled. ${money(body.refundCents)} is on its way back to your card. Check your email for the details.`
          : 'Canceled. Check your email for the details.',
    });
    load();
    onChange?.();
  }

  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' });
  const fmtTime = (d) => new Date(d).toLocaleTimeString([], { timeZone: tz, hour: 'numeric', minute: '2-digit' });

  if (!groups.length && !notice) return null;

  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Your upcoming bookings
      </div>
      {notice && (
        <div style={{ fontSize: 13.5, lineHeight: 1.5, padding: '10px 14px', borderRadius: 8, marginBottom: 10, background: notice.error ? 'rgba(186,12,47,.07)' : 'rgba(0,0,0,.04)', color: notice.error ? RED : '#111' }}>
          {notice.text}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(0,0,0,.1)', borderRadius: 10, background: '#fff' }}>
        {groups.map((g, i) => {
          const { frac, cents, fee } = refundFor(g);
          const open = confirming === g.groupId;
          return (
            <div key={g.groupId} style={{ borderTop: i ? '1px solid rgba(0,0,0,.08)' : 'none', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14 }}>
                  <strong>{fmtDate(g.startsAt)}</strong> · {fmtTime(g.startsAt)} – {fmtTime(g.endsAt)}
                  <span style={{ color: 'rgba(0,0,0,.55)' }}> · {g.cages.join(', ')}</span>
                </div>
                {!open && (
                  <button onClick={() => { setConfirming(g.groupId); setNotice(null); }} style={{ border: 'none', background: 'none', padding: 0, fontSize: 13, color: 'rgba(0,0,0,.55)', textDecoration: 'underline', cursor: 'pointer' }}>
                    Cancel booking
                  </button>
                )}
              </div>
              {open && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', background: '#faf9f7', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
                    {g.paidCents === 0
                      ? (frac === 1 ? 'Your membership hours will be returned.' : 'Past the free-cancel window, so membership hours won\'t be returned.')
                      : frac === 0
                        ? <>Starts in under {settings.cancel_half_hours} hours. <strong>No refund.</strong></>
                        : <>You'll be refunded <strong>{money(cents)}</strong>{frac < 1 ? ` (50% of ${money(g.paidCents)}` : ` (${money(g.paidCents)}`}{fee > 0 ? `, less ${money(fee)} card fee)` : ')'}.</>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button disabled={working} onClick={() => setConfirming(null)} style={{ padding: '9px 14px', borderRadius: 6, border: '1px solid rgba(0,0,0,.15)', background: '#fff', fontSize: 13, cursor: 'pointer' }}>
                      Keep it
                    </button>
                    <button disabled={working} onClick={() => cancel(g)} style={{ padding: '9px 16px', borderRadius: 6, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.08em', textTransform: 'uppercase', cursor: working ? 'default' : 'pointer' }}>
                      {working ? 'Canceling…' : 'Cancel booking'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
