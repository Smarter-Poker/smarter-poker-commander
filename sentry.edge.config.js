/**
 * Sentry Edge Runtime Configuration — Commander
 * Phase 3.2 scaffold completion (2026-04-27)
 *
 * Required because middleware.ts runs on the edge runtime; without this
 * file, middleware errors (PIN-gate enforcement, admin route guards) are
 * silently swallowed.
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
    enabled: process.env.NODE_ENV === 'production',

    initialScope: {
      tags: {
        app: 'commander',
        runtime: 'edge',
      },
    },

    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
        delete event.request.headers['x-admin-secret'];
      }
      return event;
    },
  });

  console.log('Sentry initialized (commander edge)');
}
