/**
 * A new account made here asks the same banned-network rule as every other signup.
 *
 * WHY THIS EXISTS
 * ---------------
 * 2026-11-10. Supabase Auth refuses signups from banned networks with its
 * before-user-created hook (public.fn_a_banned_network_cannot_create_an_account,
 * Club Arena migration 20261109235402). Every public signup path (email,
 * magic link, OAuth, phone) runs that hook. The admin `POST /admin/users`
 * endpoint does not: GoTrue's adminUserCreate never calls it. Registration
 * (pages/api/create-subscription.js, Path B) creates its account with
 * `auth.admin.createUser`, so without this check a banned network could
 * create an account here with a new mailbox. The email ban is a database
 * trigger and already applies to this path.
 *
 * WHICH ADDRESS
 * -------------
 * Only the address Vercel's edge sets: `x-real-ip`, else the first entry of
 * `x-vercel-forwarded-for`. Vercel overwrites both for every incoming request,
 * so a client cannot choose them. A client-sent `x-forwarded-for` is never
 * read here. A request proxied by the World Hub reaches this route from
 * Vercel, and the Hub's own firewall already denies the banned networks.
 *
 * OUTCOMES
 * --------
 * The rule says refuse: 403, nothing is created.
 * The rule cannot be asked (no address, RPC error, unexpected reply): 503,
 * nothing is created. A check that cannot run is a refusal, never a pass.
 */
export const SIGNUP_NETWORK_REFUSED = {
  error: 'Sign Up Is Not Available From This Network',
  code: 'SIGNUP_NETWORK_REFUSED',
};

export const SIGNUP_NETWORK_UNCHECKED = {
  error: 'Sign up is temporarily unavailable. Please try again shortly.',
  code: 'SIGNUP_NETWORK_UNCHECKED',
};

const first = (value) => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const address = raw.split(',')[0].trim();
  return address || null;
};

/** The client address set by Vercel's edge, or null. Never `x-forwarded-for`. */
export function signupClientAddress(headers = {}) {
  return first(headers['x-real-ip']) || first(headers['x-vercel-forwarded-for']);
}

/**
 * Returns null when the account may be created, or { status, body } to send.
 * `supabase` is the service-role client.
 */
export async function signupNetworkRefusal(supabase, headers) {
  const address = signupClientAddress(headers);
  if (!address) return { status: 503, body: SIGNUP_NETWORK_UNCHECKED };
  let data;
  let error;
  try {
    ({ data, error } = await supabase.rpc('fn_a_banned_network_cannot_create_an_account', {
      event: { metadata: { ip_address: address } },
    }));
  } catch (thrown) {
    error = thrown;
  }
  if (error || !data || typeof data !== 'object') {
    console.warn('[signup-network] rule unavailable:', error?.message || 'no reply');
    return { status: 503, body: SIGNUP_NETWORK_UNCHECKED };
  }
  if (data.error) return { status: 403, body: SIGNUP_NETWORK_REFUSED };
  return null;
}
