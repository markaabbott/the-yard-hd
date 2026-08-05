// Vercel serverless function — POST /api/stripe-webhook
// Env vars required: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//                     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Must run with the raw body (no bodyParser) so Stripe's signature check passes.

import Stripe from 'stripe';
import { supabaseAdmin as supabase } from '../../lib/supabaseAdmin';
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
        const charge = pi.latest_charge
          ? await stripe.charges.retrieve(pi.latest_charge)
          : null;
        const feeCents = charge?.balance_transaction
          ? (await stripe.balanceTransactions.retrieve(charge.balance_transaction)).fee
          : 0;

        const { error } = await supabase.rpc('confirm_payment', {
          p_intent_id: pi.id,
          p_amount_cents: pi.amount_received,
          p_fee_cents: feeCents
        });
        if (error) throw error;
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
