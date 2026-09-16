/** Local API diagnostics and error responses. No external reporting transport. */
function routeOf(req) {
  return typeof req?.url === 'string' ? req.url.split('?')[0] : 'unknown';
}

/** Logs only the error summary and route, never headers, body or user context. */
export function reportApiError(error, req) {
  try {
    console.error('[API Error]', {
      route: routeOf(req),
      method: req?.method || 'unknown',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error',
    });
  } catch { /* A broken console must not change the API response. */ }
}

/** Preserves handler results, safe production errors and already-sent responses. */
export function withApiErrorHandler(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      reportApiError(error, req);
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : error?.message || 'Internal server error',
        });
      }
      return undefined;
    }
  };
}

export default { reportApiError, withApiErrorHandler };
