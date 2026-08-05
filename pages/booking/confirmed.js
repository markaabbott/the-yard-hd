import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Link from 'next/link';
import { supabase } from '../../lib/supabaseClient';

export default function Confirmed() {
  const router = useRouter();
  const { group, payment_intent, redirect_status } = router.query;
  const [reservations, setReservations] = useState(null);
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    if (!router.isReady) return;
    let groupId = group;
    let cancelled = false;

    async function resolveGroupFromIntent() {
      // Redirected back from Stripe: look up which group this payment belongs to.
      const { data } = await supabase.from('payments').select('reservation_group_id, status')
        .eq('stripe_payment_intent_id', payment_intent).single();
      return data;
    }

    async function poll() {
      let gid = groupId;
      if (!gid && payment_intent) {
        const p = await resolveGroupFromIntent();
        if (p) gid = p.reservation_group_id;
      }
      if (!gid) { setStatus('not_found'); return; }

      const { data: res } = await supabase.from('reservations').select('*').eq('group_id', gid);
      if (cancelled) return;

      if (res && res.length && res.every((r) => r.status === 'confirmed' || r.status === 'completed')) {
        setReservations(res);
        setStatus('confirmed');
      } else if (redirect_status === 'succeeded' || !payment_intent) {
        setReservations(res || []);
        setTimeout(poll, 1500); // webhook hasn't landed yet
      } else {
        setStatus('failed');
      }
    }
    poll();
    return () => { cancelled = true; };
  }, [router.isReady, group, payment_intent, redirect_status]);

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
      {status === 'confirmed' && reservations && (
        <>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, textTransform: 'uppercase', marginBottom: 10 }}>
            You're booked
          </div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,.6)', marginBottom: 24 }}>
            {new Date(reservations[0].starts_at).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
          <Link href="/schedule" style={{ color: '#BA0C2F', fontWeight: 700, fontSize: 14 }}>Back to schedule</Link>
        </>
      )}
      {status === 'checking' && <div style={{ color: 'rgba(0,0,0,.5)', fontSize: 14 }}>Confirming your booking…</div>}
      {status === 'failed' && (
        <>
          <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 22, textTransform: 'uppercase', marginBottom: 10, color: '#BA0C2F' }}>
            Payment didn't go through
          </div>
          <Link href="/schedule" style={{ color: '#BA0C2F', fontWeight: 700, fontSize: 14 }}>Try again</Link>
        </>
      )}
      {status === 'not_found' && (
        <div style={{ color: 'rgba(0,0,0,.5)', fontSize: 14 }}>Nothing to show — <Link href="/schedule" style={{ color: '#BA0C2F' }}>go to schedule</Link>.</div>
      )}
    </main>
  );
}
