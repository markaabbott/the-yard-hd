import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      // A token can outlive its session (signed out on another device, or
      // revoked). Ask the auth server once; if the session is gone, sign this
      // browser out cleanly instead of half-working.
      if (data.session) {
        const { error } = await supabase.auth.getUser();
        if (error && [401, 403].includes(error.status)) {
          await supabase.auth.signOut({ scope: 'local' });
          setSession(null);
          return;
        }
      }
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    loading: session === undefined,
    signInWithGoogle: () =>
      supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/schedule` }
      }),
    signInWithApple: () =>
      supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo: `${window.location.origin}/schedule` }
      }),
    signInWithMagicLink: (email) =>
      supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/schedule` }
      }),
    // Sign out of THIS browser only. The default ends every session for the
    // account, which silently breaks the same login open elsewhere.
    signOut: () => supabase.auth.signOut({ scope: 'local' })
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
