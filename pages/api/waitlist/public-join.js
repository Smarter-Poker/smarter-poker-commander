/**
 * Public Waitlist Join API - POST /api/commander/waitlist/public-join
 * Allows authenticated players to add themselves to a venue waitlist via web.
 * Sets signup_method = 'web' automatically.
 *
 * Auth: Verifies Supabase JWT from Authorization header (Bearer token).
 * Does NOT require staff auth - only a valid logged-in user.
 *
 * Also: cleans up expired web entries (>1 hour, not checked in) on each call.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { captureException } from '../../../src/lib/commander/errorMonitoring';
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

// Anon client for JWT verification
const supabaseAnon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const AVERAGE_WAIT_PER_POSITION = 15;
const WEB_EXPIRY_MINUTES = 60; // Auto-delete after 1 hour

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      // ═══ Auth: Extract and verify JWT from Authorization header ═══
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({
              success: false,
              error: { code: 'AUTH_REQUIRED', message: 'Please sign in to join the waitlist' }
          });
      }

      const token = authHeader.replace('Bearer ', '').trim();

      // Try to parse the token - it might be a raw JWT or a JSON object with access_token
      let accessToken = token;
      try {
          const parsed = JSON.parse(token);
          if (parsed.access_token) accessToken = parsed.access_token;
      } catch { /* token is already a raw JWT */ }

      // Verify the user with Supabase
      const { data: authData, error: authError } = await supabaseAnon.auth.getUser(accessToken);
      const user = authData?.user;

      if (authError || !user) {
          return res.status(401).json({
              success: false,
              error: { code: 'AUTH_REQUIRED', message: 'Please sign in to join the waitlist' }
          });
      }

      try {
          const { venue_id, game_type: rawGameType, stakes, player_phone, player_name } = req.body;
          const game_type = (rawGameType || '').toLowerCase();

          // Validation
          if (!venue_id || !game_type || !stakes) {
              return res.status(400).json({
                  success: false,
                  error: { code: 'VALIDATION_ERROR', message: 'venue_id, game_type, and stakes are required' }
              });
          }

          // Verify venue exists and has Commander enabled
          const { data: venue, error: venueError } = await getSupabase()
              .from('poker_venues')
              .select('id, commander_enabled, name')
              .eq('id', venue_id)
              .maybeSingle();

          if (venueError || !venue) {
              return res.status(404).json({
                  success: false,
                  error: { code: 'NOT_FOUND', message: 'Venue not found' }
              });
          }

          if (!venue.commander_enabled) {
              return res.status(400).json({
                  success: false,
                  error: { code: 'VENUE_NOT_COMMANDER', message: 'Venue is not using Commander' }
              });
          }

          // ═══ Auto-delete expired web entries (>1 hour, not checked in) ═══
          try {
              const expiryTime = new Date(Date.now() - WEB_EXPIRY_MINUTES * 60 * 1000).toISOString();
              await getSupabase()
                  .from('commander_waitlist')
                  .delete()
                  .eq('venue_id', venue_id)
                  .eq('signup_method', 'web')
                  .eq('status', 'waiting')
                  .is('checked_in_at', null)
                  .lt('created_at', expiryTime);
          } catch (cleanupErr) {
              console.warn('Waitlist cleanup warning:', cleanupErr);
          }

          // Check if player already on this waitlist
          const { data: existing } = await getSupabase()
              .from('commander_waitlist')
              .select('id')
              .eq('venue_id', venue_id)
              .ilike('game_type', game_type)
              .eq('stakes', stakes)
              .eq('player_id', user.id)
              .eq('status', 'waiting')
              .maybeSingle();

          if (existing) {
              return res.status(400).json({
                  success: false,
                  error: { code: 'ALREADY_ON_WAITLIST', message: 'You are already on this waitlist' }
              });
          }

          // Get player's display name and phone from profile
          const { data: profile } = await getSupabase()
              .from('profiles')
              .select('display_name, full_name, phone')
              .eq('id', user.id)
              .maybeSingle();

          const playerName = player_name || profile?.display_name || profile?.full_name || user.email?.split('@')[0] || 'Web Player';
          // Phone priority: request body > profiles table > Supabase auth user.phone
          const playerPhone = player_phone || profile?.phone || user.phone || null;

          // Get next position
          const { data: positionResult, error: positionError } = await getSupabase()
              .rpc('get_next_waitlist_position', {
                  p_venue_id: venue_id,
                  p_game_type: game_type,
                  p_stakes: stakes
              });

          const position = positionError ? 1 : positionResult;
          const estimated_wait_minutes = position * AVERAGE_WAIT_PER_POSITION;

          // Find matching active game
          const { data: activeGame } = await getSupabase()
              .from('commander_games')
              .select('id')
              .eq('venue_id', venue_id)
              .ilike('game_type', game_type)
              .eq('stakes', stakes)
              .in('status', ['waiting', 'running'])
              .maybeSingle();

          // Insert waitlist entry
          const { data: entry, error: insertError } = await getSupabase()
              .from('commander_waitlist')
              .insert({
                  venue_id,
                  game_id: activeGame?.id || null,
                  game_type,
                  stakes,
                  player_id: user.id,
                  player_name: playerName,
                  player_phone: playerPhone,
                  position,
                  signup_method: 'web',
                  status: 'waiting',
                  estimated_wait_minutes
              })
              .select()
              .maybeSingle();

          if (insertError) {
              console.warn('Public waitlist join insert error:', insertError);
              return res.status(500).json({
                  success: false,
                  error: { code: 'DATABASE_ERROR', message: 'Failed to join waitlist' }
              });
          }

          // ═══ Upsert into commander_members for kiosk lookup ═══
          // The kiosk searches commander_members by name/phone, not commander_waitlist.
          // This ensures web sign-ups are findable at the kiosk check-in terminal.
          try {
              const nameParts = playerName.trim().split(/\s+/);
              const firstName = nameParts[0] || playerName;
              const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';

              // Check if member already exists for this player+venue
              const { data: existingMember } = await getSupabase()
                  .from('commander_members')
                  .select('id')
                  .eq('venue_id', venue_id)
                  .eq('email', user.email)
                  .maybeSingle();

              if (!existingMember) {
                  // Also try phone match
                  let memberByPhone = null;
                  if (playerPhone) {
                      const { data: mByPhone } = await getSupabase()
                          .from('commander_members')
                          .select('id')
                          .eq('venue_id', venue_id)
                          .eq('phone', playerPhone)
                          .maybeSingle();
                      memberByPhone = mByPhone;
                  }

                  if (!memberByPhone) {
                      // Create new member record
                      const memberNum = `WEB-${Date.now().toString(36).toUpperCase().slice(-5)}`;
                      await getSupabase().from('commander_members').insert({
                          venue_id,
                          member_number: memberNum,
                          first_name: firstName,
                          last_name: lastName,
                          phone: playerPhone,
                          email: user.email,
                          membership_status: 'active',
                          member_type: 'player',
                          notes: 'Auto-registered via web waitlist sign-up'
                      });
                  } else {
                      // Update existing member's name if missing
                      await getSupabase().from('commander_members')
                          .update({ first_name: firstName, last_name: lastName })
                          .eq('id', memberByPhone.id)
                          .is('first_name', null);
                  }
              } else {
                  // Update phone if member exists but phone is missing
                  if (playerPhone) {
                      await getSupabase().from('commander_members')
                          .update({ phone: playerPhone })
                          .eq('id', existingMember.id)
                          .is('phone', null);
                  }
              }
          } catch (memberErr) { console.warn('[App] Handled exception:', memberErr?.message || memberErr); }

          return res.status(201).json({
              success: true,
              data: {
                  entry,
                  position,
                  estimated_wait: estimated_wait_minutes,
                  check_in_deadline: new Date(Date.now() + WEB_EXPIRY_MINUTES * 60 * 1000).toISOString()
              }
          });
      } catch (error) {
          captureException(error, { action: 'waitlist_public_join', endpoint: '/api/commander/waitlist/public-join' });
          return res.status(500).json({
              success: false,
              error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }
          });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
