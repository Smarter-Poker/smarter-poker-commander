/**
 * End-Of-Event Compliance And Results Packet
 * GET /api/commander/tournaments/:id/export?format=json|csv|hendon_json|hendon_csv
 *
 * Everything a room needs to close an event and keep it: the configuration it
 * was run under, the structure that was ACTUALLY played (not the whole ladder
 * that was scheduled), the full finishing order with payouts and bounty
 * winnings, the entry/rebuy/add-on counts, the prize pool and how it was
 * derived, the house fee, the W-2G events, and the cash drawer reconciliation.
 *
 *   format=json          the full packet (default)
 *   format=csv           a flat finishing-order sheet a cage can read
 *   format=hendon_json   Hendon Mob v1 JSON, built by the SHARED builder in
 *   format=hendon_csv    pages/api/exports/hendon-mob.js
 *
 * The reconciliation block is not recomputed here: it comes from
 * buildReconciliation() in ./reconciliation, so the packet and the cage sheet
 * can never quote different numbers.
 *
 * Auth: STAFF, venue-scoped (enforced inside buildReconciliation).
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { logAction, AuditActions } from '../../../../src/lib/commander/audit';
import { parseBlindStructure } from '../../../../src/lib/parseBlindStructure';
import { buildReconciliation } from './reconciliation';
import { buildHendonMobCSV, buildHendonMobJSON } from '../../exports/hendon-mob';
import { entryBountyWinnings, entryBountyValue, hasBounties } from '../../../../src/lib/commander/tournamentBounty';
import { assessEntryW2G, entryTotalInvested } from '../../../../src/lib/commander/taxEvents';
import { denyCrossVenue } from '../../../../src/lib/commander/venueScope';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

const FORMATS = ['json', 'csv', 'hendon_json', 'hendon_csv'];

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * CSV cell. Every value is quoted and every embedded quote is doubled, which
 * is the only escaping that survives a player name containing a comma, a quote
 * or a newline. A leading =, +, - or @ is prefixed with a single quote so a
 * spreadsheet treats a crafted name as text instead of a formula.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function isoDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Filenames must survive a file system, so anything odd becomes an underscore. */
function safeFilename(name, fallback) {
  const base = String(name || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return base || fallback;
}

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (!applyRateLimit(req, res, LIMITS.read)) return;

    const staff = await guardStaff(req, res);
    if (!staff) return;

    if (req.method !== 'GET') {
      res.setHeader('Allow', ['GET']);
      return res.status(405).json({
        success: false,
        error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
      });
    }

    const { id } = req.query;
    const format = String(req.query.format || 'json').toLowerCase();

    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament Id Required' }
      });
    }
    if (!FORMATS.includes(format)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `format Must Be One Of: ${FORMATS.join(', ')}` }
      });
    }

    // The reconciliation call does the tournament read AND the venue scoping,
    // so an out-of-venue request never reaches the entry query below.
    const recon = await buildReconciliation(id, staff);
    if (recon.error) return res.status(recon.status).json({ success: false, error: recon.error });

    const { tournament, entries, venue } = await loadEventRows(id);
    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Venue scope. buildReconciliation above is venue-checked, but this route
    // must not depend on a check living in another module to protect the
    // packet it assembles here: names, seats, payouts and tax figures.
    if (denyCrossVenue(res, staff, tournament)) return;

    // Audit every export: a results packet leaves the building with player
    // names and money on it.
    try {
      await logAction(AuditActions.EXPORT_DOWNLOAD, {
        venueId: tournament.venue_id,
        staffId: staff.id,
        targetId: id,
        targetType: 'commander_tournaments',
        targetName: tournament.name || 'Tournament',
        metadata: { format, surface: 'tournament_export' },
        req
      });
    } catch (e) { console.warn('[export] audit log failed:', e?.message || e); }

    const slug = safeFilename(tournament.name, `tournament_${id}`);

    if (format === 'hendon_csv') {
      const csv = buildHendonMobCSV(tournament, entries);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="hendon_mob_${slug}.csv"`);
      return res.status(200).send(csv);
    }
    if (format === 'hendon_json') {
      res.setHeader('Content-Disposition', `attachment; filename="hendon_mob_${slug}.json"`);
      return res.status(200).json(buildHendonMobJSON(tournament, entries));
    }

    const packet = buildPacket({
      tournament,
      venue,
      entries,
      reconciliation: recon.data,
      taxEvents: await loadTaxEvents(tournament, entries)
    });

    if (format === 'csv') {
      const csv = buildFinishingOrderCSV(packet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="results_${slug}.csv"`);
      return res.status(200).send(csv);
    }

    res.setHeader('Content-Disposition', `attachment; filename="event_packet_${slug}.json"`);
    return res.status(200).json({ success: true, data: packet });
  } catch (err) {
    try { reportApiError(err, req); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    console.warn('[export] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal Server Error' }
      });
    }
  }
}

/**
 * Tournament, venue and every entry with the profile columns the Hendon Mob
 * builder expects (it reads entry.profiles.first_name / .city / .country).
 */
async function loadEventRows(tournamentId) {
  const { data: tournament } = await getSupabase()
    .from('commander_tournaments')
    .select('*, poker_venues:venue_id (id, name, city, state, country, address, zip)')
    .eq('id', tournamentId)
    .maybeSingle();

  if (!tournament) return { tournament: null, entries: [], venue: null };

  const BASE = `
    id, player_id, player_name, status, registration_method, payment_method,
    table_number, seat_number, rebuy_count, addon_taken, total_invested,
    finish_position, payout_amount, payout_position, payout_status, paid_at,
    bounties_collected, registered_at, eliminated_at, current_chips, metadata,
    profiles:player_id (id, display_name, first_name, last_name, city, state, country)`;

  const q = (columns) => getSupabase()
    .from('commander_tournament_entries')
    .select(columns)
    .eq('tournament_id', tournamentId)
    .order('finish_position', { ascending: true, nullsFirst: false })
    .limit(2000);

  let { data: entries, error } = await q(`${BASE}, bounty_value, bounty_winnings, is_reentry, reentry_of`);
  if (error && (error.code === '42703' || error.code === 'PGRST204' ||
    /column .* does not exist/i.test(String(error.message || '')))) {
    ({ data: entries } = await q(BASE));
  }

  return {
    tournament,
    entries: entries || [],
    venue: tournament.poker_venues || null
  };
}

/**
 * Tax events already filed for this event.
 *
 * Linked by tournament_id when migration
 * 20260821160000_commander_tax_events_tournament_link.sql has landed. Before
 * that the table has no tournament column at all, so the fallback matches on
 * venue + event date + the set of player ids that finished in the money, which
 * is the closest key the old schema supports. Returns [] rather than throwing
 * if neither works: a missing tax section must not fail the whole packet.
 */
async function loadTaxEvents(tournament, entries) {
  const COLUMNS = `id, venue_id, player_id, event_type, event_date, gross_amount, buy_in,
    net_amount, withholding_required, withholding_amount, withholding_rate,
    w2g_generated, w2g_document_url, player_acknowledged, acknowledged_at, notes, created_at`;

  try {
    const { data, error } = await getSupabase()
      .from('commander_tax_events')
      .select(COLUMNS)
      .eq('tournament_id', tournament.id)
      .limit(500);
    if (!error) return data || [];
  } catch (e) { console.warn('[export] tax event read by tournament failed:', e?.message || e); }

  const playerIds = [...new Set(entries.map(e => e.player_id).filter(Boolean))];
  if (playerIds.length === 0 || tournament.venue_id == null) return [];

  const raw = tournament.ended_at || tournament.actual_start || tournament.scheduled_start;
  const d = raw ? new Date(raw) : null;
  const day = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  if (!day) return [];

  try {
    const { data } = await getSupabase()
      .from('commander_tax_events')
      .select(COLUMNS)
      .eq('venue_id', tournament.venue_id)
      .eq('event_date', day)
      .in('player_id', playerIds)
      .limit(500);
    return data || [];
  } catch (e) {
    console.warn('[export] tax event fallback read failed:', e?.message || e);
    return [];
  }
}

/**
 * The structure that was ACTUALLY PLAYED.
 *
 * commander_tournaments.current_level is 0-indexed, so a tournament sitting on
 * current_level 7 has played levels 1 through 8. A completed event keeps the
 * level it ended on; a scheduled one that never ran reports nothing played.
 * The full scheduled ladder ships alongside it so the packet still documents
 * what the room advertised.
 */
function buildStructurePlayed(tournament) {
  const levels = parseBlindStructure(tournament?.blind_structure);
  const breaks = parseBlindStructure(tournament?.break_schedule);
  const started = !!(tournament?.actual_start) || ['running', 'completed', 'paused'].includes(String(tournament?.status || ''));
  const levelsReached = started
    ? Math.min(levels.length, Math.max(1, (Number(tournament?.current_level) || 0) + 1))
    : 0;

  return {
    levels_scheduled: levels.length,
    levels_reached: levelsReached,
    final_level_index: started ? (Number(tournament?.current_level) || 0) : null,
    starting_chips: Number(tournament?.starting_chips) || 0,
    played: levels.slice(0, levelsReached).map((lvl, i) => ({
      level: Number(lvl?.level ?? i + 1),
      small_blind: Number(lvl?.small_blind ?? lvl?.sb ?? 0) || 0,
      big_blind: Number(lvl?.big_blind ?? lvl?.bb ?? 0) || 0,
      ante: Number(lvl?.ante ?? 0) || 0,
      duration_minutes: Number(lvl?.duration ?? lvl?.duration_minutes ?? lvl?.minutes ?? 0) || 0,
      is_break: !!(lvl?.is_break || lvl?.break)
    })),
    scheduled: levels,
    breaks
  };
}

/** The complete event packet. Pure: everything is already loaded. */
function buildPacket({ tournament, venue, entries, reconciliation, taxEvents }) {
  const live = entries.filter(e => e.status !== 'cancelled');
  const nameOf = (e) => e?.profiles?.display_name || e?.player_name || 'Player';
  const bounties = hasBounties(tournament);

  const finishingOrder = live
    .filter(e => Number(e.finish_position) > 0)
    .sort((a, b) => Number(a.finish_position) - Number(b.finish_position))
    .map(e => {
      const assessment = assessEntryW2G(tournament, e);
      return {
        finish_position: Number(e.finish_position),
        entry_id: e.id,
        player_id: e.player_id || null,
        player_name: nameOf(e),
        first_name: e.profiles?.first_name || null,
        last_name: e.profiles?.last_name || null,
        city: e.profiles?.city || null,
        state: e.profiles?.state || null,
        country: e.profiles?.country || null,
        payout_amount: money(e.payout_amount),
        bounty_winnings: money(bounties ? entryBountyWinnings(e) : 0),
        bounty_on_head: money(bounties ? entryBountyValue(tournament, e) : 0),
        knockouts: Number(e.bounties_collected) || 0,
        rebuys: Number(e.rebuy_count) || 0,
        addon: !!e.addon_taken,
        total_invested: money(entryTotalInvested(tournament, e)),
        net_result: money((Number(e.payout_amount) || 0) +
          (bounties ? entryBountyWinnings(e) : 0) -
          entryTotalInvested(tournament, e)),
        is_reentry: e.is_reentry === true || e?.metadata?.is_reentry === true,
        reentry_of: e.reentry_of || e?.metadata?.reentry_of || null,
        status: e.status,
        payout_status: e.payout_status || null,
        paid_at: isoDate(e.paid_at) || null,
        eliminated_at: isoDate(e.eliminated_at) || null,
        w2g_required: assessment.reportable,
        w2g_net_amount: assessment.reportable ? assessment.net : 0
      };
    });

  const unfinished = live
    .filter(e => !(Number(e.finish_position) > 0))
    .map(e => ({
      entry_id: e.id,
      player_id: e.player_id || null,
      player_name: nameOf(e),
      status: e.status,
      current_chips: Number(e.current_chips) || 0,
      rebuys: Number(e.rebuy_count) || 0,
      addon: !!e.addon_taken,
      total_invested: money(entryTotalInvested(tournament, e))
    }));

  const derivation = reconciliation?.derivation || {};

  return {
    packet_version: 'commander_event_packet_v1',
    generated_at: new Date().toISOString(),
    tournament: {
      id: tournament.id,
      name: tournament.name,
      description: tournament.description || null,
      status: tournament.status,
      tournament_type: tournament.tournament_type || null,
      variant: tournament.variant || null,
      buyin_amount: money(tournament.buyin_amount),
      buyin_fee: money(tournament.buyin_fee),
      total_buyin: money((Number(tournament.buyin_amount) || 0) + (Number(tournament.buyin_fee) || 0)),
      rebuy_amount: money(tournament.rebuy_amount),
      rebuy_chips: Number(tournament.rebuy_chips) || 0,
      max_rebuys: Number(tournament.max_rebuys) || 0,
      rebuy_end_level: Number(tournament.rebuy_end_level) || 0,
      addon_amount: money(tournament.addon_amount),
      addon_chips: Number(tournament.addon_chips) || 0,
      bounty_amount: money(tournament.bounty_amount),
      starting_chips: Number(tournament.starting_chips) || 0,
      guaranteed_pool: money(tournament.guaranteed_pool),
      paying_places: Number(tournament.paying_places) || null,
      late_registration_levels: Number(tournament.late_registration_levels) || 0,
      max_entries: Number(tournament.max_entries) || null,
      is_multi_day: !!tournament.is_multi_day,
      total_days: Number(tournament.total_days) || 1,
      current_day: Number(tournament.current_day) || 1,
      flight_label: tournament.flight_label || null,
      scheduled_start: isoDate(tournament.scheduled_start) || null,
      actual_start: isoDate(tournament.actual_start) || null,
      ended_at: isoDate(tournament.ended_at) || null,
      settings: tournament.settings || null
    },
    venue: venue ? {
      id: venue.id,
      name: venue.name,
      city: venue.city || null,
      state: venue.state || null,
      country: venue.country || null,
      address: venue.address || null,
      zip: venue.zip || null
    } : null,
    structure: buildStructurePlayed(tournament),
    counts: reconciliation?.counts || {},
    money: {
      // How the pool was arrived at, in the order a cage would check it.
      gross_collected: reconciliation?.expected_in?.total ?? 0,
      house_fees: derivation.house_fees ?? 0,
      bounty_pool: derivation.bounty_pool_collected ?? 0,
      prize_pool_collected: derivation.prize_pool_collected ?? 0,
      guaranteed_pool: derivation.guaranteed_pool ?? 0,
      overlay: derivation.overlay ?? 0,
      actual_prizepool: derivation.actual_prizepool ?? 0,
      effective_prize_pool: derivation.effective_prize_pool ?? 0,
      payout_denomination: derivation.payout_denomination ?? 1,
      is_satellite: derivation.is_satellite ?? false,
      seat_value: derivation.seat_value ?? 0,
      seats_awarded: derivation.seats_awarded ?? 0,
      bounty_per_entry: derivation.bounty_per_entry ?? 0,
      total_paid_out: reconciliation?.expected_out?.payouts ?? 0,
      total_bounty_paid: reconciliation?.expected_out?.bounty_winnings ?? 0,
      final_payouts_override: tournament.final_payouts || null
    },
    payout_structure: tournament.payout_structure || null,
    finishing_order: finishingOrder,
    still_in_or_unranked: unfinished,
    w2g: {
      threshold_rule: 'Net Of That Entry Buy-In, More Than $5,000',
      candidates: reconciliation?.w2g_candidates || [],
      recorded_events: (taxEvents || []).map(t => ({
        id: t.id,
        player_id: t.player_id || null,
        event_type: t.event_type,
        event_date: t.event_date,
        gross_amount: money(t.gross_amount),
        buy_in: money(t.buy_in),
        net_amount: money(t.net_amount),
        withholding_required: !!t.withholding_required,
        withholding_amount: money(t.withholding_amount),
        withholding_rate: t.withholding_rate === null || t.withholding_rate === undefined
          ? null : Number(t.withholding_rate),
        w2g_generated: !!t.w2g_generated,
        player_acknowledged: !!t.player_acknowledged,
        notes: t.notes || null
      }))
    },
    reconciliation: reconciliation ? {
      expected_in: reconciliation.expected_in,
      actual_in: reconciliation.actual_in,
      expected_out: reconciliation.expected_out,
      actual_out: reconciliation.actual_out,
      variance: reconciliation.variance,
      balanced: reconciliation.balanced,
      discrepancies: reconciliation.discrepancies,
      unpaid_itm: reconciliation.unpaid_itm
    } : null
  };
}

/**
 * The flat finishing-order sheet.
 *
 * A short header block of the figures a cage checks first, then one row per
 * finisher. Header lines are prefixed with '#' so a spreadsheet import that
 * only wants the table can skip them, and the column row is the first
 * unprefixed line.
 */
function buildFinishingOrderCSV(packet) {
  const t = packet.tournament;
  const m = packet.money;
  const v = packet.reconciliation?.variance;
  const lines = [];

  lines.push('# Smarter Poker Commander, End Of Event Results');
  lines.push(`# Tournament,${csvCell(t.name)}`);
  lines.push(`# Venue,${csvCell(packet.venue?.name || '')}`);
  lines.push(`# Started,${csvCell(t.actual_start || t.scheduled_start || '')}`);
  lines.push(`# Ended,${csvCell(t.ended_at || '')}`);
  lines.push(`# Buy-In,${t.buyin_amount}`);
  lines.push(`# Fee,${t.buyin_fee}`);
  lines.push(`# Entries,${packet.counts?.entries ?? 0}`);
  lines.push(`# Rebuys,${packet.counts?.rebuys ?? 0}`);
  lines.push(`# Add-Ons,${packet.counts?.addons ?? 0}`);
  lines.push(`# Gross Collected,${m.gross_collected}`);
  lines.push(`# House Fees,${m.house_fees}`);
  lines.push(`# Bounty Pool,${m.bounty_pool}`);
  lines.push(`# Prize Pool,${m.effective_prize_pool}`);
  lines.push(`# Overlay,${m.overlay}`);
  lines.push(`# Total Paid Out,${m.total_paid_out}`);
  lines.push(`# Cash Over Short,${v ? v.over_short : 0}`);
  lines.push(`# Generated,${csvCell(packet.generated_at)}`);
  lines.push('');

  lines.push([
    'Position', 'Player', 'Payout', 'Bounty Winnings', 'Knockouts',
    'Rebuys', 'Add-On', 'Total Invested', 'Net Result',
    'Re-Entry', 'Status', 'Payout Status', 'Paid At', 'Eliminated At', 'W-2G Required'
  ].map(csvCell).join(','));

  for (const r of packet.finishing_order) {
    lines.push([
      r.finish_position,
      csvCell(r.player_name),
      r.payout_amount,
      r.bounty_winnings,
      r.knockouts,
      r.rebuys,
      r.addon ? 'Yes' : 'No',
      r.total_invested,
      r.net_result,
      r.is_reentry ? 'Yes' : 'No',
      csvCell(r.status || ''),
      csvCell(r.payout_status || 'Unpaid'),
      csvCell(r.paid_at || ''),
      csvCell(r.eliminated_at || ''),
      r.w2g_required ? 'Yes' : 'No'
    ].join(','));
  }

  if (packet.still_in_or_unranked.length > 0) {
    lines.push('');
    lines.push('# Entries With No Finishing Position');
    lines.push(['Player', 'Status', 'Chips', 'Rebuys', 'Add-On', 'Total Invested'].map(csvCell).join(','));
    for (const r of packet.still_in_or_unranked) {
      lines.push([
        csvCell(r.player_name),
        csvCell(r.status || ''),
        r.current_chips,
        r.rebuys,
        r.addon ? 'Yes' : 'No',
        r.total_invested
      ].join(','));
    }
  }

  return lines.join('\n') + '\n';
}
