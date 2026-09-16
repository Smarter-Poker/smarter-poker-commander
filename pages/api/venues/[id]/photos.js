/**
 * Venue Photos Staff API
 * GET /api/commander/venues/[id]/photos - List photos
 * POST /api/commander/venues/[id]/photos - Add a photo
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';

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

    // Auth guard: require manager auth
    const _staff = await guardManager(req, res);
    if (!_staff) return;

    try {
      const { id } = req.query;
      const staffSession = req.headers['x-staff-session'];

      if (req.method === 'GET') {
        // Public access
        const { category, limit = 30, offset = 0 } = req.query;

        let query = getSupabase()
          .from('commander_venue_photos')
          .select('*', { count: 'exact' })
          .eq('venue_id', id)
          .order('is_featured', { ascending: false })
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: false })
          .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (category) {
          query = query.eq('category', category)
              .limit(100);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return res.status(200).json({
          success: true,
          data: {
            photos: data || [],
            total: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
          }
        });
      }

      if (req.method === 'POST') {
        if (!staffSession) {
          return res.status(401).json({
            success: false,
            error: { code: 'AUTH_REQUIRED', message: 'Staff session required' }
          });
        }

        let staff;
        try {
          staff = JSON.parse(staffSession);
        } catch (e) {
          return res.status(401).json({
            success: false,
            error: { code: 'INVALID_SESSION', message: 'Invalid staff session' }
          });
        }

        const venueId = parseInt(id) || id;
        if (staff.venue_id !== venueId) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
          });
        }

        const { url, thumbnail_url, caption, category = 'general', is_cover_photo, is_featured } = req.body;

        if (!url) {
          return res.status(400).json({
            success: false,
            error: { code: 'MISSING_URL', message: 'Photo URL required' }
          });
        }

        // If setting as cover photo, unset existing cover
        if (is_cover_photo) {
          await getSupabase()
            .from('commander_venue_photos')
            .update({ is_cover_photo: false })
            .eq('venue_id', id)
            .eq('is_cover_photo', true);

          // Also update venue's cover_photo_url
          await getSupabase()
            .from('poker_venues')
            .update({ cover_photo_url: url })
            .eq('id', id);
        }

        const { data, error } = await getSupabase()
          .from('commander_venue_photos')
          .insert({
            venue_id: id,
            uploaded_by: staff.user_id || null,
            url,
            thumbnail_url,
            caption,
            category,
            is_cover_photo: is_cover_photo || false,
            is_featured: is_featured || false
          })
          .select()
          .maybeSingle();

        if (error) throw error;

        return res.status(201).json({
          success: true,
          data: { photo: data }
        });
      }

      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST allowed' }
      });
    } catch (error) {
      console.warn('Venue photos API error:', error);
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to process request' }
      });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
