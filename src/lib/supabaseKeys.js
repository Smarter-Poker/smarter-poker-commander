/**
 * SUPABASE API KEY RESOLUTION - Commander App
 * ---------------------------------------------------------------------------
 * Copied from Smarter-Poker-World-Hub/src/lib/supabaseKeys.js (2026-08-16).
 *
 * 2026-08-16 00:38:16 UTC: the legacy JWT API keys (`anon`, `service_role`)
 * were disabled on project kuklfnapbkmacvwxktbh. Every request carrying one
 * now comes back:
 *
 *     {"message":"Legacy API keys are disabled",
 *      "hint":"...disabled on 2026-08-16T00:38:16.61147+00:00. Re-enable them
 *              in the Supabase dashboard, or use the new publishable/secret keys."}
 *
 * The Commander app's NEXT_PUBLIC_SUPABASE_ANON_KEY env var on Vercel still
 * holds the legacy JWT, so this file provides the same resolveAnonKey()
 * guard that the main hub already has. Import resolveAnonKey() anywhere the
 * raw env var was previously used.
 *
 * REMOVE THE FALLBACK once NEXT_PUBLIC_SUPABASE_ANON_KEY holds a publishable
 * key in every environment. It exists to survive one specific outage.
 */

/**
 * Publishable key for kuklfnapbkmacvwxktbh, verified against the live REST API
 * on 2026-08-16 (HTTP 200 on /rest/v1/training_progress while the legacy anon
 * key returned "Legacy API keys are disabled" on the same request).
 */
export const SUPABASE_PUBLISHABLE_FALLBACK = 'sb_publishable__41LpJpzrfrb3hSUpEaYCA_tF53bBJx';

/** The project URL, unchanged by the key migration. */
export const SUPABASE_URL_FALLBACK = 'https://kuklfnapbkmacvwxktbh.supabase.co';

/**
 * Is this a legacy JWT-format API key (the disabled `anon` / `service_role`
 * shape) rather than a modern `sb_publishable_` / `sb_secret_` key?
 *
 * Matched on structure, not on the specific key, so a legacy key from any
 * project or era is recognised. Three dot-separated base64url segments with
 * the `eyJ` header prefix is a JWT and nothing else is.
 */
export function isLegacyJwtKey(key) {
    const k = String(key || '').trim();
    return /^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k);
}

/** Is this one of the modern key formats? */
export function isModernKey(key) {
    return /^sb_(publishable|secret)_/.test(String(key || '').trim());
}

/**
 * Resolve the browser-facing Supabase key.
 *
 * @param {string|undefined} configured  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 * @returns {{key: string, source: 'env'|'fallback-legacy'|'fallback-missing'}}
 *
 * `.trim()` is load-bearing: Vercel production env values carry a literal
 * trailing newline, and a newline inside an `apikey` header throws
 * "Invalid header value" rather than returning a clean 401.
 */
export function resolveAnonKey(configured) {
    const k = String(configured || '').trim();
    if (!k) return { key: SUPABASE_PUBLISHABLE_FALLBACK, source: 'fallback-missing' };
    if (isLegacyJwtKey(k)) return { key: SUPABASE_PUBLISHABLE_FALLBACK, source: 'fallback-legacy' };
    return { key: k, source: 'env' };
}

/**
 * One-line explanation of a resolution, for a startup warning. Returns null
 * when the configured value was used, so the healthy path stays silent.
 */
export function anonKeyWarning(source) {
    if (source === 'fallback-legacy') {
        return '[Commander/Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY holds a LEGACY JWT key, which was '
            + 'disabled on this project 2026-08-16. Falling back to the publishable key so the '
            + 'client keeps working. Update the env var to the sb_publishable_ key and redeploy.';
    }
    if (source === 'fallback-missing') {
        return '[Commander/Supabase] NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Using the publishable '
            + 'fallback. Set the env var and redeploy.';
    }
    return null;
}
