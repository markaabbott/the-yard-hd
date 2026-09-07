import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements
} from '@stripe/react-stripe-js';

let stripePromise;
function getStripe() {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

// Brand the hosted fields so the card form doesn't look bolted on.
const appearance = {
  theme: 'flat',
  variables: {
    colorPrimary: '#BA0C2F',
    colorBackground: '#ffffff',
    colorText: '#111315',
    colorDanger: '#BA0C2F',
    fontFamily: '"Merriweather Sans", system-ui, sans-serif',
    borderRadius: '7px',
    spacingUnit: '4px'
  },
  rules: {
    '.Input': { border: '1px solid rgba(0,0,0,.15)', boxShadow: 'none' },
    '.Input:focus': { border: '1px solid #BA0C2F', boxShadow: 'none' },
    '.Label': {
      fontSize: '12px',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '.04em',
      color: 'rgba(0,0,0,.6)'
    }
  }
};

function CheckoutFields({ onSuccess }) {
  const stripe = useStripe();
  const elements = useElements();
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  async function pay(e) {
    e.preventDefault();
    // Guard: without this, a form that never mounted would sit on
    // "Processing…" forever instead of telling the customer anything.
    if (!stripe || !elements || !ready) {
      setErr('The payment form is still loading. Give it a moment and try again.');
      return;
    }

    setSubmitting(true);
    setErr(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/booking/confirmed` },
      redirect: 'if_required'
    });

    if (error) {
      setSubmitting(false);
      setErr(error.message || 'That card was declined. Try another card.');
      return;
    }

    // 3DS and other redirect flows come back already succeeded; anything else
    // still pending is not something we should call a confirmed booking.
    if (paymentIntent && ['succeeded', 'processing'].includes(paymentIntent.status)) {
      onSuccess();
      return;
    }

    setSubmitting(false);
    setErr('Payment did not complete. Your card has not been charged.');
  }

  return (
    <form onSubmit={pay} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <PaymentElement
        onReady={() => setReady(true)}
        onLoadError={(e) =>
          setErr(e?.error?.message || 'The payment form could not load. Please refresh.')
        }
      />

      {!ready && !err && (
        <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,.45)' }}>Loading payment form…</div>
      )}

      {err && <div style={{ fontSize: 12.5, color: '#BA0C2F', lineHeight: 1.6 }}>{err}</div>}

      <button
        type="submit"
        disabled={submitting || !ready}
        style={{
          padding: '13px 16px',
          borderRadius: 7,
          border: 'none',
          background: '#BA0C2F',
          color: '#fff',
          fontFamily: 'Oswald, sans-serif',
          fontWeight: 500,
          fontSize: 15,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          cursor: submitting || !ready ? 'default' : 'pointer',
          opacity: submitting || !ready ? 0.55 : 1
        }}
      >
        {submitting ? 'Processing…' : 'Pay now'}
      </button>
    </form>
  );
}

export default function PaymentForm({ clientSecret, onSuccess }) {
  if (!clientSecret) return null;

  return (
    <Elements stripe={getStripe()} options={{ clientSecret, appearance }}>
      <CheckoutFields onSuccess={onSuccess} />
    </Elements>
  );
}
