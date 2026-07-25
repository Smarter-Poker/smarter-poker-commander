/**
 * Player Reputation API
 * GET /api/commander/reputation?player_id=X — Get player reputation score
 * POST /api/commander/reputation — Submit a reputation review
 * GET /api/commander/reputation?venue_id=X — Get all player scores for venue
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth for write operations
    const _authResult = await guardWriteStaff(req, res);
    if (!_authResult) return;

    if (req.method === 'GET') return getReputation(req, res);
    // 2026-07-25 audit fix: pass the verified staff session so the reviewer
    // identity is derived server-side instead of trusted from the body.
    if (req.method === 'POST') return submitReview(req, res, _authResult);
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getReputation(req, res) {
  const { player_id, venue_id, limit = 20 } = req.query;

  try {
    if (player_id) {
      // Get single player score + recent reviews
      const { data: score } = await getSupabase()
        .from('commander_player_reputation_scores')
        .select('*')
        .eq('player_id', player_id)
        .maybeSingle();

      const { data: reviews } = await getSupabase()
        .from('commander_player_reputation')
        .select('reliability, sportsmanship, etiquette, communication, comment, context, reviewer_type, created_at')
        .eq('player_id', player_id)
        .order('created_at', { ascending: false })
        .limit(10);

      return res.status(200).json({
        success: true,
        data: {
          score: score || { overall_score: 0, total_reviews: 0 },
          recent_reviews: reviews || []
        }
      });
    }

    if (venue_id) {
      // Get all player scores for venue (players who have been reviewed at this venue)
      const { data: reviews } = await getSupabase()
        .from('commander_player_reputation')
        .select('player_id')
        .eq('venue_id', venue_id)
            .limit(100);

      const playerIds = [...new Set((reviews || []).map(r => r.player_id))];

      if (playerIds.length === 0) {
        return res.status(200).json({ success: true, data: { scores: [] } });
      }

      const { data: scores } = await getSupabase()
        .from('commander_player_reputation_scores')
        .select('*')
        .in('player_id', playerIds.slice(0, parseInt(limit)))
        .order('overall_score', { ascending: false })
            .limit(100);

      // Get names
      const { data: profiles } = await getSupabase()
        .from('profiles')
        .select('id, display_name, full_name')
        .in('id', playerIds.slice(0, parseInt(limit)))
        .limit(500);

      const nameMap = {};
      (profiles || []).forEach(p => { nameMap[p.id] = p.display_name || p.full_name || 'Unknown'; });

      const enriched = (scores || []).map(s => ({
        ...s,
        player_name: nameMap[s.player_id] || 'Unknown'
      }));

      return res.status(200).json({ success: true, data: { scores: enriched } });
    }

    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'player_id or venue_id required' } });
  } catch (error) {
    console.warn('Get reputation error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
  }
}

async function submitReview(req, res, staff) {
  // 2026-07-25 audit fix: reviewer_id/reviewer_type are no longer accepted from
  // the request body — any caller could impersonate another reviewer. The
  // reviewer is the verified staff session; there is no player review path in
  // this endpoint (POST is staff-gated), so reviewer_type is always 'staff'.
  const { player_id, reliability, sportsmanship, etiquette, communication, comment, context } = req.body;

  if (!player_id) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_FIELDS', message: 'player_id required' } });
  }

  // Validate ratings
  const ratings = { reliability, sportsmanship, etiquette, communication };
  for (const [name, val] of Object.entries(ratings || {})) {
    if (val !== undefined && val !== null && (val < 1 || val > 5)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_RANGE', message: `${name} must be 1-5` } });
    }
  }

  try {
    // Insert review
    const { data: review, error: reviewErr } = await getSupabase()
      .from('commander_player_reputation')
      .insert({
        player_id,
        // 2026-07-25 audit fix: identity from the verified staff session only.
        reviewer_id: staff.id,
        reviewer_type: 'staff',
        venue_id: staff.venue_id || null,
        reliability: reliability || null,
        sportsmanship: sportsmanship || null,
        etiquette: etiquette || null,
        communication: communication || null,
        comment: comment?.trim() || null,
        context: context || null
      })
      .select()
      .maybeSingle();

    if (reviewErr) throw reviewErr;

    // Recalculate aggregate scores
    const { data: allReviews } = await getSupabase()
      .from('commander_player_reputation')
      .select('reliability, sportsmanship, etiquette, communication')
      .eq('player_id', player_id);

    const count = (allReviews || []).length;
    const avg = (field) => {
      const vals = (allReviews || []).filter(r => r[field] != null).map(r => r[field]);
      return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    };

    const relAvg = avg('reliability');
    const sptAvg = avg('sportsmanship');
    const etqAvg = avg('etiquette');
    const comAvg = avg('communication');
    const allAvgs = [relAvg, sptAvg, etqAvg, comAvg].filter(v => v > 0);
    const overall = allAvgs.length > 0 ? allAvgs.reduce((a, b) => a + b, 0) / allAvgs.length : 0;

    const { error: upsertErr } = await getSupabase()
      .from('commander_player_reputation_scores')
      .upsert({
        player_id,
        overall_score: Math.round(overall * 100) / 100,
        reliability_avg: Math.round(relAvg * 100) / 100,
        sportsmanship_avg: Math.round(sptAvg * 100) / 100,
        etiquette_avg: Math.round(etqAvg * 100) / 100,
        communication_avg: Math.round(comAvg * 100) / 100,
        total_reviews: count,
        updated_at: new Date().toISOString()
      }, { onConflict: 'player_id' });

    if (upsertErr) throw upsertErr;

    return res.status(201).json({ success: true, data: { review } });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Submit review error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: error.message } });
  }
}
