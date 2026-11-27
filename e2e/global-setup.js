// Before the tests: make sure the test accounts exist with names, the right
// role and a current waiver, then sign them in and save their sessions.
const fs = require('fs');
const path = require('path');
const { APP_URL, ACCOUNTS, admin, anon, storageKey, AUTH_DIR } = require('./lib');

async function ensureUser(db, acct) {
  const { error } = await db.auth.admin.createUser({ email: acct.email, email_confirm: true });
  if (error && !/already|registered|exists/i.test(error.message)) throw error;
  // A one-time sign-in token, turned into a session without any email.
  const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email: acct.email });
  if (linkErr) throw linkErr;
  const { data: v, error: vErr } = await anon().auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
  if (vErr) throw vErr;
  return v.session;
}

module.exports = async () => {
  const db = admin();
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const { data: fsRow } = await db.from('facility_settings').select('waiver_version').eq('id', 1).single();
  const tokens = {};

  for (const [key, acct] of Object.entries(ACCOUNTS)) {
    const session = await ensureUser(db, acct);
    const uid = session.user.id;
    await db.from('users').update({ first_name: acct.first, last_name: acct.last, needs_name: false }).eq('id', uid);
    if (acct.role) await db.from('user_roles').upsert({ user_id: uid, role: acct.role }, { onConflict: 'user_id,role' });

    // A current waiver, signed through the real API (so that path is exercised too).
    const { data: w } = await db.from('waivers').select('id').eq('user_id', uid)
      .eq('waiver_version', fsRow.waiver_version).gt('expires_at', new Date(Date.now() + 40 * 86400000).toISOString()).limit(1);
    if (!w?.length) {
      const r = await fetch(`${APP_URL}/api/sign-waiver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ version: fsRow.waiver_version, signatureName: `${acct.first} ${acct.last}`, agreeRead: true, agreeSue: true, participants: [acct.player] }),
      });
      if (!r.ok) throw new Error(`sign-waiver for ${key} failed: ${r.status} ${await r.text()}`);
    }
    const { data: mine } = await db.from('waivers').select('id').eq('user_id', uid).order('signed_at', { ascending: false }).limit(1);

    tokens[key] = { uid, email: acct.email, access_token: session.access_token, waiverId: mine?.[0]?.id || null };
    fs.writeFileSync(path.join(AUTH_DIR, `${key}.json`), JSON.stringify({
      cookies: [],
      origins: [{ origin: APP_URL, localStorage: [{ name: storageKey(), value: JSON.stringify(session) }] }],
    }));
  }
  fs.writeFileSync(path.join(AUTH_DIR, 'tokens.json'), JSON.stringify(tokens, null, 2));
};
