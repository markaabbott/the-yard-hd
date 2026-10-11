import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';

export default function SignIn() {
  const { signInWithGoogle, signInWithApple, signInWithMagicLink } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(null);

  async function submitMagicLink(e) {
    e.preventDefault();
    setErr(null);
    const { error } = await signInWithMagicLink(email);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 10, padding: '36px 30px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ textAlign: 'center', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 24, letterSpacing: '.04em', textTransform: 'uppercase' }}>
          The Yard HD
        </div>
        <p style={{ textAlign: 'center', fontSize: 13.5, color: 'rgba(0,0,0,.6)', margin: 0 }}>
          Sign in to book a cage, join a team, or manage your membership.
        </p>

        <button
          onClick={() => signInWithGoogle()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', background: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          Continue with Google
        </button>

        {/* Apple requires their own mark and wording on this button; black
            fill with the white logo is the sanctioned treatment. */}
        <button
          onClick={() => signInWithApple()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 16px', borderRadius: 7, border: 'none', background: '#000', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
        >
          <svg width="15" height="18" viewBox="0 0 14 17" fill="#fff" aria-hidden="true" style={{ marginTop: -2 }}>
            <path d="M11.6 9.02c.02 2.3 2.02 3.06 2.04 3.07-.02.05-.32 1.1-1.06 2.18-.64.94-1.3 1.87-2.35 1.89-1.03.02-1.36-.61-2.54-.61-1.18 0-1.55.59-2.52.63-1.01.04-1.78-1.01-2.42-1.94C1.44 12.33.44 8.85 1.78 6.5c.66-1.17 1.85-1.9 3.14-1.92 1-.02 1.94.67 2.54.67.6 0 1.75-.83 2.94-.71.5.02 1.91.18 2.81 1.37-.07.05-1.65.96-1.63 2.87M9.6 2.87c.53-.64.89-1.53.79-2.42-.78.03-1.73.52-2.28 1.16-.5.57-.93 1.48-.81 2.35.87.07 1.76-.44 2.3-1.09" />
          </svg>
          Continue with Apple
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(0,0,0,.3)', fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,.1)' }} />
          or
          <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,.1)' }} />
        </div>

        {sent ? (
          <div style={{ fontSize: 13.5, color: '#2a7a3c', textAlign: 'center' }}>
            Check your email for a sign-in link.
          </div>
        ) : (
          <form onSubmit={submitMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="email"
              required
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: '11px 12px', borderRadius: 7, border: '1px solid rgba(0,0,0,.15)', fontSize: 14 }}
            />
            <button
              type="submit"
              style={{ padding: '12px 16px', borderRadius: 7, border: 'none', background: '#BA0C2F', color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}
            >
              Email me a sign-in link
            </button>
            {err && <div style={{ fontSize: 12.5, color: '#BA0C2F' }}>{err}</div>}
          </form>
        )}
      </div>
    </main>
  );
}
