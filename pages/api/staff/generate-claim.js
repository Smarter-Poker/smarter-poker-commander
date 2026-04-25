/**
 * Generate Claim Code API — POST /api/commander/staff/generate-claim
 * Owner/manager generates a claim code for a staff member
 * Employee uses this code to link their Smarter.Poker account
 */
import crypto from 'crypto';
import { createClient } from '../../../src/lib/supabaseServerClient';
import { verifyManagerSession, guardOwnerStaff } from '../../../src/lib/commander/auth';
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

// Auth: OWNER — requires owner role
export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardOwnerStaff(req, res);
      if (!_staff) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      try {
          const { venue_id, staff_id } = req.body;

          if (!venue_id || !staff_id) {
              return res.status(400).json({ success: false, error: 'venue_id and staff_id required' });
          }

          // Require owner or manager auth
          const authResult = await verifyManagerSession(req, venue_id);
          if (authResult.error) {
              return res.status(authResult.error.status).json({
                  success: false,
                  error: authResult.error.message,
              });
          }

          // Verify staff exists at this venue
          const { data: staff, error: staffErr } = await getSupabase()
              .from('commander_staff')
              .select('id, display_name, role, linked_user_id, email')
              .eq('id', staff_id)
              .eq('venue_id', venue_id)
              .eq('is_active', true)
              .maybeSingle();

          if (staffErr || !staff) {
              return res.status(404).json({ success: false, error: 'Staff member not found' });
          }

          if (staff.linked_user_id) {
              return res.status(400).json({
                  success: false,
                  error: 'This staff member is already linked to a Smarter.Poker account',
              });
          }

          // Invalidate any existing unclaimed tokens for this staff member
          await getSupabase()
              .from('staff_claim_tokens')
              .update({ expires_at: new Date().toISOString() })
              .eq('staff_id', staff_id)
              .is('claimed_by', null);

          // Generate a unique 6-character alphanumeric code
          const token = crypto.randomBytes(4).toString('hex').substring(0, 6).toUpperCase();

          const { data: claim, error: insertErr } = await getSupabase()
              .from('staff_claim_tokens')
              .insert({
                  venue_id,
                  staff_id,
                  token,
                  expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
              })
              .select()
              .maybeSingle();

          if (insertErr) {
              console.warn('Generate claim error:', insertErr);
              return res.status(500).json({ success: false, error: 'Failed to generate claim code' });
          }

          // Get venue name for the claim URL display
          const { data: venue } = await getSupabase()
              .from('poker_venues')
              .select('name')
              .eq('id', venue_id)
              .maybeSingle();

          return res.status(201).json({
              success: true,
              data: {
                  token: claim.token,
                  expires_at: claim.expires_at,
                  claim_url: `https://smarter.poker/claim/${claim.token}`,
                  staff_name: staff.display_name,
                  venue_name: venue?.name || 'Unknown Venue',
              },
          });

          // Execute audit log after returning response if possible, or just before
      } catch (err) {
          console.warn('Generate claim code error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
