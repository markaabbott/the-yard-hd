# Live site checks

Playwright tests that check the live booking app (app.theyardhd.com) and website
(theyardhd.com). **They never pay.** The one test that starts a booking replaces the
payment step and releases the hold; everything the test accounts leave behind is
deleted afterwards.

Runs automatically on GitHub after each production deploy and every night. To run it
by hand: GitHub → **Actions** → **Live site checks** → **Run workflow**.

Needs three repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://auth.theyardhd.com` |
| `SUPABASE_ANON_KEY` | same as Vercel's `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | same as Vercel's `SUPABASE_SERVICE_ROLE_KEY` |

Test accounts (created automatically, no email is sent to them):
`e2e-customer@theyardhd.com` (customer) and `e2e-coach@theyardhd.com` (coach).

| File | Checks |
|---|---|
| `tests/public.spec.js` | Website prices/policies match the app's settings, icons and redirects, sign-in page, private APIs refuse signed-out requests |
| `tests/customer.spec.js` | Header, waiver panel + PDF, customer can't reach staff data, drop-in/party/team prices and text, hold → release, waiver steps, team link create/join/delete, membership plans |
| `tests/phone.spec.js` | iPhone layout of the header chips and waiver window |
| `tests/coach.spec.js` | Staff screen as a coach, coach permissions, customer search, waiver PDF as staff |
