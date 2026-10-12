-- Every minute, ask the site to send any queued emails.
-- Before running: enable the pg_cron and pg_net extensions
-- (Database → Extensions), and replace YOUR_CRON_SECRET with the same value
-- you set as CRON_SECRET in Vercel.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('send-notifications')
where exists (select 1 from cron.job where jobname = 'send-notifications');

select cron.schedule(
  'send-notifications',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://app.theyardhd.com/api/send-notifications',
    headers := '{"Authorization": "Bearer YOUR_CRON_SECRET", "Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  )
  where exists (select 1 from notifications where status = 'queued');
  $$
);
