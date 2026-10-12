// Vercel serverless function — POST /api/cancel-booking
// Body: { groupId: uuid }
// Auth: Authorization: Bearer <supabase access token>
//
// Cancels a confirmed booking: the database applies the refund policy, then we
// return the money through Stripe and send the cancellation email.

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin as admin } from '../../lib/supabaseAdmin';
import { drainNotifications } from '../../lib/notifications';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ error: 'groupId required' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  // Run the cancel as the signed-in user so the function's ownership and
  // staff checks (auth.uid(), is_staff()) apply exactly as written.
  const asUser = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: result, error } = await asUser.rpc('cancel_reservation_group', {
    p_group_id: groupId,
    p_reason: 'canceled online',
  });
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === '22023' ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }

  const refundCents = result?.refund_cents || 0;
  let refundError = null;

  if (refundCents > 0) {
    const [{ data: charge }, { data: refundRow }] = await Promise.all([
      admin.from('payments').select('id, method, stripe_payment_intent_id')
        .eq('reservation_group_id', groupId).eq('entry_type', 'charge').eq('status', 'succeeded')
        .order('created_at').limit(1).maybeSingle(),
      admin.from('payments').select('id, memo')
        .eq('reservation_group_id', groupId).eq('entry_type', 'refund').is('stripe_refund_id', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    if (charge?.method === 'card' && charge.stripe_payment_intent_id) {
      try {
        const refund = await stripe.refunds.create(
          { payment_intent: charge.stripe_payment_intent_id, amount: refundCents, reason: 'requested_by_customer',
            metadata: { reservation_group_id: groupId } },
          { idempotencyKey: `cancel-refund:${groupId}` }
        );
        if (refundRow) await admin.from('payments').update({ stripe_refund_id: refund.id }).eq('id', refundRow.id);
      } catch (e) {
        refundError = e.message;
        console.error('[cancel-booking] stripe refund failed', groupId, e.message);
        if (refundRow) {
          await admin.from('payments').update({
            status: 'failed',
            memo: `${refundRow.memo || ''} · STRIPE REFUND FAILED: ${e.message}`,
          }).eq('id', refundRow.id);
        }
        // Don't email "your refund is on the way" when it isn't. Staff can
        // issue the refund in Stripe and set this notification back to queued.
        await admin.from('notifications').update({ status: 'failed', error: `refund failed: ${e.message}` })
          .eq('dedupe_key', `cancel:${groupId}`).eq('status', 'queued');
      }
    }
  }

  try { await drainNotifications(); } catch (e) { console.error('[cancel-booking] email drain', e.message); }

  res.status(200).json({
    canceled: true,
    refundCents,
    hoursReturned: result?.hours_returned || 0,
    refundError: refundError ? 'refund_pending' : null,
  });
}
