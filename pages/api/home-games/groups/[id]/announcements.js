/**
 * Club Announcements API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 4
 * GET /api/commander/home-games/groups/[id]/announcements - List announcements
 * POST /api/commander/home-games/groups/[id]/announcements - Create announcement
 */
import { createClient } from '../../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    if (req.method !== 'GET') { const _u = await guardUser(req, res); if (!_u) return; }

    const { id: groupId } = req.query;

    if (!groupId) {
      return res.status(400).json({ error: 'Group ID required' });
    }

    if (req.method === 'GET') {
      return listAnnouncements(req, res, groupId);
    }

    if (req.method === 'POST') {
      return createAnnouncement(req, res, groupId);
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function listAnnouncements(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check membership
    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role, status')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || membership.status !== 'approved') {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const rawLimit = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    const rawBefore = Array.isArray(req.query.before) ? req.query.before[0] : req.query.before;
    const limit = rawLimit;
    // Validate before as a valid ISO 8601 timestamp to prevent PostgREST injection
    const before = rawBefore && !isNaN(Date.parse(rawBefore)) ? rawBefore : null;

    let query = getSupabase()
      .from('commander_club_announcements')
      .select(`
        *,
        profiles:author_id (id, display_name, avatar_url),
        commander_home_games:related_game_id (id, title, scheduled_date, start_time)
      `)
      .eq('group_id', groupId)
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(Math.min(parseInt(limit) || 50, 500));

    if (before) {
      query = query.lt('sent_at', new Date(rawBefore).toISOString());
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.status(200).json({ announcements: data });
  } catch (error) {
    console.warn('List announcements error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createAnnouncement(req, res, groupId) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Check if user is admin
    const { data: membership } = await getSupabase()
      .from('commander_home_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .eq('status', 'approved')
      .maybeSingle();

    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return res.status(403).json({ error: 'Only admins can create announcements' });
    }

    const {
      title,
      message,
      message_type = 'announcement',
      target_all = true,
      target_member_ids,
      scheduled_for,
      related_game_id,
      send_push = true,
      send_now = true
    } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    const status = send_now ? 'sent' : (scheduled_for ? 'scheduled' : 'draft');

    const { data: announcement, error } = await getSupabase()
      .from('commander_club_announcements')
      .insert({
        group_id: groupId,
        author_id: user.id,
        title,
        message,
        message_type,
        target_all,
        target_member_ids: target_all ? null : target_member_ids,
        scheduled_for,
        sent_at: send_now ? new Date().toISOString() : null,
        related_game_id,
        send_push,
        status
      })
      .select(`
        *,
        profiles:author_id (id, display_name, avatar_url)
      `)
      .maybeSingle();

    if (error) throw error;

    // If sending now with push notifications, trigger push
    if (send_now && send_push) {
      await sendPushNotifications(groupId, announcement, target_all, target_member_ids);
    }

    return res.status(201).json({ announcement });
  } catch (error) {
    console.warn('Create announcement error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendPushNotifications(groupId, announcement, targetAll, targetMemberIds) {
  try {
    // Get members to notify
    let memberQuery = getSupabase()
      .from('commander_home_members')
      .select('user_id, notify_announcements')
      .eq('group_id', groupId)
      .eq('status', 'approved')
      .eq('notifications_enabled', true)
          .limit(100);

    if (!targetAll && targetMemberIds?.length > 0) {
      memberQuery = memberQuery.in('user_id', targetMemberIds)
          .limit(100);
    }

    const { data: members } = await memberQuery;

    if (!members || members.length === 0) return;

    // Filter members who have announcements enabled
    const notifyUserIds = members
      .filter(m => m.notify_announcements !== false)
      .map(m => m.user_id);

    if (notifyUserIds.length === 0) return;

    // Get push subscriptions for these users
    const { data: subscriptions } = await getSupabase()
      .from('commander_push_subscriptions')
      .select('user_id, device_token, device_type')
      .in('user_id', notifyUserIds)
      .eq('group_id', groupId)
      .eq('is_active', true)
          .limit(100);

    if (!subscriptions || subscriptions.length === 0) return;

    // Log notifications (actual push would use Firebase/APNS)
    const notificationLogs = subscriptions.map(sub => ({
      user_id: sub.user_id,
      group_id: groupId,
      announcement_id: announcement.id,
      notification_type: announcement.message_type,
      title: announcement.title,
      body: announcement.message.substring(0, 200),
      channel: 'push',
      status: 'sent',
      sent_at: new Date().toISOString()
    }));

    await getSupabase()
      .from('commander_notification_log')
      .insert(notificationLogs);

    // Update announcement push count
    await getSupabase()
      .from('commander_club_announcements')
      .update({
        push_sent: true,
        push_sent_count: subscriptions.length
      })
      .eq('id', announcement.id);

    // Send push via OneSignal
    const oneSignalAppId = process.env.ONESIGNAL_APP_ID;
    const oneSignalApiKey = process.env.ONESIGNAL_REST_API_KEY;

    if (oneSignalAppId && oneSignalApiKey) {
      try {
        const userIds = [...new Set(subscriptions.map(s => s.user_id))];

        await fetch('https://onesignal.com/api/v1/notifications', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${oneSignalApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            app_id: oneSignalAppId,
            include_external_user_ids: userIds,
            headings: { en: announcement.title },
            contents: { en: announcement.message.substring(0, 200) },
            data: {
              type: 'club_announcement',
              group_id: groupId,
              announcement_id: announcement.id
            },
            url: `https://smarter.poker/hub/commander/home-games/${groupId}`
          })
        });

      } catch (pushError) {
        console.warn('OneSignal push failed:', pushError);
      }
    } else {
    }
  } catch (error) {
    console.warn('Send push notifications error:', error);
  }
}
