// POST /api/send-notifications — drains the email queue.
// Called every minute by Supabase pg_cron (schema/006_email_cron.sql) so
// cancellations and other queued emails go out without a page visit.
// Env: CRON_SECRET (must match the Bearer token in the cron job).
import { drainNotifications } from '../../lib/notifications';

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    res.status(200).json(await drainNotifications());
  } catch (e) {
    console.error('[send-notifications]', e.message);
    res.status(500).json({ error: e.message });
  }
}
