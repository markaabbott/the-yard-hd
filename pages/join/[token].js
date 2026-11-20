import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../lib/AuthContext';
import { authFetch } from '../../lib/authFetch';
import WaiverPanel from '../../components/WaiverPanel';
import { PENDING_JOIN_KEY } from '../../lib/joinLink';

const RED = '#BA0C2F';

// A parent opens the coach's team link: sign in, sign the waiver for their
// player(s), and they're added to that team's list. Parents who already have
// a waiver on file just pick which players to add.
export default function Join() {
  const router = useRouter();
  const token = typeof router.query.token === 'string' ? router.query.token : null;
  const { user, loading } = useAuth();
  const [info, setInfo] = useState(null); // { team, players?, onTeam?, signedIn }
  const [err, setErr] = useState(null);
  const [pick, setPick] = useState({});
  const [signing, setSigning] = useState(false);
  const [working, setWorking] = useState(false);
  const [done, setDone] = useState(null); // names added

  const load = useCallback(async () => {
    if (!token || loading) return;
    setErr(null);
    const r = user ? await authFetch(`/api/join?token=${encodeURIComponent(token)}`) : await fetch(`/api/join?token=${encodeURIComponent(token)}`);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(body.error || 'This team link is not working.'); return; }
    setInfo({ signedIn: !!user, ...body });
    if (user && body.players && !body.players.some((p) => p.current)) setSigning(true);
  }, [token, user, loading]);
  useEffect(() => { load(); }, [load]);

  function signIn() {
    try { localStorage.setItem(PENDING_JOIN_KEY, token); } catch (e) { /* private mode: they can reopen the link */ }
    router.push('/signin');
  }

  async function addChosen() {
    const names = Object.keys(pick).filter((n) => pick[n]);
    if (!names.length) return;
    setWorking(true);
    setErr(null);
    const r = await authFetch('/api/join', { method: 'POST', body: JSON.stringify({ token, names }) });
    const body = await r.json().catch(() => ({}));
    setWorking(false);
    if (!r.ok) { setErr(body.error || 'Could not add to the team.'); return; }
    setDone(names);
  }

  const team = info?.team;
  const onTeam = new Set((info?.onTeam || []).map((n) => n.toLowerCase()));
  const current = (info?.players || []).filter((p) => p.current);

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 460, background: '#fff', border: '1px solid rgba(0,0,0,.08)', borderRadius: 12, padding: '30px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 13, letterSpacing: '.16em', textTransform: 'uppercase', color: RED }}>The Yard HD</div>

        {err && <div style={{ fontSize: 15, lineHeight: 1.6 }}>{err}</div>}
        {!err && !info && <div style={{ fontSize: 14, color: 'rgba(0,0,0,.55)' }}>Loading…</div>}

        {team && (
          <div>
            <h1 style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 26, lineHeight: 1.1, textTransform: 'uppercase', margin: '0 0 8px' }}>Join {team.name}</h1>
            <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: 'rgba(0,0,0,.7)' }}>
              {team.coach ? `${team.coach} invited you` : 'Your coach invited you'} to sign The Yard's liability waiver for your player. It takes about a minute, it's good for one year, and your player is added to the team's list.
            </p>
          </div>
        )}

        {team && !info.signedIn && (
          <button onClick={signIn} style={primary}>Sign in to continue</button>
        )}

        {team && info.signedIn && done && (
          <>
            <div style={{ padding: '12px 14px', borderRadius: 9, background: 'rgba(20,120,60,.07)', border: '1px solid rgba(20,120,60,.22)', fontSize: 14, lineHeight: 1.6 }}>
              ✓ {done.join(', ')} {done.length === 1 ? 'is' : 'are'} on {team.name}'s list with a signed waiver.
            </div>
            <a href="/schedule" style={{ ...primary, textAlign: 'center', textDecoration: 'none' }}>Go to The Yard</a>
          </>
        )}

        {team && info.signedIn && !done && current.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', color: 'rgba(0,0,0,.6)' }}>Players with a waiver on file</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {current.map((p) => {
                const already = onTeam.has(p.name.toLowerCase());
                return (
                  <label key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14.5, padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(0,0,0,.1)', cursor: already ? 'default' : 'pointer', opacity: already ? 0.6 : 1 }}>
                    <input type="checkbox" disabled={already} checked={already || !!pick[p.name]} onChange={(e) => setPick((x) => ({ ...x, [p.name]: e.target.checked }))} style={{ width: 18, height: 18, accentColor: RED }} />
                    {p.name}{already ? ' · already on the team' : ''}
                  </label>
                );
              })}
            </div>
            <button onClick={addChosen} disabled={working || !Object.values(pick).some(Boolean)} style={{ ...primary, opacity: working || !Object.values(pick).some(Boolean) ? 0.55 : 1 }}>
              {working ? 'Adding…' : 'Add to the team'}
            </button>
            <button onClick={() => setSigning(true)} style={{ border: 'none', background: 'none', padding: 0, color: RED, fontWeight: 700, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start' }}>+ Sign for a different player</button>
          </>
        )}

        {team && info.signedIn && !done && current.length === 0 && !signing && (
          <button onClick={() => setSigning(true)} style={primary}>Sign the waiver</button>
        )}
      </div>

      {signing && user && (
        <WaiverPanel
          userId={user.id}
          teamToken={token}
          reason={`Sign for each player on ${team?.name || 'the team'}. Good for one year.`}
          onSigned={(signed) => { setSigning(false); setDone(signed.map((w) => w.participant_name)); }}
          onClose={() => setSigning(false)}
        />
      )}
    </main>
  );
}

const primary = { display: 'block', padding: '13px 16px', borderRadius: 7, border: 'none', background: RED, color: '#fff', fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 15, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer' };
