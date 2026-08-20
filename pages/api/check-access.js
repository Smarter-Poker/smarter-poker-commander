/**
 * Check if the logged-in user has Commander access (staff or subscription)
 * Uses service role key to bypass RLS - called by WorldHub to detect Commander accounts
 * Accepts Bearer token in Authorization header (same pattern as other Commander APIs)
 * Returns { hasAccess: true/false, staff: {...} } 
 */
const { createClient } = require('../../src/lib/supabaseServerClient');
const { applyRateLimit, LIMITS } = require('../../src/lib/apiRateLimit');
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
    if (!applyRateLimit(req, res, LIMITS.read)) return;

      if (req.method !== 'GET') {
          return res.status(405).json({ error: 'Method not allowed' });
      }

      try {
          // Get user from Bearer token (same pattern as other Commander APIs)
          const authHeader = req.headers.authorization;
          if (!authHeader) {
              return res.status(200).json({ hasAccess: false });
          }
          const token = authHeader.replace('Bearer ', '');
          const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
          const user = authData?.user;

          if (authError || !user) {
              return res.status(200).json({ hasAccess: false });
          }

          // Check 1: commander_staff table (staff members: owner, manager, floor, etc.)
          const { data: staffRecords, error: staffError } = await getSupabase()
              .from('commander_staff')
              .select('id, venue_id, role, poker_venues(id, name, commander_tier)')
              .eq('user_id', user.id)
              .eq('is_active', true)
              .limit(1);

          if (!staffError && staffRecords && staffRecords.length > 0) {
              const record = staffRecords[0];
              return res.status(200).json({
                  hasAccess: true,
                  tier: record.poker_venues?.commander_tier || 'home_game',
                  staff: {
                      user_id: user.id,
                      id: record.id,
                      venue_id: record.venue_id,
                      role: record.role,
                      venue_name: record.poker_venues?.name || 'My Venue',
                  },
              });
          }

          // Check 2: commander_subscriptions table (venue owners with active/trialing subscription)
          const { data: subs, error: subError } = await getSupabase()
              .from('commander_subscriptions')
              .select('id, venue_id, tier, billing_name, status, venue:poker_venues(id, name)')
              .eq('owner_id', user.id)
              .in('status', ['active', 'trialing'])
              .limit(1);

          if (!subError && subs && subs.length > 0) {
              const sub = subs[0];
              return res.status(200).json({
                  hasAccess: true,
                  tier: sub.tier || 'home_game',
                  staff: {
                      user_id: user.id,
                      role: 'owner',
                      venue_id: sub.venue_id,
                      venue_name: sub.venue?.name || 'My Venue',
                      display_name: sub.billing_name || user.email,
                  },
              });
          }

          // No access found
          return res.status(200).json({ hasAccess: false });
      } catch (err) {
          console.warn('[check-access] Error:', err);
          return res.status(200).json({ hasAccess: false }); // Fail open - don't block the Hub
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
