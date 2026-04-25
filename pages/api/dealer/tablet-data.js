/**
 * Tablet Data API - Unified endpoint for table tablet displays
 * GET /api/commander/dealer/tablet-data?table=N&venue_id=Y
 * 
 * Returns all data the tablet needs in a single call:
 * - Table details (game type, stakes, max seats)
 * - Active player sessions with time remaining
 * - Current dealer assignment
 * 
 * No auth required — tablet is unauthenticated.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
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

      if (req.method !== 'GET') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { table, venue_id } = req.query;

      if (!table) {
          return res.status(400).json({ success: false, error: 'table parameter is required' });
      }

      const tableNum = parseInt(table);

      try {
          // 1. Get table details
          let tableQuery = getSupabase()
              .from('commander_tables')
              .select('id, venue_id, table_number, table_name, max_seats, status, mode, game_type, stakes')
              .eq('table_number', tableNum);

          if (venue_id) {
              tableQuery = tableQuery.eq('venue_id', venue_id);
          }

          const { data: tableData, error: tableError } = await tableQuery.limit(1).maybeSingle();
          if (tableError) throw tableError;

          // Resolve venue_id from table if not provided
          const resolvedVenueId = venue_id || tableData?.venue_id || null;

          // 1b. Get venue settings for mode detection
          let venueType = 'texas'; // default
          let venueSettings = null;
          if (resolvedVenueId) {
              try {
                  const { data: vs } = await getSupabase()
                      .from('commander_venue_settings')
                      .select('venue_type, time_billing_rate, auto_comp_rate')
                      .eq('venue_id', resolvedVenueId)
                      .maybeSingle();
                  if (vs?.venue_type) venueType = vs.venue_type;
                  venueSettings = vs;
              } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
          }

          // 2. Get active player sessions — try both table names for migration compatibility
          let sessions = [];
          try {
              let sessionsQuery = getSupabase()
                  .from('commander_table_sessions')
                  .select('*')
                  .eq('table_number', tableNum)
                  .eq('status', 'active')
                  .order('seat_number', { ascending: true });

              if (resolvedVenueId) {
                  sessionsQuery = sessionsQuery.eq('venue_id', resolvedVenueId);
              }

              const { data, error } = await sessionsQuery;
              if (error) {
                  // Table doesn't exist — try fallback
                  if (error.message?.includes('schema cache')) {
                      let fallbackQuery = getSupabase()
                          .from('commander_table_sessions')
                          .select('*')
                          .eq('table_number', tableNum)
                          .eq('status', 'active')
                          .order('seat_number', { ascending: true });

                      if (resolvedVenueId) {
                          fallbackQuery = fallbackQuery.eq('venue_id', resolvedVenueId);
                      }

                      const { data: fbData } = await fallbackQuery;
                      sessions = fbData || [];
                  }
              } else {
                  sessions = data || [];
              }
          } catch (e) {
              console.warn('Sessions query failed, continuing with empty:', e.message);
          }

          // Calculate time remaining for each session
          const now = new Date();
          const playersWithTime = (sessions || []).map(s => {
              const totalAllocatedSeconds = ((s.time_allocated_minutes || 0) + (s.time_added_minutes || 0)) * 60;
              const elapsedSeconds = Math.floor((now - new Date(s.started_at)) / 1000);
              const timeRemaining = Math.max(0, totalAllocatedSeconds - elapsedSeconds);

              return {
                  session_id: s.id,
                  member_id: s.member_id,
                  player_name: s.player_name,
                  table_number: s.table_number,
                  seat_number: s.seat_number,
                  membership_tier: s.membership_tier,
                  member_number: s.member_number,
                  time_allocated_minutes: s.time_allocated_minutes,
                  time_added_minutes: s.time_added_minutes,
                  started_at: s.started_at,
                  time_remaining: timeRemaining,
                  is_low: timeRemaining <= 900 && timeRemaining > 0,
                  is_critical: timeRemaining <= 300 && timeRemaining > 0,
                  is_expired: timeRemaining <= 0
              };
          });

          // 3. Get current dealer — handle both old and new schema
          let dealer = null;
          try {
              let dealerQuery = getSupabase()
                  .from('commander_dealer_rotations')
                  .select('id, dealer_id, dealer_name, table_number, started_at')
                  .eq('table_number', tableNum)
                  .is('ended_at', null)
                  .order('started_at', { ascending: false })
                  .limit(1);

              if (resolvedVenueId) {
                  dealerQuery = dealerQuery.eq('venue_id', resolvedVenueId);
              }

              let { data: rotationData, error: rotationError } = await dealerQuery;

              // If columns don't exist, try minimal column set
              if (rotationError && rotationError.message?.includes('does not exist')) {
                  // Old schema: try without dealer_name and table_number in SELECT
                  // Note: table_number may not exist as WHERE column either
                  const { data: fallbackData } = await getSupabase()
                      .from('commander_dealer_rotations')
                      .select('id, dealer_id, started_at')
                      .is('ended_at', null)
                      .order('started_at', { ascending: false })
                      .limit(1);
                  rotationData = fallbackData;
              }

              const rotation = rotationData?.[0] || null;

              if (rotation) {
                  // Fetch dealer details from the correct table
                  let dealerDetails = null;
                  if (rotation.dealer_id) {
                      const { data: dealerRow } = await getSupabase()
                          .from('commander_dealers')
                          .select('id, name, employee_id, skill_level')
                          .eq('id', rotation.dealer_id)
                          .maybeSingle();
                      dealerDetails = dealerRow;
                  }

                  const dealerName = rotation.dealer_name || dealerDetails?.name || null;

                  dealer = {
                      id: rotation.dealer_id,
                      name: dealerName,
                      employee_id: dealerDetails?.employee_id || null,
                      skill_level: dealerDetails?.skill_level || null,
                      started_at: rotation.started_at,
                      rotation_id: rotation.id
                  };
              }
          } catch (e) {
              console.warn('Dealer rotation query failed:', e.message);
          }

          // 4. Get venue name
          let venue_name = '';
          if (resolvedVenueId) {
              try {
                  const { data: venueData } = await getSupabase()
                      .from('poker_venues')
                      .select('name')
                      .eq('id', resolvedVenueId)
                      .maybeSingle();
                  if (venueData?.name) venue_name = venueData.name;
              } catch { /* non-fatal */ }
          }

          // 5. Get active promotions for ticker
          let promotions = [];
          if (resolvedVenueId) {
              try {
                  const { data: promoData } = await getSupabase()
                      .from('commander_promotions')
                      .select('id, title, name, description, type, status')
                      .eq('venue_id', resolvedVenueId)
                      .eq('status', 'active')
                      .order('created_at', { ascending: false })
                      .limit(10);
                  promotions = promoData || [];
              } catch { /* non-fatal */ }
          }

          // 6. Get active announcements for ticker
          let announcements = [];
          if (resolvedVenueId) {
              try {
                  const { data: annData } = await getSupabase()
                      .from('commander_club_announcements')
                      .select('id, title, message, type, priority')
                      .eq('venue_id', resolvedVenueId)
                      .eq('status', 'active')
                      .order('created_at', { ascending: false })
                      .limit(5);
                  announcements = annData || [];
              } catch { /* non-fatal */ }
          }

          // 7. Update tablet heartbeat (auto-register on first fetch)
          if (resolvedVenueId) {
              try {
                  const deviceId = `tablet-${resolvedVenueId}-table-${tableNum}`;
                  await getSupabase()
                      .from('commander_table_displays')
                      .upsert({
                          device_id: deviceId,
                          venue_id: resolvedVenueId,
                          device_name: `Table ${tableNum} Tablet`,
                          device_type: 'tablet',
                          is_online: true,
                          last_heartbeat: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                      }, {
                          onConflict: 'device_id',
                          ignoreDuplicates: false,
                      });
              } catch { /* heartbeat is best-effort */ }
          }

          // 2b. If table is in tournament mode, also fetch tournament player seats
          // This is how dealers see moved players after an auto table break.
          let tournamentPlayers = [];
          if (tableData?.mode === 'tournament' && tableData?.tournament_id) {
              try {
                  const { data: tEntries } = await getSupabase()
                      .from('commander_tournament_entries')
                      .select('id, player_name, player_id, table_number, seat_number, current_chips, status')
                      .eq('tournament_id', tableData.tournament_id)
                      .eq('table_number', tableNum)
                      .in('status', ['active', 'seated'])
                      .order('seat_number', { ascending: true });

                  tournamentPlayers = (tEntries || []).map(e => ({
                      session_id: `tournament-${e.id}`,
                      member_id: e.player_id,
                      player_name: e.player_name,
                      table_number: e.table_number,
                      seat_number: e.seat_number,
                      membership_tier: null,
                      member_number: null,
                      current_chips: e.current_chips,
                      time_remaining: null,
                      is_low: false,
                      is_critical: false,
                      is_expired: false,
                      is_tournament_player: true,
                  }));
              } catch (e) {
                  console.warn('[tablet-data] Tournament entries lookup failed:', e.message);
              }
          }

          // Merge: tournament players override sessions for tournament tables.
          // For cash tables, tournamentPlayers is [] so playersWithTime stands alone.
          const allPlayers = tournamentPlayers.length > 0
              ? tournamentPlayers
              : playersWithTime;

          return res.status(200).json({

              success: true,
              data: {
                  table: tableData || {
                      table_number: tableNum,
                      max_seats: 9,
                      game_type: 'NLH',
                      stakes: '',
                      venue_id: resolvedVenueId
                  },
                  players: allPlayers,
                  dealer: dealer,
                  venue_type: venueType,
                  venue_name,
                  promotions,
                  announcements,
              }

          });
      } catch (err) {
          console.warn('Tablet data error:', err);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
