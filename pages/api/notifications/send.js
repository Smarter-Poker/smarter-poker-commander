/**
 * Commander Send Notification API - POST /api/commander/notifications/send [Staff/System]
 * Send notifications to players
 * Reference: API_REFERENCE.md - Notifications section
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { normalizePhoneNumber, isSmsConfigured } from '../../../src/lib/commander/notifications';
import { sendSMS as twilioSendSMS, isTwilioConfigured } from '../../../src/lib/commander/twilio';
import { isOneSignalConfigured } from '../../../src/lib/commander/pushNotifications';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
import { checkMemoryRateLimit } from '../../../src/lib/commander/rateLimit';
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

// 2026-07-25 audit fix: added 'announcement' for venue-wide broadcasts
const VALID_TYPES = ['seat_available', 'tournament_starting', 'called_for_seat', 'promotion', 'custom', 'announcement'];
const VALID_CHANNELS = ['sms', 'push', 'email', 'in_app'];
const VALID_TARGETS = ['all', 'waitlist', 'seated'];

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    // Rate limit: 20 notifications per minute per IP
    const fwd = req.headers["x-forwarded-for"];
    const ip = fwd ? fwd.split(",")[0].trim() : req.socket?.remoteAddress || "0";
    const rl = checkMemoryRateLimit(`notif:${ip}`, 20, 60000);
    if (!rl.allowed) { return res.status(429).json({ success: false, error: { code: "RATE_LIMITED", message: `Rate limited. Retry in ${rl.retryAfter}s.` } }); }

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    }

    try {
      // 2026-07-25 audit fix: use the staff object already verified by the
      // guard - the legacy inline re-auth looked up commander_staff by
      // sessionData.id, which 401'd owner sessions (no staff row).
      const staff = _g;

      const {
        player_id,
        phone,
        venue_id: bodyVenueId,
        type,
        target,
        channels = ['in_app'],
        title,
        message,
        metadata = {}
      } = req.body;

      // 2026-07-25 audit fix: venue always comes from the verified session;
      // an explicitly different body venue_id is rejected.
      if (bodyVenueId && String(bodyVenueId) !== String(staff.venue_id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
        });
      }
      const venue_id = staff.venue_id;

      // Validation
      if (!type || !message) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'type and message are required'
          }
        });
      }

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`
          }
        });
      }

      // 2026-07-25 audit fix: broadcast announcements - recipients are
      // resolved server-side from the venue's waitlist / active sessions.
      if (type === 'announcement') {
        const tgt = target || 'all';
        if (!VALID_TARGETS.includes(tgt)) {
          return res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: `Invalid target. Must be one of: ${VALID_TARGETS.join(', ')}`
            }
          });
        }

        // Resolve recipients (deduped by player_id, or phone when anonymous)
        const recipients = new Map();
        if (tgt === 'waitlist' || tgt === 'all') {
          const { data: wlRows, error: wlError } = await getSupabase()
            .from('commander_waitlist')
            .select('player_id, player_phone')
            .eq('venue_id', venue_id)
            .in('status', ['waiting', 'called']);
          if (wlError) console.warn('Announcement waitlist query error:', wlError);
          for (const row of wlRows || []) {
            const key = row.player_id ? `p:${row.player_id}` : (row.player_phone ? `ph:${row.player_phone}` : null);
            if (!key) continue;
            if (!recipients.has(key)) recipients.set(key, { player_id: row.player_id || null, phone: row.player_phone || null });
            else if (row.player_phone && !recipients.get(key).phone) recipients.get(key).phone = row.player_phone;
          }
        }
        if (tgt === 'seated' || tgt === 'all') {
          const { data: sessionRows, error: sessError } = await getSupabase()
            .from('commander_player_sessions')
            .select('player_id')
            .eq('venue_id', venue_id)
            .is('check_out_at', null);
          if (sessError) console.warn('Announcement sessions query error:', sessError);
          for (const row of sessionRows || []) {
            if (!row.player_id) continue;
            const key = `p:${row.player_id}`;
            if (!recipients.has(key)) recipients.set(key, { player_id: row.player_id, phone: null });
          }
        }

        let sent_count = 0;
        let failed_count = 0;

        for (const recipient of recipients.values()) {
          const { data: notification, error: insertError } = await getSupabase()
            .from('commander_notifications')
            .insert({
              venue_id,
              player_id: recipient.player_id,
              notification_type: 'announcement',
              channel: 'in_app',
              title: title || getDefaultTitle('announcement'),
              message,
              status: 'sent',
              sent_at: new Date().toISOString(),
              metadata: { ...metadata, target: tgt, phone: recipient.phone || null }
            })
            .select()
            .maybeSingle();

          if (insertError || !notification) {
            if (insertError) console.warn('Announcement notification insert error:', insertError);
            failed_count++;
            continue;
          }
          sent_count++;

          // Best-effort SMS via the existing path (separate sms row so its
          // status tracking never clobbers the in_app record)
          if (recipient.phone || recipient.player_id) {
            try {
              const { data: smsRow } = await getSupabase()
                .from('commander_notifications')
                .insert({
                  venue_id,
                  player_id: recipient.player_id,
                  notification_type: 'announcement',
                  channel: 'sms',
                  title: title || getDefaultTitle('announcement'),
                  message,
                  status: 'pending',
                  metadata: { ...metadata, target: tgt, phone: recipient.phone || null }
                })
                .select()
                .maybeSingle();
              if (smsRow) await sendSmsNotification(smsRow, recipient.phone);
            } catch (smsError) {
              console.warn('Announcement SMS best-effort failed:', smsError?.message || smsError);
            }
          }
        }

        return res.status(200).json({ success: true, data: { sent_count, failed_count } });
      }

      if (!player_id && !phone) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Either player_id or phone is required'
          }
        });
      }

      const invalidChannels = channels.filter(c => !VALID_CHANNELS.includes(c));
      if (invalidChannels.length > 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid channels: ${invalidChannels.join(', ')}. Must be one of: ${VALID_CHANNELS.join(', ')}`
          }
        });
      }

      // Create notification records for each channel
      const notifications = [];
      const errors = [];

      for (const channel of channels) {
        const { data: notification, error } = await getSupabase()
          .from('commander_notifications')
          .insert({
            venue_id,
            player_id: player_id || null,
            notification_type: type,
            channel,
            title: title || getDefaultTitle(type),
            message,
            status: 'pending',
            metadata: {
              ...metadata,
              phone: phone || null
            }
          })
          .select()
          .maybeSingle();

        if (error) {
          console.warn(`Commander notification insert error (${channel}):`, error);
          errors.push({ channel, error: error.message });
        } else {
          notifications.push(notification);

          // Process notification based on channel
          await processNotification(notification, channel, phone);
        }
      }

      return res.status(201).json({
        success: true,
        data: {
          notifications,
          errors: errors.length > 0 ? errors : undefined
        }
      });
    } catch (error) {
      console.warn('Commander send notification error:', error);
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

function getDefaultTitle(type) {
  const titles = {
    seat_available: 'Seat Available',
    tournament_starting: 'Tournament Starting',
    called_for_seat: 'Your Seat is Ready',
    promotion: 'Promotion Alert',
    // 2026-07-25 audit fix: title for broadcast announcements
    announcement: 'Announcement',
    custom: 'Notification'
  };
  return titles[type] || 'Notification';
}

async function processNotification(notification, channel, phone) {
  try {
    switch (channel) {
      case 'sms':
        await sendSmsNotification(notification, phone);
        break;

      case 'push':
        await sendPushNotification(notification);
        break;

      case 'in_app':
        // In-app notifications are immediately available
        await getSupabase()
          .from('commander_notifications')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString()
          })
          .eq('id', notification.id);
        break;

      case 'email':
        await sendEmailNotification(notification);
        break;
    }
  } catch (error) {
    console.warn(`Error processing ${channel} notification:`, error);
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: error.message }
      })
      .eq('id', notification.id);
  }
}

async function sendSmsNotification(notification, phone) {
  if (!isSmsConfigured() && !isTwilioConfigured()) {
    await getSupabase()
      .from('commander_notifications')
      .update({ status: 'pending' })
      .eq('id', notification.id);
    return;
  }

  // Get phone number from notification or player profile
  let toPhone = phone;
  if (!toPhone && notification.player_id) {
    // First check player preferences for this venue
    const { data: prefs } = await getSupabase()
      .from('commander_player_preferences')
      .select('notification_preferences')
      .eq('player_id', notification.player_id)
      .eq('venue_id', notification.venue_id)
      .maybeSingle();

    // If no phone in preferences, get from profiles table
    if (!prefs?.notification_preferences?.phone) {
      const { data: profile } = await getSupabase()
        .from('profiles')
        .select('phone')
        .eq('id', notification.player_id)
        .maybeSingle();
      toPhone = profile?.phone;
    } else {
      toPhone = prefs.notification_preferences.phone;
    }
  }

  if (!toPhone) {
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: 'No phone number available' }
      })
      .eq('id', notification.id);
    return;
  }

  try {
    // Normalize the phone number to E.164 format using shared utility
    const normalizedPhone = normalizePhoneNumber(toPhone);
    if (!normalizedPhone) {
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'failed',
          metadata: { ...notification.metadata, error: 'Invalid phone number format' }
        })
        .eq('id', notification.id);
      return;
    }

    // Use shared Twilio utility for SMS sending
    const smsResult = await twilioSendSMS(normalizedPhone, notification.message);

    if (smsResult.success) {
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: { ...notification.metadata, message_sid: smsResult.messageId }
        })
        .eq('id', notification.id);
    } else {
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'failed',
          metadata: { ...notification.metadata, error: smsResult.reason }
        })
        .eq('id', notification.id);
    }
  } catch (error) {
    console.warn('Twilio SMS error:', error);
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: error.message }
      })
      .eq('id', notification.id);
  }
}

async function sendEmailNotification(notification) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'notifications@smarter.poker';

  if (!resendApiKey) {
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'pending',
        metadata: { ...notification.metadata, email_pending: true }
      })
      .eq('id', notification.id);
    return;
  }

  // Get player email
  let toEmail = notification.metadata?.email;
  if (!toEmail && notification.player_id) {
    const { data: profile } = await getSupabase()
      .from('profiles')
      .select('email')
      .eq('id', notification.player_id)
      .maybeSingle();
    toEmail = profile?.email;
  }

  if (!toEmail) {
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: 'No email address available' }
      })
      .eq('id', notification.id);
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`
      },
      body: JSON.stringify({
        from: fromEmail,
        to: toEmail,
        subject: notification.title || 'Club Commander Notification',
        html: `
          <div style="font-family: Inter, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #1877F2; padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Club Commander</h1>
            </div>
            <div style="padding: 30px; background: #F9FAFB;">
              <h2 style="color: #1F2937; margin-top: 0;">${notification.title || 'Notification'}</h2>
              <p style="color: #4B5563; font-size: 16px; line-height: 1.6;">${notification.message}</p>
            </div>
            <div style="padding: 20px; text-align: center; color: #9CA3AF; font-size: 12px;">
              <p>Sent by Club Commander - Poker Room Management</p>
            </div>
          </div>
        `
      })
    });

    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const result = await response.json();

    if (result.id) {
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: { ...notification.metadata, resend_id: result.id }
        })
        .eq('id', notification.id);
    } else {
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'failed',
          metadata: { ...notification.metadata, error: result.message || 'Email send failed' }
        })
        .eq('id', notification.id);
    }
  } catch (error) {
    console.warn('Resend email error:', error);
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: error.message }
      })
      .eq('id', notification.id);
  }
}

async function sendPushNotification(notification) {
  // Use shared push notification utility for configuration check
  if (!isOneSignalConfigured()) {
    await getSupabase()
      .from('commander_notifications')
      .update({ status: 'pending' })
      .eq('id', notification.id);
    return;
  }

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  // Get player's push subscriptions
  const { data: subscriptions } = await getSupabase()
    .from('commander_push_subscriptions')
    .select('subscription_data, endpoint')
    .eq('user_id', notification.player_id)
    .eq('is_active', true);

  if (!subscriptions || subscriptions.length === 0) {
    // No push subscription, try sending by external_user_id (player_id)
    try {
      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${apiKey}`
        },
        body: JSON.stringify({
          app_id: appId,
          include_external_user_ids: [notification.player_id],
          headings: { en: notification.title },
          contents: { en: notification.message },
          data: {
            notification_id: notification.id,
            type: notification.notification_type,
            venue_id: notification.venue_id,
            ...notification.metadata
          }
        })
      });

      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json();

      if (result.id) {
        await getSupabase()
          .from('commander_notifications')
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            metadata: { ...notification.metadata, onesignal_id: result.id }
          })
          .eq('id', notification.id);
      } else {
        await getSupabase()
          .from('commander_notifications')
          .update({
            status: 'failed',
            metadata: { ...notification.metadata, error: result.errors?.[0] || 'No recipients' }
          })
          .eq('id', notification.id);
      }
    } catch (error) {
      console.warn('OneSignal push error:', error);
      await getSupabase()
        .from('commander_notifications')
        .update({
          status: 'failed',
          metadata: { ...notification.metadata, error: error.message }
        })
        .eq('id', notification.id);
    }
    return;
  }

  // Send to all active subscriptions
  try {
    const playerIds = subscriptions
      .map(s => s.subscription_data?.playerId)
      .filter(Boolean);

    if (playerIds.length === 0) {
      // Fallback to external_user_id
      const response = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${apiKey}`
        },
        body: JSON.stringify({
          app_id: appId,
          include_external_user_ids: [notification.player_id],
          headings: { en: notification.title },
          contents: { en: notification.message },
          data: {
            notification_id: notification.id,
            type: notification.notification_type,
            venue_id: notification.venue_id,
            ...notification.metadata
          }
        })
      });

      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const result = await response.json();

      await getSupabase()
        .from('commander_notifications')
        .update({
          status: result.id ? 'sent' : 'failed',
          sent_at: result.id ? new Date().toISOString() : null,
          metadata: {
            ...notification.metadata,
            onesignal_id: result.id,
            error: result.errors?.[0]
          }
        })
        .eq('id', notification.id);
      return;
    }

    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
      },
      body: JSON.stringify({
        app_id: appId,
        include_player_ids: playerIds,
        headings: { en: notification.title },
        contents: { en: notification.message },
        data: {
          notification_id: notification.id,
          type: notification.notification_type,
          venue_id: notification.venue_id,
          ...notification.metadata
        }
      })
    });

    if (!response.ok) throw new Error(`Request failed (${response.status})`);
    const result = await response.json();

    await getSupabase()
      .from('commander_notifications')
      .update({
        status: result.id ? 'sent' : 'failed',
        sent_at: result.id ? new Date().toISOString() : null,
        metadata: {
          ...notification.metadata,
          onesignal_id: result.id,
          recipients: result.recipients
        }
      })
      .eq('id', notification.id);
  } catch (error) {
      try { reportApiError(error, null); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('OneSignal push error:', error);
    await getSupabase()
      .from('commander_notifications')
      .update({
        status: 'failed',
        metadata: { ...notification.metadata, error: error.message }
      })
      .eq('id', notification.id);
  }
}
