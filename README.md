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
