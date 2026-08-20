/**
 * Clock Presets CRUD API
 * GET    /api/commander/clock-presets         - List all presets for venue
 * POST   /api/commander/clock-presets         - Create preset
 * PUT    /api/commander/clock-presets?id=UUID  - Update preset
 * DELETE /api/commander/clock-presets?id=UUID  - Delete preset
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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

      const staff = await guardWriteStaff(req, res);
      if (!staff) return;

      // For GET, staff may be `true` (read-only). For writes, it's the staff object.
      const venueId = typeof staff === 'object' ? staff.venue_id : null;

      // Resolve venue_id for read-only
      let resolvedVenueId = venueId;
      if (!resolvedVenueId) {
          try {
              const session = JSON.parse(req.headers['x-staff-session'] || '{}');
              resolvedVenueId = session.venue_id;
          } catch (e) { console.warn('[App] Handled exception:', e); }
      }

      if (req.method === 'GET') {
          try {
              let query = getSupabase()
                  .from('commander_clock_presets')
                  .select('*')
                  .order('is_default', { ascending: false })
                  .order('created_at', { ascending: false })
                  .limit(50);

              if (resolvedVenueId) {
                  query = query.eq('venue_id', resolvedVenueId);
              }

              const { data, error } = await query;
              if (error) throw error;

              res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({ success: true, data: data || [] });
          } catch (err) {
              return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
          }
      }

      if (req.method === 'POST') {
          try {
              if (!venueId) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff auth required' } });

              const { name, theme, display_options, is_default } = req.body;
              if (!name) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Name is required' } });

              // If setting as default, unset other defaults for this venue
              if (is_default) {
                  await getSupabase()
                      .from('commander_clock_presets')
                      .update({ is_default: false })
                      .eq('venue_id', venueId)
                      .eq('is_default', true);
              }

              const { data, error } = await getSupabase()
                  .from('commander_clock_presets')
                  .insert({
                      venue_id: venueId,
                      name: name.trim(),
                      theme: theme || {},
                      display_options: display_options || {},
                      is_default: is_default || false,
                  })
                  .select()
                  .maybeSingle();

              if (error) throw error;
              return res.status(201).json({ success: true, data });
          } catch (err) {
              return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
          }
      }

      if (req.method === 'PUT') {
          try {
              if (!venueId) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff auth required' } });

              const presetId = req.query.id || req.body.id;
              if (!presetId) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Preset ID required' } });

              const { name, theme, display_options, is_default } = req.body;

              // If setting as default, unset other defaults for this venue
              if (is_default) {
                  await getSupabase()
                      .from('commander_clock_presets')
                      .update({ is_default: false })
                      .eq('venue_id', venueId)
                      .eq('is_default', true);
              }

              const updates = { updated_at: new Date().toISOString() };
              if (name !== undefined) updates.name = name.trim();
              if (theme !== undefined) updates.theme = theme;
              if (display_options !== undefined) updates.display_options = display_options;
              if (is_default !== undefined) updates.is_default = is_default;

              const { data, error } = await getSupabase()
                  .from('commander_clock_presets')
                  .update(updates)
                  .eq('id', presetId)
                  .eq('venue_id', venueId)
                  .select()
                  .maybeSingle();

              if (error) throw error;
              return res.status(200).json({ success: true, data });
          } catch (err) {
              return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
          }
      }

      if (req.method === 'DELETE') {
          try {
              if (!venueId) return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Staff auth required' } });

              const presetId = req.query.id;
              if (!presetId) return res.status(400).json({ success: false, error: { code: 'VALIDATION', message: 'Preset ID required' } });

              const { error } = await getSupabase()
                  .from('commander_clock_presets')
                  .delete()
                  .eq('id', presetId)
                  .eq('venue_id', venueId);

              if (error) throw error;
              return res.status(200).json({ success: true });
          } catch (err) {
              return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: err.message } });
          }
      }

      res.setHeader('Allow', ['GET', 'POST', 'PUT', 'DELETE']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
