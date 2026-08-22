/**
 * Player Tournament Results API
 * GET /api/commander/tournaments/player-results?member_id=xxx
 *
 * Returns a member's tournament history for their own venue, plus a rolled-up
 * summary (events, cashes, ITM rate, winnings, invested, net, best finish).
 *
 * 2026-08-20 fixes:
 *  - The guard was guardWriteStaff, which returns `true` for GET WITHOUT
 *    checking anything (see its docstring: "a bare guardWriteStaff means the
 *    GET is public"). Anyone holding a member uuid could read that member's
 *    name and full tournament money history unauthenticated. Reads now require
 *    a verified staff session via guardStaff, and the session's venue must
 *    match the member's venue.
 *  - Venue scoping happened in JavaScript AFTER a .limit(50), so a player who
 *    shares a name with someone at another venue could push this venue's own
 *    results out of the window. The venue filter is now an inner-join filter
 *    applied by the database.
 *  - The endpoint returned a bare array with no aggregate, so every caller had
 *    to recompute ITM itself. It now returns { results, summary, member }.
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../src/lib/apiRateLimit';
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

// Auth: STAFF - any verified staff session may read a member profile.
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });
    }

    const { member_id } = req.query;
    if (!member_id) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'member_id Is Required' } });
    }

    // Get member info
    const { data: member, error: memberErr } = await getSupabase()
      .from('commander_members')
      .select('id, first_name, last_name, venue_id')
      .eq('id', member_id)
      .maybeSingle();

    if (memberErr) throw memberErr;
    if (!member) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Member Not Found' } });
    }

    // A staff session may only read members of its own venue.
    if (staff.venue_id != null && member.venue_id != null &&
        Number(staff.venue_id) !== Number(member.venue_id)) {
      return res.status(403).json({ success: false, error: { code: 'WRONG_VENUE', message: 'Member Belongs To A Different Venue' } });
    }

    const fullName = `${member.first_name || ''} ${member.last_name || ''}`.trim();
    if (!fullName) {
      return res.status(200).json({ success: true, data: { member_id: member.id, results: [], summary: emptySummary() } });
    }

    // Entries are matched by name (commander_members carries no profile link),
    // and the venue filter is an inner-join filter so it is applied before the
    // row limit rather than after it.
    const { data: entries, error: entriesErr } = await getSupabase()
      .from('commander_tournament_entries')
      .select(`
        id,
        tournament_id,
        player_name,
        status,
        finish_position,
        payout_amount,
        payout_position,
        rebuy_count,
        addon_taken,
        total_invested,
        eliminated_at,
        registered_at,
        commander_tournaments!inner (
          id,
          name,
          buyin_amount,
          buyin_fee,
          scheduled_start,
          actual_start,
          status,
          venue_id,
          current_entries
        )
      `)
      .ilike('player_name', fullName)
      .eq('commander_tournaments.venue_id', member.venue_id)
      .neq('status', 'cancelled')
      .order('registered_at', { ascending: false })
      .limit(100);

    if (entriesErr) {
      console.warn('Tournament results query error:', entriesErr);
      return res.status(500).json({ success: false, error: { code: 'DB_ERROR', message: 'Failed To Fetch Results' } });
    }

    const results = (entries || []).map(e => {
      const t = e.commander_tournaments || {};
      const buyin = Number(t.buyin_amount) || 0;
      const fee = Number(t.buyin_fee) || 0;
      // total_invested is the authoritative spend when the cage recorded it;
      // otherwise fall back to buy-in + fee so a row is never silently free.
      const invested = Number(e.total_invested) > 0
        ? Number(e.total_invested)
        : buyin + fee;
      const payout = Number(e.payout_amount) || 0;
      return {
        id: e.id,
        tournament_id: e.tournament_id,
        tournament_name: t.name || 'Tournament',
        date: t.actual_start || t.scheduled_start || e.registered_at,
        tournament_status: t.status || null,
        field_size: Number(t.current_entries) || null,
        buyin_amount: buyin,
        buyin_fee: fee,
        finish_position: e.finish_position || null,
        payout,
        status: e.status,
        rebuys: e.rebuy_count || 0,
        addon: !!e.addon_taken,
        total_invested: invested,
        net: payout - invested,
        eliminated_at: e.eliminated_at || null
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        member_id: member.id,
        results,
        summary: summarize(results)
      }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
    }
  }
}

function emptySummary() {
  return {
    events_played: 0,
    finished_events: 0,
    cashes: 0,
    wins: 0,
    final_tables: 0,
    itm_rate: 0,
    total_winnings: 0,
    total_invested: 0,
    net: 0,
    best_finish: null
  };
}

/**
 * ITM rate is computed over events with a RECORDED finishing position, not over
 * every registration. Counting in-progress or never-finalized events as misses
 * would understate every player in a room that has just started using the
 * finalize flow.
 */
function summarize(results) {
  const summary = emptySummary();
  summary.events_played = results.length;

  results.forEach(r => {
    summary.total_winnings += r.payout;
    summary.total_invested += r.total_invested;
    if (r.finish_position) {
      summary.finished_events += 1;
      if (!summary.best_finish || r.finish_position < summary.best_finish) {
        summary.best_finish = r.finish_position;
      }
      if (r.finish_position === 1) summary.wins += 1;
      if (r.finish_position <= 9) summary.final_tables += 1;
    }
    if (r.payout > 0) summary.cashes += 1;
  });

  summary.net = summary.total_winnings - summary.total_invested;
  summary.itm_rate = summary.finished_events > 0
    ? Math.round((summary.cashes / summary.finished_events) * 1000) / 10
    : 0;

  return summary;
}
