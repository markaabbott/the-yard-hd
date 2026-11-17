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

  const { groupId, seriesId } = req.body || {};
  if (!groupId && !seriesId) return res.status(400).json({ error: 'groupId or seriesId required' });

  // Verify the caller owns this hold. Without this check any signed-in user
  // could release somebody else's reservation by guessing a group id.
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  const uid = authData?.user?.id;
  if (authErr || !uid) return res.status(401).json({ error: 'not signed in' });

  // Unpaid team practice sign-up: free the weekly slot and cancel its intent.
  if (seriesId) {
    const { data: ser } = await supabase.from('reservation_series')
      .select('id, user_id, paid_through').eq('id', seriesId).maybeSingle();
    if (!ser) return res.status(200).json({ released: 0 });
    if (ser.user_id !== uid) return res.status(403).json({ error: 'not your team' });
    if (ser.paid_through) return res.status(200).json({ released: 0, reason: 'already paid' });
    const { data: open } = await supabase.from('payments').select('stripe_payment_intent_id')
      .eq('series_id', seriesId).eq('status', 'requires_payment');
    for (const p of open || []) await cancelIntent(p.stripe_payment_intent_id);
    const { data: n, error } = await supabase.rpc('release_team_signup', { p_series_id: seriesId, p_reason: 'checkout abandoned' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ released: n ?? 0 });
  }

  const { data: rows, error: rowErr } = await supabase
    .from('reservations')
    .select('id, user_id, status')
    .eq('group_id', groupId);

  if (rowErr) return res.status(500).json({ error: rowErr.message });
  if (!rows || rows.length === 0) return res.status(200).json({ released: 0 });
  if (!rows.every((r) => r.user_id === uid)) {
    // Staff keying in a card for a customer can release that checkout too.
    const { data: roles } = await supabase.from('user_roles').select('role')
      .eq('user_id', uid).in('role', ['coach', 'admin', 'owner']);
    if (!roles?.length) return res.status(403).json({ error: 'not your reservation' });
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

  for (const p of payments || []) await cancelIntent(p.stripe_payment_intent_id);

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

async function cancelIntent(id) {
  if (!id) return;
  try {
    const intent = await stripe.paymentIntents.retrieve(id);
    if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(intent.status)) {
      await stripe.paymentIntents.cancel(id, { cancellation_reason: 'abandoned' });
    }
  } catch (e) {
    // A Stripe hiccup must not stop us from freeing the slot.
    console.error('[release-hold] stripe cancel failed', id, e.message);
  }
}
