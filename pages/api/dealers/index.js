/**
 * Dealers API - GET/POST
 * GET: List dealers for a venue
 * POST: Create a new dealer
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    if (!applyRateLimit(req, res, LIMITS.write)) return;
  }

  // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
  // without verifying anything - the dealer roster (names, employee ids, skill
  // levels) was readable for any venue_id. venue_id is now checked against the
  // caller's staff session on both methods.
  const _g = await guardStaff(req, res); if (!_g) return;

  const { venue_id } = req.query;
  const _staffVenueId = (_g && _g.venue_id !== undefined && _g.venue_id !== null) ? _g.venue_id : null;

  if (req.method === 'GET') {
    if (!venue_id) return res.status(400).json({ success: false, error: 'venue_id required' });
    if (_staffVenueId !== null && String(_staffVenueId) !== String(venue_id)) {
      return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }
    const { data, error } = await getSupabase()
      .from('commander_dealers')
      .select('*')
      .eq('venue_id', venue_id)
      .order('name')
    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { dealers: data } });
  }

  if (req.method === 'POST') {
    const { venue_id: vid, display_name, name, employee_id, skill_level, certified_games } = req.body;
    const dealerName = name || display_name;
    if (!vid || !dealerName) return res.status(400).json({ success: false, error: 'venue_id and name required' });
    if (_staffVenueId !== null && String(_staffVenueId) !== String(vid)) {
      return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }
    const { data, error } = await getSupabase()
      .from('commander_dealers')
      .insert({ venue_id: vid, name: dealerName, employee_id, skill_level, certified_games })
      .select()
      .maybeSingle();
    if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
    return res.json({ success: true, data: { dealer: data } });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[pages/api/commander/dealers/index.js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
