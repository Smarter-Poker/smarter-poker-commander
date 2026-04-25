/**
 * Commander Venues API - GET /api/commander/venues
 * Lists venues with live game counts, waitlist data, and filter support
 * Reference: API_REFERENCE.md - Venues section
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
/** Escape SQL LIKE wildcards */
function escapeIlike(s) { return (s || '').replace(/[%_\\]/g, c => '\\' + c); }

// Haversine formula for distance calculation (km)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      const {
        filter,
        commander_enabled,
        state,
        city,
        lat,
        lng,
        radius = 100,
        limit = 50
      } = req.query;

      let query = getSupabase()
        .from('poker_venues')
        .select('*')
        .eq('is_active', true)
        .order('trust_score', { ascending: false })
        .limit(Math.min(parseInt(limit) || 50, 500));

      // Only filter by commander_enabled if explicitly set to 'true'
      if (commander_enabled === 'true') {
        query = query.eq('commander_enabled', true);
      }

      if (state) {
        query = query.eq('state', state.toUpperCase());
      }

      if (city) {
        query = query.ilike('city', `%${escapeIlike(city)}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Commander venues query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch venues' }
        });
      }

      let venues = data || [];

      // Fetch active games for all venues in one query
      const { data: activeGames } = await getSupabase()
        .from('commander_games')
        .select('venue_id, game_type, stakes, status')
        .in('status', ['running', 'waiting'])
            .limit(100)

      // Fetch waitlist counts in one query
      const { data: waitlistEntries } = await getSupabase()
        .from('commander_waitlist')
        .select('venue_id')
        .eq('status', 'waiting')

      // Build lookup maps
      const gamesByVenue = {};
      (activeGames || []).forEach(game => {
        const vid = game.venue_id;
        if (!gamesByVenue[vid]) gamesByVenue[vid] = [];
        gamesByVenue[vid].push(game);
      });

      const waitlistByVenue = {};
      (waitlistEntries || []).forEach(entry => {
        waitlistByVenue[entry.venue_id] = (waitlistByVenue[entry.venue_id] || 0) + 1;
      });

      // Enrich venues with computed fields
      let enrichedVenues = venues.map(venue => {
        const venueGames = gamesByVenue[venue.id] || [];
        const runningGames = venueGames.filter(g => g.status === 'running');
        const stakes = [...new Set(venueGames.map(g => g.stakes).filter(Boolean))];

        return {
          ...venue,
          active_games: runningGames.length,
          waitlist_count: waitlistByVenue[venue.id] || 0,
          stakes_spread: stakes,
          rating: venue.trust_score ? parseFloat(venue.trust_score) : null
        };
      });

      // Apply filter param
      if (filter === 'live') {
        enrichedVenues = enrichedVenues.filter(v => v.active_games > 0);
      }

      // GPS-based distance calculation and filtering
      if (lat && lng) {
        const userLat = parseFloat(lat);
        const userLng = parseFloat(lng);
        const maxRadius = parseFloat(radius);

        // Skip geo-filtering if coordinates are invalid
        if (isNaN(userLat) || isNaN(userLng)) {
          // Continue without geo-filtering
        } else {
        enrichedVenues = enrichedVenues.map(venue => {
          const vLat = venue.latitude || venue.lat;
          const vLng = venue.longitude || venue.lng;
          if (vLat && vLng) {
            const distance = calculateDistance(userLat, userLng, parseFloat(vLat), parseFloat(vLng));
            return {
              ...venue,
              distance_km: Math.round(distance * 10) / 10,
              distance_mi: Math.round(distance * 0.621371 * 10) / 10
            };
          }
          return venue;
        });

        // Filter by radius
        enrichedVenues = enrichedVenues.filter(v => !v.distance_km || v.distance_km <= (isNaN(maxRadius) ? 100 : maxRadius));
        }
      }

      // Sort nearby by distance
      if (filter === 'nearby' || (lat && lng)) {
        enrichedVenues.sort((a, b) => (a.distance_km || 999) - (b.distance_km || 999));
      }

      return res.status(200).json({
        success: true,
        data: {
          venues: enrichedVenues,
          total: enrichedVenues.length
        }
      });
    } catch (error) {
      console.warn('Commander venues API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
