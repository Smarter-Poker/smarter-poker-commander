/**
 * Auth-flow monitor - turns the login/session events the app already emits
 * into Sentry signals with STABLE tags, so alert rules can be written against
 * them instead of against free-text messages.
 *
 * Tags (all events):   app=commander  flow=<login|sso|session>
 * Event names:
 *   commander.auth.unauthorized   a 401 that refreshStaffSession could NOT heal
 *                                 (the platform session is gone, or no subscription)
 *   commander.auth.login_failed   completeCommanderLogin / SSO exchange failed
 *                                 after Supabase accepted the user
 *   commander.auth.reference_error a ReferenceError anywhere under /commander/login
 *                                 or /auth/sso - the 2026-09-03 outage class
 *
 * Alert rules to create in Sentry (documented in docs/runbooks/sentry-auth-alerts.md):
 *   1. message:"commander.auth.reference_error"  count >= 1  in 5 min  -> page
 *   2. message:"commander.auth.login_failed"     count >= 5  in 10 min -> page
 *   3. message:"commander.auth.unauthorized"     count >= 20 in 10 min -> warn
 *
 * Never throws; never blocks the flow it observes.
 */
import * as Sentry from '@sentry/nextjs';

function report(name, level, tags, extra) {
  try {
    Sentry.withScope((scope) => {
      scope.setTag('app', 'commander');
      Object.entries(tags || {}).forEach(([k, v]) => scope.setTag(k, String(v)));
      Object.entries(extra || {}).forEach(([k, v]) => scope.setExtra(k, v));
      scope.setLevel(level);
      Sentry.captureMessage(name, level);
    });
  } catch { /* observability must never break the app */ }
}

/** Called by login.js / sso.js when completion fails after auth succeeded. */
export function reportLoginFailure(flow, error, extra = {}) {
  report('commander.auth.login_failed', 'error', { flow }, {
    error: typeof error === 'string' ? error : error?.message || String(error),
    ...extra,
  });
  try {
    if (error instanceof Error) {
      Sentry.withScope((scope) => {
        scope.setTag('app', 'commander');
        scope.setTag('flow', flow);
        Sentry.captureException(error);
      });
    }
  } catch { /* ignore */ }
}

/**
 * Installed once from _app. Listens for the events the auth stack emits and
 * for ReferenceErrors on the auth pages. Returns a cleanup function.
 */
export function installAuthFlowMonitor() {
  if (typeof window === 'undefined') return () => {};

  const onUnauthorized = (e) => {
    report('commander.auth.unauthorized', 'warning', { flow: 'session' }, {
      url: e?.detail?.url, path: window.location.pathname,
    });
  };

  const onError = (e) => {
    const err = e?.error;
    const onAuthPage = /^\/(commander\/login|auth\/sso)/.test(window.location.pathname);
    if (onAuthPage && err && err.name === 'ReferenceError') {
      report('commander.auth.reference_error', 'fatal', { flow: window.location.pathname.includes('sso') ? 'sso' : 'login' }, {
        message: err.message, path: window.location.pathname,
      });
      try { Sentry.captureException(err); } catch { /* ignore */ }
    }
  };
  const onRejection = (e) => {
    const err = e?.reason;
    const onAuthPage = /^\/(commander\/login|auth\/sso)/.test(window.location.pathname);
    if (onAuthPage && err && err.name === 'ReferenceError') onError({ error: err });
  };

  window.addEventListener('commander:unauthorized', onUnauthorized);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('commander:unauthorized', onUnauthorized);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
