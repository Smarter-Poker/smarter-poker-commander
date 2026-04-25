/**
 * Venue Settings API
 * GET /api/commander/settings - Get venue settings
 * PUT /api/commander/settings - Update venue settings (room_open, etc)
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardStaff, guardManager } from '../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // GET: any staff can read settings (hard stop timer, security gate, etc.)
    // PUT: only managers/owners can modify settings
    const staff = req.method === 'GET'
      ? await guardStaff(req, res)
      : await guardManager(req, res);
    if (!staff) return;

    try {
      if (req.method === 'GET') {
        const { data: settings } = await getSupabase()
          .from('commander_venue_settings')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .maybeSingle();

        return res.status(200).json({
          success: true,
          data: settings || { venue_id: staff.venue_id, room_open: false }
        });
      }

      if (req.method === 'PUT') {
        const updates = req.body;
        const allowedFields = ['room_open', 'default_game_type', 'default_stakes',
          'max_tables', 'default_seats_per_table', 'time_billing_rate', 'auto_comp_rate',
          'venue_type', 'bulk_time_packages', 'club_logo_url',
          'late_reg_levels', 'default_starting_chips', 'house_rules',
          'hard_stop_enabled', 'hard_stop_time', 'last_hard_stop_date',
          'auto_refresh_interval', 'show_player_names_on_display',
          'sms_notifications_enabled', 'push_notifications_enabled',
          'max_waitlist_size', 'call_timeout_minutes', 'default_wait_time_per_player',
          'desk_customization', 'security_gate_enabled'];

        const filtered = {};
        for (const key of allowedFields) {
          if (updates[key] !== undefined) filtered[key] = updates[key];
        }

        const { data, error } = await getSupabase()
          .from('commander_venue_settings')
          .upsert({
            venue_id: staff.venue_id,
            ...filtered,
            updated_at: new Date().toISOString(),
            updated_by: staff.id
          }, { onConflict: 'venue_id' })
          .select()
          .maybeSingle();

        if (error) {
          return res.status(500).json({ success: false, error: 'Failed to upsert settings' });
        }

        if (!data) {
          return res.status(500).json({ success: false, error: 'Failed to upsert settings' });
        }

        return res.status(200).json({ success: true, data });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Settings error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
