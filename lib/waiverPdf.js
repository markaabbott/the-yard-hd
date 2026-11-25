// Builds the PDF of one signed waiver on The Yard letterhead: logo and
// contact block, the full text of the version that was signed, then a boxed
// signature record. Plain PDF 1.4 with the built-in fonts, so no extra
// package is needed. Server-only.
import { WAIVER_TITLE, WAIVER_INTRO, sectionsFor, AGREE_READ, AGREE_SUE } from './waiverText';
import { LOGO } from './pdfLogo';

// Helvetica glyph widths (1/1000 em) for ASCII 32–126.
const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// Helvetica-Bold widths, same range.
const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const width = (s, size, bold) => [...String(s)].reduce((a, ch) => {
  const c = ch.charCodeAt(0);
  return a + (c >= 32 && c <= 126 ? (bold ? WB : W)[c - 32] : ch === '·' ? 278 : 556);
}, 0) * size / 1000;

// WinAnsi: keep ASCII, map the few typographic characters we use, drop the rest.
const MAP = { '·': 0xB7, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97, '•': 0x95, '✓': 0x2A };
function pdfStr(s) {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    let b = c >= 32 && c <= 126 ? c : MAP[ch];
    if (b == null) b = 0x3F;
    const t = String.fromCharCode(b);
    out += t === '(' || t === ')' || t === '\\' ? `\\${t}` : b > 126 ? `\\${b.toString(8).padStart(3, '0')}` : t;
  }
  return `(${out})`;
}

// Word-wrap a run of [text, bold] pieces. Returns lines of [{ t, bold }].
function wrapRich(pieces, size, maxW) {
  const words = [];
  for (const [t, bold] of pieces) String(t).split(/\s+/).filter(Boolean).forEach((w) => words.push({ t: w, bold }));
  const lines = [];
  let line = [], lw = 0;
  const sp = width(' ', size, false);
  for (const w of words) {
    const ww = width(w.t, size, w.bold);
    if (line.length && lw + sp + ww > maxW) { lines.push(line); line = []; lw = 0; }
    lw += (line.length ? sp : 0) + ww;
    line.push(w);
  }
  if (line.length) lines.push(line);
  return lines;
}
const wrap = (text, size, bold, maxW) => wrapRich([[text, bold]], size, maxW).map((ln) => ln.map((w) => w.t).join(' '));
// "Facility rules. The Participant will…" → bold lead-in + text.
function lead(t) {
  const i = t.indexOf('. ');
  return i > 0 && i < 32 ? [[t.slice(0, i + 1), true], [t.slice(i + 1), false]] : [[t, false]];
}

const PAGE_W = 612, PAGE_H = 792, M = 60, BODY_W = PAGE_W - 2 * M;
const RED = '0.729 0.047 0.184', GREY = '0.42 0.42 0.42', INK = '0.1 0.1 0.1';
const TOP_1 = PAGE_H - 132;   // body starts here on page 1 (below the letterhead)
const TOP_N = PAGE_H - 92;    // and on later pages (below the running header)
const BOTTOM = 70;            // keep clear of the footer
const BODY = 10.5, LEAD = 15.5;

export function buildWaiverPdf(w, { facilityTz = 'America/Los_Angeles' } = {}) {
  const pages = [];
  let ops = [];
  let y = TOP_1;

  const newPage = () => { pages.push(ops); ops = []; y = TOP_N; };
  const need = (h) => { if (y - h < BOTTOM) newPage(); };
  const font = (bold, italic) => (italic ? 'F3' : bold ? 'F2' : 'F1');
  const text = (s, { size = BODY, bold = false, italic = false, x = M, color = INK } = {}) => {
    ops.push(`BT ${color} rg /${font(bold, italic)} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfStr(s)} Tj ET`);
  };
  const line = (x1, y1, x2, y2, { color = '0.82 0.8 0.77', w: lw = 0.75 } = {}) => ops.push(`${color} RG ${lw} w ${x1} ${y1.toFixed(2)} m ${x2} ${y2.toFixed(2)} l S`);
  const rich = (pieces, { size = BODY, lead: ld = LEAD, indent = 0, gap = 7, bullet = false, color = INK, center = false } = {}) => {
    const bx = indent + (bullet ? 14 : 0);
    const lines = wrapRich(pieces, size, BODY_W - bx);
    lines.forEach((ln, i) => {
      need(ld);
      y -= ld;
      if (bullet && i === 0) text('•', { size, x: M + indent + 2, color: RED });
      const lw = ln.reduce((a, w, j) => a + width(w.t, size, w.bold) + (j ? width(' ', size) : 0), 0);
      let x = center ? (PAGE_W - lw) / 2 : M + bx;
      // Merge runs of the same weight so the text stream stays small.
      const runs = [];
      ln.forEach((w) => { const last = runs[runs.length - 1]; if (last && last.bold === w.bold) last.t += ` ${w.t}`; else runs.push({ t: w.t, bold: w.bold }); });
      runs.forEach((r, j) => {
        const t = j ? ` ${r.t}` : r.t;
        text(t, { size, bold: r.bold, x, color });
        x += width(t, size, r.bold);
      });
    });
    y -= gap;
  };
  const para = (s, o = {}) => rich([[s, !!o.bold]], o);

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: facilityTz, dateStyle: 'long', timeStyle: 'short' }) : '—');
  const fmtDate = (ymd) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'long' }) : '—');
  const sections = sectionsFor(w.waiver_version);

  // Title block (the letterhead itself is drawn on every page at assembly time)
  rich([[WAIVER_TITLE, true]], { size: 14.5, lead: 19, center: true, gap: 3 });
  rich([[`Signed for ${w.participant_name}  ·  Version ${w.waiver_version}  ·  Waiver ID ${w.id}`, false]], { size: 8.5, lead: 12, center: true, color: GREY, gap: 14 });

  if (sections) {
    // WAIVER_INTRO[0] is the address line, already in the letterhead.
    para(WAIVER_INTRO[1], { bold: true, gap: 8 });
    WAIVER_INTRO.slice(2).forEach((t) => para(t));
    for (const s of sections) {
      need(70); // keep a heading with its first lines
      y -= 9;
      para(s.title.toUpperCase(), { size: 10.5, bold: true, color: RED, gap: 4 });
      (s.paras || []).forEach((t) => para(t));
      (s.bullets || []).forEach((t) => rich(lead(t), { bullet: true, indent: 4, gap: 4 }));
      if (s.bullets) y -= 3;
      if (s.after) para(s.after);
    }
    y -= 4;
    para(`[x]  ${AGREE_READ}`, { gap: 2 });
    para(`[x]  ${AGREE_SUE}`);
  } else {
    para(`This signature is for waiver version ${w.waiver_version}. The text of that version is kept on file with The Yard HD; ask staff for a copy.`);
  }

  // Signature record: a shaded box, two columns of details, then a signature line.
  const rel = w.is_minor ? (w.guardian_relationship === 'guardian' ? 'Legal guardian' : 'Parent') : 'Participant (self)';
  const cells = [
    ['Participant', w.participant_name], ['Date of birth', fmtDate(w.participant_dob)],
    ['Signed by', w.signature_name], ['Relationship', rel],
    ['Signed on', `${fmt(w.signed_at)} (Pacific)`], ['Expires', fmt(w.expires_at)],
    ['Account email', w.account_email || '—'], ['IP address', w.ip_address || '—'],
    ['Waiver version', w.waiver_version], ['Minor', w.is_minor ? 'Yes' : 'No'],
  ];
  const colW = (BODY_W - 36) / 2;
  const rowsH = [];
  for (let i = 0; i < cells.length; i += 2) {
    const h = Math.max(...[cells[i], cells[i + 1]].filter(Boolean).map(([, v]) => wrap(v, 10, false, colW).length));
    rowsH.push(12 + h * 13 + 6);
  }
  const device = w.user_agent ? String(w.user_agent).slice(0, 180) : '—';
  const devLines = wrap(device, 8, false, BODY_W - 36);
  const boxH = 34 + rowsH.reduce((a, b) => a + b, 0) + 14 + devLines.length * 11 + 86;
  need(boxH + 20);
  y -= 14;
  const top = y;
  ops.push(`0.972 0.965 0.955 rg 0.82 0.8 0.77 RG 0.75 w ${M} ${(top - boxH).toFixed(2)} ${BODY_W} ${boxH.toFixed(2)} re B`);
  ops.push(`${RED} rg ${M} ${(top - 3).toFixed(2)} ${BODY_W} 3 re f`);
  y = top - 24;
  text('SIGNATURE RECORD', { size: 10, bold: true, color: RED, x: M + 18 });
  y -= 6;
  for (let i = 0, r = 0; i < cells.length; i += 2, r++) {
    const rowTop = y;
    [cells[i], cells[i + 1]].filter(Boolean).forEach(([k, v], c) => {
      const x = M + 18 + c * (colW + 0);
      y = rowTop - 12;
      text(k.toUpperCase(), { size: 7.5, bold: true, color: GREY, x });
      wrap(v, 10, false, colW - 10).forEach((ln) => { y -= 13; text(ln, { size: 10, x }); });
    });
    y = rowTop - rowsH[r];
  }
  y -= 12;
  text('DEVICE', { size: 7.5, bold: true, color: GREY, x: M + 18 });
  devLines.forEach((ln) => { y -= 11; text(ln, { size: 8, color: GREY, x: M + 18 }); });
  // Signature line
  y -= 40;
  text(w.signature_name, { size: 22, italic: true, x: M + 24 });
  y -= 9;
  line(M + 18, y, M + 18 + 250, y, { color: '0.3 0.3 0.3', w: 0.8 });
  line(M + 300, y, PAGE_W - M - 18, y, { color: '0.3 0.3 0.3', w: 0.8 });
  const signedDate = w.signed_at ? new Date(w.signed_at).toLocaleDateString('en-US', { timeZone: facilityTz, dateStyle: 'long' }) : '—';
  const saveY = y;
  y += 13; text(signedDate, { size: 11, x: M + 304 }); y = saveY;
  y -= 12;
  text(`Electronic signature of ${w.signature_name}, ${rel.toLowerCase()}`, { size: 8, color: GREY, x: M + 18 });
  text('Date signed', { size: 8, color: GREY, x: M + 300 });
  y = top - boxH;
  pages.push(ops);

  // Assemble: catalog, pages, fonts, logo, then each page + its content stream.
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>');
  const logoBytes = Buffer.from(LOGO.data, 'base64').toString('latin1');
  const logo = add(`<< /Type /XObject /Subtype /Image /Width ${LOGO.w} /Height ${LOGO.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${logoBytes.length} >>\nstream\n${logoBytes}\nendstream`);

  const t = (s, x, yy, size, { bold = false, color = GREY, right = false } = {}) => {
    const xx = right ? x - width(s, size, bold) : x;
    return `BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${xx.toFixed(2)} ${yy.toFixed(2)} Td ${pdfStr(s)} Tj ET`;
  };
  const rule = (yy, color, lw) => `${color} RG ${lw} w ${M} ${yy} m ${PAGE_W - M} ${yy} l S`;
  const kids = [];
  pages.forEach((pageOps, i) => {
    const head = [];
    if (i === 0) {
      // Letterhead: logo left, contact block right, red rule.
      const lw = 132, lh = lw * LOGO.h / LOGO.w;
      head.push(`q ${lw} 0 0 ${lh.toFixed(2)} ${M} ${(PAGE_H - 50 - lh).toFixed(2)} cm /Logo Do Q`);
      const rx = PAGE_W - M;
      head.push(t('The Yard HD LLC', rx, PAGE_H - 54, 9, { bold: true, color: INK, right: true }));
      head.push(t('18737 Highway 18, Ste 11', rx, PAGE_H - 66, 8.5, { right: true }));
      head.push(t('Apple Valley, CA 92307', rx, PAGE_H - 77, 8.5, { right: true }));
      head.push(t('(760) 553-5996  ·  theyardhd.com', rx, PAGE_H - 88, 8.5, { right: true }));
      head.push(rule(PAGE_H - 102, RED, 1.5));
    } else {
      const lw = 70, lh = lw * LOGO.h / LOGO.w;
      head.push(`q ${lw} 0 0 ${lh.toFixed(2)} ${M} ${(PAGE_H - 42 - lh).toFixed(2)} cm /Logo Do Q`);
      head.push(t(`Signed waiver  ·  ${w.participant_name}`, PAGE_W - M, PAGE_H - 52, 8.5, { right: true }));
      head.push(rule(PAGE_H - 64, '0.82 0.8 0.77', 0.75));
    }
    const foot = [
      rule(48, '0.82 0.8 0.77', 0.5),
      t(`The Yard HD LLC  ·  Signed waiver  ·  ${w.participant_name}`, M, 34, 7.5),
      t(`Page ${i + 1} of ${pages.length}`, PAGE_W - M, 34, 7.5, { right: true }),
    ];
    const stream = [...head, ...pageOps, ...foot].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> /XObject << /Logo ${logo} 0 R >> >> /Contents ${content} 0 R >>`));
  });
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
