/**
 * Tournament Templates API
 * GET /api/commander/tournaments/templates - List templates for venue
 * POST /api/commander/tournaments/templates - Create template (or save from existing tournament)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this used guardWriteStaff, which returns `true` for GET
// and lets the request through unauthenticated. Tournament templates are venue
// business configuration (buy-in, fee, guarantee, payout structure), so the
// listing was readable by anyone who knew a venue_id. Templates have no public
// consumer, so the read side is now staff-only too.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    } else if (!applyRateLimit(req, res, LIMITS.read)) {
      return;
    }

      const _g = await guardStaff(req, res); if (!_g) return;

      if (req.method === 'GET') return listTemplates(req, res, _g);
      if (req.method === 'POST') return createTemplate(req, res, _g);

      res.setHeader('Allow', ['GET', 'POST']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

// 2026-08-20 audit fix: venue_id came straight off the query string and was
// never checked against the caller's staff session, so staff at venue A could
// read (and write) venue B's tournament templates by changing one query param.
function venueMismatch(staff, venueId) {
    if (!staff || staff === true) return false;
    if (staff.venue_id === undefined || staff.venue_id === null) return false;
    return String(staff.venue_id) !== String(venueId);
}

async function listTemplates(req, res, staff) {
    try {
        const { venue_id } = req.query;
        if (!venue_id) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'venue_id Required' } });

        if (venueMismatch(staff, venue_id)) {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
        }

        const { data, error } = await getSupabase()
            .from('commander_tournament_templates')
            .select('*')
            .eq('venue_id', venue_id)
            .order('created_at', { ascending: false })
            .limit(200);

        if (error) throw error;

        return res.status(200).json({ success: true, data: { templates: data || [] } });
    } catch (error) {
        console.warn('List templates error:', error);
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}

async function createTemplate(req, res, staff) {
    try {
        if (!staff || staff === true) {
            return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff Authentication Required' } });
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
                return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
            }

            if (venueMismatch(staff, tournament.venue_id)) {
                return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Tournament Belongs To A Different Venue' } });
            }

            // Never copy live clock state into a reusable template - a tournament
            // created from it would start already holding another event's clock.
            const srcSettings = (tournament.settings && typeof tournament.settings === 'object') ? tournament.settings : {};
            const { clock_state: _droppedClock, ...templateSettings } = srcSettings;

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
                    settings: templateSettings,
                    leaderboard_id: tournament.leaderboard_id
                })
                .select()
                .maybeSingle();

            if (error) throw error;
            return res.status(201).json({ success: true, data: { template } });
        }

        // Manual creation
        if (!venue_id || !name) {
            return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'venue_id And name Required' } });
        }

        if (venueMismatch(staff, venue_id)) {
            return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'You Are Not Staff At This Venue' } });
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
        return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
}
