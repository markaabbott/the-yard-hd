import { useState } from 'react';
import { useAuth } from '../lib/AuthContext';

export default function SignIn() {
  const { signInWithGoogle, signInWithMagicLink } = useAuth();
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

        <button
          disabled
          title="Coming soon"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '12px 16px', borderRadius: 7, border: '1px solid rgba(0,0,0,.1)', background: 'rgba(0,0,0,.04)', color: 'rgba(0,0,0,.35)', cursor: 'not-allowed', fontSize: 14, fontWeight: 600 }}
        >
          Continue with Apple — coming soon
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
