/**
 * Commander Members API - List & Create
 * GET: List members for a venue (with search, filter, pagination)
 * POST: Create a new member (auto-generates member_number + qr_code)
 */
import crypto from 'crypto';
import { createClient } from '../../../src/lib/supabaseServerClient';
// 2026-07-25 audit fix: guardStaff - member list is PII and must not be public on GET
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

// Auth: STAFF_WRITE - requires manager or owner role
export default async function handler(req, res) {
  try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
          if (!applyRateLimit(req, res, LIMITS.write)) return;
      }

      // 2026-07-25 audit fix: require staff auth on ALL methods (GET previously
      // public via guardWriteStaff, returning full member PII).
      const _authResult = await guardStaff(req, res);
      if (!_authResult) return;

      if (req.method === 'GET') {
          return handleList(req, res, _authResult);
      } else if (req.method === 'POST') {
          return handleCreate(req, res, _authResult);
      }
      return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function handleList(req, res, staff) {
    const { venue_id, search, status, tier, page = 1, limit: rawLimit = '50' } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 500);

    if (!venue_id) {
        return res.status(400).json({ success: false, error: 'venue_id is required' });
    }

    // 2026-07-25 audit fix: staff can only list members of their own venue
    if (String(staff.venue_id) !== String(venue_id)) {
        return res.status(403).json({ success: false, error: 'Not authorized for this venue' });
    }

    let query = getSupabase()
        .from('commander_members')
        .select('*', { count: 'exact' })
        .eq('venue_id', venue_id)
        .order('created_at', { ascending: false });

    if (status) {
        query = query.eq('membership_status', status);
    }

    if (tier) {
        query = query.eq('membership_tier', tier);
    }

    if (search) {
        // BUG #270 FIX: Sanitize to prevent PostgREST filter injection
        const s = search.trim().replace(/[,().]/g, ' ').trim();
        if (s) {
            query = query.or(
                `first_name.ilike.%${s}%,last_name.ilike.%${s}%,member_number.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`
            );
        }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    query = query.range(offset, offset + parseInt(limit) - 1);

    const { data: members, error, count } = await query;

    if (error) {
        console.warn('Members list error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }

    // 2026-07-25 audit fix: omit sensitive PII from the LIST payload (detail
    // route keeps them) and cache privately - this is an authenticated response.
    const sanitized = (members || []).map(({ id_number, date_of_birth, ...rest }) => rest);

    res.setHeader('Cache-Control', 'private, max-age=30');
    return res.status(200).json({
        success: true,
        data: {
            members: sanitized,
            total: count || 0,
            page: parseInt(page),
            limit: parseInt(limit),
        },
    });
}

async function handleCreate(req, res, staff) {
    const {
        venue_id,
        first_name,
        last_name,
        email,
        phone,
        date_of_birth,
        id_type,
        id_number,
        id_state,
        id_expiry,
        photo_url,
        address,
        membership_tier = 'daily',
        notes,
        created_by,
    } = req.body;

    if (!venue_id || !first_name || !last_name) {
        return res.status(400).json({
            success: false,
            error: 'venue_id, first_name, and last_name are required',
        });
    }

    // 2026-08-20 audit fix: venue_id came straight off the body, so staff at
    // venue A could enroll members into venue B's roster.
    if (staff && staff.venue_id !== undefined && staff.venue_id !== null
        && String(staff.venue_id) !== String(venue_id)) {
        return res.status(403).json({ success: false, error: 'You Are Not Staff At This Venue' });
    }

    try {
        // ═══ DUPLICATE DETECTION ═══
        // Check by name (case-insensitive) in same venue
        let existingQuery = getSupabase()
            .from('commander_members')
            .select('*')
            .eq('venue_id', venue_id)
            .ilike('first_name', first_name.trim())
            .ilike('last_name', last_name.trim());

        const { data: nameMatches } = await existingQuery;

        if (nameMatches && nameMatches.length > 0) {
            return res.status(200).json({
                success: true,
                data: { member: nameMatches[0] },
                duplicate: true,
                message: `Member "${first_name} ${last_name}" already exists`,
            });
        }

        // Check by email (case-insensitive) if provided
        if (email && email.trim()) {
            const { data: emailMatches } = await getSupabase()
                .from('commander_members')
                .select('*')
                .eq('venue_id', venue_id)
                .ilike('email', email.trim());

            if (emailMatches && emailMatches.length > 0) {
                return res.status(200).json({
                    success: true,
                    data: { member: emailMatches[0] },
                    duplicate: true,
                    message: `Member with email "${email}" already exists`,
                });
            }
        }

        // Generate unique member number: PREFIX-NNNNN
        const { data: venue } = await getSupabase()
            .from('poker_venues')
            .select('name')
            .eq('id', venue_id)
            .maybeSingle();

        const prefix = (venue?.name || 'CLUB')
            .replace(/[^A-Za-z]/g, '')
            .substring(0, 4)
            .toUpperCase();

        // Get current member count for sequential numbering
        const { count } = await getSupabase()
            .from('commander_members')
            .select('id', { count: 'exact', head: true })
            .eq('venue_id', venue_id)

        const memberNumber = `${prefix}-${String((count || 0) + 1).padStart(5, '0')}`;

        // Generate unique QR code
        const qrCode = `CMD-${venue_id}-${crypto.randomUUID().split('-')[0]}`;

        const { data: member, error } = await getSupabase()
            .from('commander_members')
            .insert({
                venue_id,
                member_number: memberNumber,
                qr_code: qrCode,
                first_name: first_name.trim(),
                last_name: last_name.trim(),
                email: email?.trim() || null,
                phone: phone?.trim() || null,
                date_of_birth: date_of_birth || null,
                id_type: id_type || 'drivers_license',
                id_number: id_number?.trim() || null,
                id_state: id_state || null,
                id_expiry: id_expiry || null,
                photo_url: photo_url || null,
                address: address || {},
                membership_tier,
                membership_status: 'active',
                notes: notes || null,
                created_by: created_by || null,
            })
            .select()
            .maybeSingle();

        if (error) {
            console.warn('Member create error:', error);
            return res.status(500).json({ success: false, error: 'Internal server error' });
        }

        if (!member) return res.status(500).json({ success: false, error: 'Failed to create member' });

        return res.status(201).json({ success: true, data: { member } });
    } catch (err) {
        try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
        console.warn('Member create exception:', err);
        return res.status(500).json({ success: false, error: 'Failed to create member' });
    }
}
