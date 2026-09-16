/**
 * Daily Presets API (formerly Room Presets)
 * GET    /api/commander/room-presets - List presets for venue
 * POST   /api/commander/room-presets - Create new preset
 * PUT    /api/commander/room-presets?id=X - Update preset
 * DELETE /api/commander/room-presets?id=X - Delete preset
 * POST   /api/commander/room-presets?id=X&action=apply - Apply preset (opens tables, activates promotions, creates tournaments)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardManager } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/apiErrorHandler';

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

    const _g = await guardManager(req, res); if (!_g) return;

    try {
      // 2026-08-20 audit fix: the venue used to be re-read from the RAW
      // x-staff-session header. guardManager above already verified and
      // resolved the session, so take the venue from its result and never
      // parse the client-supplied header again.
      let venueId = _g.venue_id;

      // Fallback: try Bearer token for backward compatibility
      if (!venueId) {
        try {
          const authHeader = req.headers.authorization;
          if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            const { data: authData } = await getSupabase().auth.getUser(token);
            const user = authData?.user;
            if (user) {
              // MULTI-CLUB FIX: limit(1) — unscoped maybeSingle errors for
              // users with staff rows at 2+ venues
              const { data: staff } = await getSupabase()
                .from('commander_staff')
                .select('venue_id')
                .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
                .eq('is_active', true)
                .limit(1)
                .maybeSingle();
              venueId = staff?.venue_id;
            }
          }
        } catch (e) { console.warn('[App] Handled exception:', e); }
      }

      if (!venueId) return res.status(403).json({ success: false, error: 'Could not determine venue' });

      // 2026-08-20 audit fix: role/name/identity came from the RAW header and
      // defaulted to 'owner' when it failed to parse. They now come from the
      // session guardManager already verified.
      const staffRole = _g.role || 'owner';
      const staffName = _g.display_name || 'Staff';
      const staffUserId = _g.user_id || _g.linked_user_id || _g.id || null;

      // Helper: normalize a preset row from DB into frontend-friendly shape
      // DB stores { tables: [...], promotions: [...], tournaments: [...] } all inside `tables` JSONB
      function normalizePreset(row) {
        const config = row.tables || {};
        // Handle old-format presets where tables is the config itself (object like {total:16, nlh_1_2:6})
        // or new format where tables is an object with .tables, .promotions, .tournaments arrays
        const isNewFormat = Array.isArray(config?.tables) || Array.isArray(config?.promotions) || Array.isArray(config?.tournaments);
        return {
          ...row,
          tables: isNewFormat ? (config.tables || []) : (Array.isArray(config) ? config : []),
          promotions: isNewFormat ? (config.promotions || []) : [],
          tournaments: isNewFormat ? (config.tournaments || []) : [],
        };
      }

      // GET - List all presets
      if (req.method === 'GET') {
        const { data, error } = await getSupabase()
          .from('commander_room_presets')
          .select('*')
          .eq('venue_id', venueId)
          .order('name', { ascending: true })
              .limit(100);

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        return res.status(200).json({ success: true, data: (data || []).map(normalizePreset) });
      }

      // POST - Create or Apply
      if (req.method === 'POST') {
        // ═══════════════════════════════════════════════════════════════
        // APPLY PRESET - Opens tables, activates promotions, creates tournaments
        // ═══════════════════════════════════════════════════════════════
        if (req.query.action === 'apply' && req.query.id) {
          const { data: rawPreset, error: fetchErr } = await getSupabase()
            .from('commander_room_presets')
            .select('*')
            .eq('id', req.query.id)
            .eq('venue_id', venueId)
            .maybeSingle();

          if (fetchErr || !rawPreset) {
            return res.status(404).json({ success: false, error: 'Preset not found' });
          }

          const preset = normalizePreset(rawPreset);
          const results = { games_opened: 0, promotions_activated: 0, tournaments_created: 0 };

          // ── 1. OPEN TABLES ──
          const tables = preset.tables || [];
          if (tables.length > 0) {
            const { data: availableTables } = await getSupabase()
              .from('commander_tables')
              .select('id, table_number, status')
              .eq('venue_id', venueId)
              .eq('status', 'available')
              .order('table_number', { ascending: true })
                  .limit(100)

            let tableIdx = 0;
            for (const config of tables) {
              for (let i = 0; i < (config.count || 1); i++) {
                if (tableIdx >= (availableTables || []).length) break;
                const table = availableTables[tableIdx];
                tableIdx++;

                await getSupabase().from('commander_games').insert({
                  venue_id: venueId,
                  table_id: table.id,
                  game_type: config.short_code || config.game_type_name || 'NLH',
                  stakes: config.stakes,
                  min_buyin: config.min_buyin || 100,
                  max_buyin: config.max_buyin || 0,
                  max_players: config.max_players || 9,
                  status: 'waiting',
                  started_at: new Date().toISOString()
                });

                await getSupabase().from('commander_tables')
                  .update({
                    status: 'in_use',
                    game_type: config.short_code || config.game_type_name || 'NLH',
                    stakes: config.stakes
                  })
                  .eq('id', table.id);

                results.games_opened++;
              }
            }
          }

          // ── 2. ACTIVATE PROMOTIONS ──
          const promotionIds = preset.promotions || [];
          if (promotionIds.length > 0) {
            const { error: promoErr } = await getSupabase()
              .from('commander_promotions')
              .update({ is_active: true, status: 'active' })
              .in('id', promotionIds)
              .eq('venue_id', venueId);

            if (!promoErr) {
              results.promotions_activated = promotionIds.length;
            }
          }

          // ── 3. CREATE TOURNAMENT INSTANCES ──
          const tournamentTemplates = preset.tournaments || [];
          if (tournamentTemplates.length > 0) {
            const today = new Date();
            for (const tmpl of tournamentTemplates) {
              // Calculate scheduled start from offset or explicit time
              let scheduledStart;
              if (tmpl.start_time) {
                // start_time is "HH:MM" format - combine with today's date
                const [h, m] = tmpl.start_time.split(':').map(Number);
                scheduledStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), h, m);
              } else if (tmpl.start_time_offset_minutes) {
                scheduledStart = new Date(today.getTime() + tmpl.start_time_offset_minutes * 60000);
              } else {
                scheduledStart = new Date(today.getTime() + 3600000); // default: 1 hour from now
              }

              const { error: tErr } = await getSupabase().from('commander_tournaments').insert({
                venue_id: venueId,
                name: tmpl.name || 'Daily Tournament',
                description: tmpl.description || null,
                tournament_type: tmpl.tournament_type || 'freezeout',
                buyin_amount: tmpl.buyin_amount || 0,
                buyin_fee: tmpl.buyin_fee || 0,
                starting_chips: tmpl.starting_chips || 10000,
                scheduled_start: scheduledStart.toISOString(),
                registration_opens: new Date().toISOString(),
                late_registration_levels: tmpl.late_registration_levels || 6,
                max_entries: tmpl.max_entries || null,
                guaranteed_pool: tmpl.guaranteed_pool || 0,
                blind_structure: tmpl.blind_structure || [],
                break_schedule: tmpl.break_schedule || [],
                payout_structure: tmpl.payout_structure || [],
                allows_rebuys: tmpl.allows_rebuys || false,
                rebuy_amount: tmpl.rebuy_amount || null,
                rebuy_chips: tmpl.rebuy_chips || null,
                max_rebuys: tmpl.max_rebuys || null,
                allows_addon: tmpl.allows_addon || false,
                addon_amount: tmpl.addon_amount || null,
                addon_chips: tmpl.addon_chips || null,
                bounty_amount: tmpl.bounty_amount || null,
                broadcast_to_smarter: tmpl.broadcast_to_smarter !== false,
                status: 'scheduled',
                settings: tmpl.settings || {}
              });

              if (!tErr) results.tournaments_created++;
            }
          }

          // Update last_applied_at
          await getSupabase().from('commander_room_presets')
            .update({ last_applied_at: new Date().toISOString() })
            .eq('id', preset.id);

          // Log it
          await getSupabase().from('commander_system_log').insert({
            venue_id: venueId,
            action: 'daily_preset_applied',
            details: {
              preset_id: preset.id,
              preset_name: preset.name,
              ...results
            },
            performed_by: staffUserId,
            performed_by_name: staffName
          });

          return res.status(200).json({
            success: true,
            data: { preset_name: preset.name, ...results }
          });
        }

        // ═══════════════════════════════════════════════════════════════
        // CREATE NEW PRESET
        // ═══════════════════════════════════════════════════════════════
        if (!['owner', 'manager'].includes(staffRole)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const { name, description, tables: tableConfigs, promotions, tournaments,
          is_default, start_time, day_of_week } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Preset name required' });

        // Pack tables, promotions, tournaments into single JSONB `tables` column
        const tablesJsonb = {
          tables: tableConfigs || [],
          promotions: promotions || [],
          tournaments: tournaments || [],
        };

        const { data, error } = await getSupabase()
          .from('commander_room_presets')
          .insert({
            venue_id: venueId,
            name,
            description: description || null,
            tables: tablesJsonb,
            is_default: is_default || false,
            auto_apply_schedule: start_time && day_of_week
              ? { start_time, day_of_week }
              : null,
            created_by: staffUserId
          })
          .select()
          .maybeSingle();

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        return res.status(201).json({ success: true, data: normalizePreset(data) });
      }

      // PUT - Update preset
      if (req.method === 'PUT') {
        if (!['owner', 'manager'].includes(staffRole)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: 'Preset ID required' });

        const updates = {};
        // Simple scalar fields
        if (req.body.name !== undefined) updates.name = req.body.name;
        if (req.body.description !== undefined) updates.description = req.body.description;
        if (req.body.is_default !== undefined) updates.is_default = req.body.is_default;

        // Pack tables/promotions/tournaments into single JSONB `tables` column
        if (req.body.tables !== undefined || req.body.promotions !== undefined || req.body.tournaments !== undefined) {
          updates.tables = {
            tables: req.body.tables || [],
            promotions: req.body.promotions || [],
            tournaments: req.body.tournaments || [],
          };
        }

        // Build auto_apply_schedule from start_time + day_of_week
        if (req.body.start_time !== undefined || req.body.day_of_week !== undefined) {
          updates.auto_apply_schedule = {
            start_time: req.body.start_time || null,
            day_of_week: req.body.day_of_week || null
          };
        }

        const { data, error } = await getSupabase()
          .from('commander_room_presets')
          .update(updates)
          .eq('id', id)
          .eq('venue_id', venueId)
          .select()
          .maybeSingle();

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        return res.status(200).json({ success: true, data: normalizePreset(data) });
      }

      // DELETE
      if (req.method === 'DELETE') {
        if (!['owner', 'manager'].includes(staffRole)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: 'Preset ID required' });

        const { error } = await getSupabase()
          .from('commander_room_presets')
          .delete()
          .eq('id', id)
          .eq('venue_id', venueId);

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        return res.status(200).json({ success: true });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Daily presets API error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
