/**
 * Twilio SMS Integration
 * Reference: IMPLEMENTATION_PHASES.md - Phase 1
 * SMS notifications for waitlist, tournaments, and announcements
 *
 * SETUP REQUIRED (Antigravity):
 * 1. Create Twilio account at https://www.twilio.com
 * 2. Get Account SID and Auth Token
 * 3. Buy a phone number
 * 4. Add to environment variables:
 *    - TWILIO_ACCOUNT_SID
 *    - TWILIO_AUTH_TOKEN
 *    - TWILIO_PHONE_NUMBER
 */

let twilioClient = null;

// Initialize Twilio client
async function getClient() {
  if (twilioClient) return twilioClient;

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.warn('Twilio credentials not configured - SMS disabled');
    return null;
  }

  try {
    const twilio = await import('twilio');
    twilioClient = twilio.default(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    return twilioClient;
  } catch (err) {
    console.warn('Failed to initialize Twilio:', err.message);
    return null;
  }
}

/**
 * Send an SMS message
 */
export async function sendSMS(to, body) {
  const client = await getClient();
  if (!client) {
    console.debug('[SMS MOCK]', to, body);
    return { success: false, reason: 'Twilio not configured' };
  }

  try {
    // Format phone number if needed
    const formattedPhone = formatPhoneNumber(to);
    if (!formattedPhone) {
      return { success: false, reason: 'Invalid phone number' };
    }

    const message = await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: formattedPhone
    });

    return {
      success: true,
      messageId: message.sid,
      status: message.status
    };
  } catch (err) {
    console.warn('SMS send error:', err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Format phone number to E.164 format
 */
function formatPhoneNumber(phone) {
  if (!phone) return null;

  // Remove all non-numeric characters
  const digits = phone.replace(/\D/g, '');

  // US number without country code
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // Already has country code
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // International number
  if (digits.length > 10) {
    return `+${digits}`;
  }

  return null;
}

// ==================
// Notification Templates
// ==================

/**
 * Send seat ready notification
 */
export async function sendSeatNotification(phone, venueName, game, options = {}) {
  const message = `Your ${game} Seat Is Open At ${venueName}! Please check in within ${options.timeout || 5} minutes or you may lose your spot.`;
  return sendSMS(phone, message);
}

/**
 * Send waitlist position update
 */
export async function sendWaitlistUpdate(phone, venueName, position, estimatedWait) {
  const message = `${venueName} Update: You are now #${position} on the waitlist. Estimated wait: ${estimatedWait} minutes.`;
  return sendSMS(phone, message);
}

/**
 * Send tournament registration confirmation
 */
export async function sendTournamentConfirmation(phone, tournamentName, venueName, startTime) {
  const message = `You're registered for ${tournamentName} at ${venueName}! Tournament starts at ${startTime}. Good luck!`;
  return sendSMS(phone, message);
}

/**
 * Send tournament starting reminder
 */
export async function sendTournamentReminder(phone, tournamentName, venueName, minutesUntil) {
  const message = `Reminder: ${tournamentName} at ${venueName} starts in ${minutesUntil} minutes. Please arrive on time!`;
  return sendSMS(phone, message);
}

/**
 * Send home game invitation
 */
export async function sendHomeGameInvite(phone, hostName, gameName, date, joinCode) {
  const message = `${hostName} invited you to ${gameName} on ${date}! Join with code: ${joinCode}. RSVP at smarter.poker`;
  return sendSMS(phone, message);
}

/**
 * Send home game reminder
 */
export async function sendHomeGameReminder(phone, gameName, date, location) {
  const message = `Reminder: ${gameName} is tomorrow at ${date}. Location will be shared when you arrive. See you there!`;
  return sendSMS(phone, message);
}

/**
 * Send comp balance notification
 */
export async function sendCompNotification(phone, venueName, compAmount, newBalance) {
  const message = `${venueName}: You earned $${compAmount.toFixed(2)} in comps! New balance: $${newBalance.toFixed(2)}. Ask staff to redeem.`;
  return sendSMS(phone, message);
}

/**
 * Send promotion winner notification
 */
export async function sendPromotionWinner(phone, venueName, promotionName, prizeAmount) {
  const message = `Congratulations! You won ${promotionName} at ${venueName}! Prize: $${prizeAmount}. See staff to claim.`;
  return sendSMS(phone, message);
}

/**
 * Send general announcement
 */
export async function sendAnnouncement(phone, venueName, message) {
  const fullMessage = `${venueName}: ${message}`;
  return sendSMS(phone, fullMessage.substring(0, 160)); // SMS limit
}

// ==================
// Bulk Sending
// ==================

/**
 * Send SMS to multiple recipients
 */
export async function sendBulkSMS(recipients, body, options = {}) {
  const results = {
    sent: 0,
    failed: 0,
    errors: []
  };

  // Rate limit: 1 per second by default
  const delayMs = options.delayMs || 1000;

  for (const phone of recipients) {
    const result = await sendSMS(phone, body);

    if (result.success) {
      results.sent++;
    } else {
      results.failed++;
      results.errors.push({ phone, reason: result.reason });
    }

    // Rate limiting
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

/**
 * Send waitlist notification to all players for a game
 */
export async function notifyWaitlistForGame(venueId, gameType, stakes, message) {
  // This would be called from the API to notify all waitlist players
  // Implementation depends on database access
  console.debug('Notify waitlist:', { venueId, gameType, stakes, message });
  return { success: true, notified: 0 };
}

// Export config check for API use
export function isTwilioConfigured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}
