/**
 * Commander Floor Call API - POST /api/commander/floor-call
 * Creates or cancels a floor call alert that broadcasts to all Commander screens in real-time
 * 
 * Actions:
 *   - default: Create a new floor call
 *   - cancel: Resolve/cancel an active floor call
 * 
 * Schema: commander_floor_calls
 *   id, venue_id, table_number, reason, description, priority, status,
 *   called_by, responded_by, responded_at, resolution, created_at
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { reportApiError } from '../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await guardWriteStaff(req, res);
      if (!_staff) return;
    }

      if (req.method !== 'POST') {
          return res.status(405).json({ success: false, error: 'Method not allowed' });
      }

      try {
          const { action, call_id, venue_id, table_number, table_name, called_by } = req.body;

          // ── Cancel an active floor call ──
          if (action === 'cancel' && call_id) {
              const { error } = await getSupabase()
                  .from('commander_floor_calls')
                  .update({
                      status: 'resolved',
                      responded_at: new Date().toISOString(),
                      resolution: 'cancelled_by_tablet',
                  })
                  .eq('id', call_id);

              if (error) {
                  console.warn('Floor call cancel error:', error);
                  return res.status(500).json({ success: false, error: 'Failed to cancel floor call' });
              }
              return res.status(200).json({ success: true, data: { cancelled: true } });
          }

          // ── Create a new floor call ──
          if (!venue_id || !table_number) {
              return res.status(400).json({ success: false, error: 'venue_id and table_number are required' });
          }

          // Check for existing open call from same table (prevent spam).
          // The floor-calls queue (floor-calls.js) treats pending/acknowledged/
          // en_route as open, so match those here.
          const { data: existing } = await getSupabase()
              .from('commander_floor_calls')
              .select('id, created_at')
              .eq('venue_id', venue_id)
              .eq('table_number', table_number)
              .in('status', ['pending', 'acknowledged', 'en_route'])
              .limit(1);

          if (existing && existing.length > 0) {
              const age = (Date.now() - new Date(existing[0].created_at).getTime()) / 1000;
              if (age < 60) {
                  return res.status(200).json({
                      success: true,
                      data: { id: existing[0].id, already_active: true, message: 'Floor call already active' }
                  });
              }
              // Resolve old call
              await getSupabase()
                  .from('commander_floor_calls')
                  .update({ status: 'resolved', responded_at: new Date().toISOString(), resolution: 'auto-expired' })
                  .eq('id', existing[0].id);
          }

          // Create new floor call. Status must be 'pending' - the floor-calls
          // queue and commander UI only surface pending/acknowledged/en_route,
          // so rows created as 'active' never appeared in the queue.
          const { data: call, error } = await getSupabase()
              .from('commander_floor_calls')
              .insert({
                  venue_id,
                  table_number,
                  reason: 'floor_request',
                  description: `Table ${table_number}${table_name ? ` (${table_name})` : ''} needs floor assistance`,
                  priority: 'normal',
                  status: 'pending',
                  called_by: called_by || 'tablet',
              })
              .select()
              .maybeSingle();

          if (error) {
              console.warn('Floor call create error:', error);
              return res.status(500).json({ success: false, error: 'Failed to create floor call' });
          }

          return res.status(200).json({
              success: true,
              data: { id: call.id, table_number, description: call.description }
          });
      } catch (error) {
          console.warn('Floor call error:', error);
          return res.status(500).json({ success: false, error: 'Internal server error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
