/**
 * Streaming Config API
 * PATCH /api/commander/streaming/[tableId]/config - Update stream configuration
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    if (req.method !== 'PATCH') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    const { tableId } = req.query;
    const { venue_id, platforms, delay_minutes, overlay_config } = req.body;

    if (!venue_id) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'venue_id required' }
      });
    }

    try {
      // Check if table exists
      const { data: table, error: tableError } = await getSupabase()
        .from('commander_tables')
        .select('id, venue_id')
        .eq('id', tableId)
        .eq('venue_id', venue_id)
        .maybeSingle();

      if (tableError || !table) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Table not found' }
        });
      }

      // Update or insert stream config
      const { data: existingStream } = await getSupabase()
        .from('commander_streams')
        .select('id')
        .eq('table_id', tableId)
        .maybeSingle();

      let result;
      if (existingStream) {
        // Update existing
        const { data, error } = await getSupabase()
          .from('commander_streams')
          .update({
            platforms: platforms || [],
            delay_minutes: delay_minutes || 15,
            overlay_config: overlay_config || {}
          })
          .eq('table_id', tableId)
          .select()
          .maybeSingle();

        if (error) throw error;
        result = data;
      } else {
        // Insert new
        const { data, error } = await getSupabase()
          .from('commander_streams')
          .insert({
            table_id: tableId,
            venue_id: venue_id,
            platforms: platforms || [],
            delay_minutes: delay_minutes || 15,
            overlay_config: overlay_config || {},
            status: 'offline'
          })
          .select()
          .maybeSingle();

        if (error) throw error;
        result = data;
      }

      return res.status(200).json({
        success: true,
        data: { stream: result }
      });
    } catch (error) {
      console.warn('Update stream config error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to update stream config' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
