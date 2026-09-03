/**
 * Next.js server instrumentation - runs once per server/edge boot.
 *
 * [2026-09-03] Without withSentryConfig (not used here - see pages/_app.js),
 * sentry.server.config.js and sentry.edge.config.js were never imported, so
 * API-route errors reported via reportApiError() went nowhere. Next 14 loads
 * this file when `experimental.instrumentationHook` is on (next.config.js).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}
