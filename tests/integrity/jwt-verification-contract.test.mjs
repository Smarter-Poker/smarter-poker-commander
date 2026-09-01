/**
 * JWT VERIFICATION CONTRACT — the test that should have existed.
 *
 * Ported from Smarter-Poker-World-Hub __tests__/jwt-verification-contract.test.mjs
 * (PR #1210). Commander's test tree is tests/integrity/, two levels below the
 * repo root, so the vendor import paths here are ../../vendor/... rather than
 * the Hub's ../vendor/...
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (2026-09-01 post-mortem)
 * ─────────────────────────────────────────────────────────────────────────
 * On 2026-09-01 the site fell into a permanent auth redirect loop: every
 * open tab bounced to /auth/login?redirect=. Root cause was TWO stacked
 * defects in the server-side JWT fast path, present byte-for-byte in this
 * repo as well as the Hub:
 *
 *   1. vendor/commander-shared/src/lib/serverAuth.js gated on
 *      `header.alg !== 'HS256'` after the project migrated to ES256
 *      asymmetric signing keys. Every token failed verification.
 *   2. vendor/commander-shared/src/lib/supabaseServerClient.js refused to
 *      even call the verifier unless process.env.SUPABASE_JWT_SECRET was
 *      set — a variable that does not exist in any environment and is not
 *      in .env.example.
 *
 * Either alone was sufficient. Together, 100% of authenticated requests
 * fell through to a live GET /auth/v1/user against GoTrue: ~20M edge
 * requests/24h, which saturated the PROJECT-WIDE GoTrue rate limit and
 * cascaded into the logout loop.
 *
 * This file asserts the real thing: genuine ES256 keys, genuine
 * signatures, genuine crypto.subtle, and the genuine vendored modules —
 * with no environment variables set, because that is how production runs.
 *
 * IF YOU ARE HERE BECAUSE THIS TEST FAILED: the auth fast path is broken.
 * Do not skip it. The failure mode is silent in production — nothing
 * errors, the site just serves every request from GoTrue until the rate
 * limit is hit and everyone gets logged out.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

// ── Helpers ───────────────────────────────────────────────────────────────

const b64u = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const SUPABASE_URL = 'https://kuklfnapbkmacvwxktbh.supabase.co';
const ISS = `${SUPABASE_URL}/auth/v1`;
const KID = 'test-signing-key';

/** Generate an ES256 keypair and a matching JWKS entry. */
async function makeKeys(kid = KID) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, alg: 'ES256', use: 'sig', kid }] },
  };
}

/** Mint a real, correctly-signed ES256 JWT. */
async function mintToken(privateKey, claims = {}, { kid = KID, alg = 'ES256' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg, typ: 'JWT', kid }));
  const payload = b64u(
    JSON.stringify({
      sub: 'user-123',
      email: 'player@example.com',
      role: 'authenticated',
      aud: 'authenticated',
      iss: ISS,
      exp: now + 3600,
      ...claims,
    }),
  );
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64u(new Uint8Array(sig))}`;
}

/**
 * Load the vendored auth modules with a stubbed JWKS endpoint.
 *
 * Uses a cache-busting query on the import specifier so each test gets a
 * fresh module instance with an empty JWKS cache — otherwise the first
 * test's keys leak into the rest.
 *
 * CRITICAL: only NEXT_PUBLIC_SUPABASE_URL is set. SUPABASE_JWT_SECRET is
 * explicitly deleted. Production has no such variable, so neither does the
 * test — this is what catches defect #2.
 */
let _n = 0;
async function loadModules(jwks, { onJwksFetch } = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('jwks.json')) {
      if (onJwksFetch) onJwksFetch();
      return new Response(JSON.stringify(jwks), {
        headers: { 'content-type': 'application/json' },
      });
    }
    // Any other network call from the auth fast path is a bug. Surface it
    // loudly rather than letting a test silently hit the real internet.
    throw new Error(`unexpected network call in auth fast path: ${url}`);
  };

  const bust = `?t=${++_n}`;
  const serverAuth = await import(
    `../../vendor/commander-shared/src/lib/serverAuth.js${bust}`
  );
  return { serverAuth, restoreFetch: () => { globalThis.fetch = realFetch; } };
}

// ── The contract ──────────────────────────────────────────────────────────

test('verifies a genuine ES256 token signed by the current JWKS', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(privateKey);
    const payload = await serverAuth.verifySupabaseJwt(token);

    assert.ok(payload, 'ES256 token MUST verify. This is the exact assertion that would have caught the HS256 regression.');
    assert.equal(payload.sub, 'user-123');
    assert.equal(payload.role, 'authenticated');
  } finally {
    restoreFetch();
  }
});

test('getServerUser extracts the user from a Bearer header with NO env secret configured', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    assert.equal(process.env.SUPABASE_JWT_SECRET, undefined, 'test must run without a JWT secret, as production does');

    const token = await mintToken(privateKey);
    const user = await serverAuth.getServerUser({
      headers: { authorization: `Bearer ${token}` },
    });

    assert.ok(user, 'local verification MUST work with no SUPABASE_JWT_SECRET set');
    assert.equal(user.id, 'user-123');
    assert.equal(user.email, 'player@example.com');
  } finally {
    restoreFetch();
  }
});

test('edge-runtime style Request headers are supported', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(privateKey);
    const user = await serverAuth.getServerUser({
      headers: new Headers({ authorization: `Bearer ${token}` }),
    });
    assert.equal(user?.id, 'user-123');
  } finally {
    restoreFetch();
  }
});

test('the fast path does NOT call GoTrue for a valid token', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(privateKey);

    let goTrueCalls = 0;
    const supabase = {
      auth: {
        async getUser() {
          goTrueCalls += 1;
          return { data: { user: null }, error: new Error('must not run') };
        },
      },
    };

    const result = await serverAuth.getServerUserWithFallback(
      { headers: { authorization: `Bearer ${token}` } },
      supabase,
    );

    assert.equal(result.user?.id, 'user-123');
    assert.equal(
      goTrueCalls,
      0,
      'A valid token reached GoTrue. This is the 20M-requests/24h outage signature.',
    );
  } finally {
    restoreFetch();
  }
});

test('JWKS is fetched once and cached across many verifications', async () => {
  const { privateKey, jwks } = await makeKeys();
  let fetches = 0;
  const { serverAuth, restoreFetch } = await loadModules(jwks, {
    onJwksFetch: () => { fetches += 1; },
  });
  try {
    const token = await mintToken(privateKey);
    for (let i = 0; i < 50; i++) {
      const u = await serverAuth.getServerUser({ headers: { authorization: `Bearer ${token}` } });
      assert.ok(u, `verification ${i} failed`);
    }
    assert.equal(fetches, 1, `50 verifications caused ${fetches} JWKS fetches; expected 1 (cache is broken)`);
  } finally {
    restoreFetch();
  }
});

test('an unknown kid triggers exactly one refetch, not one per request', async () => {
  const { privateKey, jwks } = await makeKeys('rotated-in-key');
  // Serve a JWKS that does NOT contain the token's kid on the first fetch,
  // then the correct one — simulating a signing-key rotation.
  let fetches = 0;
  const { serverAuth, restoreFetch } = await loadModules(jwks, {
    onJwksFetch: () => { fetches += 1; },
  });
  try {
    const token = await mintToken(privateKey, {}, { kid: 'kid-not-in-jwks' });
    // 5 requests carrying an unresolvable kid.
    for (let i = 0; i < 5; i++) {
      await serverAuth.verifySupabaseJwt(token);
    }
    assert.ok(
      fetches <= 2,
      `an unresolvable kid caused ${fetches} JWKS fetches across 5 requests; the refetch cooldown is not working and a bogus token could stampede the JWKS endpoint`,
    );
  } finally {
    restoreFetch();
  }
});

// ── Security: these must all fail closed ──────────────────────────────────

test('rejects a tampered payload', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(privateKey);
    const [h, , s] = token.split('.');
    const forged = b64u(JSON.stringify({ sub: 'attacker', aud: 'authenticated', iss: ISS, exp: Math.floor(Date.now() / 1000) + 3600 }));
    assert.equal(await serverAuth.verifySupabaseJwt(`${h}.${forged}.${s}`), null);
  } finally {
    restoreFetch();
  }
});

test('rejects alg=none', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(privateKey);
    const [, p] = token.split('.');
    const noneHeader = b64u(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID }));
    assert.equal(await serverAuth.verifySupabaseJwt(`${noneHeader}.${p}.`), null);
  } finally {
    restoreFetch();
  }
});

test('rejects an expired token', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const expired = await mintToken(privateKey, { exp: Math.floor(Date.now() / 1000) - 10 });
    assert.equal(await serverAuth.verifySupabaseJwt(expired), null);
  } finally {
    restoreFetch();
  }
});

test('rejects a token from a foreign issuer', async () => {
  const { privateKey, jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const foreign = await mintToken(privateKey, { iss: 'https://evil.example/auth/v1' });
    assert.equal(await serverAuth.verifySupabaseJwt(foreign), null);
  } finally {
    restoreFetch();
  }
});

test('rejects a token signed by a key that is not in the JWKS', async () => {
  const { jwks } = await makeKeys();
  const attacker = await makeKeys(); // different keypair, same kid
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    const token = await mintToken(attacker.privateKey);
    assert.equal(
      await serverAuth.verifySupabaseJwt(token),
      null,
      'a token signed by an unknown key was accepted — signature verification is not running',
    );
  } finally {
    restoreFetch();
  }
});

test('rejects malformed input without throwing', async () => {
  const { jwks } = await makeKeys();
  const { serverAuth, restoreFetch } = await loadModules(jwks);
  try {
    for (const bad of [null, undefined, '', 'not.a.jwt', 'a.b', 'a.b.c.d', 123, {}]) {
      assert.equal(await serverAuth.verifySupabaseJwt(bad), null, `did not reject: ${String(bad)}`);
    }
  } finally {
    restoreFetch();
  }
});

// ── Structural guards: catch the regression at the source ─────────────────

test('the vendored verifier does not reintroduce a symmetric-algorithm gate', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../../vendor/commander-shared/src/lib/serverAuth.js', import.meta.url),
    'utf8',
  );
  // Strip comments — the post-mortem comments legitimately mention HS256.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  assert.ok(
    !/['"]HS256['"]/.test(code),
    "vendor/.../serverAuth.js references 'HS256' in executable code. The project signs with ES256; a symmetric gate here silently routes 100% of traffic to GoTrue.",
  );
  assert.ok(
    !/HMAC/.test(code),
    'vendor/.../serverAuth.js references HMAC in executable code — symmetric verification has been reintroduced.',
  );
});

test('supabaseServerClient does not gate local verification behind an env secret', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(
    new URL('../../vendor/commander-shared/src/lib/supabaseServerClient.js', import.meta.url),
    'utf8',
  );
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  assert.ok(
    !/SUPABASE_JWT_SECRET/.test(code),
    'supabaseServerClient.js reads SUPABASE_JWT_SECRET again. That variable does not exist in any environment, so this short-circuits local verification to null and sends every request to GoTrue — the exact 2026-09-01 outage.',
  );
});

test('decodeSupabaseJWT verifies a real token with no environment configured', async () => {
  const { privateKey, jwks } = await makeKeys();
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  delete process.env.SUPABASE_JWT_SECRET;

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes('jwks.json')) {
      return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected network call: ${url}`);
  };

  try {
    const bust = `?t=${++_n}`;
    const { decodeSupabaseJWT } = await import(
      `../../vendor/commander-shared/src/lib/supabaseServerClient.js${bust}`
    );
    const token = await mintToken(privateKey);
    const user = await decodeSupabaseJWT(token);

    assert.ok(
      user,
      'decodeSupabaseJWT returned null for a valid ES256 token. Every file importing this module is falling through to GoTrue.',
    );
    assert.equal(user.id, 'user-123');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── Drift detector (network; skipped when unreachable) ────────────────────

test('the live JWKS still serves algorithms this verifier accepts', async (t) => {
  const url = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  let body;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return t.skip(`JWKS endpoint returned ${res.status}`);
    body = await res.json();
  } catch (e) {
    // Offline CI / sandboxed build — not a failure, but say so out loud.
    return t.skip(`JWKS unreachable (${e?.message || e}); drift check skipped`);
  }

  assert.ok(Array.isArray(body?.keys) && body.keys.length > 0, 'live JWKS has no keys');

  const algs = new Set(body.keys.map((k) => k.alg));
  assert.ok(
    algs.has('ES256'),
    `Live JWKS serves [${[...algs].join(', ')}] but the verifier only accepts ES256. The signing algorithm was changed without updating vendor/.../serverAuth.js — this is the 2026-09-01 outage repeating.`,
  );
});
