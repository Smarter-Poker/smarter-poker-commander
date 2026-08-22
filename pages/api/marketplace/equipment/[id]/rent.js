/**
 * Rent Equipment API
 * POST /api/commander/marketplace/equipment/[id]/rent - Request to rent equipment
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
      // Support both field naming conventions
      const {
        rental_start, rental_end,
        start_date, end_date,
        message, notes,
        venue_id
      } = req.body;

      const startDate = rental_start || start_date;
      const endDate = rental_end || end_date;
      const rentalNotes = message || notes;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Start and end dates required' }
        });
      }

      // Get equipment listing
      const { data: equipment, error: equipError } = await getSupabase()
        .from('commander_equipment_rentals')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (equipError || !equipment) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Equipment not found' }
        });
      }

      if (!equipment.available) {
        return res.status(400).json({
          success: false,
          error: { code: 'NOT_AVAILABLE', message: 'Equipment is not currently available' }
        });
      }

      // Calculate rental duration and cost
      const start = new Date(startDate);
      const end = new Date(endDate);
      const days = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1);

      const dailyRate = equipment.daily_rate != null ? Number(equipment.daily_rate) : null;
      const weeklyRate = equipment.weekly_rate != null ? Number(equipment.weekly_rate) : null;

      let rentalType = 'daily';
      let total;
      if (days >= 7 && weeklyRate) {
        rentalType = 'weekly';
        const weeks = Math.floor(days / 7);
        const remainingDays = days % 7;
        total = (weeks * weeklyRate) + (remainingDays * (dailyRate || 0));
      } else {
        total = days * (dailyRate != null ? dailyRate : 50);
      }

      const deposit = equipment.deposit_required != null ? Number(equipment.deposit_required) : 0;
      const requestedBy = staff.user_id || staff.linked_user_id || staff.id || null;
      const orderVenueId = staff.venue_id ?? venue_id ?? null;

      // Create the venue rental order
      const { data: order, error: orderError } = await getSupabase()
        .from('commander_equipment_rental_orders')
        .insert({
          venue_id: orderVenueId,
          equipment_id: id,
          equipment_name: equipment.name,
          rental_type: rentalType,
          start_date: startDate,
          end_date: endDate,
          quantity: 1,
          daily_rate: dailyRate,
          total,
          deposit,
          notes: rentalNotes || null,
          requested_by: requestedBy,
          status: 'requested'
        })
        .select()
        .maybeSingle();

      if (orderError) {
        console.warn('Rental order error:', orderError);
        return res.status(500).json({
          success: false,
          error: { code: 'SERVER_ERROR', message: 'Failed to send rental request' }
        });
      }

      // Best-effort notification to the equipment owner (non-fatal)
      if (equipment.vendor_id) {
        const { error: notifError } = await getSupabase()
          .from('commander_notifications')
          .insert({
            player_id: equipment.vendor_id,
            notification_type: 'equipment_rental_request',
            channel: 'in_app',
            title: 'New Equipment Rental Request',
            message: `A venue wants to rent "${equipment.name}" from ${startDate} to ${endDate}`,
            metadata: {
              order_id: order?.id,
              equipment_id: id,
              venue_id: orderVenueId,
              start_date: startDate,
              end_date: endDate,
              estimated_days: days,
              estimated_cost: total,
              notes: rentalNotes || null
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
          order: order || null,
          message: 'Rental request sent successfully',
          equipment_name: equipment.name,
          estimated_days: days,
          estimated_cost: total,
          deposit_required: deposit
        }
      });
    } catch (error) {
      console.warn('Rent equipment error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to send rental request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
