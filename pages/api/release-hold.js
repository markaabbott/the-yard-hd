// Vercel serverless function — POST /api/release-hold
// Body: { groupId: uuid }
// Auth: Authorization: Bearer <supabase access token>
//
// Called when a customer abandons checkout (closes the payment window, hits
// Cancel, or leaves the page). Two things have to happen or the slot stays
// dead: the reservation hold is released, and the open PaymentIntent is
// canceled so it stops sitting in Stripe as an "Incomplete" payment.

import Stripe from 'stripe';
import { supabaseAdmin as supabase } from '../../lib/supabaseAdmin';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const { groupId } = req.body || {};
  if (!groupId) return res.status(400).json({ error: 'groupId required' });

  // Verify the caller owns this hold. Without this check any signed-in user
  // could release somebody else's reservation by guessing a group id.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  const uid = authData?.user?.id;
  if (authErr || !uid) return res.status(401).json({ error: 'not signed in' });

  const { data: rows, error: rowErr } = await supabase
    .from('reservations')
    .select('id, user_id, status')
    .eq('group_id', groupId);

  if (rowErr) return res.status(500).json({ error: rowErr.message });
  if (!rows || rows.length === 0) return res.status(200).json({ released: 0 });
  if (!rows.every((r) => r.user_id === uid)) {
    return res.status(403).json({ error: 'not your reservation' });
  }

  // Already paid? Leave it alone — cancelling a confirmed booking goes through
  // cancel_reservation_group so the refund policy gets applied.
  if (!rows.some((r) => r.status === 'pending_payment')) {
    return res.status(200).json({ released: 0, reason: 'not a pending hold' });
  }

  const { data: payments } = await supabase
    .from('payments')
    .select('id, status, stripe_payment_intent_id')
    .eq('reservation_group_id', groupId)
    .eq('status', 'requires_payment');

  for (const p of payments || []) {
    if (!p.stripe_payment_intent_id) continue;
    try {
      const intent = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
        await stripe.paymentIntents.cancel(p.stripe_payment_intent_id, {
          cancellation_reason: 'abandoned'
        });
      }
    } catch (e) {
      // A Stripe hiccup must not stop us from freeing the slot.
      console.error('[release-hold] stripe cancel failed', p.stripe_payment_intent_id, e.message);
    }
  }

  const { data: released, error: relErr } = await supabase.rpc('release_group', {
    p_group_id: groupId,
    p_reason: 'checkout abandoned'
  });
  if (relErr) return res.status(500).json({ error: relErr.message });

  await supabase
    .from('payments')
    .update({ status: 'failed', memo: 'checkout abandoned' })
    .eq('reservation_group_id', groupId)
    .eq('status', 'requires_payment');

  res.status(200).json({ released: released ?? 0 });
}
