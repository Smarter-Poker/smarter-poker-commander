/**
 * Tablet Data API - Unified endpoint for table tablet displays
 * GET /api/commander/dealer/tablet-data?table=N&venue_id=Y
 * 
 * Returns all data the tablet needs in a single call:
 * - Table details (game type, stakes, max seats)
 * - Active player sessions with time remaining
 * - Current dealer assignment
 * 
 * No auth required - tablet is unauthenticated.
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

// Only the columns the tablet actually renders, plus the two pause columns the
// billing maths needs. `select('*')` also dragged rate_per_hour, total_charge,
// amount_paid and ended_by to an unauthenticated kiosk on every poll.
const SESSION_COLUMNS = [
    'id', 'member_id', 'player_name', 'table_number', 'seat_number',
    'membership_tier', 'member_number', 'time_allocated_minutes',
    'time_added_minutes', 'started_at', 'paused_at', 'total_paused_minutes'
].join(', ');

// Display heartbeat throttle. Every tablet in the room polls this route every
// 10 seconds and each poll used to fire an unconditional upsert into
// commander_table_displays: 20 tablets is 120 row writes a minute, plus WAL and
// index churn and the autovacuum that follows, purely to record "still here".
//
// The freshness consumers (pages/api/displays/status.js line 53 and
// pages/commander/table-tablets.js line 1430) both call a device online when
// last_heartbeat is inside 120 seconds, so a 30 second write cadence keeps the
// status accurate to well inside a minute.
//
// Two layers, because an in-process map alone is not enough: requests from one
// tablet can land on several Lambda instances, and each of those would think it
// was the first to write.
//   Layer 1 (this map): if THIS instance wrote for the device inside 30
//     seconds, skip the query entirely - no round trip at all.
//   Layer 2 (HEARTBEAT_MODE_REFRESH below): otherwise send an UPDATE carrying
//     `last_heartbeat < now - 30s`, so an instance that did not write still
//     cannot re-write a heartbeat another instance just refreshed. A no-op
//     UPDATE is an index probe and no row version, which is the cost we are
//     actually trying to remove.
// A device this process has never seen gets the full upsert, which is what
// registers the row in the first place.
const HEARTBEAT_MIN_INTERVAL_MS = 30 * 1000;
const HEARTBEAT_MODE_SKIP = 'skip';
const HEARTBEAT_MODE_REGISTER = 'register';
const HEARTBEAT_MODE_REFRESH = 'refresh';
const _heartbeatAt = new Map();
function claimHeartbeat(deviceId) {
    const now = Date.now();
    const last = _heartbeatAt.get(deviceId);
    if (last && now - last < HEARTBEAT_MIN_INTERVAL_MS) return HEARTBEAT_MODE_SKIP;
    if (_heartbeatAt.size > 500) _heartbeatAt.clear();
    _heartbeatAt.set(deviceId, now);
    return last ? HEARTBEAT_MODE_REFRESH : HEARTBEAT_MODE_REGISTER;
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
              .select('id, venue_id, table_number, table_name, max_seats, status, mode, game_type, stakes, tournament_id') // 2026-07-25 audit fix: tournament branch reads tableData.tournament_id
              .eq('table_number', tableNum);

          if (venue_id) {
              tableQuery = tableQuery.eq('venue_id', venue_id);
          }

          const { data: tableData, error: tableError } = await tableQuery.limit(1).maybeSingle();
          if (tableError) throw tableError;

          // Resolve venue_id from table if not provided
          const resolvedVenueId = venue_id || tableData?.venue_id || null;

          // Everything below depends only on the table row we just read, so it
          // all goes out in ONE batch. This route used to await ten queries
          // back to back (venue settings, sessions, rotation, dealer, venue
          // name, promotions, announcements, heartbeat, tournament entries),
          // which meant every kiosk paid ten Supabase round trips per poll even
          // though nine of them could have run at the same time.
          const noRows = { data: null, error: null };

          const isTournamentTable = tableData?.mode === 'tournament' && !!tableData?.tournament_id;
          const heartbeatDeviceId = resolvedVenueId
              ? `tablet-${resolvedVenueId}-table-${tableNum}`
              : null;
          const heartbeatMode = heartbeatDeviceId
              ? claimHeartbeat(heartbeatDeviceId)
              : HEARTBEAT_MODE_SKIP;
          const heartbeatNow = new Date().toISOString();
          const heartbeatStaleBefore = new Date(Date.now() - HEARTBEAT_MIN_INTERVAL_MS).toISOString();

          const withVenue = (q) => (resolvedVenueId ? q.eq('venue_id', resolvedVenueId) : q);

          const [
              venueSettingsRes,
              sessionsRes,
              rotationRes,
              venueRes,
              promoRes,
              announcementRes,
              tournamentEntriesRes
              // The eighth element of the batch is the display heartbeat. It is
              // deliberately not destructured: it rides along in the same batch
              // instead of adding a tenth serial round trip to the end of the
              // request, and nothing in the response depends on its result.
          ] = await Promise.all([
              resolvedVenueId
                  ? getSupabase()
                      .from('commander_venue_settings')
                      .select('venue_type, time_billing_rate, auto_comp_rate')
                      .eq('venue_id', resolvedVenueId)
                      .maybeSingle()
                  : Promise.resolve(noRows),
              withVenue(
                  getSupabase()
                      .from('commander_table_sessions')
                      .select(SESSION_COLUMNS)
                      .eq('table_number', tableNum)
                      .eq('status', 'active')
                      .order('seat_number', { ascending: true })
              ),
              withVenue(
                  getSupabase()
                      .from('commander_dealer_rotations')
                      .select('id, dealer_id, dealer_name, table_number, started_at')
                      .eq('table_number', tableNum)
                      .is('ended_at', null)
                      .order('started_at', { ascending: false })
                      .limit(1)
              ),
              resolvedVenueId
                  ? getSupabase()
                      .from('poker_venues')
                      .select('name')
                      .eq('id', resolvedVenueId)
                      .maybeSingle()
                  : Promise.resolve(noRows),
              resolvedVenueId
                  ? getSupabase()
                      .from('commander_promotions')
                      .select('id, title:name, name, description, type:promotion_type, status')
                      .eq('venue_id', resolvedVenueId)
                      .eq('status', 'active')
                      .order('created_at', { ascending: false })
                      .limit(10)
                  : Promise.resolve(noRows),
              resolvedVenueId
                  ? getSupabase()
                      .from('commander_club_announcements')
                      .select('id, title, message, type, priority')
                      .eq('venue_id', resolvedVenueId)
                      .eq('status', 'active')
                      .order('created_at', { ascending: false })
                      .limit(5)
                  : Promise.resolve(noRows),
              isTournamentTable
                  ? getSupabase()
                      .from('commander_tournament_entries')
                      .select('id, player_name, player_id, table_number, seat_number, current_chips, status')
                      .eq('tournament_id', tableData.tournament_id)
                      .eq('table_number', tableNum)
                      // SEAT OCCUPANCY: the tablet shows who is sitting at
                      // this table right now. 'bagged' excluded on purpose -
                      // they are still in the event but hold no chair.
                      .in('status', ['active', 'seated'])
                      .order('seat_number', { ascending: true })
                  : Promise.resolve(noRows),
              heartbeatMode === HEARTBEAT_MODE_REGISTER
                  ? getSupabase()
                      .from('commander_table_displays')
                      .upsert({
                          device_id: heartbeatDeviceId,
                          venue_id: resolvedVenueId,
                          device_name: `Table ${tableNum} Tablet`,
                          device_type: 'tablet',
                          is_online: true,
                          last_heartbeat: heartbeatNow,
                          updated_at: heartbeatNow,
                      }, {
                          onConflict: 'device_id',
                          ignoreDuplicates: false,
                      })
                  : heartbeatMode === HEARTBEAT_MODE_REFRESH
                      ? getSupabase()
                          .from('commander_table_displays')
                          .update({
                              is_online: true,
                              last_heartbeat: heartbeatNow,
                              updated_at: heartbeatNow,
                          })
                          .eq('device_id', heartbeatDeviceId)
                          .lt('last_heartbeat', heartbeatStaleBefore)
                      : Promise.resolve(noRows)
          ].map(p => Promise.resolve(p).catch(e => {
              // One failing side query must never take the whole tablet down.
              console.warn('[tablet-data] Sub-query failed:', e?.message || e);
              return { data: null, error: e };
          })));

          // 1b. Venue settings for mode detection
          let venueType = 'texas'; // default
          const venueSettings = venueSettingsRes.data || null;
          if (venueSettings?.venue_type) venueType = venueSettings.venue_type;

          // 2. Active player sessions
          const sessions = sessionsRes.data || [];
          if (sessionsRes.error) {
              console.warn('Sessions query failed, continuing with empty:', sessionsRes.error.message);
          }

          // Calculate time remaining for each session
          const now = new Date();
          const playersWithTime = (sessions || []).map(s => {
              const totalAllocatedSeconds = ((s.time_allocated_minutes || 0) + (s.time_added_minutes || 0)) * 60;
              // Billing freezes while paused/on meal break: subtract accumulated paused
              // minutes plus any still-open paused span from wall-clock elapsed time.
              const pausedSeconds = (s.total_paused_minutes || 0) * 60
                  + (s.paused_at ? Math.floor((now - new Date(s.paused_at)) / 1000) : 0);
              const elapsedSeconds = Math.max(0, Math.floor((now - new Date(s.started_at)) / 1000) - pausedSeconds);
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

          // 3. Get current dealer - handle both old and new schema
          let dealer = null;
          try {
              let rotationData = rotationRes.data;
              const rotationError = rotationRes.error;

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

          // 4. Venue name
          const venue_name = venueRes.data?.name || '';

          // 5. Active promotions for ticker
          const promotions = promoRes.data || [];

          // 6. Active announcements for ticker
          const announcements = announcementRes.data || [];

          // 7. Tablet heartbeat: issued in the batch above, throttled by
          //    claimHeartbeat so a polling kiosk writes at most every 30s.

          // 2b. If table is in tournament mode, also fetch tournament player seats
          // This is how dealers see moved players after an auto table break.
          let tournamentPlayers = [];
          if (isTournamentTable) {
              if (tournamentEntriesRes.error) {
                  console.warn('[tablet-data] Tournament entries lookup failed:',
                      tournamentEntriesRes.error.message);
              }
              tournamentPlayers = (tournamentEntriesRes.data || []).map(e => ({
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
