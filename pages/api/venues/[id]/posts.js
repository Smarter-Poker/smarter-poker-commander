/**
 * Venue Posts Staff API
 * GET /api/commander/venues/[id]/posts - List posts for a venue
 * POST /api/commander/venues/[id]/posts - Create a new post
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

      // Verify staff has access to this venue
      const venueId = parseInt(id) || id;
      if (staff.venue_id !== venueId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
        });
      }

      if (req.method === 'GET') {
        const { limit = 20, offset = 0, include_unpublished = false } = req.query;

        let query = getSupabase()
          .from('commander_venue_posts')
          .select(`
            *,
            author:author_id (id, display_name, avatar_url)
          `, { count: 'exact' })
          .eq('venue_id', id)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

        if (!include_unpublished) {
          query = query.eq('is_published', true)
              .limit(100);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return res.status(200).json({
          success: true,
          data: {
            posts: data || [],
            total: count,
            limit: parseInt(limit),
            offset: parseInt(offset)
          }
        });
      }

      if (req.method === 'POST') {
        const { content, post_type = 'announcement', image_urls, video_url, is_pinned = false } = req.body;

        if (!content) {
          return res.status(400).json({
            success: false,
            error: { code: 'MISSING_CONTENT', message: 'Post content required' }
          });
        }

        const { data, error } = await getSupabase()
          .from('commander_venue_posts')
          .insert({
            venue_id: id,
            author_id: staff.user_id || null,
            author_name: staff.name || 'Staff',
            content,
            post_type,
            image_urls: image_urls || [],
            video_url: video_url || null,
            is_pinned,
            is_published: true
          })
          .select()
          .maybeSingle();

        if (error) throw error;

        return res.status(201).json({
          success: true,
          data: { post: data }
        });
      }

      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET and POST allowed' }
      });
    } catch (error) {
      console.warn('Venue posts API error:', error);
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
