import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// "Signed in as" — the account's name and email, shown beside Sign out.
// Apple "Hide My Email" gives a forwarding address (…@privaterelay.appleid.com);
// that means nothing to the person, so show "Signed in with Apple" instead.
export function accountLabel(user) {
  const email = user?.email || '';
  const provider = user?.app_metadata?.provider;
  if (/@privaterelay\.appleid\.com$/i.test(email)) return 'Signed in with Apple';
  if (email) return email;
  if (provider === 'apple') return 'Signed in with Apple';
  if (provider === 'google') return 'Signed in with Google';
  return '';
}

export default function SignedInAs({ user, align = 'right' }) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (!user?.id) return;
    supabase.from('users').select('first_name, last_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setName(`${data?.first_name || ''} ${data?.last_name || ''}`.trim()));
  }, [user?.id]);

  const label = accountLabel(user);
  if (!user || (!name && !label)) return null;
  return (
    <div title={[name, user.email].filter(Boolean).join(' · ')}
      style={{ display: 'flex', flexDirection: 'column', alignItems: align === 'right' ? 'flex-end' : 'flex-start', minWidth: 0, maxWidth: 'min(240px, 48vw)', lineHeight: 1.3 }}>
      {name && <span style={{ fontSize: 13, fontWeight: 700, color: '#111', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>}
      {label && <span style={{ fontSize: 12, color: 'rgba(0,0,0,.55)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>}
    </div>
  );
}
