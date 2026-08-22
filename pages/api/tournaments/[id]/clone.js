/**
 * Clone Tournament API
 * POST /api/commander/tournaments/[id]/clone
 *
 * Recurring-event support: copies a tournament's full configuration (buy-in
 * breakdown, structure, breaks, payouts, rebuy/add-on rules, late reg,
 * guarantee, bounty, type) into a fresh 'scheduled' tournament.
 *
 * Body:
 *   scheduled_start (required, ISO timestamp)
 *   name            (optional, defaults to the source name)
 *   count           (optional, 1-12): create N weekly instances starting at
 *                   scheduled_start, one per week (daily/weekly recurrence in
 *                   one call).
 *   interval_days   (optional, default 7 when count > 1)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { logAction } from '../../../../src/lib/commander/audit';
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

// Configuration columns copied verbatim from the source tournament.
const CONFIG_COLUMNS = [
  'venue_id', 'description', 'tournament_type', 'variant',
  'buyin_amount', 'buyin_fee', 'starting_chips',
  'late_registration_levels', 'min_entries', 'max_entries', 'guaranteed_pool',
  'blind_structure', 'break_schedule', 'payout_structure',
  // 2026-08-20 audit fix: paying_places was omitted, so every clone silently
  // reverted to the column default of 3 paid places no matter how the source
  // event was configured. is_multi_day/total_days were lost the same way and
  // turned a Day 1/Day 2 event into a one-day freezeout.
  'paying_places', 'is_multi_day', 'total_days',
  'allows_rebuys', 'rebuy_amount', 'rebuy_chips', 'max_rebuys', 'rebuy_end_level',
  'allows_addon', 'addon_amount', 'addon_chips', 'addon_at_break',
  'bounty_amount', 'broadcast_to_smarter', 'series_id', 'leaderboard_id'
];

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', ['POST']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }
    if (!applyRateLimit(req, res, LIMITS.write)) return;
    const staff = await guardStaff(req, res);
    if (!staff) return;

    const { id: sourceId } = req.query;
    const { scheduled_start, name } = req.body || {};

    const start = scheduled_start ? new Date(scheduled_start) : null;
    if (!start || isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'A Valid scheduled_start Is Required' }
      });
    }

    const count = Math.min(12, Math.max(1, Number(req.body?.count) || 1));
    const intervalDays = Math.min(31, Math.max(1, Number(req.body?.interval_days) || 7));

    const { data: source } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', sourceId)
      .maybeSingle();

    if (!source) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Source Tournament Not Found' }
      });
    }

    // Venue scoping: staff sessions carry venue_id; a mismatch is a hard stop.
    if (staff.venue_id && Number(staff.venue_id) !== Number(source.venue_id)) {
      return res.status(403).json({
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' }
      });
    }

    const config = {};
    for (const col of CONFIG_COLUMNS) {
      if (source[col] !== undefined) config[col] = source[col];
    }
    // Carry display settings (clock color, theme) but never live clock state.
    const sourceSettings = source.settings && typeof source.settings === 'object' ? source.settings : {};
    const { clock_state: _dropped, ...carriedSettings } = sourceSettings;

    const rows = [];
    for (let i = 0; i < count; i++) {
      const startAt = new Date(start.getTime() + i * intervalDays * 24 * 60 * 60 * 1000);
      rows.push({
        ...config,
        name: name || source.name,
        status: 'scheduled',
        scheduled_start: startAt.toISOString(),
        current_level: 0,
        settings: carriedSettings,
        created_by: staff.role === 'owner' ? null : staff.id
      });
    }

    const { data: created, error } = await getSupabase()
      .from('commander_tournaments')
      .insert(rows)
      .select('id, name, scheduled_start, status');

    if (error) throw error;

    await logAction({ action: 'clone_tournament', category: 'tournament' }, {
      venueId: source.venue_id,
      staffId: staff.id,
      targetId: sourceId,
      targetType: 'commander_tournaments',
      targetName: source.name,
      metadata: { instances: (created || []).length, first_start: start.toISOString(), interval_days: intervalDays },
      req
    });

    return res.status(201).json({
      success: true,
      data: {
        tournaments: created || [],
        message: count === 1
          ? 'Tournament Cloned.'
          : `${(created || []).length} Recurring Instances Created.`
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_e) { console.warn('[App] Handled exception:', _e?.message || _e); }
    console.warn('[clone.js] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed To Clone Tournament' }
      });
    }
  }
}
