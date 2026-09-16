/**
 * Venue Post Management API
 * GET /api/commander/venues/[id]/posts/[postId] - Get a post
 * PUT /api/commander/venues/[id]/posts/[postId] - Update a post
 * DELETE /api/commander/venues/[id]/posts/[postId] - Delete a post
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardManager } from '../../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../../src/lib/apiErrorHandler';

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
      const { id, postId } = req.query;
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

      const venueId = parseInt(id) || id;
      if (staff.venue_id !== venueId) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Not authorized for this venue' }
        });
      }

      // Verify post exists and belongs to venue
      const { data: post, error: fetchError } = await getSupabase()
        .from('commander_venue_posts')
        .select('*')
        .eq('id', postId)
        .eq('venue_id', id)
        .maybeSingle();

      if (fetchError || !post) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Post not found' }
        });
      }

      if (req.method === 'GET') {
        return res.status(200).json({
          success: true,
          data: { post }
        });
      }

      if (req.method === 'PUT') {
        const { content, post_type, image_urls, video_url, is_pinned, is_published } = req.body;

        const updates = {};
        if (content !== undefined) updates.content = content;
        if (post_type !== undefined) updates.post_type = post_type;
        if (image_urls !== undefined) updates.image_urls = image_urls;
        if (video_url !== undefined) updates.video_url = video_url;
        if (is_pinned !== undefined) updates.is_pinned = is_pinned;
        if (is_published !== undefined) updates.is_published = is_published;
        updates.updated_at = new Date().toISOString();

        const { data, error } = await getSupabase()
          .from('commander_venue_posts')
          .update(updates)
          .eq('id', postId)
          .select()
          .maybeSingle();

        if (error) throw error;

        return res.status(200).json({
          success: true,
          data: { post: data }
        });
      }

      if (req.method === 'DELETE') {
        const { error } = await getSupabase()
          .from('commander_venue_posts')
          .delete()
          .eq('id', postId);

        if (error) throw error;

        return res.status(200).json({
          success: true,
          data: { deleted: true }
        });
      }

      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
      });
    } catch (error) {
      console.warn('Venue post API error:', error);
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
