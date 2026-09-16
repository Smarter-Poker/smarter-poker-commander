/** Local error diagnostics and existing venue health metrics. */

/**
 * Capture an exception
 */
export function captureException(error, context = {}) {
  console.warn('Error captured:', error.message, context);

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
