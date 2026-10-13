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

export const getCustomer = (id) =>
  call(id.startsWith('walkin:')
    ? `/api/staff/customers?walkin=${encodeURIComponent(id.slice(7))}`
    : `/api/staff/customers?id=${encodeURIComponent(id)}`);

export const updateCustomer = (id, fields) =>
  call('/api/staff/customers', { method: 'PATCH', body: JSON.stringify({ id, ...fields }) });

export const getReport = (start, end) =>
  call(`/api/staff/reports?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);

export async function downloadReportCsv(start, end, filename) {
  const r = await fetch(`/api/staff/reports?format=csv&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not export.');
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const cardIntent = (paymentId) =>
  call('/api/create-payment-intent', { method: 'POST', body: JSON.stringify({ paymentId }) }).then((b) => b.clientSecret);

export const releaseHold = (groupId) =>
  call('/api/release-hold', { method: 'POST', body: JSON.stringify({ groupId }) }).catch(() => {});

export const team = {
  list: () => call('/api/staff/team'),
  add: (email, role) => call('/api/staff/team', { method: 'POST', body: JSON.stringify({ email, role }) }),
  setRole: (userId, role) => call('/api/staff/team', { method: 'PATCH', body: JSON.stringify({ userId, role }) }),
  remove: (userId) => call('/api/staff/team', { method: 'DELETE', body: JSON.stringify({ userId }) }),
  revoke: (email) => call('/api/staff/team', { method: 'DELETE', body: JSON.stringify({ email }) }),
  setPermissions: (permissions) => call('/api/staff/team', { method: 'PUT', body: JSON.stringify({ permissions }) }),
};

export const getAlerts = () => call('/api/staff/alerts');
export const saveAlerts = (prefs) => call('/api/staff/alerts', { method: 'PUT', body: JSON.stringify({ prefs }) });
