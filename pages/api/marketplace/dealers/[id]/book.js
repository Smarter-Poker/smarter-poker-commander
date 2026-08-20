/**
 * Book Dealer API
 * POST /api/commander/marketplace/dealers/[id]/book - Request to book a freelance dealer
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires a signed staff session (owner/manager/floor)
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const staff = await guardWriteStaff(req, res); if (!staff) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    try {
      const { venue_id, date, start_time, hours, notes } = req.body;

      if (!date) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'date is required' }
        });
      }

      // Get dealer listing
      const { data: dealer, error: dealerError } = await getSupabase()
        .from('commander_dealer_marketplace')
        .select('*')
        .eq('id', id)
        .eq('status', 'active')
        .maybeSingle();

      if (dealerError || !dealer) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Dealer not found or unavailable' }
        });
      }

      const bookedHours = Number(hours) > 0 ? Number(hours) : 1;
      const hourlyRate = dealer.hourly_rate != null ? Number(dealer.hourly_rate) : null;
      const total = hourlyRate != null ? hourlyRate * bookedHours : null;
      const requestedBy = staff.user_id || staff.linked_user_id || staff.id || null;
      const bookingVenueId = staff.venue_id ?? venue_id ?? null;

      // Create the venue booking request
      const { data: booking, error: bookingError } = await getSupabase()
        .from('commander_dealer_bookings')
        .insert({
          venue_id: bookingVenueId,
          dealer_marketplace_id: id,
          dealer_name: dealer.name,
          requested_date: date,
          hours: bookedHours,
          hourly_rate: hourlyRate,
          total,
          notes: notes || null,
          requested_by: requestedBy,
          status: 'requested'
        })
        .select()
        .maybeSingle();

      if (bookingError) {
        console.warn('Dealer booking error:', bookingError);
        return res.status(500).json({
          success: false,
          error: { code: 'SERVER_ERROR', message: 'Failed to send booking request' }
        });
      }

      // Best-effort notification to the dealer (non-fatal)
      if (dealer.dealer_id) {
        const { error: notifError } = await getSupabase()
          .from('commander_notifications')
          .insert({
            player_id: dealer.dealer_id,
            notification_type: 'dealer_booking_request',
            channel: 'in_app',
            title: 'New Booking Request',
            message: `A venue wants to book you for ${bookedHours} hour${bookedHours > 1 ? 's' : ''} on ${date}`,
            metadata: {
              booking_id: booking?.id,
              dealer_marketplace_id: id,
              venue_id: bookingVenueId,
              requested_date: date,
              start_time: start_time || null,
              hours: bookedHours,
              notes: notes || null
            },
            status: 'sent'
          });

        if (notifError) {
          console.warn('Notification error:', notifError);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          booking: booking || null,
          message: 'Booking request sent to dealer',
          dealer_name: dealer.name,
          hours: bookedHours,
          estimated_cost: total
        }
      });
    } catch (error) {
      console.warn('Book dealer error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to send booking request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
