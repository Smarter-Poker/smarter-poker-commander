/**
 * GET /api/health
 * Health check endpoint for smarter-poker-commander.
 * Returns service name, status, and uptime metadata.
 */

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(200).json({
    status: 'ok',
    service: 'smarter-poker-commander',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.substring(0, 8) ?? 'local',
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
    timestamp: new Date().toISOString(),
  });
}
