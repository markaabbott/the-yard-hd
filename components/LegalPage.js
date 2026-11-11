import Head from 'next/head';
import Link from 'next/link';

// Shared shell for /privacy and /terms. Public pages: no sign-in needed.
const RED = '#BA0C2F';

export function H({ children }) {
  return <h2 style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 21, letterSpacing: '.03em', textTransform: 'uppercase', margin: '34px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${RED}` }}>{children}</h2>;
}
export function P({ children }) {
  return <p style={{ fontSize: 15, lineHeight: 1.7, color: '#2a2a2a', margin: '0 0 12px' }}>{children}</p>;
}
export function L({ items }) {
  return (
    <ul style={{ fontSize: 15, lineHeight: 1.7, color: '#2a2a2a', margin: '0 0 12px', paddingLeft: 22 }}>
      {items.map((t, i) => <li key={i} style={{ marginBottom: 6 }}>{t}</li>)}
    </ul>
  );
}

export default function LegalPage({ title, effective, children }) {
  return (
    <main style={{ minHeight: '100vh', padding: '40px 20px 80px' }}>
      <Head><title>{`${title} · The Yard HD`}</title></Head>
      <article style={{ maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 10, padding: 'clamp(24px, 5vw, 48px)' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', color: RED }}>The Yard HD</div>
        <h1 style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 'clamp(32px, 6vw, 44px)', lineHeight: 1.05, textTransform: 'uppercase', margin: '8px 0 6px' }}>{title}</h1>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,.55)', marginBottom: 8 }}>Effective {effective}</div>
        {children}
        <div style={{ marginTop: 40, paddingTop: 18, borderTop: '1px solid rgba(0,0,0,.1)', display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }}>
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms of Service</Link>
          <Link href="/">Book at The Yard HD</Link>
        </div>
      </article>
    </main>
  );
}

export const CONTACT = (
  <>
    The Yard HD LLC<br />
    18737 Highway 18, Ste 11, Apple Valley, CA<br />
    <a href="mailto:info@theyardhd.com">info@theyardhd.com</a> · <a href="tel:7605535996">(760) 553-5996</a>
  </>
);
