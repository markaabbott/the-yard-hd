// US phone numbers: accept anything with 10 digits (or 11 starting with 1)
// and store/show them as (760) 555-0100.

export function phoneDigits(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

// Formatted number, '' for blank input, or null when it isn't a valid US number.
export function formatPhone(s) {
  if (!String(s || '').trim()) return '';
  const d = phoneDigits(s);
  if (d.length !== 10 || /^[01]/.test(d)) return null;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export const isPhoneOk = (s) => formatPhone(s) !== null;

export const PHONE_ERROR = 'Enter a 10-digit phone number, like (760) 555-0100.';
