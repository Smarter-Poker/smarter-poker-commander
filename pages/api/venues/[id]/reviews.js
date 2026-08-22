/**
 * Venue Reviews API
 * GET /api/commander/venues/[id]/reviews - List reviews
 * POST /api/commander/venues/[id]/reviews - Submit a review
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    try {
      const { id } = req.query;

      if (req.method === 'GET') {
        // Public access - no auth required
        const { sort = 'recent', limit = 20, offset = 0 } = req.query;

        // NOTE: commander_venue_reviews.reviewer_id has no FK to profiles, so a
        // PostgREST embed (`reviewer:reviewer_id (...)`) errors and 500s. Select
        // the review rows directly and join reviewer profiles in a second query.
        let query = getSupabase()
          .from('commander_venue_reviews')
          .select('*', { count: 'exact' })
          .eq('venue_id', id)
          .eq('is_published', true)
              .limit(100);

        if (sort === 'helpful') {
          query = query.order('helpful_count', { ascending: false })
              .limit(100);
        } else if (sort === 'rating_high') {
          query = query.order('overall_rating', { ascending: false })
              .limit(100);
        } else if (sort === 'rating_low') {
          query = query.order('overall_rating', { ascending: true });
        } else {
          query = query.order('created_at', { ascending: false });
        }

        const { data, error, count } = await query
          .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (error) throw error;

        // Batch-load reviewer display info (public: display_name + avatar only).
        const reviewerIds = [...new Set((data || []).map(r => r.reviewer_id).filter(Boolean))];
        const reviewerMap = {};
        if (reviewerIds.length > 0) {
          const { data: reviewers } = await getSupabase()
            .from('profiles')
            .select('id, display_name, avatar_url')
            .in('id', reviewerIds);
          (reviewers || []).forEach(p => { reviewerMap[p.id] = p; });
        }

        const reviews = (data || []).map(r => ({
          ...r,
          reviewer: reviewerMap[r.reviewer_id] || null
        }));

        return res.status(200).json({
          success: true,
          data: {
            reviews,
            total: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
          }
        });
      }

      if (req.method === 'POST') {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({
            success: false,
            error: { code: 'AUTH_REQUIRED', message: 'Login required to submit review' }
          });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
        const user = authData?.user;

        if (authError || !user) {
          return res.status(401).json({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
          });
        }

        const {
          overall_rating,
          game_selection_rating,
          staff_rating,
          atmosphere_rating,
          food_rating,
          title,
          content,
          visit_date,
          games_played
        } = req.body;

        if (!overall_rating || overall_rating < 1 || overall_rating > 5) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_RATING', message: 'Overall rating (1-5) required' }
          });
        }

        // Check if user already reviewed this venue
        const { data: existing } = await getSupabase()
          .from('commander_venue_reviews')
          .select('id')
          .eq('venue_id', id)
          .eq('reviewer_id', user.id)
          .maybeSingle();

        if (existing) {
          // Update existing review
          const { data, error } = await getSupabase()
            .from('commander_venue_reviews')
            .update({
              overall_rating,
              game_selection_rating,
              staff_rating,
              atmosphere_rating,
              food_rating,
              title,
              content,
              visit_date,
              games_played,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id)
            .select()
            .maybeSingle();

          if (error) throw error;

          return res.status(200).json({
            success: true,
            data: { review: data, updated: true }
          });
        }

        // Create new review
        const { data, error } = await getSupabase()
          .from('commander_venue_reviews')
          .insert({
            venue_id: id,
            reviewer_id: user.id,
            overall_rating,
            game_selection_rating,
            staff_rating,
            atmosphere_rating,
            food_rating,
            title,
            content,
            visit_date,
            games_played,
            is_published: true
          })
          .select()
          .maybeSingle();

        if (error) throw error;

        // Update venue review count and rating
        const { data: allReviews } = await getSupabase()
          .from('commander_venue_reviews')
          .select('overall_rating')
          .eq('venue_id', id)
          .eq('is_published', true);

        if (allReviews && allReviews.length > 0) {
          const avgRating = allReviews.reduce((sum, r) => sum + r.overall_rating, 0) / allReviews.length;
          await getSupabase()
            .from('poker_venues')
            .update({
              trust_score: parseFloat(avgRating.toFixed(1))
            })
            .eq('id', id);
        }

        return res.status(201).json({
          success: true,
          data: { review: data }
        });
      }

      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST allowed' }
      });
    } catch (error) {
      console.warn('Venue reviews API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to process request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
