/**
 * Tournament Templates API
 * GET /api/commander/tournaments/templates - List templates for venue
 * POST /api/commander/tournaments/templates - Create template (or save from existing tournament)
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

      if (req.method === 'GET') return listTemplates(req, res);
      if (req.method === 'POST') return createTemplate(req, res, _g);

      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listTemplates(req, res) {
    try {
        const { venue_id } = req.query;
        if (!venue_id) return res.status(400).json({ success: false, error: { message: 'venue_id required' } });

        const { data, error } = await getSupabase()
            .from('commander_tournament_templates')
            .select('*')
            .eq('venue_id', venue_id)
            .order('created_at', { ascending: false })
                .limit(100);

        if (error) throw error;

        return res.status(200).json({ success: true, data: { templates: data || [] } });
    } catch (error) {
        console.warn('List templates error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}

async function createTemplate(req, res, staff) {
    try {
        if (!staff || staff === true) {
            return res.status(401).json({ success: false, error: { message: 'Staff auth required' } });
        }

        const {
            venue_id, name, tournament_type, buyin_amount, buyin_fee,
            starting_chips, blind_structure, break_schedule, payout_structure,
            late_registration_levels, allows_rebuys, rebuy_amount, rebuy_chips,
            max_rebuys, rebuy_end_level, allows_addon, addon_amount, addon_chips,
            max_entries, settings, leaderboard_id,
            // "Save from tournament" mode
            from_tournament_id
        } = req.body;

        // If saving from existing tournament, fetch its data
        if (from_tournament_id) {
            const { data: tournament, error: tErr } = await getSupabase()
                .from('commander_tournaments')
                .select('*')
                .eq('id', from_tournament_id)
                .maybeSingle();

            if (tErr || !tournament) {
                return res.status(404).json({ success: false, error: { message: 'Tournament not found' } });
            }

            const { data: template, error } = await getSupabase()
                .from('commander_tournament_templates')
                .insert({
                    venue_id: tournament.venue_id,
                    name: name || `${tournament.name} Template`,
                    tournament_type: tournament.tournament_type,
                    buyin_amount: tournament.buyin_amount,
                    buyin_fee: tournament.buyin_fee,
                    starting_chips: tournament.starting_chips,
                    blind_structure: tournament.blind_structure,
                    break_schedule: tournament.break_schedule,
                    payout_structure: tournament.payout_structure,
                    late_registration_levels: tournament.late_registration_levels,
                    allows_rebuys: tournament.allows_rebuys,
                    rebuy_amount: tournament.rebuy_amount,
                    rebuy_chips: tournament.rebuy_chips,
                    max_rebuys: tournament.max_rebuys,
                    rebuy_end_level: tournament.rebuy_end_level,
                    allows_addon: tournament.allows_addon,
                    addon_amount: tournament.addon_amount,
                    addon_chips: tournament.addon_chips,
                    max_entries: tournament.max_entries,
                    settings: tournament.settings,
                    leaderboard_id: tournament.leaderboard_id
                })
                .select()
                .maybeSingle();

            if (error) throw error;
            return res.status(201).json({ success: true, data: { template } });
        }

        // Manual creation
        if (!venue_id || !name) {
            return res.status(400).json({ success: false, error: { message: 'venue_id and name required' } });
        }

        const { data: template, error } = await getSupabase()
            .from('commander_tournament_templates')
            .insert({
                venue_id, name, tournament_type, buyin_amount, buyin_fee,
                starting_chips, blind_structure, break_schedule, payout_structure,
                late_registration_levels, allows_rebuys, rebuy_amount, rebuy_chips,
                max_rebuys, rebuy_end_level, allows_addon, addon_amount, addon_chips,
                max_entries, settings, leaderboard_id
            })
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(201).json({ success: true, data: { template } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Create template error:', error);
        return res.status(500).json({ success: false, error: { message: 'Internal server error' } });
    }
}
