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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      const _g = await guardWriteStaff(req, res); if (!_g) return;

      if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      const { id: tournamentId } = req.query;
      const { type, player_id, message: customMessage, table_number, seat_number } = req.body;

      if (!type || !NOTIFICATION_TYPES.includes(type)) {
          return res.status(400).json({
              success: false,
              error: `Invalid type. Must be one of: ${NOTIFICATION_TYPES.join(', ')}`
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
              return res.status(404).json({ success: false, error: 'Tournament not found' });
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
              // Single player notification
              targetUserIds = [player_id];
          } else {
              // Mass notification to all active/registered players
              const { data: entries } = await getSupabase()
                  .from('commander_tournament_entries')
                  .select('player_id')
                  .eq('tournament_id', tournamentId)
                  .in('status', ['registered', 'seated', 'active'])
                  .limit(100);

              targetUserIds = (entries || [])
                  .map(e => e.player_id)
                  .filter(Boolean);
          }

          if (targetUserIds.length === 0) {
              return res.status(200).json({
                  success: true,
                  data: { sent: 0, message: 'No players to notify' }
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
          } else {
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

          if (insertErr) {
          }

          return res.status(200).json({
              success: true,
              data: {
                  sent: sentCount,
                  in_app: targetUserIds.length,
                  type,
                  message: notification.body
              }
          });
      } catch (error) {
          console.warn('[notify.js] Error:', error);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

function buildNotification(type, ctx) {
    const { tournamentName, venueName, customMessage, table_number, seat_number, tournament } = ctx;

    switch (type) {
        case 'tournament_starting':
            return {
                title: `${tournamentName} Starting Now`,
                body: `${tournamentName} at ${venueName} is starting! Please take your seat.`
            };

        case 'seat_assignment':
            return {
                title: 'Seat Assignment',
                body: table_number
                    ? `Your seat is ready: Table ${table_number}${seat_number ? `, Seat ${seat_number}` : ''} — ${tournamentName}`
                    : `Your seat is ready for ${tournamentName}. Check the floor for your assignment.`
            };

        case 'level_up': {
            const blinds = parseBlindStructure(tournament?.blind_structure);
            const level = tournament?.current_level || 0;
            const current = blinds?.[level];
            return {
                title: `Level ${level + 1} — ${tournamentName}`,
                body: current
                    ? `Blinds now ${current.small_blind?.toLocaleString()}/${current.big_blind?.toLocaleString()}${current.ante ? ` ante ${current.ante.toLocaleString()}` : ''}`
                    : `Level ${level + 1} has started.`
            };
        }

        case 'break':
            return {
                title: 'Break Time',
                body: `${tournamentName} is on break. Play resumes shortly.`
            };

        case 'break_ending':
            return {
                title: 'Break Ending',
                body: `Break is ending soon. Please return to your seat for ${tournamentName}.`
            };

        case 'final_table':
            return {
                title: 'Final Table!',
                body: `${tournamentName} has reached the Final Table! Good luck!`
            };

        case 'elimination':
            return {
                title: 'Tournament Result',
                body: customMessage || `Thank you for playing ${tournamentName}!`
            };

        case 'itm':
            return {
                title: 'In The Money!',
                body: customMessage || `Congratulations! You cashed in ${tournamentName}!`
            };

        case 'winner':
            return {
                title: 'Tournament Winner!',
                body: customMessage || `Congratulations! You won ${tournamentName}!`
            };

        case 'custom':
            return {
                title: tournamentName,
                body: customMessage || 'You have a new tournament notification.'
            };

        default:
            return {
                title: tournamentName,
                body: 'Tournament notification'
            };
    }
}
