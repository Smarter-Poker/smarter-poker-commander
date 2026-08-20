import crypto from 'crypto';
import twilio from 'twilio';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const JWT_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

let twilioClient;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, phone, code, hash } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }

  try {
    if (action === 'send') {
      if (!twilioClient) {
        return res.status(500).json({ error: 'Twilio is not configured.' });
      }

      // Format phone to E.164 (strip non-digits, prepend +1 if missing for US)
      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `+1${cleanPhone}` : (cleanPhone.startsWith('1') ? `+${cleanPhone}` : phone);

      // Generate a 6-digit code
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();

      // Create a stateless HMAC hash of the code + phone number
      const newHash = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${verificationCode}:${formattedPhone}`)
        .digest('hex');

      // Send the SMS
      await twilioClient.messages.create({
        body: `Your Smarter.Poker Commander verification code is: ${verificationCode}`,
        from: TWILIO_PHONE_NUMBER,
        to: formattedPhone
      });

      return res.status(200).json({ hash: newHash });
    }

    if (action === 'verify') {
      if (!code || !hash) {
        return res.status(400).json({ error: 'Code and hash are required.' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `+1${cleanPhone}` : (cleanPhone.startsWith('1') ? `+${cleanPhone}` : phone);

      const expectedHash = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${code}:${formattedPhone}`)
        .digest('hex');

      if (expectedHash === hash) {
        return res.status(200).json({ valid: true });
      } else {
        return res.status(400).json({ valid: false, error: 'Invalid verification code.' });
      }
    }

    return res.status(400).json({ error: 'Invalid action.' });
  } catch (error) {
    console.error('[verify-sms] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to process verification.' });
  }
}
