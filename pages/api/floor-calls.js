/**
 * Floor Calls API
 * POST /api/commander/floor-calls - Create a new floor call
 * GET  /api/commander/floor-calls - List floor calls (with filters)
 * PUT  /api/commander/floor-calls - Acknowledge/resolve a floor call
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
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

const VALID_REASONS = [
  'dispute', 'chip_fill', 'buyin', 'player_issue',
  'security', 'maintenance', 'dealer_relief', 'floor_assistance', 'other'
];

const VALID_PRIORITIES = ['urgent', 'high', 'normal', 'low'];
const VALID_STATUSES = ['pending', 'acknowledged', 'en_route', 'resolved', 'cancelled'];

// Auth: STAFF_WRITE — requires manager or owner role
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth for all operations
    const staffResult = await guardWriteStaff(req, res);
    if (!staffResult) return;

    try {
      // GET - List floor calls with filters
      if (req.method === 'GET') {
        // Floor calls are polled by multiple staff devices — 10s CDN cache prevents fan-out
        res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
        const { venue_id, status, reason, priority, responded_by, limit = '50' } = req.query;

        let query = getSupabase()
          .from('commander_floor_calls')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(Math.min(parseInt(limit) || 50, 500));

        if (venue_id) query = query.eq('venue_id', venue_id);

        if (status) {
          // Support comma-separated statuses: status=pending,acknowledged
          const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
          if (statuses.length === 1) {
            query = query.eq('status', statuses[0]);
          } else if (statuses.length > 1) {
            query = query.in('status', statuses);
          }
        } else {
          query = query.in('status', ['pending', 'acknowledged', 'en_route']);
        }

        if (reason) query = query.eq('reason', reason);
        if (priority) query = query.eq('priority', priority);
        if (responded_by) query = query.eq('responded_by', responded_by);

        const { data, error } = await query;
        if (error) throw error;
        return res.status(200).json({ success: true, data });
      }

      // POST - Create floor call
      if (req.method === 'POST') {
        const { venue_id, table_number, reason, description, priority, called_by } = req.body;
        if (!table_number || !reason) {
          return res.status(400).json({ success: false, error: 'table_number and reason required' });
        }

        const safeReason = VALID_REASONS.includes(reason) ? reason : 'other';
        const safePriority = VALID_PRIORITIES.includes(priority) ? priority : 'normal';

        const { data, error } = await getSupabase().from('commander_floor_calls').insert({
          venue_id: venue_id || null,
          table_number,
          reason: safeReason,
          description: description || '',
          priority: safePriority,
          called_by: called_by || 'staff',
          status: 'pending'
        }).select().maybeSingle();

        if (error) throw error;
        if (!data) throw new Error('Failed to create floor call');

        // Also log to activity feed (non-blocking)
        await getSupabase().from('commander_activity_log').insert({
          venue_id: venue_id || null,
          event_type: safePriority === 'urgent' ? 'incident' : 'floor_call',
          message: `Floor call at Table ${table_number}: ${safeReason.replace(/_/g, ' ')}`,
          detail: description || '',
          table_number
        }).catch((err) => {
          console.warn('Activity log insert warning (non-critical):', err);
        });

        return res.status(201).json({ success: true, data });
      }

      // PUT - Acknowledge, en_route, resolve, or cancel
      if (req.method === 'PUT') {
        const { id, status, responded_by, resolution } = req.body;
        if (!id || !status) {
          return res.status(400).json({ success: false, error: 'id and status required' });
        }
        if (!VALID_STATUSES.includes(status)) {
          return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
        }

        // Fetch existing call for response time computation
        const { data: existing } = await getSupabase()
          .from('commander_floor_calls')
          .select('created_at, responded_at')
          .eq('id', id)
          .maybeSingle();

        const now = new Date().toISOString();
        const updates = { status };

        if (status === 'acknowledged' || status === 'en_route') {
          if (responded_by) updates.responded_by = responded_by;
          if (!existing?.responded_at) {
            updates.responded_at = now;
          }
        }

        if (status === 'resolved') {
          updates.resolution = resolution || '';
          if (!existing?.responded_at) {
            updates.responded_at = now;
          }
        }

        if (status === 'cancelled') {
          updates.resolution = resolution || 'Cancelled';
        }

        const { data, error } = await getSupabase().from('commander_floor_calls')
          .update(updates).eq('id', id).select().maybeSingle();

        if (error || !data) throw error || new Error('Floor call not found');
        return res.status(200).json({ success: true, data });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Floor calls error:', err);
      return res.status(500).json({ success: false, error: err.message });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
