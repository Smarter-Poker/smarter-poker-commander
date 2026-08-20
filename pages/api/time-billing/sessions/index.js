/**
 * Time Billing Sessions API
 * GET /api/commander/time-billing/sessions - List sessions (active/completed)
 * POST /api/commander/time-billing/sessions - Start new session
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const staff = await guardStaff(req, res); if (!staff) return;

    try {

      if (req.method === 'GET') {
        const { data: sessions, error } = await getSupabase()
          .from('commander_table_sessions')
          .select('*')
          .eq('venue_id', staff.venue_id)
          .order('started_at', { ascending: false })
          .limit(100);

        if (error) {
          // Table might not exist yet - return empty
          return res.status(200).json({ success: true, data: [] });
        }
        return res.status(200).json({ success: true, data: sessions || [] });
      }

      if (req.method === 'POST') {
        const { player_name, table_number, seat_number, rate_per_hour } = req.body;
        if (!player_name) return res.status(400).json({ success: false, error: 'Player name required' });

        // If no rate provided, look up venue's saved time_billing_rate
        let finalRate = rate_per_hour;
        if (!finalRate) {
          const { data: settings } = await getSupabase()
            .from('commander_venue_settings')
            .select('time_billing_rate')
            .eq('venue_id', staff.venue_id)
            .maybeSingle();
          finalRate = settings?.time_billing_rate || 0;
        }

        const { data: session, error } = await getSupabase()
          .from('commander_table_sessions')
          .insert({
            venue_id: staff.venue_id,
            player_name,
            table_number: table_number || null,
            seat_number: seat_number || null,
            rate_per_hour: finalRate,
            status: 'active',
            started_at: new Date().toISOString(),
            started_by: staff.id,
            amount_paid: 0,
            total_charge: 0
          })
          .select()
          .maybeSingle();

        if (error) {
          console.warn('Time session create error:', error);
          return res.status(500).json({ success: false, error: 'Internal server error' });
        }
        if (!session) {
          return res.status(500).json({ success: false, error: 'Failed to create session' });
        }
        return res.status(201).json({ success: true, data: session });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Time billing error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
