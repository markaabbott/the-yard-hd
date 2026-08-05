import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../lib/AuthContext';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/schedule' : '/signin');
  }, [loading, user, router]);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontFamily: 'Oswald, sans-serif', fontSize: 14, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8a8578' }}>
        Loading The Yard HD…
      </div>
    </main>
  );
}
