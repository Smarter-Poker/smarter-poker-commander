/**
 * Tournament Template Detail API
 * GET /api/commander/tournaments/templates/[id] - Get template
 * PUT /api/commander/tournaments/templates/[id] - Update template
 * DELETE /api/commander/tournaments/templates/[id] - Delete template
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const _g = await guardWriteStaff(req, res); if (!_g) return;
      const { id } = req.query;

      if (req.method === 'GET') return getTemplate(req, res, id);
      if (req.method === 'PUT') return updateTemplate(req, res, id);
      if (req.method === 'DELETE') return deleteTemplate(req, res, id);

      res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getTemplate(req, res, id) {
    try {
        const { data, error } = await getSupabase()
            .from('commander_tournament_templates')
            .select('*')
            .eq('id', id)
            .maybeSingle();

        if (error) throw error;
        return res.status(200).json({ success: true, data: { template: data } });
    } catch (error) {
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function updateTemplate(req, res, id) {
    try {
        const allowed = [
            'name', 'tournament_type', 'buyin_amount', 'buyin_fee', 'starting_chips',
            'blind_structure', 'break_schedule', 'payout_structure', 'late_registration_levels',
            'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'max_rebuys', 'rebuy_end_level',
            'allows_addon', 'addon_amount', 'addon_chips', 'max_entries', 'settings', 'leaderboard_id'
        ];
        const updates = {};
        allowed.forEach(key => { if (req.body[key] !== undefined) updates[key] = req.body[key]; });

        const { data, error } = await getSupabase()
            .from('commander_tournament_templates')
            .update(updates)
            .eq('id', id)
            .select()
            .maybeSingle();

        if (error) throw error;
        return res.status(200).json({ success: true, data: { template: data } });
    } catch (error) {
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function deleteTemplate(req, res, id) {
    try {
        const { error } = await getSupabase()
            .from('commander_tournament_templates')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return res.status(200).json({ success: true });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}
