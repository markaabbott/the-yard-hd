// Shared helpers for the e2e checks.
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const APP_URL = process.env.APP_URL || 'https://app.theyardhd.com';
const SITE_URL = process.env.SITE_URL || 'https://theyardhd.com';
const SUPABASE_URL = process.env.SUPABASE_URL;               // e.g. https://auth.theyardhd.com
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;   // GitHub secret, never in the repo
const ANON_KEY = process.env.SUPABASE_ANON_KEY;              // GitHub secret (same value as NEXT_PUBLIC_SUPABASE_ANON_KEY)

// Dedicated test accounts. No email is ever sent to them: sign-in is done
// with an admin-generated token, and nothing in the tests sends notifications.
const ACCOUNTS = {
  customer: { email: 'e2e-customer@theyardhd.com', first: 'E2E', last: 'Customer', role: null,
    player: { name: 'E2E Player', dob: '2014-01-01', relationship: 'parent' } },
  coach: { email: 'e2e-coach@theyardhd.com', first: 'E2E', last: 'Coach', role: 'coach',
    player: { name: 'E2E Coach', dob: '1980-01-01', relationship: 'self' } },
};

function need() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Missing settings: ${missing.join(', ')} (add them as GitHub repository secrets)`);
}
const admin = () => { need(); return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } }); };
const anon = () => { need(); return createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } }); };

// supabase-js keeps the session in localStorage under sb-<first label of the host>-auth-token.
const storageKey = () => `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;

const AUTH_DIR = path.join(__dirname, '.auth');
const readTokens = () => JSON.parse(fs.readFileSync(path.join(AUTH_DIR, 'tokens.json'), 'utf8'));

module.exports = { APP_URL, SITE_URL, ACCOUNTS, admin, anon, storageKey, AUTH_DIR, readTokens };
