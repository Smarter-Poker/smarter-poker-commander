/**
 * OneSignal Push Notification Integration
 * Reference: IMPLEMENTATION_PHASES.md
 *
 * SETUP REQUIRED:
 * 1. Create account at https://onesignal.com (FREE)
 * 2. Create new app → Select "Web Push"
 * 3. Configure your site URL
 * 4. Get App ID and REST API Key from Settings → Keys & IDs
 * 5. Add to Vercel environment variables:
 *    - NEXT_PUBLIC_ONESIGNAL_APP_ID
 *    - ONESIGNAL_REST_API_KEY
 */

const ONESIGNAL_APP_ID = process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;
const ONESIGNAL_API_URL = 'https://onesignal.com/api/v1';

/**
 * Check if OneSignal is configured
 */
export function isOneSignalConfigured() {
  return !!(ONESIGNAL_APP_ID && ONESIGNAL_REST_API_KEY);
}

/**
 * Send push notification to specific user(s)
 */
export async function sendPushNotification({
  playerIds,       // OneSignal player IDs (array)
  externalUserIds, // Your user IDs (array) - alternative to playerIds
  title,
  message,
  url,
  data = {},
  buttons = []
}) {
  if (!isOneSignalConfigured()) {
    console.debug('[PUSH MOCK]', { title, message, playerIds: playerIds?.length || externalUserIds?.length });
    return { success: false, reason: 'OneSignal not configured' };
  }

  try {
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      headings: { en: title },
      contents: { en: message },
      data,
    };

    // Target by OneSignal player IDs
    if (playerIds && playerIds.length > 0) {
      payload.include_player_ids = playerIds;
    }
    // Or target by your external user IDs
    else if (externalUserIds && externalUserIds.length > 0) {
      payload.include_external_user_ids = externalUserIds;
    }
    else {
      return { success: false, reason: 'No recipients specified' };
    }

    // Add URL if provided
    if (url) {
      payload.url = url;
    }

    // Add action buttons if provided
    if (buttons.length > 0) {
      payload.buttons = buttons;
    }

    const response = await fetch(`${ONESIGNAL_API_URL}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.errors) {
      console.warn('OneSignal error:', result.errors);
      return { success: false, reason: result.errors.join(', ') };
    }

    return {
      success: true,
      notificationId: result.id,
      recipients: result.recipients
    };
  } catch (err) {
    console.warn('Push notification error:', err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Send push to a segment (e.g., all subscribed users)
 */
export async function sendPushToSegment({
  segments = ['Subscribed Users'],
  title,
  message,
  url,
  data = {}
}) {
  if (!isOneSignalConfigured()) {
    console.debug('[PUSH MOCK - SEGMENT]', { title, message, segments });
    return { success: false, reason: 'OneSignal not configured' };
  }

  try {
    const payload = {
      app_id: ONESIGNAL_APP_ID,
      included_segments: segments,
      headings: { en: title },
      contents: { en: message },
      data,
    };

    if (url) {
      payload.url = url;
    }

    const response = await fetch(`${ONESIGNAL_API_URL}/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${ONESIGNAL_REST_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (result.errors) {
      return { success: false, reason: result.errors.join(', ') };
    }

    return {
      success: true,
      notificationId: result.id,
      recipients: result.recipients
    };
  } catch (err) {
    console.warn('Push notification error:', err.message);
    return { success: false, reason: err.message };
  }
}

// ==================
// Notification Templates
// ==================

/**
 * Send seat ready notification
 */
export async function notifySeatReady(userId, venueName, game, tableNumber) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Your Seat is Ready!',
    message: `${venueName}: Your seat for ${game} is ready at Table ${tableNumber}. Check in within 5 minutes.`,
    url: '/hub/commander',
    data: { type: 'seat_ready', venue: venueName },
    buttons: [
      { id: 'checkin', text: 'Check In' },
      { id: 'pass', text: 'Pass' }
    ]
  });
}

/**
 * Send waitlist position update
 */
export async function notifyWaitlistUpdate(userId, venueName, position, estimatedWait) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Waitlist Update',
    message: `${venueName}: You're now #${position}. Estimated wait: ${estimatedWait} min.`,
    data: { type: 'waitlist_update', position }
  });
}

/**
 * Send tournament registration confirmation
 */
export async function notifyTournamentRegistered(userId, tournamentName, venueName, startTime) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Tournament Registered',
    message: `You're in! ${tournamentName} at ${venueName} starts at ${startTime}. Good luck!`,
    url: '/hub/commander/tournaments',
    data: { type: 'tournament_registered' }
  });
}

/**
 * Send tournament starting reminder
 */
export async function notifyTournamentStarting(userId, tournamentName, minutesUntil) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Tournament Starting Soon',
    message: `${tournamentName} starts in ${minutesUntil} minutes! Please arrive on time.`,
    url: '/hub/commander/tournaments',
    data: { type: 'tournament_reminder', minutesUntil }
  });
}

/**
 * Send home game invite
 */
export async function notifyHomeGameInvite(userId, hostName, gameName, date) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Game Invite',
    message: `${hostName} invited you to ${gameName} on ${date}. Tap to RSVP!`,
    url: '/hub/commander/home-games',
    data: { type: 'home_game_invite' },
    buttons: [
      { id: 'accept', text: 'Accept' },
      { id: 'decline', text: 'Decline' }
    ]
  });
}

/**
 * Send home game reminder
 */
export async function notifyHomeGameReminder(userId, gameName, hoursUntil) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Game Tonight',
    message: `${gameName} starts in ${hoursUntil} hours. See you there!`,
    url: '/hub/commander/home-games',
    data: { type: 'home_game_reminder' }
  });
}

/**
 * Send promotion winner notification
 */
export async function notifyPromotionWinner(userId, venueName, promotionName, prizeAmount) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'You Won!',
    message: `Congratulations! You won ${promotionName} at ${venueName}! Prize: $${prizeAmount}`,
    data: { type: 'promotion_winner', prize: prizeAmount }
  });
}

/**
 * Send comp balance update
 */
export async function notifyCompEarned(userId, venueName, compAmount, newBalance) {
  return sendPushNotification({
    externalUserIds: [userId],
    title: 'Comps Earned',
    message: `${venueName}: +$${compAmount.toFixed(2)} comps! Balance: $${newBalance.toFixed(2)}`,
    data: { type: 'comp_earned', amount: compAmount, balance: newBalance }
  });
}

/**
 * Send club/group announcement
 */
export async function notifyClubAnnouncement(userIds, clubName, message) {
  return sendPushNotification({
    externalUserIds: userIds,
    title: clubName,
    message: message.substring(0, 100),
    data: { type: 'club_announcement' }
  });
}

/**
 * Send Jackpot Bounty notification
 */
export async function notifyJackpotBounty(userIds, clubName, tournamentName, winnerName, amount, tierLabel) {
  return sendPushNotification({
    externalUserIds: userIds,
    title: `🎰 ${tierLabel} Bounty in ${clubName}!`,
    message: `${winnerName} just pulled a ${amount.toLocaleString()} chip Mystery Bounty in ${tournamentName}!`,
    url: '/hub/club-arena',
    data: { type: 'jackpot_bounty', amount }
  });
}

/**
 * Send venue-wide announcement
 */
export async function notifyVenueAnnouncement(venueName, message) {
  // This sends to all subscribed users with a tag for this venue
  return sendPushToSegment({
    segments: ['Subscribed Users'],
    title: venueName,
    message: message.substring(0, 100),
    data: { type: 'venue_announcement', venue: venueName }
  });
}

// ==================
// Social Page Notifications
// ==================

/**
 * Notify page followers of a new post
 */
export async function notifyPageNewPost(followerIds, pageName, authorName) {
  if (!followerIds || followerIds.length === 0) return { success: false, reason: 'No followers' };
  return sendPushNotification({
    externalUserIds: followerIds,
    title: pageName,
    message: `${authorName} posted something new on ${pageName}`,
    data: { type: 'page_new_post', page: pageName }
  });
}

/**
 * Notify post author of a new like
 */
export async function notifyPostLiked(authorId, likerName, pageName) {
  return sendPushNotification({
    externalUserIds: [authorId],
    title: 'New Like',
    message: `${likerName} liked your post on ${pageName}`,
    data: { type: 'post_liked', page: pageName }
  });
}

/**
 * Notify post author of a new comment
 */
export async function notifyPostCommented(authorId, commenterName, pageName) {
  return sendPushNotification({
    externalUserIds: [authorId],
    title: 'New Comment',
    message: `${commenterName} commented on your post in ${pageName}`,
    data: { type: 'post_commented', page: pageName }
  });
}

/**
 * Notify page owner of new follower
 */
export async function notifyNewPageFollower(ownerId, followerName, pageName) {
  return sendPushNotification({
    externalUserIds: [ownerId],
    title: 'New Follower',
    message: `${followerName} started following ${pageName}`,
    data: { type: 'page_new_follower', page: pageName }
  });
}

/**
 * Get OneSignal status for health checks
 */
export function getOneSignalStatus() {
  return {
    configured: isOneSignalConfigured(),
    hasAppId: !!ONESIGNAL_APP_ID,
    hasApiKey: !!ONESIGNAL_REST_API_KEY,
  };
}
