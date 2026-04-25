/**
 * Twilio SMS Status Webhook
 * POST /api/commander/webhooks/twilio/status - Receive SMS delivery status updates
 *
 * SECURITY: Validates Twilio request signatures to prevent spoofed webhook calls.
 * Attackers cannot forge delivery statuses without the TWILIO_AUTH_TOKEN secret.
 * Reference: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import crypto from 'crypto';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Twilio Signature Validation ───────────────────────────────────────────
    // Prevents unauthenticated callers from spoofing SMS delivery statuses.
    // If TWILIO_AUTH_TOKEN is not set, we log a warning but still process
    // (backwards-compat for venues not yet configured with Twilio).
    const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
    if (twilioAuthToken) {
      const twilioSignature = req.headers['x-twilio-signature'];
      if (!twilioSignature) {
        console.warn('[twilio-webhook] Missing X-Twilio-Signature header — rejecting');
        return res.status(403).json({ error: 'Missing webhook signature' });
      }

      // Reconstruct the URL as Twilio sees it
      const proto = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      const webhookUrl = `${proto}://${host}/api/commander/webhooks/twilio/status`;

      // Build the validation string: URL + sorted form params
      const params = req.body || {};
      const sortedKeys = Object.keys(params || {}).sort();
      const paramString = sortedKeys.reduce((acc, key) => acc + key + params[key], '');
      const validationString = webhookUrl + paramString;

      // Compute HMAC-SHA1
      const expectedSignature = crypto
        .createHmac('sha1', twilioAuthToken)
        .update(Buffer.from(validationString, 'utf-8'))
        .digest('base64');

      // Constant-time comparison to prevent timing attacks
      const expected = Buffer.from(expectedSignature);
      const received = Buffer.from(twilioSignature);
      const valid = expected.length === received.length &&
        crypto.timingSafeEqual(expected, received);

      if (!valid) {
        console.warn('[twilio-webhook] Invalid signature — possible spoofed request');
        return res.status(403).json({ error: 'Invalid webhook signature' });
      }
    } else {
      console.warn('[twilio-webhook] TWILIO_AUTH_TOKEN not set — signature validation DISABLED');
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      // Twilio sends form-encoded data
      const {
        MessageSid,
        MessageStatus,
        To,
        From,
        ErrorCode,
        ErrorMessage
      } = req.body;

      if (!MessageSid || !MessageStatus) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      // Map Twilio status to our status
      const statusMap = {
        queued: 'pending',
        sent: 'sent',
        delivered: 'delivered',
        undelivered: 'failed',
        failed: 'failed'
      };

      const mappedStatus = statusMap[MessageStatus] || MessageStatus;

      // Update notification by message_sid in metadata
      const { data: notifications, error: findError } = await getSupabase()
        .from('commander_notifications')
        .select('id')
        .eq('channel', 'sms')
        .contains('metadata', { message_sid: MessageSid })
        .limit(100);

      if (findError) {
        console.warn('Find notification error:', findError);
      }

      if (notifications && notifications.length > 0) {
        const updates = {
          status: mappedStatus,
          metadata: {
            message_sid: MessageSid,
            twilio_status: MessageStatus,
            error_code: ErrorCode,
            error_message: ErrorMessage
          }
        };

        if (mappedStatus === 'delivered') {
          updates.delivered_at = new Date().toISOString();
        }

        const { error: updateError } = await getSupabase()
          .from('commander_notifications')
          .update(updates)
          .eq('id', notifications[0].id);

        if (updateError) {
          console.warn('Update notification error:', updateError);
        }
      }

      // Always return 200 to acknowledge receipt to Twilio
      return res.status(200).json({ received: true });

    } catch (error) {
      console.warn('Twilio webhook error:', error);
      // Still return 200 to prevent Twilio from retrying
      return res.status(200).json({ received: true, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// Body parsing enabled — Twilio sends form-encoded data
export const config = {
  api: {
    bodyParser: true
  }
};
