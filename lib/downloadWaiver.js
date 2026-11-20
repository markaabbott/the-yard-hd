// Browser helper: download a signed waiver's PDF (the route needs the
// sign-in token, so a plain link won't do).
import { authFetch } from './authFetch';

export async function downloadWaiverPdf(id, name = 'waiver') {
  const r = await authFetch(`/api/waiver-pdf?id=${encodeURIComponent(id)}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.error || 'Could not download the waiver.');
  }
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Waiver - ${String(name).replace(/[^A-Za-z0-9 .-]/g, '')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
