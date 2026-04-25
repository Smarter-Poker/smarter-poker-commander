/**
 * Commander Notifications Service - SMS Integration
 * Reference: IMPLEMENTATION_PHASES.md - Step 1.6
 *
 * Delegates SMS sending to the shared twilio.js module to avoid
 * duplicate client initialization.
 */
import { sendSMS, isTwilioConfigured } from './twilio';

/**
 * Send SMS notification for seat availability
 * @param {string} phone - Phone number to send to
 * @param {string} venue - Venue name
 * @param {string} game - Game description (e.g., "NLH 1/3")
 * @returns {Promise<object>} - Message result
 */
export async function sendSeatNotification(phone, venue, game) {
  const message = `Your seat is ready at ${venue} for ${game}. Please check in within 5 minutes.`;
  return sendSms(phone, message);
}

/**
 * Send SMS notification for tournament starting
 * @param {string} phone - Phone number
 * @param {string} venue - Venue name
 * @param {string} tournament - Tournament name
 * @param {number} minutes - Minutes until start
 * @returns {Promise<object>} - Message result
 */
export async function sendTournamentNotification(phone, venue, tournament, minutes) {
  const message = `${tournament} at ${venue} starts in ${minutes} minutes. Registration closes soon.`;
  return sendSms(phone, message);
}

/**
 * Send custom SMS notification
 * Delegates to shared twilio.js module.
 * @param {string} phone - Phone number
 * @param {string} message - Message content
 * @returns {Promise<object>} - Message result
 */
export async function sendSms(phone, message) {
  const normalizedPhone = normalizePhoneNumber(phone);
  if (!normalizedPhone) {
    return { success: false, error: 'Invalid phone number format' };
  }
  const result = await sendSMS(normalizedPhone, message);
  // Map twilio.js response format to notifications format for backward compatibility
  return {
    success: result.success,
    messageId: result.messageId || undefined,
    status: result.status || undefined,
    error: result.reason || undefined,
    mock: !isTwilioConfigured() || undefined
  };
}

/**
 * Normalize phone number to E.164 format
 * @param {string} phone - Input phone number
 * @returns {string|null} - Normalized number or null
 */
export function normalizePhoneNumber(phone) {
  if (!phone) return null;

  // Remove all non-numeric characters
  const digits = phone.replace(/\D/g, '');

  // Check for valid US number (10 digits or 11 with leading 1)
  if (digits.length === 10) {
    return `+1${digits}`;
  } else if (digits.length === 11 && digits[0] === '1') {
    return `+${digits}`;
  } else if (digits.length > 10 && digits[0] !== '1') {
    // International number - assume it's already correct
    return `+${digits}`;
  }

  return null;
}

/**
 * Check if SMS/Twilio is configured
 * @returns {boolean}
 */
export function isSmsConfigured() {
  return isTwilioConfigured();
}

/**
 * Get SMS configuration status for debugging
 * @returns {object}
 */
export function getSmsStatus() {
  return {
    configured: isSmsConfigured(),
    hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
    hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
    hasPhoneNumber: !!process.env.TWILIO_PHONE_NUMBER
  };
}

// Message templates
export const MESSAGE_TEMPLATES = {
  SEAT_READY: (venue, game) =>
    `Your seat is ready at ${venue} for ${game}. Please check in within 5 minutes.`,

  CALLED_FOR_SEAT: (venue, game, position) =>
    `You're up! ${venue} is calling you for ${game}. You were #${position} on the waitlist.`,

  POSITION_UPDATE: (venue, game, position, wait) =>
    `Update: You're now #${position} for ${game} at ${venue}. Estimated wait: ${wait} minutes.`,

  TOURNAMENT_REMINDER: (venue, tournament, minutes) =>
    `Reminder: ${tournament} at ${venue} starts in ${minutes} minutes.`,

  TOURNAMENT_STARTING: (venue, tournament) =>
    `${tournament} at ${venue} is starting now. Please take your seat.`,

  PROMOTION_ALERT: (venue, promo) =>
    `${venue}: ${promo}`,

  CUSTOM: (message) => message
};
