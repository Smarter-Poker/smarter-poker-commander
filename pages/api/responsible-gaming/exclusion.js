/**
 * Self-Exclusion API
 * POST /api/commander/responsible-gaming/exclusion
 * DELETE /api/commander/responsible-gaming/exclusion
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { requireAuth } from '../../../src/lib/commander/auth';
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

// Auth: USER - requires authenticated user
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method === 'POST') {
      return handleCreate(req, res);
    } else if (req.method === 'DELETE') {
      return handleRemove(req, res);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleCreate(req, res) {
  // Require auth - players can only self-exclude themselves
  const user = await requireAuth(req, res);
  if (!user) return;

  const { venue_id, duration_days, reason } = req.body;

  if (!duration_days) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'duration_days required' }
    });
  }

  try {
    // 2026-07-25 audit fix: the table has no start_date/end_date/requested_by
    // columns (the old insert failed). Write the real schema - exclusion_type,
    // scope, venue_id, duration_days, expires_at (null for permanent), reason,
    // exclusion_status - matching the enforcement queries in waitlist/index.js
    // and tournaments/[id]/register.js, which treat scope 'network' as global
    // and filter .is('lifted_at', null).or('expires_at.is.null,expires_at.gt.now()').
    const days = parseInt(duration_days);
    const isPermanent = !Number.isFinite(days) || days <= 0;
    let expires_at = null;
    if (!isPermanent) {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + days);
      expires_at = expiry.toISOString();
    }

    const { data: exclusion, error } = await getSupabase()
      .from('commander_self_exclusions')
      .insert({
        player_id: user.id,
        exclusion_type: 'self',
        scope: venue_id ? 'venue' : 'network',
        venue_id: venue_id || null, // null for all venues
        duration_days: isPermanent ? null : days,
        expires_at,
        reason,
        exclusion_status: 'active'
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { exclusion }
    });
  } catch (error) {
    console.warn('Create exclusion error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to create exclusion' }
    });
  }
}

async function handleRemove(req, res) {
  // Require auth - players can only lift their own exclusions
  const user = await requireAuth(req, res);
  if (!user) return;

  const { exclusion_id } = req.body;

  if (!exclusion_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'exclusion_id required' }
    });
  }

  try {
    // Check if exclusion allows early removal and belongs to this user
    const { data: exclusion } = await getSupabase()
      .from('commander_self_exclusions')
      .select('*')
      .eq('id', exclusion_id)
      .eq('player_id', user.id)
      .maybeSingle();

    if (!exclusion) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Exclusion not found' }
      });
    }

    // 2026-07-25 audit fix: already-lifted exclusions cannot be lifted again.
    if (exclusion.lifted_at) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_LIFTED', message: 'Exclusion already lifted' }
      });
    }

    // Self-exclusions typically have cooling-off periods
    // 2026-07-25 audit fix: start_date column does not exist - use created_at.
    const minCoolingDays = 7;
    const daysSinceStart = Math.floor(
      (Date.now() - new Date(exclusion.created_at).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSinceStart < minCoolingDays) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'COOLING_PERIOD',
          message: `Cannot remove exclusion for ${minCoolingDays - daysSinceStart} more days`
        }
      });
    }

    const { error } = await getSupabase()
      .from('commander_self_exclusions')
      .update({
        exclusion_status: 'lifted',
        // 2026-07-25 audit fix: lifted_at is what enforcement queries check;
        // also record who lifted it (the verified authenticated player).
        lifted_at: new Date().toISOString(),
        lifted_by: user.id
      })
      .eq('id', exclusion_id);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { message: 'Exclusion lifted' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Remove exclusion error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to remove exclusion' }
    });
  }
}
