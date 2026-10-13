// Client helpers for the staff screens. Every call carries the session token.
import { supabase } from './supabaseClient';

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}

async function call(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}`, ...(opts.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || 'Something went wrong. Try again.');
  return body;
}

export const staffAction = (action, args) =>
  call('/api/staff/action', { method: 'POST', body: JSON.stringify({ action, args }) }).then((b) => b.result);

export const searchCustomers = (q) =>
  call(`/api/staff/customers?q=${encodeURIComponent(q)}`).then((b) => b.customers);

export const createCustomer = (c) =>
  call('/api/staff/customers', { method: 'POST', body: JSON.stringify(c) });

export const cardIntent = (paymentId) =>
  call('/api/create-payment-intent', { method: 'POST', body: JSON.stringify({ paymentId }) }).then((b) => b.clientSecret);

export const releaseHold = (groupId) =>
  call('/api/release-hold', { method: 'POST', body: JSON.stringify({ groupId }) }).catch(() => {});
