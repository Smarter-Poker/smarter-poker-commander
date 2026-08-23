/**
 * Alternate Queue Notifications
 *
 * Alternates have always HAD a queue position: floor-view returns
 * data.alternates with queue_position, and my-chips returns the player's own.
 * Nothing ever told them. A player who paid and is sitting in the bar has no
 * way to know whether they are next up or eleventh, so they either hover at
 * the desk all night or miss the call.
 *
 * This module is the one place that turns the queue into a message. It is used
 * by:
 *   - POST /api/commander/tournaments/[id]/notify-alternates   (TD, manual)
 *   - entries/[entryId]/promote.js                             (auto, on seat)
 *   - eliminate.js auto-promotion                              (auto, on bust)
 *
 * The automatic callers use notifyNextAlternates(), which is fire and forget:
 * a push outage must never fail a seating.
 */
import { sendPushNotification, isOneSignalConfigured } from './pushNotifications';

// How many alternates get an automatic update when the queue advances. Beyond
// about three deep the position is not actionable, and everybody in the field
// getting a push on every bust is noise.
export const AUTO_NOTIFY_DEPTH = 3;

// Window used to work out how fast seats are actually opening tonight.
const WAIT_SAMPLE_MINUTES = 120;
// Never quote a wait longer than this. A number in the hours reads as broken.
const MAX_QUOTED_WAIT_MINUTES = 180;

/** 1 -> '1st', 2 -> '2nd', 3 -> '3rd', 11 -> '11th', 21 -> '21st'. */
// Imported AND re-exported: `export { x } from` alone creates no local
// binding, and this module calls ordinal() itself further down. Lives in a
// dependency-free module so a client screen can use it without importing this
// file, which pulls in pushNotifications.
import { ordinal } from './ordinal';
export { ordinal };

/**
 * The waiting alternates, in the order they will be seated.
 * Same ordering the auto-promotion uses (longest wait first), so the position
 * quoted here is the position the player is actually in.
 */
export async function fetchAlternateQueue(supabase, tournamentId) {
  const { data, error } = await supabase
    .from('commander_tournament_entries')
    .select('id, player_id, player_name, registered_at, created_at')
    .eq('tournament_id', tournamentId)
    .eq('status', 'alternate')
    .order('registered_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[alternateNotifications] queue read failed', {
      tournamentId, code: error.code, message: error.message, details: error.details,
    });
    return [];
  }

  return (data || []).map((e, i) => ({
    entry_id: e.id,
    player_id: e.player_id,
    player_name: e.player_name,
    queue_position: i + 1,
  }));
}

/**
 * Minutes-per-seat estimate, derived from how fast the field is actually
 * busting tonight rather than from a guess. Returns null when there is not
 * enough data, and the message then simply omits the estimate: no estimate is
 * better than a wrong one a player plans their evening around.
 */
export async function estimateSeatIntervalMinutes(supabase, tournamentId) {
  const since = new Date(Date.now() - WAIT_SAMPLE_MINUTES * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('commander_tournament_entries')
    .select('eliminated_at')
    .eq('tournament_id', tournamentId)
    .eq('status', 'eliminated')
    .gte('eliminated_at', since)
    .limit(500);

  if (error || !data || data.length === 0) return null;

  const stamps = data
    .map(r => (r.eliminated_at ? new Date(r.eliminated_at).getTime() : null))
    .filter(t => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (stamps.length < 2) return null;

  // Elapsed span the sample actually covers, not the full window: a tournament
  // that started 20 minutes ago must not look like a slow two-hour bust rate.
  const spanMinutes = (Date.now() - stamps[0]) / 60000;
  if (spanMinutes <= 0) return null;

  const perMinute = stamps.length / spanMinutes;
  if (perMinute <= 0) return null;

  return 1 / perMinute;
}

/**
 * Players who have turned push off for this venue.
 * commander_player_preferences.notification_preferences defaults to
 * { sms: true, push: true, email: false }; only an explicit false opts out.
 */
async function fetchPushOptOuts(supabase, venueId, playerIds) {
  const ids = (playerIds || []).filter(Boolean);
  if (ids.length === 0 || venueId == null) return new Set();

  const { data, error } = await supabase
    .from('commander_player_preferences')
    .select('player_id, notification_preferences')
    .eq('venue_id', venueId)
    .in('player_id', ids);

  if (error) {
    // A preferences outage must not silence the queue. Log and notify.
    console.warn('[alternateNotifications] preferences read failed:', error.message);
    return new Set();
  }

  const optedOut = new Set();
  (data || []).forEach(row => {
    if (row?.notification_preferences?.push === false) optedOut.add(row.player_id);
  });
  return optedOut;
}

function buildMessage({ queuePosition, tournamentName, waitMinutes }) {
  if (queuePosition === 1) {
    return {
      title: 'You Are Next Up',
      body: `You Are 1st In Line For ${tournamentName}. Stay Close To The Floor, You Are Next To Be Seated.`,
    };
  }
  const wait = waitMinutes != null
    ? ` Estimated Wait About ${waitMinutes.toLocaleString()} Minutes.`
    : '';
  return {
    title: 'Alternates List Update',
    body: `You Are ${ordinal(queuePosition)} In Line For ${tournamentName}.${wait}`,
  };
}

/**
 * Push each waiting alternate their current position, and record it in-app.
 *
 * @param {object} supabase   - service-role client
 * @param {object} args
 * @param {object} args.tournament - { id, venue_id, name }
 * @param {number} [args.limit]    - only the first N in the queue
 * @param {string[]} [args.entryIds] - only these entries (positions stay true)
 * @returns {Promise<{ notified, skipped_opt_out, in_app, alternates }>}
 */
export async function notifyAlternates(supabase, { tournament, limit, entryIds } = {}) {
  if (!tournament?.id) {
    return { notified: 0, skipped_opt_out: 0, in_app: 0, alternates: [] };
  }

  const tournamentName = tournament.name || 'The Tournament';
  const queue = await fetchAlternateQueue(supabase, tournament.id);

  let targets = queue;
  if (Array.isArray(entryIds) && entryIds.length > 0) {
    const wanted = new Set(entryIds.map(String));
    targets = queue.filter(a => wanted.has(String(a.entry_id)));
  }
  if (Number.isFinite(limit) && limit > 0) {
    targets = targets.slice(0, limit);
  }
  // A player with no linked account has nothing to push to. They stay in the
  // returned list flagged as not notified, so the floor knows to call them.
  const reachable = targets.filter(a => a.player_id);

  if (reachable.length === 0) {
    return {
      notified: 0,
      skipped_opt_out: 0,
      in_app: 0,
      alternates: targets.map(a => ({ ...a, notified: false, reason: 'NO_LINKED_ACCOUNT' })),
    };
  }

  const [interval, optedOut] = await Promise.all([
    estimateSeatIntervalMinutes(supabase, tournament.id),
    fetchPushOptOuts(supabase, tournament.venue_id, reachable.map(a => a.player_id)),
  ]);

  const pushConfigured = isOneSignalConfigured();
  const rows = [];
  const sends = [];
  const outcome = new Map();

  targets.forEach(alt => {
    if (!alt.player_id) {
      outcome.set(alt.entry_id, { notified: false, reason: 'NO_LINKED_ACCOUNT' });
      return;
    }

    const waitMinutes = interval
      ? Math.min(MAX_QUOTED_WAIT_MINUTES, Math.max(5, Math.round((alt.queue_position * interval) / 5) * 5))
      : null;
    const msg = buildMessage({
      queuePosition: alt.queue_position,
      tournamentName,
      waitMinutes,
    });

    const isOptedOut = optedOut.has(alt.player_id);
    const willPush = pushConfigured && !isOptedOut;

    if (willPush) {
      sends.push(
        sendPushNotification({
          externalUserIds: [alt.player_id],
          title: msg.title,
          message: msg.body,
          url: `/hub/commander/tournament/${tournament.id}/my-status`,
          data: {
            type: 'alternate_position',
            tournament_id: tournament.id,
            queue_position: alt.queue_position,
          },
        }).catch(err => {
          console.warn('[alternateNotifications] push failed:', err?.message || err);
          return null;
        })
      );
    }

    // The in-app row is written whether or not push went out: it is the record
    // the player's status screen reads, and the only trace the floor has that
    // the position was communicated.
    // notification_type is CHECK-constrained to
    // seat_available / tournament_starting / called_for_seat / promotion /
    // custom. A position update is not a seat call, so 'custom' carries it and
    // metadata.sub_type keeps it queryable.
    rows.push({
      player_id: alt.player_id,
      venue_id: tournament.venue_id,
      notification_type: 'custom',
      title: msg.title,
      message: msg.body,
      channel: willPush ? 'push' : 'in_app',
      status: 'sent',
      sent_at: new Date().toISOString(),
      metadata: {
        tournament_id: tournament.id,
        tournament_name: tournamentName,
        sub_type: 'alternate_position',
        queue_position: alt.queue_position,
        estimated_wait_minutes: waitMinutes,
        push_opt_out: isOptedOut || undefined,
      },
    });

    outcome.set(alt.entry_id, {
      notified: willPush,
      reason: isOptedOut ? 'PUSH_OPT_OUT' : (!pushConfigured ? 'PUSH_NOT_CONFIGURED' : undefined),
      queue_position: alt.queue_position,
      estimated_wait_minutes: waitMinutes,
    });
  });

  await Promise.allSettled(sends);

  let inApp = 0;
  if (rows.length > 0) {
    const { error: insertErr } = await supabase.from('commander_notifications').insert(rows);
    if (insertErr) {
      console.error('[alternateNotifications] commander_notifications insert failed', {
        tournament_id: tournament.id, rows: rows.length,
        code: insertErr.code, message: insertErr.message, details: insertErr.details,
      });
    } else {
      inApp = rows.length;
    }
  }

  const alternates = targets.map(a => ({ ...a, ...(outcome.get(a.entry_id) || { notified: false }) }));
  return {
    notified: alternates.filter(a => a.notified).length,
    skipped_opt_out: alternates.filter(a => a.reason === 'PUSH_OPT_OUT').length,
    in_app: inApp,
    alternates,
  };
}

/**
 * Fire-and-forget update for the top of the queue after it advances.
 *
 * Called from the seating paths. It never throws and never awaits anything the
 * caller depends on: a player being seated must not fail because OneSignal is
 * having a bad afternoon.
 */
export function notifyNextAlternates(supabase, tournament, count = AUTO_NOTIFY_DEPTH) {
  try {
    return notifyAlternates(supabase, { tournament, limit: count })
      .catch(err => {
        console.warn('[alternateNotifications] auto notify failed:', err?.message || err);
        return null;
      });
  } catch (err) {
    console.warn('[alternateNotifications] auto notify threw:', err?.message || err);
    return Promise.resolve(null);
  }
}

export default notifyAlternates;
