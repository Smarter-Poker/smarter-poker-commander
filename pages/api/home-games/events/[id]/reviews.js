/**
 * Home Game Reviews API
 * GET /api/commander/home-games/events/:id/reviews
 * POST /api/commander/home-games/events/:id/reviews
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

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


    let userObj = null;
    if (req.method !== "GET") { 
      userObj = await guardUser(req, res); 
      if (!userObj) return; 
    }
    const { id } = req.query;

    if (req.method === 'GET') {
      return handleGet(req, res, id);
    } else if (req.method === 'POST') {
      return handleCreate(req, res, id, userObj);
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

async function handleGet(req, res, eventId) {
  try {
    const { data: reviews, error } = await getSupabase()
      .from('commander_home_game_reviews')
      .select(`
        *,
        profiles:reviewer_id (id, display_name, avatar_url)
      `)
      .eq('game_id', eventId)
      .order('created_at', { ascending: false })
          .limit(100);

    if (error) throw error;

    // Calculate average rating
    const avgRating = reviews?.length
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        reviews: reviews || [],
        average_rating: Math.round(avgRating * 10) / 10,
        total_reviews: reviews?.length || 0
      }
    });
  } catch (error) {
    console.warn('Get reviews error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch reviews' }
    });
  }
}

async function handleCreate(req, res, eventId, _user) {
  const { rating, comment } = req.body;
  const player_id = _user.id;

  if (!rating) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'rating required' }
    });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_RATING', message: 'Rating must be 1-5' }
    });
  }

  try {
    // Check if already reviewed
    const { data: existing } = await getSupabase()
      .from('commander_home_game_reviews')
      .select('id')
      .eq('game_id', eventId)
      .eq('reviewer_id', player_id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_REVIEWED', message: 'Already reviewed this game' }
      });
    }

    // Check if player attended. NOTE: commander_home_rsvps has a `user_id`
    // column, not `player_id`. Prior code used `.eq('player_id', ...)`, which
    // PostgREST rejected with 42703 undefined_column. The destructured
    // `error` was silently ignored and `rsvp` was always null, so EVERY
    // review submission short-circuited to 403 NOT_ATTENDED. This is why
    // nobody has been able to leave a home-game review in production.
    const { data: rsvp, error: rsvpErr } = await getSupabase()
      .from('commander_home_rsvps')
      .select('response, is_confirmed')
      .eq('game_id', eventId)
      .eq('user_id', player_id)
      .maybeSingle();

    if (rsvpErr) {
      console.warn('Reviews: RSVP attendance check failed:', rsvpErr);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Attendance check failed' }
      });
    }

    if (!rsvp || rsvp.response !== 'yes') {
      return res.status(403).json({
        success: false,
        error: { code: 'NOT_ATTENDED', message: 'Must attend game to review' }
      });
    }

    // Live schema (information_schema verified): the column is review_text;
    // there is no `comment` or `is_anonymous` column on
    // commander_home_game_reviews.
    const { data: review, error } = await getSupabase()
      .from('commander_home_game_reviews')
      .insert({
        game_id: eventId,
        reviewer_id: player_id,
        rating,
        review_text: comment
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Award XP for leaving a review (10 XP)
    // XP system removed

    return res.status(201).json({
      success: true,
      // Keep the historical API response shape: clients read `comment`.
      data: { review: review ? { ...review, comment: review.review_text } : review }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create review error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create review' }
    });
  }
}
