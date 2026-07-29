/**
 * High Hands API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/high-hands - List high hands for venue
 * POST /api/commander/high-hands - Record new high hand
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method === 'GET') {
      return listHighHands(req, res);
    }

    if (req.method === 'POST') {
      // 2026-07-25 audit fix: _g is the verified staff session (guardWriteStaff)
      return createHighHand(req, res, _g);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.warn('[high-hands API Error]', err?.message || err, err?.code || '', err?.details || '', err?.hint || '');
    if (!res.headersSent) return res.status(500).json({ success: false, error: err?.message || 'Internal server error', details: err?.details || null, hint: err?.hint || null });
  }
}

async function listHighHands(req, res) {
  try {
    const {
      venue_id,
      promotion_id,
      date,
      limit: rawLimit = '50',
      offset: rawOffset = '0'
    } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 500);
    const offset = parseInt(rawOffset) || 0;

    if (!venue_id) {
      return res.status(400).json({ error: 'Venue ID required' });
    }

    let query = getSupabase()
      .from('commander_high_hands')
      .select('*', { count: 'exact' })
      .eq('venue_id', venue_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (promotion_id) {
      query = query.eq('promotion_id', promotion_id);
    }

    if (date) {
      query = query.gte('created_at', `${date}T00:00:00`).lt('created_at', `${date}T23:59:59`);
    }

    const { data, error, count } = await query;

    if (error) throw error;

    // Get current high hand (highest rank today)
    const today = new Date().toISOString().split('T')[0];
    const { data: currentHigh } = await getSupabase()
      .from('commander_high_hands')
      .select('*')
      .eq('venue_id', venue_id)
      .gte('created_at', `${today}T00:00:00`)
      .not('verified_at', 'is', null)
      .order('hand_rank', { ascending: false })
      .limit(1)
      .maybeSingle();

    return res.status(200).json({
      high_hands: data,
      current_high: currentHigh || null,
      total: count,
      limit,
      offset
    });
  } catch (error) {
    console.warn('List high hands error:', error?.message || error, error?.code || '', error?.details || '', error?.hint || '');
    return res.status(500).json({ error: error?.message || 'Internal server error', details: error?.details || null, hint: error?.hint || null });
  }
}

async function createHighHand(req, res, staff) {
  try {
    // 2026-07-25 audit fix: identity comes from the verified x-staff-session
    // (guardWriteStaff at the handler) — requiring a Bearer JWT and a user_id
    // staff lookup blocked PIN-terminal staff, who have no JWT.
    const {
      venue_id,
      promotion_id,
      player_id,
      player_name,
      hand_description,
      hand_cards,
      board_cards,
      hand_rank,
      game_id,
      table_number,
      prize_amount,
      auto_verify = false
    } = req.body;

    if (!venue_id || !hand_description) {
      return res.status(400).json({ error: 'venue_id and hand_description required' });
    }

    if (!player_id && !player_name) {
      return res.status(400).json({ error: 'player_id or player_name required' });
    }

    // 2026-07-25 audit fix: venue scoping — session staff must belong to the
    // venue this high hand is being recorded for.
    if (!staff || String(staff.venue_id) !== String(venue_id)) {
      return res.status(403).json({ error: 'You are not authorized to record high hands for this venue' });
    }

    const insertData = {
      venue_id: venue_id,
      promotion_id: promotion_id || null,
      player_id: player_id || null,
      player_name: player_name || null,
      notes: hand_description,
      cards: hand_cards || null,
      board_cards: board_cards || null,
      hand_rank: hand_rank || null,
      game_id: game_id || null,
      table_number: table_number || null,
      prize_amount: prize_amount || null
    };

    if (auto_verify) {
      insertData.verified_by = staff.id;
      insertData.verified_at = new Date().toISOString();
    }

    const { data: highHand, error } = await getSupabase()
      .from('commander_high_hands')
      .insert(insertData)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    // XP system removed

    return res.status(201).json({ high_hand: highHand });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Create high hand error:', error?.message || error, error?.code || '', error?.details || '');
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
