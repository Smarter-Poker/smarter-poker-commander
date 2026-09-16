/**
 * Resolve Incident API
 * POST /api/commander/incidents/:id/resolve
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;
    // 2026-07-25 audit fix: page sends { resolution }; resolved_by comes from
    // the verified staff session, never the request body.
    const { resolution, resolution_notes, follow_up_required = false } = req.body || {};
    const notes = resolution || resolution_notes;

    if (!notes) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELDS', message: 'resolution required' }
      });
    }

    try {
      // 2026-07-25 audit fix: venue-scope - the incident must belong to the
      // staff member's venue.
      const { data: existing, error: loadError } = await getSupabase()
        .from('commander_incidents')
        .select('id, venue_id')
        .eq('id', id)
        .maybeSingle();

      if (loadError) throw loadError;
      if (!existing) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Incident not found' }
        });
      }
      if (String(existing.venue_id) !== String(_staff.venue_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
        });
      }

      const { data: incident, error } = await getSupabase()
        .from('commander_incidents')
        .update({
          incident_status: 'resolved',
          resolved_by: _staff.id,
          resolution_notes: notes,
          follow_up_required,
          resolved_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .maybeSingle();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        data: { incident }
      });
    } catch (error) {
      console.warn('Resolve incident error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to resolve incident' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
