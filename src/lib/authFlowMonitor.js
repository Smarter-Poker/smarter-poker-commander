/** Browser-local auth failure diagnostics. Never sends events to a service. */
function report(name, level, tags, extra) {
  try {
    const log = level === 'warning' ? console.warn : console.error;
    // Limit logged fields to flow and path; no session, user, URL query or form data.
    log.call(console, name, { flow: tags?.flow, path: extra?.path, error: extra?.error || extra?.message });
  } catch { /* Diagnostic failure cannot interrupt authentication. */ }
}

/** Called by login.js / sso.js when completion fails after auth succeeded. */
export function reportLoginFailure(flow, error, extra = {}) {
  report('commander.auth.login_failed', 'error', { flow }, {
    error: typeof error === 'string' ? error : error?.message || String(error),
    ...extra,
  });
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
