/**
 * Squads API - Create group waitlist
 * POST /api/commander/squads
 * GET /api/commander/squads
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard: require user auth for writes
    if (req.method !== "GET") { const _user = await guardUser(req, res); if (!_user) return; }
    if (req.method === 'POST') {
      return handleCreate(req, res);
    } else if (req.method === 'GET') {
      return handleList(req, res);
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

async function handleCreate(req, res) {
  const { venue_id, game_type, stakes, leader_id, prefer_same_table = true, accept_split = false } = req.body;

  if (!venue_id || !game_type || !leader_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'venue_id, game_type, and leader_id required' }
    });
  }

  try {
    // Create squad (waitlist group)
    const { data: squad, error } = await getSupabase()
      .from('commander_waitlist_groups')
      .insert({
        venue_id,
        game_type,
        stakes,
        leader_id,
        prefer_same_table,
        accept_split,
        status: 'waiting'
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    // Add leader as first member
    await getSupabase()
      .from('commander_waitlist_group_members')
      .insert({
        group_id: squad.id,
        player_id: leader_id
      });

    return res.status(201).json({
      success: true,
      data: { squad }
    });
  } catch (error) {
    console.warn('Create squad error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create squad' }
    });
  }
}

async function handleList(req, res) {
  const { venue_id, player_id, status } = req.query;

  try {
    let query = getSupabase()
      .from('commander_waitlist_groups')
      .select(`
        *,
        commander_waitlist_group_members (
          id,
          player_id,
          joined_at,
          profiles:player_id (id, display_name, avatar_url)
        )
      `)
      .order('created_at', { ascending: false })
          .limit(100);

    if (venue_id) query = query.eq('venue_id', venue_id);
    if (status) query = query.eq('status', status);

    const { data: squads, error } = await query;

    if (error) throw error;

    // Filter by player if specified
    let filtered = squads;
    if (player_id) {
      filtered = squads.filter(s =>
        s.commander_waitlist_group_members?.some(m => m.player_id === player_id)
      );
    }

    return res.status(200).json({
      success: true,
      data: { squads: filtered }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('List squads error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch squads' }
    });
  }
}
