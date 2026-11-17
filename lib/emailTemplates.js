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

// Card refunds go back to the card less the processing fee; cash and check
// refunds are handed back at the front desk.
const refundHow = (method) => (method === 'cash' || method === 'check'
  ? `${method === 'cash' ? 'Cash' : 'Check'} payments are refunded at the front desk.`
  : 'Card refunds are less the card processing fee.');

const BRING = 'Turf shoes or athletic sneakers (no cleats) and a helmet for every batter. Players under 16 need a parent, guardian, or coach inside the building the whole session.';

function receipt(d, deposit) {
  const w = when(d.startsAt, d.endsAt, d.timezone);
  const details = [
    ['Date', w.date, true],
    ['Time', w.time, true],
    d.kind === 'party' ? ['Where', 'Whole facility + mezzanine'] : ['Cage', d.cages.join(', ')],
    [d.amountLabel || (deposit ? 'Deposit paid' : 'Paid'), d.amount],
  ];
  if (deposit && d.balanceDue && d.balanceDue !== '$0.00') details.push(['Balance due', `${d.balanceDue} at the facility`, true]);
  const p = d.policy;
  const extra = section('What to bring', esc(BRING)) +
    section('Need to cancel?', esc(`Full refund up to ${p.freeHours} hours before your start time, 50% between ${p.freeHours} and ${p.halfHours} hours, and no refund inside ${p.halfHours} hours. ${refundHow(d.method)}`));
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
      `Cancellation: full refund ${p.freeHours}+ hrs before, 50% ${p.halfHours}–${p.freeHours} hrs, none inside ${p.halfHours} hrs. ${refundHow(d.method)}`, '',
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
      intro: noRefund ? 'This time is released for other players.'
        : d.method === 'cash' || d.method === 'check'
          ? `This time is released for other players. You paid by ${d.method}, so we'll return your refund at the front desk.`
          : 'This time is released for other players. Refunds land on your original card in 5–10 business days.',
      details, cta: { href: `${d.siteUrl}/schedule`, label: 'Book another time' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `Book again: ${d.siteUrl}/schedule`, '',
      `${d.facility.phone}`].join('\n'),
  };
}

function moved(d) {
  const w = when(d.startsAt, d.endsAt, d.timezone);
  const was = d.oldStartsAt ? when(d.oldStartsAt, d.oldEndsAt, d.timezone) : null;
  // Same start and end: only the cage changed.
  const cageOnly = d.oldStartsAt && new Date(d.oldStartsAt).getTime() === new Date(d.startsAt).getTime()
    && (!d.oldEndsAt || !d.endsAt || new Date(d.oldEndsAt).getTime() === new Date(d.endsAt).getTime());
  const details = [
    ['Date', w.date, true],
    ['Time', w.time, true],
    ['Cage', d.cages.join(', ')],
  ];
  if (was && !cageOnly) details.push(['Was', `${was.date}, ${was.time}`]);
  const subject = cageOnly ? `New cage: ${w.date}, ${w.time}` : `Booking moved: ${w.date}, ${w.time}`;
  return {
    subject,
    html: layout({
      preheader: cageOnly ? `Same time, now in ${d.cages.join(', ')}` : `Your session is now ${w.date} · ${w.time}`,
      eyebrow: 'Booking updated',
      headline: cageOnly
        ? (d.firstName ? `New cage, ${d.firstName}.` : 'Your booking has a new cage.')
        : (d.firstName ? `New time, ${d.firstName}.` : 'Your booking has a new time.'),
      intro: cageOnly
        ? 'Our staff moved your session to a different cage. Same day and time, and nothing changes on your payment.'
        : 'Our staff moved your session. Nothing changes on your payment. Here are the new details.',
      details, extra: section('What to bring', esc(BRING)),
      cta: { href: `${d.siteUrl}/schedule`, label: 'View schedule' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `What to bring: ${BRING}`, '',
      `${d.facility.street}, ${d.facility.city}, ${d.facility.state} ${d.facility.zip} · ${d.facility.phone}`].join('\n'),
  };
}

function membershipReceipt(d) {
  const r = d.ref;
  const exp = r.expires_at ? new Date(r.expires_at).toLocaleDateString('en-US', { timeZone: d.timezone, weekday: 'long', month: 'long', day: 'numeric' }) : '';
  const details = [
    ['Plan', r.plan || 'Membership', true],
    ['Cage hours', hrs(r.hours)],
    ['Good through', exp, true],
    ['Extra time', `${r.member_rate}/hr`],
    ['Paid', d.amount],
  ];
  const how = 'Book any open cage on the Drop-in tab. Your hours are used first; anything past them bills at your member rate. Unused hours expire with the term and don’t carry over.';
  const subject = `Your membership is active: ${r.plan || 'Membership'}`;
  return {
    subject,
    html: layout({
      preheader: `${hrs(r.hours)} of cage time, good through ${exp}.`, eyebrow: 'Membership active',
      headline: d.firstName ? `You're a member, ${d.firstName}.` : "You're a member.",
      intro: esc(how), details, extra: section('What to bring', esc(BRING)),
      cta: { href: `${d.siteUrl}/schedule`, label: 'Book a cage' }, f: d.facility,
    }),
    text: [subject, '', ...details.map(([k, v]) => `${k}: ${v}`), '', how, '', `${d.siteUrl}/schedule`].join('\n'),
  };
}

function teamReceipt(d) {
  const r = d.ref;
  const list = (d.teamDates || []).map((x) => { const w = when(x.startsAt, x.endsAt, d.timezone); return `${w.date}, ${w.time}`; });
  const details = [
    ['Team', r.team, true],
    ['Where', 'Whole facility'],
    ['Practices', list.length ? list.join('\n') : `${r.period_start} – ${r.period_end}`],
    ['Paid', d.amount, true],
  ];
  const note = 'Your weekly slot is held three months out. We’ll email a reminder 7 days before the next 4-week cycle is due.';
  const subject = `Team practice confirmed: ${r.team}`;
  return {
    subject,
    html: layout({
      preheader: `${list.length || 4} practices confirmed for ${r.team}.`, eyebrow: 'Team practice',
      headline: `${r.team} is booked.`, intro: esc(note),
      details: details.map(([k, v, b]) => [k, v, b]), extra: section('What to bring', esc(BRING)),
      cta: { href: `${d.siteUrl}/schedule`, label: 'View your teams' }, f: d.facility,
    }).replace(/(<td[^>]*>)([^<]*\n[^<]*)(<\/td>)/g, (m, a, b, c) => a + b.split('\n').join('<br>') + c),
    text: [subject, '', `Team: ${r.team}`, 'Where: Whole facility', 'Practices:', ...list.map((x) => `  ${x}`), `Paid: ${d.amount}`, '', note].join('\n'),
  };
}

function teamCycleDue(d) {
  const r = d.ref;
  const due = r.due_on ? new Date(`${r.due_on}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : 'soon';
  const subject = `${r.team}: next 4 weeks due ${due}`;
  const intro = 'Pay from Your teams on the schedule page to keep your weekly slot. A cycle left unpaid more than five days past its due date releases the slot.';
  return {
    subject,
    html: layout({
      preheader: `${r.amount} due ${due}`, eyebrow: 'Payment reminder', headline: `${r.team}: next cycle due.`,
      intro: esc(intro), details: [['Team', r.team, true], ['Amount', r.amount, true], ['Due', due]],
      cta: { href: `${d.siteUrl}/schedule`, label: 'Pay now' }, f: d.facility,
    }),
    text: [subject, '', `Amount: ${r.amount}`, `Due: ${due}`, '', intro, `${d.siteUrl}/schedule`].join('\n'),
  };
}

function teamSlotReleased(d) {
  const r = d.ref;
  const subject = `${r.team}: weekly slot released`;
  const intro = 'The last cycle went unpaid past the grace period, so your future practice dates were released. Anything you already paid for stays yours. Call us to set up a new slot.';
  return {
    subject,
    html: layout({
      preheader: 'Your weekly practice slot was released.', eyebrow: 'Slot released', eyebrowColor: MUTED,
      headline: `${r.team}'s slot was released.`, intro: esc(intro), details: [['Team', r.team, true]],
      cta: { href: `${d.siteUrl}/schedule`, label: 'See open times' }, f: d.facility,
    }),
    text: [subject, '', intro, '', d.facility.phone].join('\n'),
  };
}

const ROLE_NAME = { coach: 'Coach', admin: 'Admin', owner: 'Owner' };
const ROLE_CAN = {
  coach: 'You can see the schedule, book and hold time for customers, collect payments, and mark no-shows.',
  admin: 'You can do everything on the staff schedule: bookings, refunds, blocks, reports, and managing coaches.',
  owner: 'You have full access, including adding and removing admins and owners.',
};
const ALERT = {
  booked:    { eyebrow: 'New booking', head: (s) => s.title },
  canceled:  { eyebrow: 'Booking canceled', head: (s) => s.title, color: MUTED },
  blocked:   { eyebrow: 'Time blocked', head: () => 'Time blocked' },
  unblocked: { eyebrow: 'Block removed', head: () => 'Block removed', color: MUTED },
};

function staffAlert(d) {
  const r = d.ref, s = d.staff || {}, a = ALERT[r.event] || ALERT.booked;
  const block = r.event === 'blocked' || r.event === 'unblocked';
  const w = when(d.startsAt, block ? r.ends_at : d.endsAt, d.timezone);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: d.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d.startsAt));
  const details = block ? [
    ['Date', s.dates > 1 && s.lastStartsAt ? `${w.date} + ${s.dates - 1} more through ${when(s.lastStartsAt, null, d.timezone).date}` : w.date, true],
    ['Time', w.time, true],
    ['Where', (s.cages || []).join(', ') || 'Cage'],
    ...(r.repeat_rule ? [['Repeats', r.repeat_rule]] : []),
    ...(r.reason ? [['Reason', r.reason]] : []),
    ...(r.actor ? [[r.event === 'blocked' ? 'Blocked by' : 'Removed by', r.actor]] : []),
  ] : [
    ['Date', w.date, true],
    ['Time', w.time, true],
    ['Cage', d.cages.join(', ')],
    ['Customer', s.customer],
    ...(s.contact ? [['Contact', s.contact]] : []),
    ['Type', s.kind],
    ...(r.event === 'booked' && s.money ? [['Payment', s.money]] : []),
    ...(r.event === 'canceled' ? [['Refund', s.refund || 'None']] : []),
    [r.event === 'booked' ? 'Booked by' : 'Canceled by', r.by_staff ? (r.actor || 'Staff') : 'Customer, online'],
  ];
  const subject = block ? `${a.eyebrow}: ${w.date}, ${w.time}` : `${a.eyebrow}: ${s.title}, ${w.date} ${w.time}`;
  const intro = r.event === 'booked' ? (r.by_staff ? 'A staff member booked this for a customer.' : 'A customer just booked online.')
    : r.event === 'canceled' ? 'This time is open again.'
    : r.event === 'blocked' ? 'Nobody can book this time until the block is removed.'
    : 'This time is open for booking again.';
  const why = section('Why you got this', esc('You turned on this staff alert. Change which alerts you get under Email alerts on the staff schedule.'));
  return {
    subject,
    html: layout({
      preheader: `${w.date} · ${w.time}`, eyebrow: a.eyebrow, eyebrowColor: a.color || RED,
      headline: a.head(s), intro: esc(intro), details, extra: why,
      cta: { href: `${d.siteUrl}/staff?day=${ymd}`, label: 'Open staff schedule' }, f: d.facility,
    }),
    text: [subject, '', intro, '', ...details.map(([k, v]) => `${k}: ${v}`), '', `${d.siteUrl}/staff?day=${ymd}`].join('\n'),
  };
}

function staffInvite(d) {
  const r = d.ref, role = ROLE_NAME[r.role] || 'Staff';
  const details = [['Role', role, true], ['Added by', r.invited_by]];
  const how = r.has_account ? 'Sign in the way you always do and open the staff schedule.'
    : 'Sign in with this email address (magic link, Google, or Apple) and you’ll land with staff access.';
  const subject = `You’re on The Yard HD staff (${role})`;
  return {
    subject,
    html: layout({
      preheader: `${r.invited_by} added you as ${role}.`, eyebrow: 'Staff access',
      headline: d.firstName ? `Welcome to the team, ${d.firstName}.` : 'Welcome to the team.',
      intro: esc(`${ROLE_CAN[r.role] || ''} ${how}`), details,
      cta: { href: `${d.siteUrl}/staff`, label: 'Open staff schedule' }, f: d.facility,
    }),
    text: [subject, '', ROLE_CAN[r.role] || '', how, '', `${d.siteUrl}/staff`].join('\n'),
  };
}

export const TEMPLATES = {
  booking_receipt: (d) => receipt(d, false),
  party_deposit_receipt: (d) => receipt(d, true),
  booking_canceled: canceled,
  booking_moved: moved,
  staff_alert: staffAlert,
  staff_invite: staffInvite,
  membership_receipt: membershipReceipt,
  team_receipt: teamReceipt,
  team_cycle_due: teamCycleDue,
  team_slot_released: teamSlotReleased,
};

export function renderEmail(template, data) {
  const fn = TEMPLATES[template];
  return fn ? fn(data) : null;
}
