// Branded transactional emails. Pure functions, no deps: render(template, data)
// returns { subject, html, text } or null when the template isn't built yet.
// Table layout + inline styles because email clients ignore most CSS.

const RED = '#BA0C2F';
const INK = '#111111';
const MUTED = '#5C5C5C';
const LINE = '#E6E2DC';
const BG = '#F2F0EC';
const HEAD = "Oswald,'Arial Narrow',Arial,sans-serif";
const BODY = "-apple-system,'Segoe UI',Helvetica,Arial,sans-serif";

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function when(startsAt, endsAt, tz) {
  const s = new Date(startsAt);
  const e = endsAt ? new Date(endsAt) : null;
  const date = s.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' });
  const t = (d, ampm) => d.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).replace(ampm ? '' : / ?[AP]M$/, '');
  if (!e) return { date, time: t(s, true) };
  const sameHalf = t(s, true).slice(-2) === t(e, true).slice(-2);
  return { date, time: `${sameHalf ? t(s, false) : t(s, true)} – ${t(e, true)}` };
}

const hrs = (n) => `${Number(n)} ${Number(n) === 1 ? 'hour' : 'hours'}`;

function rows(items) {
  return items.map(([k, v, strong]) => `
    <tr>
      <td style="padding:12px 0;border-top:1px solid ${LINE};font:500 12px/1.4 ${HEAD};letter-spacing:.08em;text-transform:uppercase;color:${MUTED};width:120px;vertical-align:top">${esc(k)}</td>
      <td style="padding:12px 0;border-top:1px solid ${LINE};font:${strong ? 600 : 400} 16px/1.45 ${BODY};color:${INK}">${esc(v)}</td>
    </tr>`).join('');
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${RED};border-radius:4px">
    <a href="${esc(href)}" style="display:inline-block;padding:14px 26px;font:500 15px/1 ${HEAD};letter-spacing:.08em;text-transform:uppercase;color:#ffffff;text-decoration:none">${esc(label)}</a>
  </td></tr></table>`;
}

function layout({ preheader, eyebrow, eyebrowColor = RED, headline, intro, details, extra = '', cta, f }) {
  const addr = `${f.street}, ${f.city}, ${f.state} ${f.zip}`;
  const maps = `https://maps.google.com/?q=${encodeURIComponent(addr)}`;
  const logo = `${new URL(cta.href).origin}/email-logo.png`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;600&display=swap" rel="stylesheet">
<title>${esc(headline)}</title></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
  <tr><td style="background:#ffffff;padding:24px 32px 20px;border-bottom:4px solid ${RED}">
    <img src="${esc(logo)}" width="200" height="50" alt="The Yard HD" style="display:block;width:200px;height:50px;border:0;outline:none;text-decoration:none;font:600 22px/1 ${HEAD};color:${RED}">
  </td></tr>
  <tr><td style="background:#ffffff;padding:36px 32px 32px">
    <div style="font:500 13px/1 ${HEAD};letter-spacing:.14em;text-transform:uppercase;color:${eyebrowColor};margin:0 0 12px">${esc(eyebrow)}</div>
    <h1 style="margin:0 0 14px;font:600 34px/1.05 ${HEAD};text-transform:uppercase;color:${INK}">${esc(headline)}</h1>
    <p style="margin:0 0 26px;font:400 16px/1.55 ${BODY};color:${MUTED}">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${LINE};margin:0 0 28px">${rows(details)}</table>
    ${extra}
    ${cta ? button(cta.href, cta.label) : ''}
  </td></tr>
  <tr><td style="padding:24px 32px;font:400 13px/1.6 ${BODY};color:${MUTED}">
    <a href="${maps}" style="color:${INK};text-decoration:none;font-weight:600">${esc(addr)}</a><br>
    ${f.landmark ? esc(f.landmark) + '<br>' : ''}
    <a href="tel:${esc(f.phone.replace(/\D/g, ''))}" style="color:${INK};text-decoration:none">${esc(f.phone)}</a><br><br>
    <span style="color:#8A8A8A">This is an automated message from noreply@theyardhd.com. Replies aren't read, so please call us with questions.</span>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function section(title, html) {
  return `<div style="margin:0 0 28px">
    <div style="font:500 13px/1 ${HEAD};letter-spacing:.1em;text-transform:uppercase;color:${INK};margin:0 0 10px">${esc(title)}</div>
    <div style="font:400 15px/1.6 ${BODY};color:${MUTED}">${html}</div></div>`;
}

const BRING = 'Turf shoes or athletic sneakers (no cleats) and a helmet for every batter. Players under 16 need a parent, guardian, or coach inside the building the whole session.';

function receipt(d, deposit) {
  const w = when(d.startsAt, d.endsAt, d.timezone);
  const details = [
    ['Date', w.date, true],
    ['Time', w.time, true],
    ['Cage', d.cages.join(', ')],
    [d.amountLabel || (deposit ? 'Deposit paid' : 'Paid'), d.amount],
  ];
  if (deposit && d.balanceDue && d.balanceDue !== '$0.00') details.push(['Balance due', `${d.balanceDue} at the facility`, true]);
  const p = d.policy;
  const extra = section('What to bring', esc(BRING)) +
    section('Need to cancel?', esc(`Full refund up to ${p.freeHours} hours before your start time, 50% between ${p.freeHours} and ${p.halfHours} hours, and no refund inside ${p.halfHours} hours. Refunds are less the card processing fee.`));
  const subject = `You're booked: ${w.date}, ${w.time}`;
  return {
    subject,
    html: layout({
      preheader: `${d.cages.join(', ')} · ${w.date} · ${w.time}`,
      eyebrow: deposit ? 'Deposit received' : 'Booking confirmed',
      headline: d.firstName ? `You're booked, ${d.firstName}.` : "You're booked.",
      intro: deposit ? 'Your party date is held. Here are the details.' : 'Your cage time is locked in. Here are the details.',
      details, extra, cta: { href: `${d.siteUrl}/schedule`, label: 'View schedule' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `What to bring: ${BRING}`, '',
      `Cancellation: full refund ${p.freeHours}+ hrs before, 50% ${p.halfHours}–${p.freeHours} hrs, none inside ${p.halfHours} hrs. Refunds are less the card processing fee.`, '',
      `${d.facility.street}, ${d.facility.city}, ${d.facility.state} ${d.facility.zip} · ${d.facility.phone}`].join('\n'),
  };
}

function canceled(d) {
  const w = when(d.startsAt, d.endsAt, d.timezone);
  const noRefund = !d.refund || d.refund === '$0.00';
  const details = [
    ['Date', w.date],
    ['Time', w.time],
    ['Cage', d.cages.join(', ')],
    ['Refund', noRefund ? 'None (canceled inside the no-refund window)' : d.refund, true],
  ];
  if (!noRefund && d.fee && d.fee !== '$0.00') details.push(['Card fee', `${d.fee} (not refundable)`]);
  if (Number(d.hoursReturned) > 0) details.push(['Member hours', `${hrs(d.hoursReturned)} returned to your balance`]);
  const subject = `Canceled: ${w.date}, ${w.time}`;
  return {
    subject,
    html: layout({
      preheader: noRefund ? 'Your booking has been canceled.' : `Your booking has been canceled. ${d.refund} is on its way back.`,
      eyebrow: 'Booking canceled', eyebrowColor: MUTED,
      headline: 'Your session is canceled.',
      intro: noRefund ? 'This time is released for other players.' : 'This time is released for other players. Refunds land on your original card in 5–10 business days.',
      details, cta: { href: `${d.siteUrl}/schedule`, label: 'Book another time' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `Book again: ${d.siteUrl}/schedule`, '',
      `${d.facility.phone}`].join('\n'),
  };
}

function moved(d) {
  const w = when(d.startsAt, d.endsAt, d.timezone);
  const was = d.oldStartsAt ? when(d.oldStartsAt, d.oldEndsAt, d.timezone) : null;
  const details = [
    ['Date', w.date, true],
    ['Time', w.time, true],
    ['Cage', d.cages.join(', ')],
  ];
  if (was) details.push(['Was', `${was.date}, ${was.time}`]);
  const subject = `Booking moved: ${w.date}, ${w.time}`;
  return {
    subject,
    html: layout({
      preheader: `Your session is now ${w.date} · ${w.time}`,
      eyebrow: 'Booking updated',
      headline: d.firstName ? `New time, ${d.firstName}.` : 'Your booking has a new time.',
      intro: 'Our staff moved your session. Nothing changes on your payment. Here are the new details.',
      details, extra: section('What to bring', esc(BRING)),
      cta: { href: `${d.siteUrl}/schedule`, label: 'View schedule' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `What to bring: ${BRING}`, '',
      `${d.facility.street}, ${d.facility.city}, ${d.facility.state} ${d.facility.zip} · ${d.facility.phone}`].join('\n'),
  };
}

export const TEMPLATES = {
  booking_receipt: (d) => receipt(d, false),
  party_deposit_receipt: (d) => receipt(d, true),
  booking_canceled: canceled,
  booking_moved: moved,
};

export function renderEmail(template, data) {
  const fn = TEMPLATES[template];
  return fn ? fn(data) : null;
}
