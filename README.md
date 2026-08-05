# The Yard HD — web app

## Local setup
1. `cd web && npm install`
2. Copy `.env.local.example` to `.env.local`, fill in Supabase + Stripe keys.
3. `npm run dev` — http://localhost:3000

## Deploy
1. Push this repo to GitHub.
2. Vercel → New Project → import the repo → set the root directory to `web/` if the repo has other folders at top level.
3. Add all vars from `.env.local.example` in Vercel → Project Settings → Environment Variables.
4. Deploy. Note the resulting URL (or theyardhd.com once DNS is pointed).
5. In Stripe → Developers → Webhooks → Add endpoint: `https://<your-domain>/api/stripe-webhook`, events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel, redeploy.
6. Point theyardhd.com's DNS (at SiteGround) to Vercel per Vercel's domain setup instructions.

## API routes
- `/api/create-payment-intent` — called by the client after `book_hold` when money is owed.
- `/api/stripe-webhook` — Stripe calls this; do not call it yourself.

## Pages (this slice)
- `/signin` — Google + magic link (Apple button shown, disabled until Apple Developer approval).
- `/schedule` — live cage/time grid for today or a picked date, real-time via Supabase `postgres_changes` on `reservations`.
- Click an open slot → `BookingPanel`: pick duration, live quote (`quote_window` RPC), confirm (`book_hold` RPC) → Stripe Payment Element if money is owed.
- `/booking/confirmed` — polls for the reservation to flip to `confirmed` (the webhook does that server-side) and shows the confirmation.

Run `schema/003_availability.sql` in Supabase too — it adds `v_public_schedule`, a view the grid reads so customers see which slots are taken without seeing whose they are (reservations RLS only shows a customer their own rows, which is right for `/api/create-payment-intent` but wrong for a shared grid).

Only drop-in booking is wired in this slice. Memberships, teams, parties, clinics, and the admin screens still need their own pages.
