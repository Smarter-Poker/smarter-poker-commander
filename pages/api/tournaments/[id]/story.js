/**
 * Tournament Story API
 * POST /api/commander/tournaments/[id]/story
 * 
 * Creates tournament-themed stories in the social_stories table.
 * Players can share milestone moments from their tournament journey.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { requireAuth } from '../../../../src/lib/commander/auth';
import { parseBlindStructure } from '../../../../src/lib/parseBlindStructure';
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

// Tournament-themed gradient backgrounds
const TOURNAMENT_GRADIENTS = {
    registered: 'linear-gradient(135deg, #1877F2 0%, #0A5DC2 100%)',
    chip_update: 'linear-gradient(135deg, #F59E0B 0%, #D97706 100%)',
    itm: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
    final_table: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
    winner: 'linear-gradient(135deg, #F59E0B 0%, #FBBF24 50%, #F59E0B 100%)',
    bubble: 'linear-gradient(135deg, #6366F1 0%, #4F46E5 100%)',
    custom: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)'
};

const VALID_STORY_TYPES = ['registered', 'chip_update', 'itm', 'final_table', 'winner', 'bubble', 'custom'];

// Auth: USER - requires authenticated user
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }


    // Auth guard
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      const _staff = await requireAuth(req, res);
      if (!_staff) return;
    }

      if (req.method !== 'POST') {
          res.setHeader('Allow', ['POST']);
          return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
      }

      // Auth via Bearer token (player auth)
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token) {
          return res.status(401).json({ success: false, error: { code: 'AUTH_REQUIRED', message: 'Authorization Required' } });
      }

      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authError || !user) {
          return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid Token' } });
      }

      const { id: tournamentId } = req.query;
      // chip_count / finish_position / payout_amount are deliberately NOT
      // read from the body any more - see the story-content block below.
      // Accepting them silently would leave the same forgery one line away.
      const {
          story_type = 'custom',
          content,
          media_url
      } = req.body;

      if (!VALID_STORY_TYPES.includes(story_type)) {
          return res.status(400).json({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: `Invalid story_type. Must Be One Of: ${VALID_STORY_TYPES.join(', ')}` }
          });
      }

      if (content !== undefined && content !== null && typeof content !== 'string') {
          return res.status(400).json({
              success: false,
              error: { code: 'VALIDATION_ERROR', message: 'content Must Be Text' }
          });
      }

      try {
          // Get tournament details
          const { data: tournament, error: tErr } = await getSupabase()
              .from('commander_tournaments')
              .select('name, venue_id, status, current_level, blind_structure')
              .eq('id', tournamentId)
              .maybeSingle();

          if (tErr || !tournament) {
              return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
          }

          // Get player's entry to verify participation.
          // 2026-08-20 audit fix: a re-entry player has MORE THAN ONE row here,
          // and .maybeSingle() errors on multiple rows. The error was discarded,
          // entry came back null, and every re-entered player was told they were
          // not registered. Take the most recent entry instead.
          const { data: entryRows, error: entryErr } = await getSupabase()
              .from('commander_tournament_entries')
              .select('id, status, current_chips, finish_position, payout_amount, table_number, seat_number, registered_at')
              .eq('tournament_id', tournamentId)
              .eq('player_id', user.id)
              .order('registered_at', { ascending: false })
              .limit(1);

          if (entryErr) {
              console.warn('[story.js] entry read failed:', entryErr.message);
              return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Read Your Tournament Entry' } });
          }

          const entry = (entryRows || [])[0];
          if (!entry) {
              return res.status(403).json({ success: false, error: { code: 'NOT_REGISTERED', message: 'You Are Not Registered In This Tournament' } });
          }

          // Break rows share the blind array with playing levels, so the array
          // index is NOT the level number. Resolve both separately.
          const blindRows = parseBlindStructure(tournament.blind_structure);
          const levelIndex = tournament.current_level || 0;
          let displayLevel = 0;
          for (let i = 0; i <= levelIndex && i < blindRows.length; i++) {
              if (!blindRows[i]?.is_break) displayLevel++;
          }
          if (displayLevel === 0) displayLevel = levelIndex + 1;

          // Build story content
          const storyContent = (typeof content === 'string' && content.trim())
              ? content.trim().slice(0, 500)
              : buildStoryContent(story_type, {
              tournamentName: tournament.name,
              // RESULTS COME FROM THE DATABASE, NEVER THE REQUEST BODY.
              //
              // These three read `body_value ?? entry_value`, so the client
              // won. Any player with an entry in the event - the only thing
              // checked above - could POST { story_type: 'winner',
              // payout_amount: 50000 } and publish "I Won <real tournament
              // name>! $50,000" to social_stories, in the templated, sysgen
              // format that makes it read as verified. Same for finishing
              // position and chip count.
              //
              // The entry row is the record of what happened; the body has no
              // standing here. Free-text `content` is still the author's own
              // words, which is a different thing from a fabricated result.
              chipCount: Number(entry?.current_chips) || null,
              finishPosition: Number(entry?.finish_position) || null,
              // payout_amount is NUMERIC, i.e. a string over PostgREST, and
              // String.prototype.toLocaleString is a no-op that printed "250.00".
              payoutAmount: Number(entry?.payout_amount) || null,
              level: displayLevel,
              blinds: blindRows[levelIndex]
          });

          // Create story
          const { data: story, error: storyErr } = await getSupabase()
              .from('social_stories')
              .insert({
                  author_id: user.id,
                  content: storyContent,
                  media_url: media_url || null,
                  media_type: media_url ? 'image' : 'text',
                  background_color: TOURNAMENT_GRADIENTS[story_type] || TOURNAMENT_GRADIENTS.custom
              })
              .select()
              .maybeSingle();

          if (storyErr || !story) {
              console.warn('[story.js] Failed to create story:', storyErr);
              return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Create Story' } });
          }

          return res.status(201).json({
              success: true,
              data: {
                  story_id: story.id,
                  content: storyContent,
                  story_type,
                  tournament_name: tournament.name
              }
          });
      } catch (error) {
          console.warn('[story.js] Error:', error);
          return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_loggingErr) { console.warn('[App] Handled exception:', _loggingErr?.message || _loggingErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

function buildStoryContent(type, ctx) {
    const { tournamentName, chipCount, finishPosition, payoutAmount, level, blinds } = ctx;

    switch (type) {
        case 'registered':
            return `Just Registered For ${tournamentName}! Let's Go!`;

        case 'chip_update': {
            const chipStr = chipCount ? chipCount.toLocaleString() : '???';
            // `level` is already the 1-based DISPLAY level (breaks excluded),
            // resolved by the caller. Do not add 1 to it again.
            const blindStr = blinds && !blinds.is_break
                ? `Level ${level || 1}, ${Number(blinds.small_blind || 0).toLocaleString()}/${Number(blinds.big_blind || 0).toLocaleString()}`
                : '';
            return `Sitting On ${chipStr} Chips In ${tournamentName}! ${blindStr}`;
        }

        case 'itm':
            return payoutAmount
                ? `In The Money! Finished ${addOrdinal(finishPosition)} In ${tournamentName}, $${payoutAmount.toLocaleString()}`
                : `In The Money! Cashed In ${tournamentName}!`;

        case 'final_table':
            return `Final Table! ${tournamentName}, Let's Close It Out!`;

        case 'winner':
            return payoutAmount
                ? `I Won ${tournamentName}! $${payoutAmount.toLocaleString()}`
                : `I Won ${tournamentName}!`;

        case 'bubble':
            return `Bubbled ${tournamentName}. So Close! Next Time.`;

        case 'custom':
        default:
            return `Playing In ${tournamentName}!`;
    }
}

function addOrdinal(n) {
    if (!n) return '';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
