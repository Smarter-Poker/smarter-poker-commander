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
          return res.status(405).json({ success: false, error: 'Method Not Allowed' });
      }

      // Auth via Bearer token (player auth)
      const authHeader = req.headers.authorization;
      const token = authHeader?.replace('Bearer ', '');
      if (!token) {
          return res.status(401).json({ success: false, error: 'Authorization Required' });
      }

      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authError || !user) {
          return res.status(401).json({ success: false, error: 'Invalid Token' });
      }

      const { id: tournamentId } = req.query;
      const {
          story_type = 'custom',
          content,
          media_url,
          chip_count,
          finish_position,
          payout_amount
      } = req.body;

      if (!VALID_STORY_TYPES.includes(story_type)) {
          return res.status(400).json({
              success: false,
              error: `Invalid story_type. Must Be One Of: ${VALID_STORY_TYPES.join(', ')}`
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
              return res.status(404).json({ success: false, error: 'Tournament Not Found' });
          }

          // Get player's entry to verify participation
          const { data: entry } = await getSupabase()
              .from('commander_tournament_entries')
              .select('id, status, current_chips, finish_position, payout_amount, table_number, seat_number')
              .eq('tournament_id', tournamentId)
              .eq('player_id', user.id)
              .maybeSingle();

          if (!entry) {
              return res.status(403).json({ success: false, error: 'You Are Not Registered In This Tournament' });
          }

          // Build story content
          const storyContent = content || buildStoryContent(story_type, {
              tournamentName: tournament.name,
              chipCount: chip_count || entry?.current_chips,
              finishPosition: finish_position || entry?.finish_position,
              payoutAmount: payout_amount || entry?.payout_amount,
              level: tournament.current_level,
              blinds: parseBlindStructure(tournament.blind_structure)?.[tournament.current_level]
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

          if (storyErr) {
              console.warn('[story.js] Failed to create story:', storyErr);
              return res.status(500).json({ success: false, error: 'Failed To Create Story' });
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
          return res.status(500).json({ success: false, error: 'Internal Server Error' });
      }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

function buildStoryContent(type, ctx) {
    const { tournamentName, chipCount, finishPosition, payoutAmount, level, blinds } = ctx;

    switch (type) {
        case 'registered':
            return `Just Registered For ${tournamentName}! Let's Go!`;

        case 'chip_update': {
            const chipStr = chipCount ? chipCount.toLocaleString() : '???';
            const blindStr = blinds
                ? `Level ${(level || 0) + 1}, ${blinds.small_blind?.toLocaleString()}/${blinds.big_blind?.toLocaleString()}`
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
