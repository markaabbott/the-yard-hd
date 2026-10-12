// Server-only. Sends through Resend's REST API (no SDK needed).
const FROM = process.env.EMAIL_FROM || 'The Yard HD <noreply@theyardhd.com>';

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: FROM, to, subject, html, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || `Resend ${res.status}`);
  return body.id;
}
