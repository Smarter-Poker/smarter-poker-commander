/**
 * Player Profile API
 * GET /api/commander/profile - Get current player's commander profile
 * PATCH /api/commander/profile - Update profile
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: PLAYER - verified Bearer user (own profile only)
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' }
      });
    }

    // 2026-07-25 audit fix: removed guardOwnerStaff gate on writes - this is the
    // player's own profile endpoint; the verified Bearer user above is sufficient
    // and the handler only writes that user's rows.

    if (req.method === 'GET') {
      return getProfile(req, res, user);
    } else if (req.method === 'PATCH') {
      return updateProfile(req, res, user);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getProfile(req, res, user) {
  try {
    // Get base profile
    const { data: profile, error: profileError } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile) {
      return res.status(404).json({
        success: false,
        error: { code: 'PROFILE_NOT_FOUND', message: 'Profile not found' }
      });
    }

    // Get player preferences
    const { data: preferences } = await getSupabase()
      .from('commander_player_preferences')
      .select('*')
      .eq('player_id', user.id)
      .maybeSingle();

    // Get favorite venues (venues where player has sessions)
    const { data: sessions } = await getSupabase()
      .from('commander_player_sessions')
      .select(`
        venue_id,
        poker_venues (id, name, city, state)
      `)
      .eq('player_id', user.id)
      .order('check_in_at', { ascending: false })
      .limit(10);

    // Count unique venues
    const venueMap = new Map();
    sessions?.forEach(s => {
      if (s.poker_venues && !venueMap.has(s.venue_id)) {
        venueMap.set(s.venue_id, s.poker_venues);
      }
    });
    const favoriteVenues = Array.from(venueMap.values()).slice(0, 5);

    // Get achievements (simplified - based on session counts)
    const { count: sessionCount } = await getSupabase()
      .from('commander_player_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('player_id', user.id)
          .limit(100)

    const achievements = [];
    if (sessionCount >= 1) achievements.push({ id: 'first_session', name: 'First Session', icon: 'trophy' });
    if (sessionCount >= 10) achievements.push({ id: 'regular', name: 'Regular', icon: 'star' });
    if (sessionCount >= 50) achievements.push({ id: 'veteran', name: 'Veteran', icon: 'award' });
    if (sessionCount >= 100) achievements.push({ id: 'legend', name: 'Legend', icon: 'crown' });

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          ...profile,
          preferences: preferences || null,
          favorite_venues: favoriteVenues,
          achievements
        }
      }
    });
  } catch (error) {
    console.warn('Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch profile' }
    });
  }
}

async function updateProfile(req, res, user) {
  try {
    const { preferences, ...profileUpdates } = req.body;

    // Update profile if there are updates
    if (Object.keys(profileUpdates || {}).length > 0) {
      const { error: profileError } = await getSupabase()
        .from('profiles')
        .update(profileUpdates)
        .eq('id', user.id);

      if (profileError) throw profileError;
    }

    // Update preferences if provided
    if (preferences) {
      const { error: prefError } = await getSupabase()
        .from('commander_player_preferences')
        .upsert({
          player_id: user.id,
          ...preferences,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'player_id'
        });

      if (prefError) throw prefError;
    }

    return res.status(200).json({
      success: true,
      data: { updated: true }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Update profile error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update profile' }
    });
  }
}
