/**
 * Freeroll Qualifications API
 * GET    /api/commander/freerolls/[id]/qualifications - List qualifications
 * POST   /api/commander/freerolls/[id]/qualifications - Add / update a player
 * DELETE /api/commander/freerolls/[id]/qualifications - Remove a player (pass ?player_id=)
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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const guard = await guardWriteStaff(req, res);
      if (!guard) return;

      const freerollId = req.query.id;
      if (!freerollId) {
          return res.status(400).json({
              success: false,
              error: { code: 'MISSING_ID', message: 'Freeroll ID required' }
          });
      }

      if (req.method === 'GET') return listQualifications(req, res, freerollId);
      if (req.method === 'POST') return upsertQualification(req, res, freerollId);
      if (req.method === 'DELETE') return removeQualification(req, res, freerollId);

      return res.status(405).json({
          success: false,
          error: { code: 'METHOD_NOT_ALLOWED', message: 'GET, POST, DELETE allowed' }
      });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listQualifications(req, res, freerollId) {
    try {
        const { data: quals, error } = await getSupabase()
            .from('commander_freeroll_qualifications')
            .select('*')
            .eq('freeroll_id', freerollId)
            .order('is_qualified', { ascending: false })
            .order('hours_logged', { ascending: false })
            .order('points_earned', { ascending: false })

        if (error) throw error;

        return res.status(200).json({
            success: true,
            data: { qualifications: quals || [] }
        });
    } catch (error) {
        console.warn('Qualifications fetch error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Failed to fetch qualifications' }
        });
    }
}

async function upsertQualification(req, res, freerollId) {
    const {
        player_id, player_name, hours_logged, points_earned,
        custom_value, is_qualified, manually_added, notes
    } = req.body;

    if (!player_id && !player_name) {
        return res.status(400).json({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'player_id or player_name required' }
        });
    }

    try {
        // First check the freeroll to auto-qualify based on threshold
        const { data: freeroll } = await getSupabase()
            .from('commander_freerolls')
            .select('qualification_type, qualification_threshold')
            .eq('id', freerollId)
            .maybeSingle();

        let autoQualified = is_qualified || false;
        const threshold = freeroll?.qualification_threshold || 0;

        if (freeroll && threshold > 0) {
            if (freeroll.qualification_type === 'cash_hours' && (hours_logged || 0) >= threshold) {
                autoQualified = true;
            }
            if (freeroll.qualification_type === 'tournament_points' && (points_earned || 0) >= threshold) {
                autoQualified = true;
            }
        }

        if (manually_added && is_qualified !== false) autoQualified = true;

        const payload = {
            freeroll_id: freerollId,
            player_id: player_id || null,
            player_name: player_name || null,
            hours_logged: hours_logged ?? 0,
            points_earned: points_earned ?? 0,
            custom_value: custom_value || null,
            is_qualified: autoQualified,
            qualified_at: autoQualified ? new Date().toISOString() : null,
            manually_added: manually_added || false,
            notes: notes || null,
            updated_at: new Date().toISOString(),
        };

        let qual, error;

        if (player_id) {
            // Upsert based on freeroll_id + player_id (real user)
            const result = await getSupabase()
                .from('commander_freeroll_qualifications')
                .upsert(payload, {
                    onConflict: 'freeroll_id,player_id',
                    ignoreDuplicates: false,
                })
                .select()
                .maybeSingle();
            qual = result.data;
            error = result.error;
        } else {
            // Insert for name-only players (no real user_id)
            const result = await getSupabase()
                .from('commander_freeroll_qualifications')
                .insert(payload)
                .select()
                .maybeSingle();
            qual = result.data;
            error = result.error;
        }

        if (error) throw error;

        return res.status(200).json({ success: true, data: { qualification: qual } });
    } catch (error) {
        console.warn('Upsert qualification error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Internal server error' }
        });
    }
}

async function removeQualification(req, res, freerollId) {
    const playerId = req.query.player_id || req.body?.player_id;

    if (!playerId) {
        return res.status(400).json({
            success: false,
            error: { code: 'MISSING_FIELDS', message: 'player_id required' }
        });
    }

    try {
        const { error } = await getSupabase()
            .from('commander_freeroll_qualifications')
            .delete()
            .eq('freeroll_id', freerollId)
            .eq('player_id', playerId);

        if (error) throw error;

        return res.status(200).json({ success: true });
    } catch (error) {
        try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
        console.warn('Remove qualification error:', error);
        return res.status(500).json({
            success: false,
            error: { code: 'SERVER_ERROR', message: 'Internal server error' }
        });
    }
}
