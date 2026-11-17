// fetch() to our own /api routes with the signed-in user's token.
// If the server says the token is no good (401), refresh the session once and
// retry. If the session itself is gone (signed out elsewhere, revoked), sign
// this browser out and send them to sign in instead of failing silently.
import { supabase } from './supabaseClient';

async function token() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

export async function authFetch(url, opts = {}) {
  const go = (t) => fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
  });
  let r = await go(await token());
  if (r.status !== 401) return r;
  const { data, error } = await supabase.auth.refreshSession();
  if (error || !data?.session) {
    await supabase.auth.signOut({ scope: 'local' });
    if (typeof window !== 'undefined' && !opts.keepalive) window.location.assign('/signin');
    return r;
  }
  r = await go(data.session.access_token);
  return r;
}
