/**
 * Staff Schedule Broadcast API - POST /api/commander/schedule/broadcast
 * Sends the week's schedule to all staff via SMS and/or email
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { verifyManagerSession, guardWriteStaff } from '../../../src/lib/commander/auth';
import twilio from 'twilio';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../src/lib/apiErrorHandler';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);
const TWILIO_FROM = process.env.TWILIO_PHONE_NUMBER;

export default async function handler(req, res) {
  try {
    // CDN cache: fresh for 60s, serve stale up to 300s

    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }

    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    }

    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
      }

      const { venue_id, week_start, channel = 'sms' } = req.body;

      if (!venue_id || !week_start) {
          return res.status(400).json({
              success: false,
              error: { message: 'venue_id and week_start required' }
          });
      }

      // Auth: manager/owner only
      const authResult = await verifyManagerSession(req, venue_id);
      if (authResult.error) {
          return res.status(authResult.error.status).json({
              success: false,
              error: { code: authResult.error.code, message: authResult.error.message }
          });
      }

      try {
          // Fetch shifts for the week
          const start = new Date(week_start + 'T00:00:00');
          const end = new Date(start);
          end.setDate(end.getDate() + 7);
          const endStr = end.toISOString().split('T')[0];

          // Parallel fetch: shifts, staff, and venue name are all independent
          const [shiftsResult, staffResult, venueResult] = await Promise.all([
              getSupabase()
                  .from('commander_staff_shifts')
                  .select('*')
                  .eq('venue_id', venue_id)
                  .gte('shift_date', week_start)
                  .lt('shift_date', endStr)
                  .order('shift_date')
                  .order('start_time')
                  .limit(100),
              getSupabase()
                  .from('commander_staff')
                  .select('id, display_name, phone, email, role')
                  .eq('venue_id', venue_id)
                  .eq('is_active', true)
                  .limit(100),
              getSupabase()
                  .from('poker_venues')
                  .select('name')
                  .eq('id', venue_id)
                  .maybeSingle()
          ]);

          const { data: shifts, error: shiftsErr } = shiftsResult;
          const { data: allStaff, error: staffErr } = staffResult;

          if (shiftsErr) throw shiftsErr;

          if (!shifts || shifts.length === 0) {
              return res.status(400).json({
                  success: false,
                  error: { message: 'No shifts scheduled for this week' }
              });
          }

          if (staffErr) throw staffErr;

          const venueName = venueResult.data?.name || 'Your Venue';

          // Group shifts by staff_id
          const shiftsByStaff = {};
          for (const shift of shifts) {
              if (!shiftsByStaff[shift.staff_id]) shiftsByStaff[shift.staff_id] = [];
              shiftsByStaff[shift.staff_id].push(shift);
          }

          const weekLabel = new Date(week_start + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'short', day: 'numeric'
          });
          const weekEndLabel = new Date(end.getTime() - 86400000).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric'
          });

          const results = { sent: 0, failed: 0, skipped: 0 };

          // Send each staff member THEIR schedule
          for (const member of allStaff) {
              const myShifts = shiftsByStaff[member.id];
              if (!myShifts || myShifts.length === 0) continue; // No shifts = skip

              // Format their personal schedule
              const lines = myShifts.map(s => {
                  const day = new Date(s.shift_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                  const startFormatted = formatTime12(s.start_time);
                  const endFormatted = formatTime12(s.end_time);
                  return `${day}: ${startFormatted} - ${endFormatted}`;
              });

              const message = `${venueName} Schedule (${weekLabel} - ${weekEndLabel})\n\nHi ${member.display_name || 'Team Member'},\n\nYour shifts:\n${lines.join('\n')}\n\nQuestions? Contact your manager.`;

              // Send SMS
              if ((channel === 'sms' || channel === 'both') && member.phone) {
                  try {
                      const phone = normalizePhone(member.phone);
                      if (phone) {
                          await twilioClient.messages.create({
                              body: message,
                              to: phone,
                              from: TWILIO_FROM
                          });
                          results.sent++;
                      } else {
                          results.skipped++;
                      }
                  } catch (smsErr) {
                      console.warn(`[Broadcast] SMS failed for ${member.display_name}:`, smsErr.message);
                      results.failed++;
                  }
              } else if (channel === 'sms' && !member.phone) {
                  results.skipped++; // No phone
              }

              // Send Email (direct via Resend API)
              if ((channel === 'email' || channel === 'both') && member.email) {
                  const resendKey = process.env.RESEND_API_KEY;
                  if (!resendKey) {
                      if (channel === 'email') results.skipped++;
                  } else {
                      try {
                          const htmlBody = `
                              <div style="font-family: Inter, -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
                                  <div style="background: #1877F2; padding: 20px; text-align: center;">
                                      <h1 style="color: white; margin: 0; font-size: 24px;">Club Commander</h1>
                                  </div>
                                  <div style="padding: 30px; background: #F9FAFB;">
                                      <h2 style="color: #1F2937; margin-top: 0;">Your Schedule - ${weekLabel} to ${weekEndLabel}</h2>
                                      <p style="color: #4B5563; font-size: 16px; line-height: 1.6; white-space: pre-line;">${message}</p>
                                  </div>
                                  <div style="padding: 20px; text-align: center; color: #9CA3AF; font-size: 12px;">
                                      <p>Sent By Club Commander - Poker Room Management</p>
                                  </div>
                              </div>`;
                          const emailRes = await fetch('https://api.resend.com/emails', {
                              method: 'POST',
                              headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${resendKey}`
                              },
                              body: JSON.stringify({
                                  from: process.env.RESEND_FROM_EMAIL || 'notifications@smarter.poker',
                                  to: member.email,
                                  subject: `Your Schedule - ${weekLabel} to ${weekEndLabel}`,
                                  html: htmlBody
                              })
                          });
                          if (!emailRes.ok) throw new Error(`Request failed (${emailRes.status})`);
                          const emailResult = await emailRes.json();
                          if (emailResult.id) {
                              results.sent++;
                          } else {
                              console.warn(`[Broadcast] Resend failed for ${member.display_name}:`, emailResult.message);
                              results.failed++;
                          }
                      } catch (emailErr) {
                          console.warn(`[Broadcast] Email failed for ${member.display_name}:`, emailErr.message);
                          results.failed++;
                      }
                  }
              } else if (channel === 'email' && !member.email) {
                  results.skipped++;
              }
          }

          return res.status(200).json({
              success: true,
              data: {
                  ...results,
                  total_staff: allStaff.length,
                  total_shifts: shifts.length
              }
          });
      } catch (err) {
          console.warn('[Schedule Broadcast] Error:', err);
          return res.status(500).json({
              success: false,
              error: { message: 'Failed to broadcast schedule' }
          });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

function formatTime12(timeStr) {
    if (!timeStr) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function normalizePhone(phone) {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    if (digits.length > 10) return '+' + digits;
    return null;
}
