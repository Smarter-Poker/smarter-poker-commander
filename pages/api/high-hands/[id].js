/**
 * High Hand Detail API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/high-hands/:id - Get high hand details
 * PUT /api/commander/high-hands/:id - Update/verify high hand
 * DELETE /api/commander/high-hands/:id - Delete high hand
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({ success: false, error: 'High hand ID required' });
    }

    if (req.method === 'GET') {
      return getHighHand(req, res, id);
    }

    if (req.method === 'PUT') {
      // 2026-07-25 audit fix: _g is the verified staff session (guardWriteStaff)
      return updateHighHand(req, res, id, _g);
    }

    if (req.method === 'DELETE') {
      return deleteHighHand(req, res, id, _g);
    }

    res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.warn('[high-hands/id API Error]', err?.message || err, err?.code || '', err?.details || '');
    if (!res.headersSent) return res.status(500).json({ success: false, error: err?.message || 'Internal server error' });
  }
}

async function getHighHand(req, res, id) {
  try {
    const { data: highHand, error } = await getSupabase()
      .from('commander_high_hands')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw error;

    if (!highHand) {
      return res.status(404).json({ success: false, error: 'High hand not found' });
    }

    return res.status(200).json({ high_hand: highHand });
  } catch (error) {
    console.warn('Get high hand error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateHighHand(req, res, id, staff) {
  try {
    // 2026-07-25 audit fix: identity comes from the verified x-staff-session
    // (guardWriteStaff) — the Bearer-JWT + user_id lookup blocked PIN-terminal
    // staff. Venue scoping is preserved against the record being written.

    // Get existing high hand
    const { data: existing, error: getError } = await getSupabase()
      .from('commander_high_hands')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (getError || !existing) {
      return res.status(404).json({ success: false, error: 'High hand not found' });
    }

    if (!staff || String(staff.venue_id) !== String(existing.venue_id)) {
      return res.status(403).json({ success: false, error: 'You are not authorized to update high hands for this venue' });
    }

    const {
      action,
      player_id,
      player_name,
      hand_description,
      hand_cards,
      board_cards,
      hand_rank,
      prize_amount
    } = req.body;

    let updates = {};

    if (action === 'verify') {
      if (existing.verified_at) {
        return res.status(400).json({ success: false, error: 'High hand already verified' });
      }
      updates = {
        verified_by: staff.id,
        verified_at: new Date().toISOString()
      };
      if (prize_amount !== undefined) {
        updates.prize_amount = prize_amount;
      }
    } else {
      // Regular update
      if (player_id !== undefined) updates.player_id = player_id;
      if (player_name !== undefined) updates.player_name = player_name;
      if (hand_description !== undefined) updates.hand_description = hand_description;
      if (hand_cards !== undefined) updates.hand_cards = hand_cards;
      if (board_cards !== undefined) updates.board_cards = board_cards;
      if (hand_rank !== undefined) updates.hand_rank = hand_rank;
      if (prize_amount !== undefined) updates.prize_amount = prize_amount;
    }

    const { data: highHand, error } = await getSupabase()
      .from('commander_high_hands')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) throw error;

    // Award XP if this was a verification and player has ID
    if (action === 'verify' && (highHand.player_id || existing.player_id)) {
      const playerId = highHand.player_id || existing.player_id;
      // XP system removed
    }

    return res.status(200).json({ high_hand: highHand });
  } catch (error) {
    console.warn('Update high hand error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function deleteHighHand(req, res, id, staff) {
  try {
    // 2026-07-25 audit fix: identity comes from the verified x-staff-session
    // (guardWriteStaff) — the Bearer-JWT + user_id lookup blocked PIN-terminal
    // staff. Venue scoping and the manager/owner role check are preserved.

    // Get existing high hand
    const { data: existing, error: getError } = await getSupabase()
      .from('commander_high_hands')
      .select('venue_id, verified_at')
      .eq('id', id)
      .maybeSingle();

    if (getError || !existing) {
      return res.status(404).json({ success: false, error: 'High hand not found' });
    }

    if (!staff || String(staff.venue_id) !== String(existing.venue_id)) {
      return res.status(403).json({ success: false, error: 'You are not authorized to delete high hands for this venue' });
    }

    if (!['owner', 'manager'].includes(staff.role)) {
      return res.status(403).json({ success: false, error: 'Only managers can delete high hands' });
    }

    // Prevent deleting verified high hands
    if (existing.verified_at) {
      return res.status(400).json({ success: false, error: 'Cannot delete verified high hands' });
    }

    const { error } = await getSupabase()
      .from('commander_high_hands')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ success: true, message: 'High hand deleted' });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Delete high hand error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
