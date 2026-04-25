/**
 * /commander/admin/pin-entry
 *
 * Server-side rendered PIN entry page. After submission, POSTs to
 * /api/admin/pin-verify which sets the HttpOnly session cookie. On
 * success, redirects to ?next=... or /commander/admin.
 */
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/router';

export default function PinEntry() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Caller must already be Supabase-authenticated; we read the bearer
      // token from localStorage as a best-effort handoff. In practice this
      // page is gated by the outer Supabase cookie middleware.
      const supaToken = readSupabaseAccessToken();

      const r = await fetch('/api/admin/pin-verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(supaToken ? { Authorization: `Bearer ${supaToken}` } : {}),
        },
        body: JSON.stringify({ pin }),
      });

      if (r.ok) {
        const next = (router.query.next as string) || '/commander/admin';
        router.replace(next);
        return;
      }

      const j = await r.json().catch(() => ({}));
      setError(j.error || `Verification failed (${r.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{padding: 32, maxWidth: 360, margin: '8vh auto', fontFamily: 'system-ui'}}>
      <h1>Admin PIN</h1>
      <p style={{color: '#666'}}>Enter your 4-12 character PIN to access commander admin.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoFocus
          minLength={4}
          maxLength={12}
          disabled={loading}
          style={{display: 'block', width: '100%', padding: 12, fontSize: 18, marginBottom: 12}}
        />
        <button
          type="submit"
          disabled={loading || pin.length < 4}
          style={{padding: '12px 24px', fontSize: 16, cursor: 'pointer'}}
        >
          {loading ? 'Verifying...' : 'Unlock'}
        </button>
      </form>
      {error ? <p style={{color: '#c33', marginTop: 16}}>{error}</p> : null}
    </main>
  );
}

function readSupabaseAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    // Supabase JS SDK stores session under 'sb-<ref>-auth-token'
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const v = JSON.parse(localStorage.getItem(k) || '{}');
        return v?.access_token ?? null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
