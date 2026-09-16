/**
 * Home Game Posts API
 * GET /api/commander/home-games/[id]/posts - List posts for a home game group
 * POST /api/commander/home-games/[id]/posts - Create a new post
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
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
    // Rate-limit ALL methods, not just writes. GET was uncapped before and
    // could be hit in a loop to DoS the feed pull path.
    const rateKind = ['POST','PUT','PATCH','DELETE'].includes(req.method) ? LIMITS.write : LIMITS.read;
    if (!applyRateLimit(req, res, rateKind)) return;

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    try {
      const { id } = req.query;

      // Validate UUID shape up-front. Prior code trusted raw string and let
      // PostgREST reject with a 400 that included schema detail.
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_GROUP_ID', message: 'Invalid group id' }
        });
      }

      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).json({
          success: false,
          error: { code: 'AUTH_REQUIRED', message: 'Authorization required' }
        });
      }

      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;

      if (authError || !user) {
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid token' }
        });
      }

      // Verify user is a member of this group
      const { data: membership, error: memberError } = await getSupabase()
        .from('commander_home_members')
        .select('role, status')
        .eq('group_id', id)
        .eq('user_id', user.id)
        .eq('status', 'approved')
        .maybeSingle();

      if (memberError || !membership) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Must be a member to access posts' }
        });
      }

      if (req.method === 'GET') {
        const safeP = (v) => Array.isArray(v) ? v[0] : v;
        const limit = Math.min(parseInt(safeP(req.query.limit)) || 20, 100);
        const offset = Math.min(Math.max(parseInt(safeP(req.query.offset)) || 0, 0), 10000);

        const { data, error, count } = await getSupabase()
          .from('commander_home_posts')
          .select(`
            *,
            author:author_id (id, display_name, avatar_url)
          `, { count: 'exact' })
          .eq('group_id', id)
          .eq('is_published', true)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

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
        const { content, post_type = 'announcement', image_urls, video_url, is_pinned = false, visible_to = 'members' } = req.body;

        if (!content || typeof content !== 'string') {
          return res.status(400).json({
            success: false,
            error: { code: 'MISSING_CONTENT', message: 'Post content required' }
          });
        }
        // Mirror DB CHECK: chk_home_posts_content_length (max 10000)
        if (content.length > 10000) {
          return res.status(400).json({
            success: false,
            error: { code: 'CONTENT_TOO_LONG', message: 'content too long (max 10000 chars)' }
          });
        }
        // Mirror DB CHECK: commander_home_posts_post_type_check
        const ALLOWED_POST_TYPES = ['announcement','game_recap','photo','update'];
        if (typeof post_type !== 'string' || !ALLOWED_POST_TYPES.includes(post_type)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_POST_TYPE',
                     message: `post_type must be one of: ${ALLOWED_POST_TYPES.join(', ')}` }
          });
        }
        // Mirror DB CHECK: commander_home_posts_visible_to_check
        const ALLOWED_VISIBLE_TO = ['public','members'];
        if (typeof visible_to !== 'string' || !ALLOWED_VISIBLE_TO.includes(visible_to)) {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_VISIBLE_TO',
                     message: `visible_to must be one of: ${ALLOWED_VISIBLE_TO.join(', ')}` }
          });
        }
        // image_urls: array of string URLs, capped at 10 items, each ≤ 2000 chars
        let safeImageUrls = [];
        if (image_urls != null) {
          if (!Array.isArray(image_urls)) {
            return res.status(400).json({
              success: false,
              error: { code: 'INVALID_IMAGE_URLS', message: 'image_urls must be an array' }
            });
          }
          safeImageUrls = image_urls
            .filter(u => typeof u === 'string' && u.length > 0 && u.length <= 2000)
            .slice(0, 10);
        }
        // video_url: single string, ≤ 2000 chars
        let safeVideoUrl = null;
        if (video_url != null) {
          if (typeof video_url !== 'string' || video_url.length > 2000) {
            return res.status(400).json({
              success: false,
              error: { code: 'INVALID_VIDEO_URL', message: 'video_url must be a string (max 2000 chars)' }
            });
          }
          safeVideoUrl = video_url;
        }
        // is_pinned: bool
        if (typeof is_pinned !== 'boolean') {
          return res.status(400).json({
            success: false,
            error: { code: 'INVALID_IS_PINNED', message: 'is_pinned must be boolean' }
          });
        }

        // Only owner/admin can pin posts
        if (is_pinned && !['owner', 'admin'].includes(membership.role)) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'Only owner/admin can pin posts' }
          });
        }

        const { data, error } = await getSupabase()
          .from('commander_home_posts')
          .insert({
            group_id: id,
            author_id: user.id,
            content,
            post_type,
            image_urls: safeImageUrls,
            video_url: safeVideoUrl,
            is_pinned,
            visible_to,
            is_published: true
          })
          .select(`
            *,
            author:author_id (id, display_name, avatar_url)
          `)
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
      console.warn('Home game posts API error:', error);
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
