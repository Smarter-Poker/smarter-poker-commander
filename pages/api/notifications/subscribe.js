/**
 * Push Notifications Subscribe API
 * POST /api/commander/notifications/subscribe - Subscribe to push notifications
 * DELETE /api/commander/notifications/subscribe - Unsubscribe from push notifications
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }
    if (req.method === 'POST') {
      return subscribe(req, res);
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }

    if (req.method === 'DELETE') {
      return unsubscribe(req, res);
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

async function subscribe(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
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

    const { subscription, platform, device_id, venue_id, onesignal_player_id } = req.body;

    if (!subscription && !onesignal_player_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'subscription object or onesignal_player_id required' }
      });
    }

    // Check for existing subscription with this endpoint or OneSignal player ID
    const endpoint = subscription?.endpoint || onesignal_player_id;
    let query = getSupabase()
      .from('commander_push_subscriptions')
      .select('id');

    if (subscription?.endpoint) {
      query = query.eq('endpoint', subscription.endpoint)
    } else if (onesignal_player_id) {
      query = query.eq('endpoint', onesignal_player_id)
    }

    const { data: existing } = await query.maybeSingle();

    // Build subscription data with OneSignal player ID
    const subscriptionData = subscription || {};
    if (onesignal_player_id) {
      subscriptionData.playerId = onesignal_player_id;
    }

    if (existing) {
      // Update existing subscription
      const { data: updated, error } = await getSupabase()
        .from('commander_push_subscriptions')
        .update({
          user_id: user.id,
          subscription_data: subscriptionData,
          platform: platform || 'web',
          device_id,
          venue_id: venue_id ? venue_id : null,
          is_active: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: { subscription: updated, updated: true }
      });
    }

    // Create new subscription
    const { data: newSub, error } = await getSupabase()
      .from('commander_push_subscriptions')
      .insert({
        user_id: user.id,
        endpoint,
        subscription_data: subscriptionData,
        platform: platform || 'web',
        device_id,
        venue_id: venue_id ? venue_id : null,
        is_active: true
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      data: { subscription: newSub, created: true }
    });
  } catch (error) {
    console.warn('Subscribe error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to subscribe' }
    });
  }
}

async function unsubscribe(req, res) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
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

    const { endpoint, device_id } = req.body;

    if (!endpoint && !device_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'endpoint or device_id required' }
      });
    }

    let query = getSupabase()
      .from('commander_push_subscriptions')
      .update({ is_active: false })
      .eq('user_id', user.id);

    if (endpoint) {
      query = query.eq('endpoint', endpoint);
    } else if (device_id) {
      query = query.eq('device_id', device_id);
    }

    const { error } = await query;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: { message: 'Unsubscribed successfully' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('Unsubscribe error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to unsubscribe' }
    });
  }
}
