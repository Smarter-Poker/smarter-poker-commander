/**
 * Commander Member Detail API - Get, Update, Delete
 * GET: Fetch single member by ID
 * PUT: Update member fields
 * DELETE: Deactivate member (soft delete)
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
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

// Auth: STAFF on EVERY method, reads included.
// 2026-08-20 audit fix: this used guardWriteStaff, which returns `true` for GET
// without verifying anything. The GET returns a full commander_members row -
// legal name, date of birth, government ID number, address, phone, email and
// comp balance - so the entire member database was readable by member id.
// PUT/DELETE were staff-gated but had no venue ownership check at all, so any
// staff member at any venue could edit or suspend any other venue's members.
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

      const _authResult = await guardStaff(req, res);
      if (!_authResult) return;

      const { id } = req.query;

      if (!id) {
          return res.status(400).json({ success: false, error: 'Member ID is required' });
      }

      // Venue ownership: the member must belong to the caller's venue.
      const { data: owner } = await getSupabase()
          .from('commander_members')
          .select('id, venue_id')
          .eq('id', id)
          .maybeSingle();

      if (!owner) {
          return res.status(404).json({ success: false, error: 'Member Not Found' });
      }

      if (_authResult.venue_id !== undefined && _authResult.venue_id !== null
          && String(owner.venue_id) !== String(_authResult.venue_id)) {
          return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
      }

      if (req.method === 'GET') {
          return handleGet(req, res, id);
      } else if (req.method === 'PUT') {
          return handleUpdate(req, res, id);
      } else if (req.method === 'DELETE') {
          return handleDelete(req, res, id);
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleGet(req, res, id) {
    const { data: member, error } = await getSupabase()
        .from('commander_members')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (error || !member) {
        return res.status(404).json({ success: false, error: 'Member not found' });
    }

    return res.status(200).json({ success: true, data: { member } });
}

async function handleUpdate(req, res, id) {
    const allowedFields = [
        'first_name', 'last_name', 'email', 'phone', 'date_of_birth',
        'id_type', 'id_number', 'id_state', 'id_expiry',
        'photo_url', 'address', 'membership_tier', 'membership_status',
        'membership_expires', 'notes', 'time_balance_minutes',
        'comp_balance', 'comp_lifetime_earned', 'comp_lifetime_redeemed',
        'last_edited_by', 'last_edited_by_staff_id', 'last_edited_at',
    ];

    const updates = {};
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    }

    if (Object.keys(updates || {}).length === 0) {
        return res.status(400).json({ success: false, error: 'No fields to update' });
    }

    updates.updated_at = new Date().toISOString();

    const { data: member, error } = await getSupabase()
        .from('commander_members')
        .update(updates)
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.warn('Member update error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    return res.status(200).json({ success: true, data: { member } });
}

async function handleDelete(req, res, id) {
    // Soft delete: set status to 'suspended'
    const { data: member, error } = await getSupabase()
        .from('commander_members')
        .update({
            membership_status: 'suspended',
            updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.warn('Member delete error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    return res.status(200).json({ success: true, data: { member } });
}
