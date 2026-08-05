// Reference for the checkout screen's client-side code (Stripe Elements).
// NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY goes in Vercel env vars, safe to expose.
//
// Flow: call book_hold (via Supabase RPC) -> if due_now_cents > 0, POST
// /api/create-payment-intent with the returned payment_id -> mount Elements
// with the clientSecret -> stripe.confirmPayment() -> webhook confirms server-side.

import { loadStripe } from '@stripe/stripe-js';
// see /pages for usage example

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export async function startCheckout(paymentId) {
  const res = await fetch('/api/create-payment-intent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paymentId })
  });
  const { clientSecret, error } = await res.json();
  if (error) throw new Error(error);
  return { stripe: await stripePromise, clientSecret };
}

// In the component: elements = stripe.elements({ clientSecret });
// const paymentElement = elements.create('payment'); paymentElement.mount('#payment-element');
//
// On submit:
// const { error } = await stripe.confirmPayment({
//   elements,
//   confirmParams: { return_url: `${window.location.origin}/booking/confirmed` }
// });
// Don't flip any local UI to "booked" here — the webhook + confirm_payment
// is the single source of truth; the return_url page should poll/read status.
