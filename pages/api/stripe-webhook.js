// Vercel serverless function — POST /api/stripe-webhook
// Env vars required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Must run with the raw body (no bodyParser) so Stripe's signature check passes.

import Stripe from 'stripe';
import { supabaseAdmin as supabase } from '../../lib/supabaseAdmin';
import { drainNotifications } from '../../lib/notifications';
export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  let event;
  try {
    const buf = await buffer(req);
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        // Stripe often hasn't attached the balance transaction (which holds
        // the fee) when this event fires. Ask for it expanded; if it's still
        // missing, the charge.updated case below fills the fee in later.
        const charge = pi.latest_charge
          ? await stripe.charges.retrieve(pi.latest_charge, { expand: ['balance_transaction'] })
          : null;
        const feeCents = charge?.balance_transaction?.fee ?? 0;

        const { error } = await supabase.rpc('confirm_payment', {
          p_intent_id: pi.id,
          p_amount_cents: pi.amount_received,
          p_fee_cents: feeCents
        });
        if (error) throw error;
        // Send the receipt now instead of waiting for the cron. An email
        // failure must not make Stripe retry a payment that already applied.
        try { await drainNotifications(); } catch (e) { console.error('[webhook] email drain', e.message); }
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const { error } = await supabase.rpc('fail_payment', {
          p_intent_id: pi.id,
          p_reason: pi.last_payment_error?.message || 'card declined'
        });
        if (error) throw error;
        break;
      }

      // The fee shows up on the charge after payment_intent.succeeded. Record
      // it on the payment so "customer pays the card fee" refunds work.
      // (Subscribe the endpoint to charge.updated in Stripe.)
      case 'charge.updated': {
        const ch = event.data.object;
        if (!ch.payment_intent || !ch.balance_transaction || ch.status !== 'succeeded') break;
        const btId = typeof ch.balance_transaction === 'string' ? ch.balance_transaction : ch.balance_transaction.id;
        const bt = await stripe.balanceTransactions.retrieve(btId);
        if (!bt?.fee) break;
        const { error } = await supabase.from('payments')
          .update({ processing_fee_cents: bt.fee })
          .eq('stripe_payment_intent_id', ch.payment_intent)
          .eq('entry_type', 'charge')
          .eq('method', 'card')
          .or('processing_fee_cents.is.null,processing_fee_cents.eq.0');
        if (error) throw error;
        break;
      }

      // Card disputes: flag for staff review rather than silently eating the loss.
      case 'charge.dispute.created': {
        const dispute = event.data.object;
        console.warn('Dispute opened on charge', dispute.charge, dispute.reason);
        break;
      }

      default:
        break; // ignore anything else we didn't subscribe to
    }
  } catch (err) {
    // Return 500 so Stripe retries — our RPCs are idempotent (confirm_payment
    // checks status = 'succeeded' first), so a retry is always safe.
    console.error(`Error handling ${event.type}:`, err.message);
    return res.status(500).send('handler error');
  }

  res.status(200).json({ received: true });
}
