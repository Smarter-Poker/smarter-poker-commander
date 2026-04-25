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

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _g = await guardWriteStaff(req, res); if (!_g) return;

    if (req.method !== 'POST') {
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST allowed' }
      });
    }

    const { id } = req.query;

    try {
      // Support both staff session and bearer token auth
      const staffSession = req.headers['x-staff-session'];
      const authHeader = req.headers.authorization;

      let userId = null;
      let venueId = null;

      if (staffSession) {
        try {
          const staff = JSON.parse(staffSession);
          userId = staff.user_id;
          venueId = staff.venue_id;
        } catch (e) {
          return res.status(401).json({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Invalid staff session' }
          });
        }
      } else if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
        const user = authData?.user;

        if (authError || !user) {
          return res.status(401).json({
            success: false,
            error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
          });
        }
        userId = user.id;
      } else {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
        });
      }

      // Support both field naming conventions
      const {
        home_game_id,
        rental_start, rental_end,
        start_date, end_date,
        message, notes,
        venue_id
      } = req.body;

      const startDate = rental_start || start_date;
      const endDate = rental_end || end_date;
      const rentalNotes = message || notes;
      const renterVenueId = venue_id || venueId;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELDS', message: 'Start and end dates required' }
        });
      }

      // Get equipment listing
      const { data: equipment, error: equipError } = await getSupabase()
        .from('commander_equipment_rentals')
        .select('*, owner:owner_id (id, display_name, email)')
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

      let estimatedCost;
      if (days >= 7 && equipment.weekly_rate) {
        const weeks = Math.floor(days / 7);
        const remainingDays = days % 7;
        estimatedCost = (weeks * equipment.weekly_rate) + (remainingDays * equipment.daily_rate);
      } else {
        estimatedCost = days * (equipment.daily_rate || 50);
      }

      // Create rental record
      const { data: rental, error: rentalError } = await getSupabase()
        .from('commander_equipment_rentals')
        .insert({
          equipment_id: id,
          renter_user_id: userId,
          renter_venue_id: renterVenueId,
          owner_id: equipment.owner_id,
          home_game_id: home_game_id || null,
          start_date: startDate,
          end_date: endDate,
          days,
          daily_rate: equipment.daily_rate,
          total_cost: estimatedCost,
          deposit_amount: equipment.deposit_required || 0,
          notes: rentalNotes || null,
          status: 'pending'
        })
        .select()
        .maybeSingle();

      if (rentalError) {
        console.warn('Rental record error:', rentalError);
      }

      // Create rental request notification to equipment owner
      if (equipment.owner_id) {
        const { error: notifError } = await getSupabase()
          .from('commander_notifications')
          .insert({
            user_id: equipment.owner_id,
            venue_id: equipment.venue_id,
            type: 'rental_request',
            title: 'New Equipment Rental Request',
            message: `Someone wants to rent "${equipment.name}" from ${startDate} to ${endDate}`,
            data: {
              rental_id: rental?.id,
              equipment_id: id,
              renter_id: userId,
              home_game_id,
              start_date: startDate,
              end_date: endDate,
              estimated_days: days,
              estimated_cost: estimatedCost,
              notes: rentalNotes
            },
            channel: 'in_app'
          });

        if (notifError) {
          console.warn('Notification error:', notifError);
        }
      }

      return res.status(200).json({
        success: true,
        data: {
          rental: rental || null,
          message: 'Rental request sent successfully',
          equipment_name: equipment.name,
          estimated_days: days,
          estimated_cost: estimatedCost,
          deposit_required: equipment.deposit_required
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
