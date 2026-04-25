/**
 * Single Incident API - GET/PATCH /api/commander/incidents/[id]
 * View or update/resolve an incident
 * Reference: ENHANCEMENTS.md - Incident Reporting System
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { requireStaff } from '../../../src/lib/commander/auth';
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

    const { id } = req.query;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Incident ID required' }
      });
    }

    if (req.method === 'GET') {
      return handleGet(req, res, id);
    } else if (req.method === 'PATCH') {
      return handlePatch(req, res, id);
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

async function handleGet(req, res, id) {
  try {
    const { data: incident, error } = await getSupabase()
      .from('commander_incidents')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !incident) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Incident not found' }
      });
    }

    // Require staff auth at the incident's venue
    const staff = await requireStaff(req, res, incident.venue_id);
    if (!staff) return;

    return res.status(200).json({
      success: true,
      data: { incident }
    });
  } catch (error) {
    console.warn('Get incident error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to fetch incident' }
    });
  }
}

async function handlePatch(req, res, id) {
  try {
    // Fetch existing incident to get venue_id
    const { data: existing, error: fetchError } = await getSupabase()
      .from('commander_incidents')
      .select('id, venue_id, incident_status')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Incident not found' }
      });
    }

    // Require staff auth at the incident's venue
    const staff = await requireStaff(req, res, existing.venue_id);
    if (!staff) return;

    const {
      incident_type,
      severity,
      description,
      action_taken,
      incident_status,
      resolution,
      player_id,
      table_id
    } = req.body;

    const updates = {};
    if (incident_type !== undefined) updates.incident_type = incident_type;
    if (severity !== undefined) updates.severity = severity;
    if (description !== undefined) updates.description = description;
    if (action_taken !== undefined) updates.action_taken = action_taken;
    if (player_id !== undefined) updates.player_id = player_id;
    if (table_id !== undefined) updates.table_id = table_id;

    // Handle resolution/status change
    if (incident_status !== undefined) {
      updates.incident_status = incident_status;
      if (incident_status === 'resolved') {
        updates.resolved_by = staff.id;
        updates.resolved_at = new Date().toISOString();
      }
    }
    if (resolution !== undefined) updates.resolution = resolution;

    if (Object.keys(updates || {}).length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'No valid fields to update' }
      });
    }

    const { data: incident, error: updateError } = await getSupabase()
      .from('commander_incidents')
      .update(updates)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (updateError) {
      console.warn('Update incident error:', updateError);
      return res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: 'Failed to update incident' }
      });
    }

    return res.status(200).json({
      success: true,
      data: { incident }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Patch incident error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to update incident' }
    });
  }
}
