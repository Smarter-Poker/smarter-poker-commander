/**
 * Public Player Self-Check-In API
 * POST /api/checkin/self  { code }
 *
 * 2026-07-25 audit fix: the QR self-check-in page (/commander/check-in/[code])
 * previously called the staff-guarded /api/commander/dealer/scan and always
 * 401'd (players have no staff session). This endpoint is intentionally
 * PUBLIC (the QR code IS the authentication), IP rate-limited, and returns
 * only the minimum the page needs — no member PII beyond first name.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { checkMemoryRateLimit } from '../../../src/lib/commander/rateLimit';
import { reportApiError } from '../../../src/lib/sentryWrap';

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// How long before a repeat scan counts as a NEW check-in (the page polls every
// 30s — without this window every poll would inflate visit counts).
const CHECKIN_DEDUP_MS = 6 * 60 * 60 * 1000; // 6 hours

// Auth: PUBLIC — QR code is the credential; IP rate-limited.
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    // Rate limit: 15 requests per minute per IP (page polls every 30s)
    const fwd = req.headers['x-forwarded-for'];
    const ip = fwd ? fwd.split(',')[0].trim() : req.socket?.remoteAddress || '0';
    const rl = checkMemoryRateLimit(`selfcheckin:${ip}`, 15, 60000);
    if (!rl.allowed) { return res.status(429).json({ success: false, error: 'Too many requests' }); }

    const { code } = req.body || {};
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ success: false, error: 'code is required' });
    }

    // Same lookup as dealer/scan.js: accept raw code (CMD-XXXX-XXXXXXXX),
    // member number, or a full check-in URL containing the code.
    let lookupCode = code.trim();
    if (lookupCode.includes('/check-in/')) {
      const parts = lookupCode.split('/');
      lookupCode = parts[parts.length - 1];
    }

    const { data: members, error: memberError } = await getSupabase()
      .from('commander_members')
      .select('*')
      .or(`qr_code.eq.${lookupCode},member_number.eq.${lookupCode}`)
      .limit(1);

    if (memberError) throw memberError;

    const member = members?.[0];
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found. QR code not recognized.' });
    }

    // Membership status (same rules as dealer/scan.js)
    const membershipActive =
      member.membership_status !== 'suspended' &&
      member.membership_status !== 'banned' &&
      member.membership_status !== 'expired' &&
      member.membership_status !== 'inactive';
    const isExpiredByDate = member.membership_expires &&
      new Date(member.membership_expires) < new Date();

    // Record the check-in (mirrors the staff flow in members/checkin.js),
    // deduped so the page's 30s polling doesn't inflate visit counts.
    const now = new Date().toISOString();
    const lastCheckinMs = member.last_checkin ? new Date(member.last_checkin).getTime() : 0;
    if (!lastCheckinMs || (Date.now() - lastCheckinMs) > CHECKIN_DEDUP_MS) {
      await getSupabase()
        .from('commander_members')
        .update({
          last_checkin: now,
          last_visit: now,
          visit_count: (member.visit_count || 0) + 1,
          total_visits: (member.total_visits || 0) + 1,
          updated_at: now,
        })
        .eq('id', member.id);

      await getSupabase().from('commander_checkins').insert({
        member_id: member.id,
        venue_id: member.venue_id,
        checked_in_at: now,
      }).catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); // Non-fatal if table doesn't exist
    }

    // Already seated? (table/seat only — no PII)
    const { data: existingSessions } = await getSupabase()
      .from('commander_table_sessions')
      .select('table_number, seat_number, time_remaining, status')
      .eq('member_id', member.id)
      .eq('status', 'active')
      .limit(1);
    const alreadySeated = existingSessions?.[0] || null;

    // Venue name (public info)
    let venue = null;
    if (member.venue_id) {
      const { data: venueRow } = await getSupabase()
        .from('poker_venues')
        .select('id, name')
        .eq('id', member.venue_id)
        .maybeSingle();
      venue = venueRow || { id: member.venue_id, name: null };
    }

    // Active games at the venue (public board info)
    let activeGames = [];
    if (member.venue_id) {
      const { data: games } = await getSupabase()
        .from('commander_games')
        .select('id, game_type, stakes, status, current_players, max_players')
        .eq('venue_id', member.venue_id)
        .in('status', ['waiting', 'running'])
        .order('created_at', { ascending: true });
      activeGames = games || [];
    }

    // Minimal, PII-free response: first name only, no member id/number/DOB/etc.
    return res.status(200).json({
      success: true,
      data: {
        member: {
          first_name: member.first_name || '',
          membership_tier: member.membership_tier || 'standard',
          total_visits: member.total_visits || 0,
          last_visit: member.last_visit || null,
        },
        membership_active: membershipActive && !isExpiredByDate,
        time_balance_minutes: member.time_balance_minutes || 0,
        already_seated: alreadySeated,
        venue,
        active_games: activeGames,
      }
    });
  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[api/checkin/self]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
