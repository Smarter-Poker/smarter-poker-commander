/**
 * Commander Admin Pilots API
 * GET /api/commander/admin/pilots - List pilot venues with metrics
 * POST /api/commander/admin/pilots - Add a pilot venue
 * Reference: Phase 6 - Scale & Polish
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
import { guardManager } from '../../../src/lib/commander/auth';
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    // Auth guard: require manager auth
    const _staff = await guardManager(req, res);
    if (!_staff) return;

    // 2026-07-25 audit fix: POST branch — the page's Add Pilot flow had no
    // API to call (endpoint was GET-only).
    if (req.method === 'POST') {
      try {
        const { venue_id, notes } = req.body || {};
        if (!venue_id) {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'venue_id is required' }
          });
        }

        const { data: existing } = await getSupabase()
          .from('commander_pilot_venues')
          .select('id')
          .eq('venue_id', venue_id)
          .maybeSingle();
        if (existing) {
          return res.status(409).json({
            success: false,
            error: { code: 'ALREADY_EXISTS', message: 'Venue is already a pilot' }
          });
        }

        const insertRow = {
          venue_id,
          status: 'active',
          pilot_start_date: new Date().toISOString()
        };
        if (notes) insertRow.notes = notes;

        let { data, error } = await getSupabase()
          .from('commander_pilot_venues')
          .insert(insertRow)
          .select()
          .maybeSingle();

        // Retry without notes if the column does not exist in this schema
        if (error && insertRow.notes && /notes/i.test(error.message || '')) {
          delete insertRow.notes;
          ({ data, error } = await getSupabase()
            .from('commander_pilot_venues')
            .insert(insertRow)
            .select()
            .maybeSingle());
        }

        if (error) {
          console.warn('Commander admin pilots insert error:', error);
          return res.status(500).json({
            success: false,
            error: { code: 'DATABASE_ERROR', message: 'Failed to create pilot' }
          });
        }

        return res.status(201).json({ success: true, data: { pilot: data } });
      } catch (error) {
        captureException(error, {
          action: 'admin_pilots_create',
          endpoint: '/api/commander/admin/pilots'
        });
        return res.status(500).json({
          success: false,
          error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        });
      }
    }

    if (req.method !== 'GET') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      const { status } = req.query;

      let query = getSupabase()
        .from('commander_pilot_venues')
        .select(`
          *,
          poker_venues (
            id,
            name,
            city,
            state
          )
        `)
        .order('pilot_start_date', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.warn('Commander admin pilots query error:', error);
        return res.status(500).json({
          success: false,
          error: { code: 'DATABASE_ERROR', message: 'Failed to fetch pilots' }
        });
      }

      // Map to expected format
      const pilots = (data || []).map(pilot => ({
        id: pilot.id,
        venue_id: pilot.venue_id,
        venue_name: pilot.poker_venues?.name || 'Unknown Venue',
        city: pilot.poker_venues?.city || '',
        state: pilot.poker_venues?.state || '',
        pilot_start_date: pilot.pilot_start_date,
        pilot_end_date: pilot.pilot_end_date,
        status: pilot.status,
        uptime_percentage: parseFloat(pilot.uptime_percentage) || 0,
        support_tickets_count: pilot.support_tickets_count || 0,
        staff_satisfaction_score: parseFloat(pilot.staff_satisfaction_score) || 0,
        player_adoption_percentage: parseFloat(pilot.player_adoption_percentage) || 0,
        weekly_reports: pilot.weekly_reports || [],
        final_assessment: pilot.final_assessment,
        converted_to_paid: pilot.converted_to_paid,
        conversion_date: pilot.conversion_date,
        created_at: pilot.created_at,
        updated_at: pilot.updated_at
      }));

      return res.status(200).json({
        success: true,
        pilots
      });
    } catch (error) {
      captureException(error, {
        action: 'admin_pilots_list',
        endpoint: '/api/commander/admin/pilots'
      });
      return res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: err.message || 'Internal server error' });
  }
}
