// Builds the PDF of one signed waiver: the full waiver text the person agreed
// to, then the signature record. Plain PDF 1.4 with the built-in Helvetica
// fonts, so no extra package is needed. Server-only.
import { WAIVER_TITLE, WAIVER_INTRO, sectionsFor, AGREE_READ, AGREE_SUE } from './waiverText';

// Helvetica glyph widths (1/1000 em) for ASCII 32–126.
const W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const width = (s, size, bold) => [...s].reduce((a, ch) => {
  const c = ch.charCodeAt(0);
  return a + (c >= 32 && c <= 126 ? W[c - 32] : 556);
}, 0) * size / 1000 * (bold ? 1.08 : 1);

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

function wrap(text, size, bold, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (width(next, size, bold) <= maxW || !line) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

const PAGE_W = 612, PAGE_H = 792, M = 54, BODY_W = PAGE_W - 2 * M;

export function buildWaiverPdf(w, { facilityTz = 'America/Los_Angeles' } = {}) {
  const pages = [];
  let ops = [];
  let y = PAGE_H - M;

  const newPage = () => { if (ops.length) pages.push(ops); ops = []; y = PAGE_H - M; };
  const need = (h) => { if (y - h < M + 24) newPage(); };
  const text = (s, { size = 10, bold = false, x = M, color = '0 0 0' } = {}) => {
    ops.push(`BT ${color} rg /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfStr(s)} Tj ET`);
  };
  const para = (s, { size = 10, bold = false, indent = 0, gap = 6, bullet = false, color } = {}) => {
    const lead = size * 1.4;
    const lines = wrap(s, size, bold, BODY_W - indent - (bullet ? 12 : 0));
    lines.forEach((ln, i) => {
      need(lead);
      y -= lead;
      if (bullet && i === 0) text('•', { size, x: M + indent, color });
      text(ln, { size, bold, x: M + indent + (bullet ? 12 : 0), color });
    });
    y -= gap;
  };
  const rule = () => { need(10); y -= 4; ops.push(`0.8 0.78 0.75 RG 0.75 w ${M} ${y} m ${PAGE_W - M} ${y} l S`); y -= 8; };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: facilityTz, dateStyle: 'long', timeStyle: 'short' }) : '—');
  const fmtDate = (ymd) => (ymd ? new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', dateStyle: 'long' }) : '—');
  const sections = sectionsFor(w.waiver_version);
  const sameVersion = !!sections;

  // Header
  para('THE YARD HD', { size: 9, bold: true, gap: 2, color: '0.729 0.047 0.184' });
  para(WAIVER_TITLE, { size: 15, bold: true, gap: 4 });
  para(`Signed waiver for ${w.participant_name} · version ${w.waiver_version} · waiver ID ${w.id}`, { size: 9, color: '0.35 0.35 0.35', gap: 8 });
  rule();

  if (sameVersion) {
    WAIVER_INTRO.forEach((t) => para(t));
    for (const s of sections) {
      need(60); // keep a heading with at least its first lines
      y -= 4;
      para(s.title, { size: 11, bold: true, gap: 3 });
      (s.paras || []).forEach((t) => para(t));
      (s.bullets || []).forEach((t) => para(t, { bullet: true, indent: 6, gap: 3 }));
      if (s.after) para(s.after);
    }
    y -= 4;
    para(`[x] ${AGREE_READ}`, { gap: 2 });
    para(`[x] ${AGREE_SUE}`);
  } else {
    para(`This signature is for waiver version ${w.waiver_version}. The text of that version is kept on file with The Yard HD; ask staff for a copy.`);
  }

  // Signature record (kept on one page)
  need(250);
  y -= 6;
  rule();
  para('Signature record', { size: 12, bold: true, gap: 4 });
  const rows = [
    ['Participant', w.participant_name],
    ['Date of birth', fmtDate(w.participant_dob)],
    ['Minor', w.is_minor ? 'Yes' : 'No'],
    ['Signed by', w.signature_name],
    ['Relationship', w.is_minor ? (w.guardian_relationship === 'guardian' ? 'Legal guardian' : 'Parent') : 'Participant (self)'],
    ['Electronic signature', `Typed name "${w.signature_name}" with both agreement boxes checked`],
    ['Signed on', `${fmt(w.signed_at)} (Pacific)`],
    ['Expires', fmt(w.expires_at)],
    ['Account email', w.account_email || '—'],
    ['IP address', w.ip_address || '—'],
    ['Device', w.user_agent ? String(w.user_agent).slice(0, 160) : '—'],
    ['Waiver version', w.waiver_version],
  ];
  for (const [k, v] of rows) {
    const lines = wrap(v, 10, false, BODY_W - 130);
    need(14 * lines.length + 2);
    y -= 14;
    text(k, { size: 9, bold: true, color: '0.35 0.35 0.35' });
    lines.forEach((ln, i) => { if (i) y -= 14; text(ln, { x: M + 130 }); });
    y -= 2;
  }
  newPage();

  // Assemble: catalog, pages, fonts, then each page + its content stream.
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  pages.forEach((pageOps, i) => {
    const footer = `BT 0.45 0.45 0.45 rg /F1 8 Tf ${M} 30 Td ${pdfStr(`The Yard HD · signed waiver · ${w.participant_name} · page ${i + 1} of ${pages.length}`)} Tj ET`;
    const stream = [...pageOps, footer].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
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
