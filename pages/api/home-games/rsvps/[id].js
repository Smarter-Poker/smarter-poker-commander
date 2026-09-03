/**
 * ══════════════════════════════════════════════════════════════════════════
 *  COMMANDER - HOME GAME RSVP (per-RSVP actions)
 *  GET    /api/commander/home-games/rsvps/[id]   - read a single RSVP
 *  PATCH  /api/commander/home-games/rsvps/[id]   - host approves/declines/etc
 *  DELETE /api/commander/home-games/rsvps/[id]   - host removes an RSVP
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Phase 11 rewrite. The previous implementation had three concrete bugs:
 *
 *    1. PATCH attempted `.update({ status })` against commander_home_rsvps,
 *       which has NO `status` column. The real columns are `response`
 *       ('yes'|'no'|'maybe'|'waitlist') and `is_confirmed` (boolean).
 *       Every host approval attempt in the commander UI was silently
 *       erroring out of a 404 branch.
 *
 *    2. Zero authorization check beyond generic `guardUser`. Any
 *       authenticated user could PATCH or DELETE ANY RSVP by UUID -
 *       an IDOR.
 *
 *    3. Even if (1) had been fixed, nothing flipped `is_confirmed=true`.
 *       The address-privacy invariant from Phase 9 keys on `is_confirmed`
 *       via `address_visible_to='rsvp'`, so an "approved" guest still
 *       couldn't see the address.
 *
 *  This rewrite fixes all three and wires the Phase 10-mirrored
 *  approve-back notification pipeline: when the host flips an RSVP to
 *  confirmed, we fire an in-app notification row + a branded email to
 *  the REQUESTER telling them they're in and now have access to the
 *  address.
 *
 *  Wire contract (accepts BOTH shapes for back-compat with the live UI):
 *
 *    { action: 'approve' | 'decline' | 'waitlist' | 'remove' }  ← preferred
 *    { status: 'yes'     | 'no'      | 'waitlist' | 'removed' } ← legacy
 *
 *  The legacy shape is what pages/hub/commander/home-games/[id]/manage.js
 *  has been sending since before this file existed. We translate it
 *  server-side so we don't have to rev the client in lockstep.
 *
 *  Action → column mapping:
 *    approve  →  response='yes',      is_confirmed=true
 *    decline  →  response='no',       is_confirmed=false
 *    waitlist →  response='waitlist', is_confirmed=false
 *    remove   →  (row deleted)
 *
 *  Authorization:
 *    Caller must be 'owner' or 'admin' in commander_home_members for the
 *    group that owns the event that owns the RSVP, with status='approved'.
 *    No other role (including the RSVP's own user) can PATCH/DELETE.
 *
 *  Notification dispatch:
 *    Only on 'approve' AND only when the approval actually changed state
 *    (was_confirmed=false → is_confirmed=true). Re-approving an already-
 *    approved RSVP is a no-op, no second notification. Plus a 4-hour
 *    dedup window on (user_id=requester, type, metadata.rsvp_id) to
 *    belt-and-suspenders against flapping.
 * ══════════════════════════════════════════════════════════════════════════
 */

import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardUser } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { sendPushNotification } from '../../../../src/lib/commander/pushNotifications';
import { sendDirectMessageBetweenUsers } from '../../../../src/lib/home-games/messenger';
import { reportApiError } from '../../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

/**
 * Translate the legacy { status: 'yes'|'no'|'waitlist'|'removed' } payload
 * shape to the canonical { action: 'approve'|'decline'|'waitlist'|'remove' }.
 * Accepts either shape and returns the normalized action string, or null
 * if neither is valid.
 */
function resolveAction(body) {
  if (!body || typeof body !== 'object') return null;
  const rawAction = typeof body.action === 'string' ? body.action.toLowerCase() : null;
  if (rawAction && ['approve', 'decline', 'waitlist', 'remove'].includes(rawAction)) {
    return rawAction;
  }
  const rawStatus = typeof body.status === 'string' ? body.status.toLowerCase() : null;
  switch (rawStatus) {
    case 'yes':       return 'approve';
    case 'approved':  return 'approve';
    case 'no':        return 'decline';
    case 'declined':  return 'decline';
    case 'waitlist':  return 'waitlist';
    case 'removed':   return 'remove';
    case 'remove':    return 'remove';
    default:          return null;
  }
}

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // GET is open to any authenticated user (they need to be able to read
    // their own RSVP), but we still authorize below before returning rows
    // for non-hosts.
    if (req.method !== 'GET') {
      const _u = await guardUser(req, res);
      if (!_u) return;
    }

    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing RSVP id' });
    }

    const supabase = getSupabase();

    // ── Load the RSVP + event + group chain ───────────────────────────────
    const { data: rsvp, error: rsvpErr } = await supabase
      .from('commander_home_rsvps')
      .select('id, game_id, user_id, response, is_confirmed, bringing_guests, guest_names, message, responded_at, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (rsvpErr) throw rsvpErr;
    if (!rsvp) return res.status(404).json({ success: false, error: 'RSVP not found' });

    const { data: event, error: eventErr } = await supabase
      .from('commander_home_games')
      .select('id, group_id, host_id, scheduled_date, start_time, status, title, address, address_visible_to, max_players, rsvp_yes')
      .eq('id', rsvp.game_id)
      .maybeSingle();
    if (eventErr) throw eventErr;
    if (!event) return res.status(404).json({ success: false, error: 'Event not found' });

    const { data: group, error: groupErr } = await supabase
      .from('commander_home_groups')
      .select('id, owner_id, name')
      .eq('id', event.group_id)
      .maybeSingle();
    if (groupErr) throw groupErr;
    if (!group) return res.status(404).json({ success: false, error: 'Home game not found' });

    // ── Authorization (GET) ────────────────────────────────────────────────
    // For GET, allow: the RSVP's own user, or a host/admin of the group.
    if (req.method === 'GET') {
      const user = await guardUser(req, res);
      if (!user) return;
      const isSelf = user.id === rsvp.user_id;
      const isGroupStaff = await callerIsGroupStaff(supabase, user.id, group.id);
      if (!isSelf && !isGroupStaff) {
        return res.status(403).json({ success: false, error: 'Not authorized' });
      }
      // Include address only if the RSVP belongs to the caller AND is confirmed
      // (mirrors the address_visible_to='rsvp' contract), or if caller is staff.
      const includeAddress = isGroupStaff || (isSelf && rsvp.is_confirmed);
      return res.json({
        success: true,
        data: {
          rsvp,
          event: includeAddress
            ? { ...event }
            : { ...event, address: null },
          group,
        },
      });
    }

    // ── Authorization (PATCH / DELETE): staff only ────────────────────────
    // guardUser above populated req session; re-fetch the user for the check.
    const staffUser = await guardUser(req, res);
    if (!staffUser) return; // already 401'd
    const isGroupStaff = await callerIsGroupStaff(supabase, staffUser.id, group.id);
    if (!isGroupStaff) {
      return res.status(403).json({
        success: false,
        error: 'Only the group owner or admins can manage RSVPs',
      });
    }

    // ── DELETE ────────────────────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('commander_home_rsvps')
        .delete()
        .eq('id', id);
      if (error) {
        return res.status(500).json({ success: false, error: 'Internal server error' });
      }
      return res.json({ success: true });
    }

    // ── PATCH - apply the host action ─────────────────────────────────────
    if (req.method === 'PATCH') {
      const action = resolveAction(req.body);
      if (!action) {
        return res.status(400).json({
          success: false,
          error: "Body must include either { action: 'approve'|'decline'|'waitlist'|'remove' } or { status: 'yes'|'no'|'waitlist'|'removed' }",
        });
      }

      if (action === 'remove') {
        const { error } = await supabase
          .from('commander_home_rsvps')
          .delete()
          .eq('id', id);
        if (error) {
          return res.status(500).json({ success: false, error: 'Internal server error' });
        }
        return res.json({ success: true, data: { action, removed: true, rsvp_id: id } });
      }

      // approve / decline / waitlist → translate to column writes
      const patch = { updated_at: new Date().toISOString() };
      switch (action) {
        case 'approve':  patch.response = 'yes';      patch.is_confirmed = true;  break;
        case 'decline':  patch.response = 'no';       patch.is_confirmed = false; break;
        case 'waitlist': patch.response = 'waitlist'; patch.is_confirmed = false; break;
      }

      const wasConfirmed = !!rsvp.is_confirmed;

      const { data: updated, error: updErr } = await supabase
        .from('commander_home_rsvps')
        .update(patch)
        .eq('id', id)
        .select('id, game_id, user_id, response, is_confirmed, bringing_guests, guest_names, message, responded_at, updated_at')
        .maybeSingle();
      if (updErr) {
        return res.status(500).json({ success: false, error: updErr.message });
      }
      if (!updated) {
        return res.status(404).json({ success: false, error: 'RSVP not found' });
      }

      // Also promote the membership to 'approved' on approve - otherwise
      // the group-level "approved members" list still shows the person as
      // pending even though their RSVP is confirmed. Don't clobber a
      // pre-existing owner/admin role: only update rows currently at
      // status='pending'.
      if (action === 'approve') {
        try {
          await supabase
            .from('commander_home_members')
            .update({ status: 'approved', joined_at: new Date().toISOString() })
            .eq('group_id', group.id)
            .eq('user_id', rsvp.user_id)
            .eq('status', 'pending');
        } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
      }

      // Fire requester notification ONLY on state-change approve.
      // Re-approving an already-confirmed RSVP is a no-op. Wrapped in
      // try/catch so notification failure never fails the approval.
      if (action === 'approve' && !wasConfirmed) {
        try {
          await dispatchRequesterNotification(supabase, {
            req,
            requester_user_id: rsvp.user_id,
            host_user_id: staffUser.id,
            group,
            event,
            rsvp: updated,
          });
        } catch (notifyErr) {
          console.warn('[rsvps/[id]] notification dispatch failed:', notifyErr?.message || notifyErr);
        }
      }

      return res.json({
        success: true,
        data: {
          action,
          rsvp: updated,
          state_changed: action === 'approve' && !wasConfirmed,
        },
      });
    }

    res.setHeader('Allow', ['GET', 'PATCH', 'DELETE']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    console.warn('[pages/api/commander/home-games/rsvps/[id].js]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * Is the caller allowed to manage RSVPs in this group?
 * Owner or admin with status='approved'. Implemented as two fast lookups
 * rather than a join to keep the SQL simple on the PostgREST side.
 */
async function callerIsGroupStaff(supabase, user_id, group_id) {
  if (!user_id || !group_id) return false;
  try {
    const { data: member } = await supabase
      .from('commander_home_members')
      .select('role, status')
      .eq('group_id', group_id)
      .eq('user_id', user_id)
      .maybeSingle();
    if (member && member.status === 'approved' && ['owner', 'admin'].includes(member.role)) {
      return true;
    }
  } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
  // Fallback: check commander_home_groups.owner_id directly - covers the
  // brand-new-group case where the auto_add_group_owner trigger may have
  // raced or been skipped.
  try {
    const { data: group } = await supabase
      .from('commander_home_groups')
      .select('owner_id')
      .eq('id', group_id)
      .maybeSingle();
    if (group && group.owner_id === user_id) return true;
  } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }
  return false;
}

/**
 * ── dispatchRequesterNotification ───────────────────────────────────────────
 *  Fires when a host approves a requester's RSVP (is_confirmed false→true).
 *  Mirrors the Phase 10 host-side dispatcher but inverted: the REQUESTER is
 *  the notification target, the HOST is the actor.
 *
 *  THREE surfaces (NO EMAIL - Phase 12 removed all email dispatch):
 *    1. Row in public.notifications (in-app bell)
 *    2. OneSignal push (mobile + desktop push banners)
 *    3. Internal messenger DM from host -> requester with the address.
 *       The DM is the primary address-delivery channel now.
 *
 *  Dedup: 4-hour window on (user_id=requester, type=approved, rsvp_id)
 *  anchored on the in-app notification row. If the row exists for this
 *  rsvp_id in the last 4h, all surfaces already fired and we skip.
 * ───────────────────────────────────────────────────────────────────────────
 */
async function dispatchRequesterNotification(supabase, ctx) {
  const {
    requester_user_id,
    host_user_id,
    group,
    event,
    rsvp,
  } = ctx;

  if (!requester_user_id || requester_user_id === host_user_id) return;

  // ── Dedup window ──────────────────────────────────────────────────────────
  const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  try {
    const { data: recent } = await supabase
      .from('notifications')
      .select('id')
      .eq('user_id', requester_user_id)
      .eq('type', 'home_game_rsvp_approved')
      .gte('created_at', fourHoursAgo)
      .filter('metadata->>rsvp_id', 'eq', String(rsvp.id))
      .limit(1);
    if (recent && recent.length > 0) return;
  } catch (dedupErr) {
    console.warn('[rsvps/[id]] dedup check failed (proceeding):', dedupErr?.message || dedupErr);
  }

  // ── Resolve profile display names + the public slug for action link ──────
  const [requesterProfileRes, hostProfileRes, pageRes] = await Promise.allSettled([
    supabase.from('profiles').select('id, display_name, full_name, first_name, username').eq('id', requester_user_id).maybeSingle(),
    supabase.from('profiles').select('id, display_name, full_name, first_name, username').eq('id', host_user_id).maybeSingle(),
    supabase.from('social_pages').select('slug').eq('linked_entity_type', 'home_group').eq('linked_entity_id', String(group.id)).eq('page_type', 'home_game').maybeSingle(),
  ]);

  const pickName = (p) => (p?.display_name || p?.full_name || p?.first_name || p?.username || null);
  const requesterProfile = requesterProfileRes.status === 'fulfilled' ? requesterProfileRes.value?.data : null;
  const hostProfile      = hostProfileRes.status      === 'fulfilled' ? hostProfileRes.value?.data      : null;
  const pageSlug         = pageRes.status             === 'fulfilled' ? pageRes.value?.data?.slug || null : null;

  const requesterName = pickName(requesterProfile) || 'there';
  const hostName      = pickName(hostProfile)      || 'The host';

  const slugUrl = pageSlug
    ? `https://smarter.poker/hub/home-games/${pageSlug}`
    : `https://smarter.poker/hub/commander/home-games/${group.id}`;

  const metadata = {
    rsvp_id: String(rsvp.id),
    game_id: String(event.id),
    group_id: String(group.id),
    group_name: group.name,
    event_title: event.title || null,
    scheduled_date: event.scheduled_date,
    start_time: event.start_time || null,
    host_id: String(host_user_id),
    host_name: hostName,
    page_slug: pageSlug,
  };

  const titleText = `You're confirmed at ${group.name}`;
  const bodyText = event.title
    ? `${hostName} approved your seat for "${event.title}" on ${event.scheduled_date}.`
    : `${hostName} approved your seat for ${event.scheduled_date}.`;

  // ── 1. In-app notification row ────────────────────────────────────────────
  try {
    const { error: notifErr } = await supabase.from('notifications').insert({
      user_id: requester_user_id,
      type: 'home_game_rsvp_approved',
      title: titleText,
      message: bodyText,
      data: metadata,
      metadata,
      actor_id: host_user_id,
      action_url: slugUrl,
      link: slugUrl,
      is_read: false,
      read: false,
    });
    if (notifErr) {
      console.warn('[rsvps/[id]] notifications insert failed:', notifErr.message);
    }
  } catch (e) {
    console.warn('[rsvps/[id]] notifications insert threw:', e?.message || e);
  }

  // ── 2. OneSignal push to the requester's registered devices ──────────────
  try {
    await sendPushNotification({
      externalUserIds: [requester_user_id],
      title: titleText,
      message: bodyText,
      url: slugUrl,
      data: {
        ...metadata,
        notification_type: 'home_game_rsvp_approved',
      },
    });
  } catch (e) {
    console.warn('[rsvps/[id]] push dispatch threw:', e?.message || e);
  }

  // ── 3. Internal messenger DM from host -> requester ──────────────────────
  // Includes the address if populated - this is the primary channel for
  // delivering the address to a newly-confirmed guest. The host can keep
  // chatting with the requester afterward for logistics.
  const dateStr = event.scheduled_date || '';
  const timeStr = event.start_time ? ` at ${String(event.start_time).slice(0, 5)}` : '';
  const eventLabel = event.title ? `"${event.title}"` : `the game on ${dateStr}${timeStr}`;
  const addressBlock = event.address
    ? `\n\nLocation: ${event.address}`
    : `\n\n(I'll share the address closer to game day.)`;

  const dmContent =
    `Hi ${requesterName} - you're in! Just confirmed your seat at ${eventLabel}. ` +
    `See you at the table.` +
    addressBlock +
    `\n\nGame page: ${slugUrl}`;

  try {
    await sendDirectMessageBetweenUsers(supabase, {
      fromUserId: host_user_id,
      toUserId: requester_user_id,
      content: dmContent,
      messageType: 'text',
    });
  } catch (e) {
      try { reportApiError(e, null); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[rsvps/[id]] DM dispatch threw:', e?.message || e);
  }
}
