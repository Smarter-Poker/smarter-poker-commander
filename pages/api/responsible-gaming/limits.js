/**
 * Spending Limits API
 * GET /api/commander/responsible-gaming/limits
 * PUT /api/commander/responsible-gaming/limits
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }
    if (req.method === 'GET') {
      return handleGet(req, res);
    } else if (req.method === 'PUT') {
      return handleUpdate(req, res);
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

async function handleGet(req, res) {
  // Get player from auth
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
    });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
      });
    }

    const player_id = user.id;

    const { data: limits, error } = await getSupabase()
      .from('commander_spending_limits')
      .select('*')
      .eq('player_id', player_id)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    // Return defaults if no limits set
    const effectiveLimits = limits || {
      player_id,
      daily_limit: null,
      weekly_limit: null,
      monthly_limit: null,
      session_limit: null,
      loss_limit: null,
      time_limit_hours: null,
      enabled: false
    };

    return res.status(200).json({
      success: true,
      data: { limits: effectiveLimits }
    });
  } catch (error) {
    console.warn('Get limits error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch limits' }
    });
  }
}

async function handleUpdate(req, res) {
  // Get player from auth
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: { code: 'AUTH_REQUIRED', message: 'Authentication required' }
    });
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Invalid token' }
      });
    }

    const player_id = user.id;

    const {
      daily_limit,
      weekly_limit,
      monthly_limit,
      session_limit,
      loss_limit,
      time_limit_hours,
      enabled = true
    } = req.body;
    // Upsert limits
    const { data: limits, error } = await getSupabase()
      .from('commander_spending_limits')
      .upsert({
        player_id,
        daily_limit,
        weekly_limit,
        monthly_limit,
        session_limit,
        loss_limit,
        time_limit_hours,
        enabled,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'player_id'
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { limits }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Update limits error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update limits' }
    });
  }
}
