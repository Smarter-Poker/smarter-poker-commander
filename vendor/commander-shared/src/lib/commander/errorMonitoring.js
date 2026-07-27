/**
 * Error Monitoring Utilities
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * Sentry integration and error tracking
 */

// Sentry initialization (optional - configure if SENTRY_DSN is set)
let Sentry = null;

export async function initErrorMonitoring() {
  if (process.env.SENTRY_DSN) {
    try {
      const sentryModule = '@sentry/nextjs';
      Sentry = await import(/* webpackIgnore: true */ sentryModule);
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
        beforeSend(event) {
          // Scrub sensitive data
          if (event.request?.headers) {
            delete event.request.headers.authorization;
            delete event.request.headers.cookie;
          }
          return event;
        }
      });
      console.debug('Sentry initialized');
    } catch (err) {
      console.warn('Sentry not available:', err.message);
    }
  }
}

/**
 * Capture an exception
 */
export function captureException(error, context = {}) {
  console.warn('Error captured:', error.message, context);

  if (Sentry) {
    Sentry.withScope(scope => {
      if (context.user) {
        scope.setUser({ id: context.user.id, email: context.user.email });
      }
      if (context.venue_id) {
        scope.setTag('venue_id', context.venue_id);
      }
      if (context.action) {
        scope.setTag('action', context.action);
      }
      if (context.extra) {
        scope.setExtras(context.extra);
      }
      Sentry.captureException(error);
    });
  }

  // Also log to system health if venue context is available
  if (context.venue_id) {
    recordErrorMetric(context.venue_id, error, context);
  }

  return error;
}

/**
 * Capture a message
 */
export function captureMessage(message, level = 'info', context = {}) {
  console.debug(`[${level.toUpperCase()}] ${message}`, context);

  if (Sentry) {
    Sentry.withScope(scope => {
      if (context.venue_id) {
        scope.setTag('venue_id', context.venue_id);
      }
      if (context.extra) {
        scope.setExtras(context.extra);
      }
      Sentry.captureMessage(message, level);
    });
  }
}

/**
 * Set user context for error tracking
 */
export function setUserContext(user) {
  if (Sentry && user) {
    Sentry.setUser({
      id: user.id,
      email: user.email,
      username: user.display_name
    });
  }
}

/**
 * Clear user context
 */
export function clearUserContext() {
  if (Sentry) {
    Sentry.setUser(null);
  }
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(message, category = 'default', data = {}) {
  if (Sentry) {
    Sentry.addBreadcrumb({
      message,
      category,
      data,
      level: 'info'
    });
  }
}

/**
 * Record error metric to system health
 */
async function recordErrorMetric(venueId, error, context = {}) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.rpc('record_health_metric', {
      p_venue_id: parseInt(venueId),
      p_metric_type: 'error_rate',
      p_metric_value: 1,
      p_metric_unit: 'count',
      p_endpoint: context.endpoint || null,
      p_details: {
        error_message: error.message,
        error_name: error.name,
        action: context.action
      }
    });
  } catch (err) { console.warn('[App] Handled exception:', err?.message || err); }
}

/**
 * Performance monitoring wrapper
 */
export function withPerformanceMonitoring(handler, operationName) {
  return async (req, res) => {
    const startTime = Date.now();

    try {
      const result = await handler(req, res);

      // Record latency
      const duration = Date.now() - startTime;
      if (duration > 1000) {
        captureMessage(`Slow operation: ${operationName}`, 'warning', {
          extra: { duration, url: req.url }
        });
      }

      return result;
    } catch (error) {
      captureException(error, {
        action: operationName,
        extra: { url: req.url, method: req.method }
      });
      throw error;
    }
  };
}

/**
 * API error handler wrapper
 */
export function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      captureException(error, {
        extra: {
          url: req.url,
          method: req.method,
          query: req.query,
          body: req.body ? JSON.stringify(req.body).substring(0, 500) : null
        }
      });

      // Don't expose internal errors to clients
      const statusCode = error.statusCode || 500;
      const message = statusCode === 500
        ? 'An unexpected error occurred'
        : error.message;

      return res.status(statusCode).json({
        error: message,
        code: error.code || 'INTERNAL_ERROR'
      });
    }
  };
}
