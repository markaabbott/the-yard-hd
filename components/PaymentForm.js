import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

let stripePromise;
function getStripe() {
  if (!stripePromise) stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

export default function PaymentForm({ clientSecret, onSuccess }) {
  const mountRef = useRef(null);
  const [stripe, setStripe] = useState(null);
  const [elements, setElements] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let active = true;
    getStripe().then((s) => {
      if (!active || !s) return;
      const els = s.elements({ clientSecret });
      const paymentElement = els.create('payment');
      paymentElement.mount(mountRef.current);
      setStripe(s);
      setElements(els);
    });
    return () => { active = false; };
  }, [clientSecret]);

  async function pay() {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}/booking/confirmed` },
      redirect: 'if_required'
    });
    setSubmitting(false);
    if (error) { setErr(error.message); return; }
    onSuccess();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div ref={mountRef} />
      {err && <div style={{ fontSize: 12.5, color: '#BA0C2F' }}>{err}</div>}
      <button
        onClick={pay}
        disabled={submitting}
        style={{ padding: '13px 16px', borderRadius: 7, border: 'none', background: '#BA0C2F', color: '#fff', fontWeight: 700, fontSize: 14, cursor: submitting ? 'default' : 'pointer', opacity: submitting ? 0.6 : 1 }}
      >
        {submitting ? 'Processing…' : 'Pay now'}
      </button>
    </div>
  );
}
