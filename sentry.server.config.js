/**
 * Sentry Server Configuration — Commander
 * Phase 3.2 scaffold completion (2026-04-27)
 *
 * Mirrors World Hub's sentry.server.config.js pattern but tagged
 * app: 'commander' so Sentry events from this service are filterable.
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Only enable in production
    enabled: process.env.NODE_ENV === 'production',

    // Before sending, scrub sensitive data
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      // Strip PIN session cookie if it leaks into a body or URL
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /commander_admin_session=[^;&]+/g,
          'commander_admin_session=REDACTED'
        );
      }
      return event;
    },

    initialScope: {
      tags: {
        app: 'commander',
        runtime: 'server',
      },
    },
  });

  console.log('Sentry initialized (commander server)');
}
