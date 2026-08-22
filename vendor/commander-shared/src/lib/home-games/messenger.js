/**
 * ══════════════════════════════════════════════════════════════════════════
 *  HOME-GAMES INTERNAL MESSENGER DISPATCH
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Small helper module used by both the public Request-Seat endpoint (Phase
 *  10 replacement) and the commander approval endpoint (Phase 11 replacement)
 *  to send 1:1 direct messages inside the platform's internal messenger.
 *
 *  The messenger uses three tables:
 *    social_conversations            - the thread itself
 *    social_conversation_participants - membership (2 rows for a 1:1 DM)
 *    social_messages                 - the actual content
 *
 *  Before today, two RPCs existed (fn_get_or_create_conversation and
 *  fn_send_message) that were supposed to encapsulate this logic. On audit
 *  they turned out to be broken stubs - fn_get_or_create_conversation just
 *  returned a random UUID without touching any table, and fn_send_message
 *  wrote to an unused `messages` table while the real UI reads from
 *  `social_messages`. So we do it inline against the real tables.
 *
 *  The caller must pass a Supabase service-role client. All writes here
 *  bypass RLS.
 * ══════════════════════════════════════════════════════════════════════════
 */

/**
 * Find a 1:1 conversation between two users, or create one.
 * Returns the conversation UUID, or null on any failure (caller decides
 * whether to treat as fatal).
 */
export async function getOrCreateDirectConversation(supabase, userA, userB) {
  if (!userA || !userB || userA === userB) return null;

  try {
    // Find conversations where userA is a participant
    const { data: aRows, error: aErr } = await supabase
      .from('social_conversation_participants')
      .select('conversation_id')
      .eq('user_id', userA);
    if (aErr) throw aErr;

    const aIds = (aRows || []).map((r) => r.conversation_id).filter(Boolean);

    if (aIds.length > 0) {
      // Find conversations from that set where userB is ALSO a participant
      // AND the thread is non-group (1:1). We fetch and filter client-side
      // because PostgREST's filter-on-join syntax varies by client version.
      const { data: bRows, error: bErr } = await supabase
        .from('social_conversation_participants')
        .select('conversation_id')
        .eq('user_id', userB)
        .in('conversation_id', aIds);
      if (bErr) throw bErr;

      const shared = (bRows || []).map((r) => r.conversation_id).filter(Boolean);
      if (shared.length > 0) {
        // Check which of those are 1:1 (is_group=false)
        const { data: convs } = await supabase
          .from('social_conversations')
          .select('id, is_group')
          .in('id', shared);
        const direct = (convs || []).find((c) => !c.is_group);
        if (direct) return direct.id;
      }
    }

    // None exists - create a fresh one
    const { data: newConv, error: newErr } = await supabase
      .from('social_conversations')
      .insert({ is_group: false })
      .select('id')
      .maybeSingle();
    if (newErr) throw newErr;
    if (!newConv) return null;

    const { error: partErr } = await supabase
      .from('social_conversation_participants')
      .insert([
        { conversation_id: newConv.id, user_id: userA },
        { conversation_id: newConv.id, user_id: userB },
      ]);
    if (partErr) {
      // Best-effort cleanup - orphan participants OR orphan conversation.
      // Leave the conversation row; future retries will find it and
      // succeed on the participant insert.
      console.warn('[messenger] participant insert failed:', partErr.message);
    }

    return newConv.id;
  } catch (err) {
    console.warn('[messenger] getOrCreateDirectConversation failed:', err?.message || err);
    return null;
  }
}

/**
 * Insert a message into a conversation. Returns the inserted row id, or null.
 * Also bumps the conversation's last_message_at/preview atomically-ish.
 */
export async function sendDirectMessage(supabase, { conversationId, senderId, content, messageType = 'text' }) {
  if (!conversationId || !senderId || !content) return null;

  try {
    const { data: inserted, error: insErr } = await supabase
      .from('social_messages')
      .insert({
        conversation_id: conversationId,
        sender_id: senderId,
        content,
        message_type: messageType,
      })
      .select('id')
      .maybeSingle();
    if (insErr) throw insErr;

    // Bump conversation last_message_at + preview so the inbox sorts right
    // and shows a snippet. Best-effort - not worth failing the dispatch.
    const previewText = String(content).replace(/\s+/g, ' ').slice(0, 240);
    try {
      await supabase
        .from('social_conversations')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: previewText,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conversationId);
    } catch (_) { console.warn('[App] Handled exception:', _?.message || _); }

    return inserted?.id || null;
  } catch (err) {
    console.warn('[messenger] sendDirectMessage failed:', err?.message || err);
    return null;
  }
}

/**
 * Convenience: get-or-create + send in one call. Returns { conversationId, messageId }
 * on full success, partial on failure.
 */
export async function sendDirectMessageBetweenUsers(supabase, { fromUserId, toUserId, content, messageType = 'text' }) {
  const conversationId = await getOrCreateDirectConversation(supabase, fromUserId, toUserId);
  if (!conversationId) return { conversationId: null, messageId: null };
  const messageId = await sendDirectMessage(supabase, { conversationId, senderId: fromUserId, content, messageType });
  return { conversationId, messageId };
}
