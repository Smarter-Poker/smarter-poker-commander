/**
 * Sentry Client Configuration — Commander
 * Phase 3.2 scaffold completion (2026-04-27)
 */

import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',

    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    enabled: process.env.NODE_ENV === 'production',

    // Inherit World Hub's filter list — same browser noise applies to commander.
    ignoreErrors: [
      'top.GLOBALS',
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      'Network Error',
      'Failed to fetch',
      'Load failed',
      'Non-Error promise rejection',
      'AbortError',
      'signal is aborted without reason',
      'signal is aborted',
      'The operation was aborted',
      'The user aborted a request',
      'UnknownError: Internal error',
      'Internal error',
      'Invariant: attempted to hard navigate to the same URL',
    ],

    beforeSend(event, hint) {
      const error = hint?.originalException;

      if (error && typeof error === 'object') {
        if ('name' in error && String(error.name) === 'AbortError') return null;
        if ('message' in error) {
          const msg = String(error.message);
          if (msg.includes('signal is aborted') || msg.includes('aborted')) return null;
          if (msg.includes('Internal error')) return null;
        }
        if ('stack' in error) {
          const stack = String(error.stack);
          if (stack.includes('chrome-extension://') || stack.includes('moz-extension://')) return null;
        }
      }

      if (event.request?.url) {
        event.request.url = event.request.url.replace(/token=[^&]+/g, 'token=REDACTED');
      }
      if (event.request?.cookies) delete event.request.cookies;
      if (event.request?.headers?.authorization) {
        event.request.headers.authorization = '[REDACTED]';
      }

      return event;
    },

    initialScope: {
      tags: {
        app: 'commander',
        runtime: 'client',
      },
    },
  });

  console.log('Sentry initialized (commander client)');
}
