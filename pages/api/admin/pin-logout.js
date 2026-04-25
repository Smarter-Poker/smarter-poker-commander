/**
 * POST /api/admin/pin-logout
 *
 * Clear the commander_admin_session cookie. Called by the admin
 * UI's logout button.
 */
import { buildLogoutCookie } from '../../../src/lib/auth/pinSession.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Set-Cookie', buildLogoutCookie());
  return res.status(200).json({ ok: true });
}
