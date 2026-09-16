/**
 * Tournament Template Detail API
 * GET /api/commander/tournaments/templates/[id] - Get template
 * PUT /api/commander/tournaments/templates/[id] - Update template
 * DELETE /api/commander/tournaments/templates/[id] - Delete template
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

/**
 * 2026-08-20 audit fix: every handler in this file addressed the template by id
 * alone with no venue check, so any authenticated staff member could read,
 * overwrite, or DELETE another venue's tournament templates by guessing/holding
 * a template id. Load the row first and reject a venue mismatch.
 *
 * Returns the template row, or null after having already sent the response.
 */
async function loadOwnedTemplate(res, id, staff) {
    if (!id) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Template ID Required' } });
        return null;
    }

    const { data, error } = await getSupabase()
        .from('commander_tournament_templates')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        console.error('[tournaments/templates] template read failed', {
            id, code: error.code, message: error.message, details: error.details,
        });
        res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Template' } });
        return null;
    }

    if (!data) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Template Not Found' } });
        return null;
    }

    const staffVenue = (staff && staff !== true) ? staff.venue_id : undefined;
    if (staffVenue !== undefined && staffVenue !== null && String(staffVenue) !== String(data.venue_id)) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Template Belongs To A Different Venue' } });
        return null;
    }

    return data;
}

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this used guardWriteStaff, which returns `true` for GET
// and let an unauthenticated caller read any venue's template by id.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) {
      return;
    }

      const _g = await guardStaff(req, res); if (!_g) return;
      const { id } = req.query;

      if (req.method === 'GET') return getTemplate(req, res, id, _g);
      if (req.method === 'PUT' || req.method === 'PATCH') return updateTemplate(req, res, id, _g);
      if (req.method === 'DELETE') return deleteTemplate(req, res, id, _g);

      res.setHeader('Allow', ['GET', 'PUT', 'PATCH', 'DELETE']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

async function getTemplate(req, res, id, staff) {
    try {
        const template = await loadOwnedTemplate(res, id, staff);
        if (!template) return;

        return res.status(200).json({ success: true, data: { template } });
    } catch (error) {
        console.warn('Get template error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}

async function updateTemplate(req, res, id, staff) {
    try {
        const template = await loadOwnedTemplate(res, id, staff);
        if (!template) return;

        const allowed = [
            'name', 'tournament_type', 'buyin_amount', 'buyin_fee', 'starting_chips',
            'blind_structure', 'break_schedule', 'payout_structure', 'late_registration_levels',
            'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'max_rebuys', 'rebuy_end_level',
            'allows_addon', 'addon_amount', 'addon_chips', 'max_entries', 'settings', 'leaderboard_id'
        ];
        const updates = {};
        allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No Editable Fields Were Provided' } });
        }

        // A template must never carry live clock state.
        if (updates.settings && typeof updates.settings === 'object') {
            const { clock_state: _droppedClock, ...cleanSettings } = updates.settings;
            updates.settings = cleanSettings;
        }

        updates.updated_at = new Date().toISOString();

        const { data, error } = await getSupabase()
            .from('commander_tournament_templates')
            .update(updates)
            .eq('id', id)
            // Scope the write to the owning venue as well as the id.
            .eq('venue_id', template.venue_id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return res.status(200).json({ success: true, data: { template: data } });
    } catch (error) {
        console.warn('Update template error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}

async function deleteTemplate(req, res, id, staff) {
    try {
        const template = await loadOwnedTemplate(res, id, staff);
        if (!template) return;

        const { error } = await getSupabase()
            .from('commander_tournament_templates')
            .delete()
            .eq('id', id)
            .eq('venue_id', template.venue_id);

        if (error) throw error;
        return res.status(200).json({ success: true, data: { deleted_id: id, message: 'Template Deleted' } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
        console.warn('Delete template error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}
