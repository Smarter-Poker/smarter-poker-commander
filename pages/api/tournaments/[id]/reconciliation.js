/**
 * Per-Tournament Cash Drawer Reconciliation
 * GET /api/commander/tournaments/:id/reconciliation
 *
 * The one number a cage manager actually needs at the end of an event: does the
 * money in the drawer match the money the tournament says it took, and if not,
 * exactly which row is wrong.
 *
 * Four buckets, each with an expected and an actual figure:
 *
 *   EXPECTED IN   derived from the tournament configuration and the entry rows
 *                 (entries x (buyin + fee), rebuys x rebuy_amount,
 *                 addons x addon_amount), split into the prize slice, the
 *                 bounty slice and the house fee using the SHARED helpers in
 *                 payout.js. This file re-derives none of that math.
 *   ACTUAL IN     summed from commander_cash_transactions, grouped by type and
 *                 by payment method.
 *   EXPECTED OUT  payout_amount recorded on the entries plus bounty_winnings.
 *   ACTUAL OUT    cash_out transactions for this tournament.
 *
 * MATCHING CASH TO THE TOURNAMENT
 * -------------------------------
 * Registration writes commander_cash_transactions.tournament_id, so buy-ins
 * link directly. The rebuy and add-on RPCs (commander_txn_tournament_rebuy /
 * commander_txn_tournament_addon) do NOT: verified against the live function
 * bodies 2026-08-20, both insert type 'buy_in' with tournament_id left NULL and
 * the entry id only in the notes string
 * ("Tournament Rebuy: NAME (ID: <entry uuid>)"). Rather than lose that cash
 * from the report, this endpoint also sweeps the venue's drawer over the
 * event's time window and claims any row whose notes carry an entry id
 * belonging to this tournament. Those rows are reported as `linked_by: notes`
 * so nobody mistakes the heuristic for a real foreign key, and migration
 * 20260821170000_commander_txn_tournament_link.sql fixes the RPCs at source.
 *
 * Auth: STAFF, venue-scoped.
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { reportApiError } from '../../../../src/lib/apiErrorHandler';
// Shared money math. Every figure below that touches the prize pool, the
// bounty slice or the payout ladder comes out of these, so this report can
// never disagree with the payouts screen.
import {
  collectedPrizePool,
  collectedBountyPool,
  effectivePrizePool,
  bountyPortionPerEntry,
  buildPayoutTable
} from './payout';
import { entryBountyWinnings, hasBounties } from '../../../../src/lib/commander/tournamentBounty';
import { assessEntryW2G } from '../../../../src/lib/commander/taxEvents';
import { isSameVenue } from '../../../../src/lib/commander/venueScope';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    _supabase = createClient(url, key);
  }
  return _supabase;
}

/** Rounded to cents. Every money figure in the response goes through this. */
function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** A cent of drift is float noise, not a cash discrepancy. */
const VARIANCE_EPSILON = 0.01;

// commander_cash_transactions.type CHECK, verified live 2026-08-20:
// buy_in | cash_out | add_on | time_purchase | membership | void.
// There is no 'rebuy' and no 'payout' value; a rebuy is filed as 'buy_in' and
// a payout is filed as 'cash_out'.
const MONEY_IN_TYPES = ['buy_in', 'add_on', 'time_purchase', 'membership'];
const MONEY_OUT_TYPES = ['cash_out'];

const ENTRY_ID_IN_NOTES = /\(ID:\s*([0-9a-fA-F-]{36})\)/;

/** Entries that are still money in the drawer (a cancellation is refunded). */
const CANCELLED_STATUSES = ['cancelled'];

/** payout_status values that mean the cage has physically handed money over. */
const PAID_STATUSES = ['paid', 'settled', 'complete', 'completed'];

function isPaidOut(entry) {
  if (entry?.paid_at) return true;
  const status = String(entry?.payout_status || '').toLowerCase();
  return PAID_STATUSES.includes(status);
}

/**
 * Names have to be matched across two tables that were written by different
 * code paths: an entry carries profiles.display_name OR a typed-in
 * player_name, while the ledger row carries whatever registration resolved at
 * the time (display name, or "first last"). Case, punctuation and double
 * spaces differ constantly. Normalizing to lowercase alphanumerics is what
 * stops the report crying discrepancy over "O'Brien" vs "OBrien".
 */
function normName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Every name an entry might have been ledgered under. */
function entryNameKeys(entry) {
  const parts = [entry?.profiles?.display_name, entry?.player_name];
  return parts.map(normName).filter(Boolean);
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
    if (!id) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Tournament Id Required' }
      });
    }

    const built = await buildReconciliation(id, staff);
    if (built.error) return res.status(built.status).json({ success: false, error: built.error });

    return res.status(200).json({ success: true, data: built.data });
  } catch (err) {
    try { reportApiError(err, req); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    console.warn('[reconciliation] Error:', err);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Internal Server Error' }
      });
    }
  }
}

/**
 * Build the whole money picture for one tournament.
 *
 * Exported so the end-of-event export packet embeds the identical figures
 * rather than recomputing them and drifting.
 *
 * @param {string} tournamentId
 * @param {object} staff  the verified staff session (venue scoping)
 * @returns {Promise<{status?:number, error?:object, data?:object}>}
 */
export async function buildReconciliation(tournamentId, staff) {
  const { data: tournament, error: tErr } = await getSupabase()
    .from('commander_tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle();

  if (tErr) {
    console.warn('[reconciliation] tournament read failed:', tErr.message || tErr);
    return { status: 500, error: { code: 'DB_ERROR', message: 'Failed To Read The Tournament' } };
  }
  if (!tournament) {
    return { status: 404, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } };
  }
  // One shared check. This spelling fell OPEN on a null venue_id.
  // 2026-09-03: this helper has no `res` in scope - the old
  // `denyCrossVenue(res, ...)` line threw ReferenceError on EVERY request that
  // reached it (i.e. every request for a tournament that exists), which the
  // handler's catch turned into a 500. Return the refusal as data instead; the
  // handler already knows how to send { status, error }.
  if (!isSameVenue(staff, tournament)) {
    return { status: 403, error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' } };
  }

  // ── Entries ──────────────────────────────────────────────────────────────
  const BASE_ENTRY_COLUMNS = `
    id, player_id, player_name, status, registration_method, payment_method,
    cashier_staff_id, rebuy_count, addon_taken, total_invested,
    finish_position, payout_amount, payout_position, payout_status, paid_at,
    bounties_collected, registered_at, eliminated_at, metadata,
    profiles (id, display_name)`;

  const entriesQuery = (columns) => getSupabase()
    .from('commander_tournament_entries')
    .select(columns)
    .eq('tournament_id', tournamentId)
    .order('registered_at', { ascending: true });

  // bounty_value / bounty_winnings / is_reentry arrived in later migrations;
  // fall back so a deploy that lands first still reconciles.
  let { data: entries, error: eErr } = await entriesQuery(
    `${BASE_ENTRY_COLUMNS}, bounty_value, bounty_winnings, is_reentry, reentry_of`
  );
  if (eErr && (eErr.code === '42703' || eErr.code === 'PGRST204' ||
    /column .* does not exist/i.test(String(eErr.message || '')))) {
    ({ data: entries, error: eErr } = await entriesQuery(BASE_ENTRY_COLUMNS));
  }
  if (eErr) {
    console.warn('[reconciliation] entries read failed:', eErr.message || eErr);
    return { status: 500, error: { code: 'DB_ERROR', message: 'Failed To Read The Entries' } };
  }

  const allEntries = entries || [];
  const live = allEntries.filter(e => !CANCELLED_STATUSES.includes(e.status));
  const cancelled = allEntries.filter(e => CANCELLED_STATUSES.includes(e.status));
  const entryById = new Map(allEntries.map(e => [String(e.id), e]));
  const nameOf = (e) => e?.profiles?.display_name || e?.player_name || 'Player';

  const totalEntries = live.length;
  const totalRebuys = live.reduce((s, e) => s + (Number(e.rebuy_count) || 0), 0);
  const totalAddons = live.filter(e => e.addon_taken).length;
  const totalReentries = live.filter(e => e.is_reentry === true || e?.metadata?.is_reentry === true).length;

  // ── Expected in ──────────────────────────────────────────────────────────
  const buyinAmount = Math.max(0, Number(tournament.buyin_amount) || 0);
  const buyinFee = Math.max(0, Number(tournament.buyin_fee) || 0);
  const rebuyAmount = Math.max(0, Number(tournament.rebuy_amount) || 0);
  const addonAmount = Math.max(0, Number(tournament.addon_amount) || 0);

  const expectedBuyins = money(totalEntries * (buyinAmount + buyinFee));
  const expectedRebuys = money(totalRebuys * rebuyAmount);
  const expectedAddons = money(totalAddons * addonAmount);
  const expectedInTotal = money(expectedBuyins + expectedRebuys + expectedAddons);

  const counts = { entries: totalEntries, rebuys: totalRebuys, addons: totalAddons };
  const collectedPool = money(collectedPrizePool(tournament, counts));
  const bountyPool = money(collectedBountyPool(tournament, counts));
  const houseFees = money(totalEntries * buyinFee);
  const prizePool = money(effectivePrizePool(tournament, collectedPool));
  const overlay = money(Math.max(0, (Number(tournament.guaranteed_pool) || 0) - collectedPool));

  const payoutTable = buildPayoutTable(tournament, prizePool, totalEntries);
  const paidPlaces = payoutTable.rows.filter(r => Number(r.amount) > 0).length;

  // ── Cash transactions ────────────────────────────────────────────────────
  const { transactions, sweepError } = await loadTransactions(tournament, tournamentId, entryById);

  const inRows = transactions.filter(t => MONEY_IN_TYPES.includes(t.type));
  const outRows = transactions.filter(t => MONEY_OUT_TYPES.includes(t.type));

  const actualIn = summarize(inRows);
  const actualOut = summarize(outRows);

  // ── Expected out ─────────────────────────────────────────────────────────
  const expectedPayouts = money(live.reduce((s, e) => s + (Number(e.payout_amount) || 0), 0));
  const expectedBountyWinnings = money(
    hasBounties(tournament) ? live.reduce((s, e) => s + entryBountyWinnings(e), 0) : 0
  );
  // 2026-08-22: bounty money is handed over AT THE TABLE from the dealer's
  // rack the moment a knockout happens, not from the cage drawer at the end,
  // so no cash_out row is ever written for it and none should be. Including it
  // in the drawer's expected-out made every bounty and PKO event report as
  // permanently short by exactly the bounty total, which trains the cage to
  // ignore the variance, which is worse than not showing one.
  //
  // The drawer therefore balances on CAGE payouts only. Bounty cash is
  // reported alongside as its own reconciliation line so it is still visible
  // and still checked against the bounty pool below.
  //
  // 2026-08-22, Dan: this is SETTLED, not a gap awaiting a ledger. A dedicated
  // bounty event table and a 'bounty_payout' cash-transaction type were both
  // considered and rejected. Reasoning, and the one condition that would
  // reopen it (a venue that pays bounties from the cage instead of the table):
  //   .agent/audits/2026-08-22-bounty-cash-is-not-a-drawer-variance.md
  // Please read that before proposing a bounty ledger again.
  const expectedOutTotal = money(expectedPayouts);
  const expectedOutIncludingBounties = money(expectedPayouts + expectedBountyWinnings);

  // ── Variance ─────────────────────────────────────────────────────────────
  // Sign convention, stated once: variance = ACTUAL - EXPECTED.
  //   cash_in  positive  the drawer took more than the tournament says it should.
  //   cash_out positive  the cage paid out more than it owed.
  //   over_short = net actual - net expected. Positive is OVER, negative SHORT.
  const cashInVariance = money(actualIn.total - expectedInTotal);
  const cashOutVariance = money(actualOut.total - expectedOutTotal);
  const netExpected = money(expectedInTotal - expectedOutTotal);
  const netActual = money(actualIn.total - actualOut.total);
  const overShort = money(netActual - netExpected);

  // ── Discrepancies ────────────────────────────────────────────────────────
  const discrepancies = [];
  const add = (code, severity, message, extra) => {
    discrepancies.push({ code, severity, message, ...(extra || {}) });
  };

  if (sweepError) {
    add('DRAWER_SWEEP_FAILED', 'warning',
      'The Venue Cash Drawer Could Not Be Swept For Unlinked Rebuy And Add-On Rows. Actual Cash In May Be Understated.');
  }

  // The three slices must reconstruct the gross charge exactly. If they do not,
  // a price is configured so the bounty exceeds the buy-in and the shared
  // helper is clamping it, which would silently hide money.
  const sliceSum = money(collectedPool + bountyPool + houseFees);
  if (Math.abs(sliceSum - expectedInTotal) > VARIANCE_EPSILON) {
    add('PRIZE_SLICE_MISMATCH', 'error',
      `Prize Pool Plus Bounty Pool Plus House Fees Is ${sliceSum.toLocaleString()} But The Gross Charge Is ${expectedInTotal.toLocaleString()}. Check The Bounty Amount Against The Buy-In.`,
      { expected: expectedInTotal, actual: sliceSum, difference: money(sliceSum - expectedInTotal) });
  }

  // Buy-in row count against the field.
  const buyinRows = inRows.filter(t => t.kind === 'buyin');
  if (buyinRows.length !== totalEntries) {
    add('BUYIN_COUNT_MISMATCH', buyinRows.length < totalEntries ? 'error' : 'warning',
      `${totalEntries} Entr${totalEntries === 1 ? 'y' : 'ies'} Recorded But ${buyinRows.length} Buy-In Cash Transaction${buyinRows.length === 1 ? '' : 's'} Found.`,
      { expected: totalEntries, actual: buyinRows.length });
  }

  const rebuyRows = inRows.filter(t => t.kind === 'rebuy');
  if (rebuyRows.length !== totalRebuys) {
    add('REBUY_COUNT_MISMATCH', rebuyRows.length < totalRebuys ? 'error' : 'warning',
      `${totalRebuys} Rebuy${totalRebuys === 1 ? '' : 's'} Recorded On Entries But ${rebuyRows.length} Rebuy Cash Transaction${rebuyRows.length === 1 ? '' : 's'} Found.`,
      { expected: totalRebuys, actual: rebuyRows.length });
  }

  const addonRows = inRows.filter(t => t.kind === 'addon');
  if (addonRows.length !== totalAddons) {
    add('ADDON_COUNT_MISMATCH', addonRows.length < totalAddons ? 'error' : 'warning',
      `${totalAddons} Add-On${totalAddons === 1 ? '' : 's'} Recorded On Entries But ${addonRows.length} Add-On Cash Transaction${addonRows.length === 1 ? '' : 's'} Found.`,
      { expected: totalAddons, actual: addonRows.length });
  }

  // An entry the cage has marked paid must have money leaving the drawer.
  //
  // 2026-08-20: matched by ENTRY ID first. entries/[entryId]/pay.js is now the
  // only thing that pays a finisher, and it writes the entry id into the ledger
  // row's notes in the format ENTRY_ID_IN_NOTES parses, so the link is exact.
  // The name match is kept as the fallback for any cash_out row written by hand
  // at the cashier screen, which carries a name and no entry id. Name matching
  // alone mis-attributed money whenever one player held two entries (a re-entry
  // that also cashed) or two players shared a normalized name.
  const outByEntryId = new Map();
  const outByName = new Map();
  for (const t of outRows) {
    if (t.entry_id && entryById.has(String(t.entry_id))) {
      const id = String(t.entry_id);
      outByEntryId.set(id, (outByEntryId.get(id) || 0) + t.amount);
      continue;
    }
    const key = normName(t.player_name);
    if (!key) continue;
    outByName.set(key, (outByName.get(key) || 0) + t.amount);
  }
  for (const e of live) {
    const owed = Number(e.payout_amount) || 0;
    if (owed <= 0 || !isPaidOut(e)) continue;
    const paid = (outByEntryId.get(String(e.id)) || 0) +
      entryNameKeys(e).reduce((s, key) => Math.max(s, outByName.get(key) || 0), 0);
    if (paid + VARIANCE_EPSILON < owed) {
      add('PAID_ENTRY_NO_CASH_TX', 'error',
        `${nameOf(e)} Is Marked Paid For ${owed.toLocaleString()} But Only ${paid.toLocaleString()} Was Recorded Leaving The Drawer.`,
        { entry_id: e.id, player_name: nameOf(e), expected: money(owed), actual: money(paid) });
    }
  }

  // A cash row that belongs to nobody in the field.
  const liveNames = new Set(live.flatMap(entryNameKeys));
  for (const t of transactions) {
    if (t.entry_id && entryById.has(String(t.entry_id))) continue;
    const key = normName(t.player_name);
    if (key && liveNames.has(key)) continue;
    add('CASH_TX_NO_ENTRY', 'warning',
      `A ${t.type.replace(/_/g, ' ')} Transaction For ${t.player_name || 'An Unnamed Player'} (${money(t.amount).toLocaleString()}) Has No Matching Entry In This Tournament.`,
      { transaction_id: t.id, player_name: t.player_name || null, amount: money(t.amount), type: t.type });
  }

  if (Math.abs(cashInVariance) > VARIANCE_EPSILON) {
    add('CASH_IN_VARIANCE', 'error',
      `Cash In Is ${cashInVariance > 0 ? 'Over' : 'Short'} By ${Math.abs(cashInVariance).toLocaleString()}.`,
      { expected: expectedInTotal, actual: actualIn.total, difference: cashInVariance });
  }
  if (Math.abs(cashOutVariance) > VARIANCE_EPSILON) {
    add('CASH_OUT_VARIANCE', 'error',
      `Cash Out Is ${cashOutVariance > 0 ? 'Over' : 'Short'} By ${Math.abs(cashOutVariance).toLocaleString()}.`,
      { expected: expectedOutTotal, actual: actualOut.total, difference: cashOutVariance });
  }

  if (expectedPayouts > prizePool + VARIANCE_EPSILON) {
    add('PAYOUTS_EXCEED_PRIZE_POOL', 'error',
      `Recorded Payouts Of ${expectedPayouts.toLocaleString()} Exceed The Prize Pool Of ${prizePool.toLocaleString()}.`,
      { expected: prizePool, actual: expectedPayouts, difference: money(expectedPayouts - prizePool) });
  }
  if (hasBounties(tournament) && expectedBountyWinnings > bountyPool + VARIANCE_EPSILON) {
    add('BOUNTY_WINNINGS_EXCEED_POOL', 'error',
      `Recorded Bounty Winnings Of ${expectedBountyWinnings.toLocaleString()} Exceed The Bounty Pool Of ${bountyPool.toLocaleString()}.`,
      { expected: bountyPool, actual: expectedBountyWinnings, difference: money(expectedBountyWinnings - bountyPool) });
  }

  // ── Unpaid In-The-Money finishers ────────────────────────────────────────
  const unpaidItm = live
    .filter(e => {
      const inMoney = (Number(e.payout_amount) || 0) > 0 ||
        (paidPlaces > 0 && Number(e.finish_position) > 0 && Number(e.finish_position) <= paidPlaces);
      return inMoney && !isPaidOut(e);
    })
    .sort((a, b) => (Number(a.finish_position) || 9999) - (Number(b.finish_position) || 9999))
    .map(e => {
      const position = Number(e.finish_position) || null;
      const scheduled = position
        ? Number(payoutTable.rows.find(r => Number(r.position) === position)?.amount) || 0
        : 0;
      return {
        entry_id: e.id,
        player_id: e.player_id || null,
        player_name: nameOf(e),
        finish_position: position,
        payout_amount: money(Number(e.payout_amount) || 0),
        scheduled_amount: money(scheduled),
        bounty_winnings: money(entryBountyWinnings(e)),
        payout_status: e.payout_status || null,
        paid_at: e.paid_at || null
      };
    });

  if (unpaidItm.length > 0) {
    add('UNPAID_ITM_FINISHERS', 'warning',
      `${unpaidItm.length} In-The-Money Finisher${unpaidItm.length === 1 ? ' Has' : 's Have'} Not Been Marked Paid.`,
      { count: unpaidItm.length });
  }

  // ── W-2G ─────────────────────────────────────────────────────────────────
  // Net of that entry's own buy-in, per the IRS poker tournament rule. The cage
  // needs this BEFORE the player walks out of the building.
  const w2gCandidates = live
    .map(e => ({ entry: e, assessment: assessEntryW2G(tournament, e) }))
    .filter(x => x.assessment.reportable)
    .sort((a, b) => b.assessment.net - a.assessment.net)
    .map(({ entry, assessment }) => ({
      entry_id: entry.id,
      player_id: entry.player_id || null,
      player_name: nameOf(entry),
      finish_position: Number(entry.finish_position) || null,
      gross_amount: assessment.gross,
      buy_in: assessment.buy_in,
      net_amount: assessment.net,
      threshold: assessment.threshold,
      withholding_required: assessment.withholding_required,
      withholding_amount: assessment.withholding_amount,
      tin_status: assessment.tin_status,
      note: assessment.note
    }));

  if (w2gCandidates.length > 0) {
    add('W2G_REQUIRED', 'warning',
      `${w2gCandidates.length} Finisher${w2gCandidates.length === 1 ? '' : 's'} Net More Than ${(5000).toLocaleString()} And Require A W-2G. Collect The Taxpayer Identification Number Before They Leave.`,
      { count: w2gCandidates.length });
  }

  const balanced = Math.abs(overShort) <= VARIANCE_EPSILON &&
    Math.abs(cashInVariance) <= VARIANCE_EPSILON &&
    Math.abs(cashOutVariance) <= VARIANCE_EPSILON;

  return {
    data: {
      tournament: {
        id: tournament.id,
        venue_id: tournament.venue_id,
        name: tournament.name,
        status: tournament.status,
        tournament_type: tournament.tournament_type || null,
        scheduled_start: tournament.scheduled_start,
        actual_start: tournament.actual_start,
        ended_at: tournament.ended_at
      },
      counts: {
        entries: totalEntries,
        cancelled_entries: cancelled.length,
        rebuys: totalRebuys,
        addons: totalAddons,
        reentries: totalReentries,
        paid_places: paidPlaces
      },
      expected_in: {
        buyins: { count: totalEntries, unit: money(buyinAmount + buyinFee), amount: expectedBuyins },
        rebuys: { count: totalRebuys, unit: money(rebuyAmount), amount: expectedRebuys },
        addons: { count: totalAddons, unit: money(addonAmount), amount: expectedAddons },
        total: expectedInTotal
      },
      derivation: {
        buyin_amount: money(buyinAmount),
        buyin_fee: money(buyinFee),
        rebuy_amount: money(rebuyAmount),
        addon_amount: money(addonAmount),
        bounty_per_entry: money(bountyPortionPerEntry(tournament)),
        prize_pool_collected: collectedPool,
        bounty_pool_collected: bountyPool,
        house_fees: houseFees,
        guaranteed_pool: money(Number(tournament.guaranteed_pool) || 0),
        actual_prizepool: money(Number(tournament.actual_prizepool) || 0),
        effective_prize_pool: prizePool,
        overlay,
        payout_denomination: payoutTable.denomination,
        is_satellite: payoutTable.is_satellite,
        seat_value: payoutTable.seat_value,
        seats_awarded: payoutTable.seats_awarded
      },
      actual_in: actualIn,
      expected_out: {
        payouts: expectedPayouts,
        bounty_winnings: expectedBountyWinnings,
        // The drawer total deliberately EXCLUDES bounty winnings: that cash
        // leaves the dealer's rack at the table, not the cage, so it never
        // produces a cash_out row and must not make the drawer look short.
        total: expectedOutTotal,
        total_including_bounties: expectedOutIncludingBounties,
        bounty_paid_at_table: expectedBountyWinnings > 0
      },
      actual_out: actualOut,
      variance: {
        cash_in: { expected: expectedInTotal, actual: actualIn.total, variance: cashInVariance },
        cash_out: { expected: expectedOutTotal, actual: actualOut.total, variance: cashOutVariance },
        net: { expected: netExpected, actual: netActual, variance: overShort },
        over_short: overShort,
        // Plain words for the sheet, so nobody has to remember the sign.
        over_short_label: Math.abs(overShort) <= VARIANCE_EPSILON
          ? 'Balanced'
          : (overShort > 0 ? 'Over' : 'Short')
      },
      balanced,
      discrepancies,
      unpaid_itm: unpaidItm,
      w2g_candidates: w2gCandidates,
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        kind: t.kind,
        amount: money(t.amount),
        payment_method: t.payment_method,
        player_name: t.player_name,
        entry_id: t.entry_id,
        linked_by: t.linked_by,
        created_at: t.created_at
      })),
      generated_at: new Date().toISOString()
    }
  };
}

/**
 * Group a set of transactions into a total plus a by-type and by-payment-method
 * breakdown. Shared by the in and out sides so the two are shaped identically.
 */
function summarize(rows) {
  const byType = {};
  const byPaymentMethod = {};
  let total = 0;
  let linkedByNotes = 0;

  for (const t of rows) {
    total += t.amount;
    const type = t.kind || t.type || 'other';
    if (!byType[type]) byType[type] = { count: 0, amount: 0 };
    byType[type].count += 1;
    byType[type].amount = money(byType[type].amount + t.amount);

    const method = t.payment_method || 'unrecorded';
    if (!byPaymentMethod[method]) byPaymentMethod[method] = { count: 0, amount: 0 };
    byPaymentMethod[method].count += 1;
    byPaymentMethod[method].amount = money(byPaymentMethod[method].amount + t.amount);

    if (t.linked_by === 'notes') linkedByNotes += 1;
  }

  return {
    total: money(total),
    count: rows.length,
    by_type: byType,
    by_payment_method: byPaymentMethod,
    linked_by_notes: linkedByNotes
  };
}

/**
 * Every cash row that belongs to this tournament.
 *
 * Two passes:
 *   1. tournament_id = the tournament. Written by registration.
 *   2. the venue's drawer over the event window, claimed when the notes carry
 *      an entry id belonging to this tournament. This is what recovers the
 *      rebuy and add-on rows the RPCs file with a NULL tournament_id.
 *
 * Voided rows (voided_at set, or type 'void') are excluded from both: a voided
 * transaction is money that never moved.
 */
async function loadTransactions(tournament, tournamentId, entryById) {
  const seen = new Map();
  let sweepError = false;

  const shape = (row, linkedBy) => {
    const notes = String(row.notes || '');
    const idMatch = notes.match(ENTRY_ID_IN_NOTES);
    const entryId = idMatch ? idMatch[1] : null;
    let kind = row.type;
    if (/^Tournament Rebuy/i.test(notes)) kind = 'rebuy';
    else if (/^Tournament Add-?on/i.test(notes)) kind = 'addon';
    else if (row.type === 'buy_in') kind = 'buyin';
    else if (row.type === 'add_on') kind = 'addon';
    else if (row.type === 'cash_out') kind = 'payout';
    return {
      id: row.id,
      type: row.type,
      kind,
      amount: money(row.amount),
      payment_method: row.payment_method || null,
      player_name: row.player_name || null,
      notes,
      entry_id: entryId,
      linked_by: linkedBy,
      created_at: row.created_at
    };
  };

  const { data: linked, error: linkedErr } = await getSupabase()
    .from('commander_cash_transactions')
    .select('id, type, amount, payment_method, player_name, notes, created_at, voided_at')
    .eq('tournament_id', tournamentId)
    .is('voided_at', null)
    .neq('type', 'void')
    .order('created_at', { ascending: true })
    .limit(2000);

  if (linkedErr) {
    console.warn('[reconciliation] linked transaction read failed:', linkedErr.message || linkedErr);
    sweepError = true;
  }
  for (const row of (linked || [])) seen.set(String(row.id), shape(row, 'tournament_id'));

  // Pass 2: the notes sweep. Bounded by the venue and by the event window so a
  // busy room's whole ledger is never pulled into a single report.
  if (tournament.venue_id != null && entryById.size > 0) {
    const startRaw = tournament.actual_start || tournament.scheduled_start || tournament.registration_opens;
    const endRaw = tournament.ended_at;
    const start = startRaw ? new Date(startRaw) : null;
    const end = endRaw ? new Date(endRaw) : null;
    const from = start && !Number.isNaN(start.getTime())
      ? new Date(start.getTime() - 12 * 3600 * 1000).toISOString()
      : null;
    const to = end && !Number.isNaN(end.getTime())
      ? new Date(end.getTime() + 12 * 3600 * 1000).toISOString()
      : null;

    const sweep = async (pattern) => {
      let q = getSupabase()
        .from('commander_cash_transactions')
        .select('id, type, amount, payment_method, player_name, notes, created_at, voided_at')
        .eq('venue_id', tournament.venue_id)
        .is('tournament_id', null)
        .is('voided_at', null)
        .neq('type', 'void')
        .ilike('notes', pattern)
        .order('created_at', { ascending: true })
        .limit(2000);
      if (from) q = q.gte('created_at', from);
      if (to) q = q.lte('created_at', to);
      const { data, error } = await q;
      if (error) {
        console.warn('[reconciliation] drawer sweep failed:', error.message || error);
        sweepError = true;
        return [];
      }
      return data || [];
    };

    const swept = [
      ...(await sweep('Tournament Rebuy:%')),
      ...(await sweep('Tournament Add-on:%'))
    ];

    for (const row of swept) {
      if (seen.has(String(row.id))) continue;
      const shaped = shape(row, 'notes');
      // Only claim it when the entry id in the notes really is one of ours.
      if (shaped.entry_id && entryById.has(String(shaped.entry_id))) {
        seen.set(String(row.id), shaped);
      }
    }
  }

  return { transactions: [...seen.values()], sweepError };
}
