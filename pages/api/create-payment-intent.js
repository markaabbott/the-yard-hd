// Vercel serverless function — POST /api/create-payment-intent
// Body: { paymentId: uuid }  (the payments.id returned by book_hold's due_now_cents path)
//
// This is the ONE place a PaymentIntent gets created. Amount always comes from
// the payments row the SQL already priced — never trust a client-supplied amount.

import Stripe from 'stripe';
import { supabaseAdmin as supabase } from '../../lib/supabaseAdmin';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method not allowed');

  const { paymentId } = req.body || {};
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' });

  const { data: payment, error } = await supabase
    .from('payments')
    .select('id, amount_cents, user_id, status, stripe_payment_intent_id')
    .eq('id', paymentId)
    .single();

  if (error || !payment) return res.status(404).json({ error: 'unknown payment' });
  if (payment.status !== 'requires_payment') {
    return res.status(409).json({ error: `payment is already ${payment.status}` });
  }

  let email = null;
  if (payment.user_id) {
    const { data: u } = await supabase.from('users').select('email').eq('id', payment.user_id).single();
    email = u?.email || null;
  }

  // Reuse the existing intent on a page refresh instead of creating a duplicate.
  if (payment.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(payment.stripe_payment_intent_id);
    if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(existing.status)) {
      return res.status(200).json({ clientSecret: existing.client_secret });
    }
  }

  const intent = await stripe.paymentIntents.create({
    amount: payment.amount_cents,
    currency: 'usd',
    receipt_email: email || undefined,
    statement_descriptor_suffix: 'THE YARD HD'.slice(0, 22),
    metadata: { payment_id: payment.id },
    automatic_payment_methods: { enabled: true }
  });

  const { error: attachErr } = await supabase.rpc('attach_payment_intent', {
    p_payment_id: payment.id,
    p_intent_id: intent.id
  });
  if (attachErr) return res.status(500).json({ error: attachErr.message });

  res.status(200).json({ clientSecret: intent.client_secret });
}
