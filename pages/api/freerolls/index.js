/**
 * Freerolls API
 * GET  /api/commander/freerolls - List freerolls for a venue
 * POST /api/commander/freerolls - Create a new freeroll
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// 2026-08-20 audit fix: this parsed the UNSIGNED x-staff-session header. The
// venue now comes from the verified session object returned by guardStaff.
function getVenueIdFromStaff(staff) {
    if (!staff || staff === true) return null;
    return (staff.venue_id === undefined || staff.venue_id === null) ? null : parseInt(staff.venue_id);
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      // 2026-08-20 audit fix: was guardWriteStaff, which returns `true` for GET
      // without verifying anything - and with no (or a forged) x-staff-session
      // the list query ran unfiltered, returning every venue's freerolls.
      const guard = await guardStaff(req, res);
      if (!guard) return;

      if (req.method === 'POST') return createFreeroll(req, res, guard);
      if (req.method !== 'GET') {
          return res.status(405).json({
              success: false,
              error: { code: 'METHOD_NOT_ALLOWED', message: 'GET and POST allowed' }
          });
      }

      return listFreerolls(req, res, guard);

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listFreerolls(req, res, staff) {
    try {
        const venueId = getVenueIdFromStaff(staff);
        const { status, limit = 50 } = req.query;

        let query = getSupabase()
            .from('commander_freerolls')
            .select('*')
            .order('scheduled_date', { ascending: false, nullsFirst: false })
            .limit(Math.min(parseInt(limit) || 50, 500));

        if (venueId) {
            query = query.eq('venue_id', venueId);
        }

        if (status) {
            query = query.eq('status', status);
        }

        const { data: freerolls, error } = await query;

        if (error) {
            // Handle missing-table cleanly - feature not provisioned in this Supabase project.
            // Migration archived at supabase/migrations/archive/20260225_freerolls.sql,
            // never applied to production. Return empty list + clear flag instead of 500.
            if (error.code === '42P01' || /relation .* does not exist/i.test(error.message || '')) {
                console.warn('[freerolls] commander_freerolls table not provisioned; returning empty list');
                return res.status(200).json({
                    success: true,
                    data: { freerolls: [] },
                    feature_disabled: true,
                    reason: 'commander_freerolls table not provisioned in this Supabase project',
                });
            }
            console.warn('Freerolls fetch error:', error);
            throw error;
        }

        // Get qualification counts per freeroll
        const freerollIds = (freerolls || []).map(f => f.id);
        let qualCounts = {};

        if (freerollIds.length > 0) {
            // ASI fix 2026-04-28: missing semicolon caused next line `(quals||[])`
            // to be parsed as `chain(quals||[])`, throwing TypeError. Added explicit ;.
            const { data: quals } = await getSupabase()
                .from('commander_freeroll_qualifications')
                .select('freeroll_id, is_qualified')
                .in('freeroll_id', freerollIds);

            (quals || []).forEach(q => {
                if (!qualCounts[q.freeroll_id]) {
                    qualCounts[q.freeroll_id] = { total: 0, qualified: 0 };
                }
                qualCounts[q.freeroll_id].total++;
                if (q.is_qualified) qualCounts[q.freeroll_id].qualified++;
            });
        }

        const enriched = (freerolls || []).map(fr => ({
            ...fr,
            total_tracked: qualCounts[fr.id]?.total || 0,
            qualified_count: qualCounts[fr.id]?.qualified || 0,
        }));

        return res.status(200).json({
            success: true,
            data: { freerolls: enriched }
        });

    } catch (error) {
        console.warn('Freerolls error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Failed to fetch freerolls' }
        });
    }
}

async function createFreeroll(req, res, guard) {
    const venueId = guard.venue_id || getVenueIdFromStaff(guard);
    const {
        name, description, qualification_type, qualification_threshold,
        qualification_period, qualification_game_types, qualification_min_stakes,
        qualification_rules_text, scheduled_date, prize_pool, prize_description,
        max_qualifiers, status
    } = req.body;

    if (!name) {
        return res.status(400).json({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'Freeroll name required' }
        });
    }

    try {
        const { data: freeroll, error } = await getSupabase()
            .from('commander_freerolls')
            .insert({
                venue_id: venueId,
                name: name.trim(),
                description: description?.trim() || null,
                qualification_type: qualification_type || 'cash_hours',
                qualification_threshold: qualification_threshold || 0,
                qualification_period: qualification_period || 'weekly',
                qualification_game_types: qualification_game_types || ['nlhe'],
                qualification_min_stakes: qualification_min_stakes || null,
                qualification_rules_text: qualification_rules_text || null,
                scheduled_date: scheduled_date || null,
                prize_pool: prize_pool ? parseFloat(prize_pool) : 0,
                prize_description: prize_description || null,
                max_qualifiers: max_qualifiers ? parseInt(max_qualifiers) : null,
                status: status || 'upcoming',
                created_by: guard.id || null,
            })
            .select()
            .maybeSingle();

        if (error) throw error;

        return res.status(201).json({ success: true, data: { freeroll } });
    } catch (error) {
        try { reportApiError(error, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
        console.warn('Create freeroll error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Internal server error' }
        });
    }
}
