/**
 * /commander/admin/pin-entry
 *
 * Server-side rendered PIN entry page. After submission, POSTs to
 * /api/admin/pin-verify which sets the HttpOnly session cookie. On
 * success, redirects to ?next=... or /commander/admin.
 *
 * 2026-07-25 audit fixes:
 *  - Token lookup now checks the storage keys this app actually uses
 *    ('commander-auth', 'smarter-poker-auth') in addition to the sb-* keys —
 *    previously the Bearer header was never attached and every verify 401'd.
 *  - First-time setup: when the server answers PIN_NOT_SET (409), the page
 *    switches to an enrollment form that calls /api/admin/pin-setup.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/router';

export default function PinEntry() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [mode, setMode] = useState<'verify' | 'setup'>('verify');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const supaToken = readSupabaseAccessToken();
      if (!supaToken) {
        setError('You must be signed in first. Open /commander/login, sign in, then return here.');
        return;
      }

      if (mode === 'setup') {
        if (pin !== confirmPin) {
          setError('PINs do not match');
          return;
        }
        const s = await fetch('/api/admin/pin-setup', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${supaToken}`,
          },
          body: JSON.stringify({ pin }),
        });
        if (!s.ok) {
          const j = await s.json().catch(() => ({}));
          setError(j.error || `PIN setup failed (${s.status})`);
          return;
        }
        // Enrolled — fall through to verify with the same PIN.
        setMode('verify');
        setNotice('PIN created. Verifying...');
      }

      const r = await fetch('/api/admin/pin-verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${supaToken}`,
        },
        body: JSON.stringify({ pin }),
      });

      if (r.ok) {
        // Only allow same-origin relative paths — an absolute or
        // protocol-relative ?next= would be an open redirect.
        const rawNext = router.query.next as string;
        const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//')
          ? rawNext
          : '/commander/admin';
        router.replace(next);
        return;
      }

      const j = await r.json().catch(() => ({}));
      if (r.status === 409 || j.code === 'PIN_NOT_SET') {
        setMode('setup');
        setNotice('No admin PIN exists for this account yet. Create one now.');
        setError(null);
        return;
      }
      setError(j.error || `Verification failed (${r.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{padding: 32, maxWidth: 360, margin: '8vh auto', fontFamily: 'system-ui'}}>
      <h1>{mode === 'setup' ? 'Create Admin PIN' : 'Admin PIN'}</h1>
      <p style={{color: '#666'}}>
        {mode === 'setup'
          ? 'Choose a 4-12 character PIN to protect commander admin.'
          : 'Enter your 4-12 character PIN to access commander admin.'}
      </p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          minLength={4}
          maxLength={12}
          disabled={loading}
          placeholder={mode === 'setup' ? 'New PIN' : 'PIN'}
          style={{display: 'block', width: '100%', padding: 12, fontSize: 18, marginBottom: 12}}
        />
        {mode === 'setup' ? (
          <input
            type="password"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            minLength={4}
            maxLength={12}
            disabled={loading}
            placeholder="Confirm PIN"
            style={{display: 'block', width: '100%', padding: 12, fontSize: 18, marginBottom: 12}}
          />
        ) : null}
        <button
          type="submit"
          disabled={loading || pin.length < 4 || (mode === 'setup' && confirmPin.length < 4)}
          style={{padding: '12px 24px', fontSize: 16, cursor: 'pointer'}}
        >
          {loading ? 'Working...' : mode === 'setup' ? 'Create PIN' : 'Unlock'}
        </button>
      </form>
      {notice ? <p style={{color: '#2a7', marginTop: 16}}>{notice}</p> : null}
      {error ? <p style={{color: '#c33', marginTop: 16}}>{error}</p> : null}
    </main>
  );
}

function readSupabaseAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Keys this platform actually uses, in preference order.
    for (const key of ['commander-auth', 'smarter-poker-auth']) {
      const raw = localStorage.getItem(key);
      if (raw) {
        const v = JSON.parse(raw);
        const token = v?.access_token ?? v?.currentSession?.access_token ?? null;
        if (token) return token;
      }
    }
    // Supabase JS SDK default: 'sb-<ref>-auth-token'
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        const token = v?.access_token ?? v?.currentSession?.access_token ?? null;
        if (token) return token;
      }
    }
    return null;
  } catch {
    return null;
  }
}
