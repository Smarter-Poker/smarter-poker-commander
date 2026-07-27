/**
 * Sentry API-route helper — Phase 5.1.1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Why this file exists (and `src/lib/sentry.js` doesn't do the same job):
 *   - `src/lib/sentry.js` uses a runtime-dynamic `new Function('import(...)')`
 *     to avoid hard-requiring @sentry/nextjs. That was pragmatic when Sentry
 *     was optional, but adds async overhead and hides errors from static
 *     analysis. @sentry/nextjs is now a first-class dependency, so we import
 *     it directly and keep the import synchronous on server-side.
 *   - Most of our API handlers already have a top-level
 *       } catch (err) { console.warn('[API Error]', err); res.status(500)... }
 *     block. The simplest drop-in is `reportApiError(err, req)` — one synchronous
 *     function call that Sentry fires-and-forgets.
 *   - New routes should prefer `withSentryRoute(handler)` which wraps the whole
 *     function and gives you free capture + tagged scope without boilerplate.
 *
 * Scope tags we set automatically:
 *   - route:          req.url (stripped of query)
 *   - method:         req.method
 *   - user_id:        from Bearer-decoded supabase user (if caller passes it)
 *
 * Redaction is already handled by sentry.server.config.js `beforeSend` (it
 * strips authorization + cookie headers). We never put req.body in the scope.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// Static import — @sentry/nextjs is a hard dep. Any environment without a
// Sentry DSN just short-circuits inside Sentry.init (see sentry.server.config).
// eslint-disable-next-line import/no-unresolved
import * as Sentry from '@sentry/nextjs';

/**
 * Strip query string from a Next.js req.url for cleaner route tagging.
 * "/api/club-arena/approve-cashout?foo=1" → "/api/club-arena/approve-cashout"
 */
function routeOf(req) {
    if (!req?.url) return 'unknown';
    const qIdx = req.url.indexOf('?');
    return qIdx === -1 ? req.url : req.url.slice(0, qIdx);
}

/**
 * Fire-and-forget error reporter for catch blocks in existing API routes.
 *
 *   try { ... } catch (err) {
 *     reportApiError(err, req);
 *     console.warn('[API Error]', err);
 *     return res.status(500)...;
 *   }
 *
 * @param {Error|unknown} error   The thrown value. If not an Error, we still
 *                                fire a captureMessage so we don't lose the signal.
 * @param {object}        req     Next.js request object (for route + method tags).
 * @param {object}       [extra]  { userId?, tags?, context? } — optional scope adds.
 */
export function reportApiError(error, req, extra = {}) {
    try {
        Sentry.withScope((scope) => {
            scope.setTag('route', routeOf(req));
            scope.setTag('method', req?.method || 'unknown');
            if (extra.userId) scope.setUser({ id: extra.userId });
            if (extra.tags) {
                for (const [k, v] of Object.entries(extra.tags || {})) {
                    scope.setTag(k, String(v));
                }
            }
            if (extra.context) {
                for (const [k, v] of Object.entries(extra.context || {})) {
                    scope.setExtra(k, v);
                }
            }
            if (error instanceof Error) {
                Sentry.captureException(error);
            } else {
                Sentry.captureMessage(
                    typeof error === 'string' ? error : JSON.stringify(error),
                    'error'
                );
            }
        });
    } catch (innerErr) { console.warn('[App] Handled exception:', innerErr?.message || innerErr); }
}

/**
 * Wrap a Next.js API handler so any unhandled throw is captured and a generic
 * 500 is returned. Prefer this shape for NEW routes; for existing routes with
 * bespoke catch handling, use `reportApiError()` inside the existing catch.
 *
 *   export default withSentryRoute(async function handler(req, res) { ... });
 *
 * @param {Function} handler    The route handler (may be async).
 * @param {string}  [routeName] Optional human-readable override for the `route` tag.
 */
export function withSentryRoute(handler, routeName) {
    return async (req, res) => {
        try {
            return await handler(req, res);
        } catch (err) {
            reportApiError(err, req, {
                tags: routeName ? { route_name: routeName } : undefined,
            });
            if (!res.headersSent) {
                return res.status(500).json({
                    success: false,
                    error:
                        process.env.NODE_ENV === 'production'
                            ? 'Internal server error'
                            : err?.message || 'Internal server error',
                });
            }
            return undefined;
        }
    };
}

/**
 * Convenience: add a breadcrumb at runtime. Non-throwing.
 */
export function addBreadcrumb(breadcrumb) {
    try {
        Sentry.addBreadcrumb({
            category: breadcrumb?.category || 'api',
            message: breadcrumb?.message,
            data: breadcrumb?.data,
            level: breadcrumb?.level || 'info',
        });
    } catch {
        // ignore
    }
}

export default { reportApiError, withSentryRoute, addBreadcrumb };
