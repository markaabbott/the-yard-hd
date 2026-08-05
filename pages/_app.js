import { AuthProvider } from '../lib/AuthContext';

export default function App({ Component, pageProps }) {
  return (
    <AuthProvider>
      <style jsx global>{`
        body { margin: 0; background: #F0EEE9; font-family: 'Merriweather Sans', system-ui, sans-serif; }
        a { color: #BA0C2F; }
        a:hover { color: #8F0A24; }
        input, select, textarea, button { font-family: 'Merriweather Sans', sans-serif; }
        * { box-sizing: border-box; }
      `}</style>
      <Component {...pageProps} />
    </AuthProvider>
  );
}
