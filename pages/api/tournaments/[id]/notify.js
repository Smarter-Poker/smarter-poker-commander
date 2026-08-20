/**
 * Tournament Notification API
 * POST /api/commander/tournaments/[id]/notify
 * 
 * Staff-triggered push notification sender for tournament events.
 * Supports: tournament_starting, seat_assignment, level_up, break, final_table, custom
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import {
    sendPushNotification,
    isOneSignalConfigured
} from '../../../../src/lib/commander/pushNotifications';
import { parseBlindStructure } from '../../../../src/lib/parseBlindStructure';
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

const NOTIFICATION_TYPES = [
    'tournament_starting',
    'seat_assignment',
    'level_up',
    'break',
    'break_ending',
    'final_table',
    'elimination',
    'itm',
    'winner',
    'custom'
];

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      const _g = await guardWriteStaff(req, res); if (!_g) return;

      if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
      }

      const { id: tournamentId } = req.query;
      const { type, player_id, message: customMessage, table_number, seat_number } = req.body;

      if (!type || !NOTIFICATION_TYPES.includes(type)) {
          return res.status(400).json({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: `Invalid Type. Must Be One Of: ${NOTIFICATION_TYPES.join(', ')}` }
          });
      }

      try {
          // Get tournament details
          const { data: tournament, error: tErr } = await getSupabase()
              .from('commander_tournaments')
              .select('*, poker_venues:venue_id (name)')
              .eq('id', tournamentId)
              .maybeSingle();

          if (tErr || !tournament) {
              return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
          }

          const venueName = tournament.poker_venues?.name || 'Venue';
          const tournamentName = tournament.name || 'Tournament';

          // Build notification content based on type
          const notification = buildNotification(type, {
              tournamentName,
              venueName,
              tournamentId,
              customMessage,
              table_number,
              seat_number,
              tournament
          });

          let targetUserIds = [];
          let sentCount = 0;

          if (player_id) {
              // Single player notification.
              // 2026-08-20 audit fix: player_id was taken from the body and
              // pushed to verbatim, with no check that the player is even in
              // this tournament. Staff-only route, so this is not an escalation
              // path, but one mistyped id sent "Your Seat Is Ready: Table 4,
              // Seat 7" to an unrelated player with no trace of why.
              // 'cancelled' entries are excluded: that registration was
              // reversed and refunded, so the player is not in the field.
              const { data: entryRows, error: pErr } = await getSupabase()
                  .from('commander_tournament_entries')
                  .select('id, status')
                  .eq('tournament_id', tournamentId)
                  .eq('player_id', player_id)
                  .neq('status', 'cancelled')
                  .limit(1);

              // 22P02 is Postgres invalid_text_representation: player_id is a
              // uuid column, so a malformed id is a caller typo, not an outage.
              // Fall through to the same clear 404 rather than a bare 500.
              if (pErr && pErr.code !== '22P02') {
                  console.error('[notify.js] participant check failed', {
                      tournamentId, code: pErr.code, message: pErr.message, details: pErr.details,
                  });
                  return res.status(500).json({
                      success: false,
                      error: { code: 'DB_ERROR', message: 'Failed To Verify The Target Player' }
                  });
              }

              if (pErr || !entryRows || entryRows.length === 0) {
                  return res.status(404).json({
                      success: false,
                      error: {
                          code: 'PLAYER_NOT_IN_TOURNAMENT',
                          message: 'That Player Has No Active Entry In This Tournament. Check The Player Before Sending.'
                      }
                  });
              }

              targetUserIds = [player_id];
          } else {
              // Mass notification to all active/registered players.
              // 2026-08-20 audit fix: .limit(100) silently truncated the target
              // list, so in any field over 100 entries most players were never
              // told the tournament was starting and the response still said
              // the broadcast succeeded.
              const { data: entries, error: eErr } = await getSupabase()
                  .from('commander_tournament_entries')
                  .select('player_id')
                  .eq('tournament_id', tournamentId)
                  // Everyone still in the event, including 'bagged'. A bagged
                  // player is between days, not out: the resume-time
                  // announcement is aimed squarely at them.
                  .in('status', ['registered', 'seated', 'active', 'bagged'])
                  .limit(5000);

              if (eErr) {
                  console.error('[notify.js] entries read failed', {
                      tournamentId, code: eErr.code, message: eErr.message, details: eErr.details,
                  });
                  return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Tournament Entries' } });
              }

              // De-duplicate: a re-entry player has more than one row and would
              // otherwise get the same push twice.
              targetUserIds = [...new Set((entries || [])
                  .map(e => e.player_id)
                  .filter(Boolean))];
          }

          if (targetUserIds.length === 0) {
              return res.status(200).json({
                  success: true,
                  data: { sent: 0, message: 'No Players To Notify' }
              });
          }

          // Send push notification via OneSignal
          if (isOneSignalConfigured()) {
              try {
                  await sendPushNotification({
                      externalUserIds: targetUserIds,
                      title: notification.title,
                      message: notification.body,
                      url: `/hub/commander/tournament/${tournamentId}/my-status`,
                      data: {
                          type: 'tournament_notification',
                          tournament_id: tournamentId,
                          notification_type: type
                      }
                  });
                  sentCount = targetUserIds.length;
              } catch (pushErr) {
                  console.warn('[notify.js] Push notification error:', pushErr.message);
              }
          }

          // Also insert in-app notifications for each player
          const notificationRows = targetUserIds.map(uid => ({
              player_id: uid,
              venue_id: tournament.venue_id,
              notification_type: type === 'custom' ? 'custom' : 'tournament_starting',
              title: notification.title,
              message: notification.body,
              channel: 'push',
              status: 'sent',
              metadata: {
                  tournament_id: tournamentId,
                  tournament_name: tournamentName,
                  sub_type: type
              }
          }));

          const { error: insertErr } = await getSupabase()
              .from('commander_notifications')
              .insert(notificationRows);

          // The empty `if (insertErr) {}` swallowed every in-app write failure,
          // so the TD saw "notified" while nothing had been recorded.
          if (insertErr) {
              console.error('[notify.js] commander_notifications insert failed', {
                  tournamentId, rows: notificationRows.length,
                  code: insertErr.code, message: insertErr.message, details: insertErr.details,
              });
          }

          return res.status(200).json({
              success: true,
              data: {
                  sent: sentCount,
                  in_app: insertErr ? 0 : targetUserIds.length,
                  in_app_error: insertErr ? insertErr.message : undefined,
                  type,
                  message: notification.body
              }
          });
      } catch (error) {
          console.warn('[notify.js] Error:', error);
          return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

function buildNotification(type, ctx) {
    const { tournamentName, venueName, customMessage, table_number, seat_number, tournament } = ctx;

    switch (type) {
        case 'tournament_starting':
            return {
                title: `${tournamentName} Starting Now`,
                body: `${tournamentName} At ${venueName} Is Starting! Please Take Your Seat.`
            };

        case 'seat_assignment':
            return {
                title: 'Seat Assignment',
                body: table_number
                    ? `Your Seat Is Ready: Table ${table_number}${seat_number ? `, Seat ${seat_number}` : ''}, ${tournamentName}`
                    : `Your Seat Is Ready For ${tournamentName}. Check The Floor For Your Assignment.`
            };

        case 'level_up': {
            const blinds = parseBlindStructure(tournament?.blind_structure);
            const level = tournament?.current_level || 0;
            const current = blinds?.[level];
            // Break rows share the array with playing levels, so the index is
            // not the level number. Count non-break rows up to the current index.
            let displayLevel = 0;
            for (let i = 0; i <= level && i < (blinds?.length || 0); i++) {
                if (!blinds[i]?.is_break) displayLevel++;
            }
            if (displayLevel === 0) displayLevel = level + 1;
            return {
                title: `Level ${displayLevel}, ${tournamentName}`,
                body: current
                    ? `Blinds Now ${current.small_blind?.toLocaleString()}/${current.big_blind?.toLocaleString()}${current.ante ? ` Ante ${current.ante.toLocaleString()}` : ''}`
                    : `Level ${displayLevel} Has Started.`
            };
        }

        case 'break':
            return {
                title: 'Break Time',
                body: `${tournamentName} Is On Break. Play Resumes Shortly.`
            };

        case 'break_ending':
            return {
                title: 'Break Ending',
                body: `Break Is Ending Soon. Please Return To Your Seat For ${tournamentName}.`
            };

        case 'final_table':
            return {
                title: 'Final Table!',
                body: `${tournamentName} Has Reached The Final Table! Good Luck!`
            };

        case 'elimination':
            return {
                title: 'Tournament Result',
                body: customMessage || `Thank You For Playing ${tournamentName}!`
            };

        case 'itm':
            return {
                title: 'In The Money!',
                body: customMessage || `Congratulations! You Cashed In ${tournamentName}!`
            };

        case 'winner':
            return {
                title: 'Tournament Winner!',
                body: customMessage || `Congratulations! You Won ${tournamentName}!`
            };

        case 'custom':
            return {
                title: tournamentName,
                body: customMessage || 'You Have A New Tournament Notification.'
            };

        default:
            return {
                title: tournamentName,
                body: 'Tournament Notification'
            };
    }
}
