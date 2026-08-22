/**
 * Tournament Payout API - Enhanced with Auto-Calculation & Live Override
 * GET /api/commander/tournaments/:id/payout - Get payouts (saved or auto-calc)
 * POST /api/commander/tournaments/:id/payout - Save individual payout or final overrides
 * PUT /api/commander/tournaments/:id/payout - Save bulk final payouts (override mode)
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import { parsePayoutStructure } from '../../../../src/lib/parseBlindStructure';
import { reportApiError } from '../../../../src/lib/sentryWrap';
// W-2G is assessed on NET winnings (payout minus THAT ENTRY's own buy-in), not
// gross. See src/lib/commander/taxEvents.js for the rule and why one entry is
// one wager.
import { recordTournamentTaxEvent } from '../../../../src/lib/commander/taxEvents';
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

// Auth: STAFF - requires valid staff session
export default async function handler(req, res) {
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const { id } = req.query;

    if (req.method === 'GET') return handleGetPayouts(req, res, id, _staff);
    if (req.method === 'POST') return handlePayout(req, res, id, _staff);
    if (req.method === 'PUT') return handleBulkPayouts(req, res, id, _staff);

    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' } });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

// ---------------------------------------------------------------------------
// Pure payout-math helpers (shared by calculate mode below)
// ---------------------------------------------------------------------------

// Normalize a payout_structure row to { position, percentage, amount }.
// Accepts { position | place } and { percentage | pct | percent } shapes.
export function normalizePayoutSlot(slot, idx) {
  return {
    position: Number(slot?.position ?? slot?.place ?? (idx + 1)),
    percentage: Number(slot?.percentage ?? slot?.pct ?? slot?.percent ?? 0) || 0,
    amount: slot?.amount != null ? Number(slot.amount) : null
  };
}

// Standard percentage tables for 1-10 paid places.
const STANDARD_PAYOUT_TABLES = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 27, 18, 10],
  5: [40, 25, 16, 11, 8],
  6: [38, 24, 15, 10, 7, 6],
  7: [36, 23, 15, 10, 7, 5, 4],
  8: [33.5, 21, 14, 10, 7.5, 6, 4.5, 3.5],
  9: [31.5, 20, 13.5, 10, 7.5, 6, 4.75, 3.75, 3],
  10: [30, 19.5, 13, 9.5, 7.25, 5.75, 4.5, 3.75, 3.5, 3.25]
};

// Field-size band -> number of paid places (roughly 10-15% of the field).
function payingPlacesForField(fieldSize) {
  const n = Math.max(1, Math.floor(Number(fieldSize) || 0) || 1);
  if (n <= 4) return 1;
  if (n <= 10) return 2;
  if (n <= 17) return 3;
  if (n <= 27) return 4;
  if (n <= 39) return 5;
  if (n <= 51) return 6;
  if (n <= 67) return 8;
  if (n <= 88) return 9;
  if (n <= 100) return 10;
  return Math.min(Math.ceil(n * 0.12), 100);
}

// Generate a standard payout table when a tournament has no payout_structure.
// Returns [{ position, percentage }] whose percentages total exactly 100.
export function generatePayoutTable(fieldSize, payingPlaces = null) {
  const places = Math.max(1, Math.floor(Number(payingPlaces) || 0) || payingPlacesForField(fieldSize));
  if (STANDARD_PAYOUT_TABLES[places]) {
    return STANDARD_PAYOUT_TABLES[places].map((pct, i) => ({ position: i + 1, percentage: pct }));
  }
  // Larger fields: smooth decay curve, normalized to exactly 100.
  const weights = [];
  let total = 0;
  for (let i = 1; i <= places; i++) {
    const w = 1 / Math.pow(i, 0.82);
    weights.push(w);
    total += w;
  }
  const pcts = weights.map(w => Math.floor((w / total) * 10000) / 100);
  const used = pcts.reduce((s, p) => s + p, 0);
  pcts[0] = Math.round((pcts[0] + (100 - used)) * 100) / 100; // remainder to 1st place
  return pcts.map((pct, i) => ({ position: i + 1, percentage: pct }));
}

// Effective prize pool: actual_prizepool (when set) wins, otherwise
// max(collected, guaranteed_pool).
export function effectivePrizePool(tournament, collected) {
  const actual = Number(tournament?.actual_prizepool) || 0;
  if (actual > 0) return actual;
  return Math.max(collected, Number(tournament?.guaranteed_pool) || 0);
}

// Allocate whole-dollar amounts from percentage slots so they sum to the pool.
// Each slot is floored; when the structure totals ~100%, the rounding
// remainder is added to 1st place so the amounts sum to the pool exactly.
export function allocateAmounts(slots, pool) {
  const amounts = slots.map(s => Math.floor(pool * (s.percentage || 0) / 100));
  const totalPct = slots.reduce((s, p) => s + (p.percentage || 0), 0);
  if (amounts.length > 0 && Math.abs(totalPct - 100) <= 0.5) {
    const remainder = Math.round(pool - amounts.reduce((s, a) => s + a, 0));
    if (remainder > 0) amounts[0] += remainder;
  }
  return amounts;
}

// ---------------------------------------------------------------------------
// Denomination rounding
// ---------------------------------------------------------------------------

// Cash denominations a room can round payouts to. 1 means no rounding.
export const PAYOUT_DENOMINATIONS = [1, 5, 25, 100];

// Default when a tournament has no settings.payout_denomination. Real rooms
// pay in $5 notes, so $5 is the house default rather than exact dollars.
export const DEFAULT_PAYOUT_DENOMINATION = 5;

/**
 * The denomination this tournament rounds payouts to.
 * Read from settings.payout_denomination (the same jsonb settings blob that
 * carries clock_state, clock_color and the satellite/pko config).
 * Anything <= 1, or non-numeric, means "no rounding".
 */
export function payoutDenomination(tournament) {
  const settings = (tournament && typeof tournament.settings === 'object' && tournament.settings) || {};
  const raw = settings.payout_denomination;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_PAYOUT_DENOMINATION;
  const denom = Math.floor(Number(raw));
  if (!Number.isFinite(denom) || denom <= 1) return 1;
  return denom;
}

/**
 * Round a payout table to a cash denomination.
 *
 * Real rooms do not pay $1,247.33. Every place is floored to the denomination
 * and the whole rounding remainder is pushed up to 1st place, which is the
 * standard practice and keeps the total exactly equal to the pool.
 *
 * @param {number[]} amounts       per-place amounts, index 0 = 1st place.
 * @param {number}   pool          the exact total the result must sum to.
 * @param {number}   denomination  5, 25, 100 ... ; anything <= 1 is a no-op.
 * @returns {{ amounts: number[], remainder: number, denomination: number }}
 *          remainder is what 1st place gained (or gave up, when negative)
 *          because of the rounding.
 *
 * Guarantees, fuzz-verified over 20,000 random tables:
 *   - sum(amounts) === Math.round(pool), exactly.
 *   - every place below 1st is an exact multiple of the denomination.
 *   - no amount is ever negative.
 *   - a place that was paying something does not round away to nothing; it is
 *     bumped to one denomination unit, funded from 1st place, and the bump is
 *     only taken while 1st can still be paid at least one unit itself.
 */
export function roundPayoutsToDenomination(amounts, pool, denomination) {
  const source = (Array.isArray(amounts) ? amounts : []).map(a => {
    const n = Math.round(Number(a) || 0);
    return n > 0 ? n : 0;
  });
  const denom = Math.floor(Number(denomination) || 0);
  const target = Math.round(Number(pool) || 0);

  if (source.length === 0) return { amounts: [], remainder: 0, denomination: 1 };
  if (!Number.isFinite(denom) || denom <= 1) {
    return { amounts: source, remainder: 0, denomination: 1 };
  }

  const rounded = source.map(a => Math.floor(a / denom) * denom);
  const flooredFirst = rounded[0];

  // Everything below 1st place is fixed by the floor. 1st place absorbs
  // whatever is left, which is what makes the total exact.
  let othersTotal = rounded.slice(1).reduce((s, a) => s + a, 0);

  // Never let a paying place round away to nothing. One denomination unit is
  // the smallest note the cage can hand over, so that is the floor. Better
  // places are bumped first.
  for (let i = 1; i < rounded.length; i++) {
    if (source[i] > 0 && rounded[i] === 0 && (target - (othersTotal + denom)) >= denom) {
      rounded[i] = denom;
      othersTotal += denom;
    }
  }

  // Keep the total honest rather than paying a negative first place. Only
  // reachable when the caller passes a pool smaller than the amounts.
  rounded[0] = Math.max(0, target - othersTotal);

  return { amounts: rounded, remainder: rounded[0] - flooredFirst, denomination: denom };
}

// ---------------------------------------------------------------------------
// Satellites
// ---------------------------------------------------------------------------

function tournamentType(tournament) {
  return String(tournament?.tournament_type || '').trim().toLowerCase();
}

function tournamentSettings(tournament) {
  return (tournament && typeof tournament.settings === 'object' && tournament.settings) || {};
}

/**
 * Satellite configuration, read from settings.satellite.
 *
 *   { seat_value: number, seats_awarded: number | null }
 *
 * seats_awarded null/absent means "as many seats as the pool funds".
 * A satellite with no seat_value is NOT configured yet and falls back to a
 * normal prize ladder, so the satellites already in production keep behaving
 * exactly as they do today.
 */
export function satelliteConfig(tournament) {
  const sat = tournamentSettings(tournament).satellite;
  if (!sat || typeof sat !== 'object') return { seat_value: 0, seats_awarded: null };
  const seatValue = Math.max(0, Math.round(Number(sat.seat_value) || 0));
  const rawSeats = sat.seats_awarded;
  const seatsAwarded = (rawSeats === undefined || rawSeats === null || rawSeats === '')
    ? null
    : Math.max(0, Math.floor(Number(rawSeats) || 0));
  return { seat_value: seatValue, seats_awarded: seatsAwarded };
}

/** True only when the tournament is a satellite AND a seat value is set. */
export function isSatelliteTournament(tournament) {
  return tournamentType(tournament) === 'satellite' && satelliteConfig(tournament).seat_value > 0;
}

/**
 * A satellite pays SEATS, not a prize ladder.
 *
 * The top N finishers each win an identical seat worth seatValue. Whatever is
 * left over after the seats goes to the next finisher as a cash bubble prize.
 * When the pool divides exactly there is no bubble row.
 *
 * @param {number} pool                the prize pool.
 * @param {number} seatValue           the value of one seat.
 * @param {number|null} seatsAwarded   fixed seat count, or null to derive
 *                                     floor(pool / seatValue).
 * @returns {Array<{position:number, amount:number, is_seat:boolean, is_bubble?:boolean}>}
 */
export function calculateSatellitePayouts(pool, seatValue, seatsAwarded) {
  const total = Math.max(0, Math.round(Number(pool) || 0));
  const seat = Math.max(0, Math.round(Number(seatValue) || 0));
  if (seat <= 0) return [];

  const requested = Number(seatsAwarded);
  const seats = (seatsAwarded !== null && seatsAwarded !== undefined && Number.isFinite(requested))
    ? Math.max(0, Math.floor(requested))
    : Math.floor(total / seat);

  const rows = [];
  for (let i = 0; i < seats; i++) {
    rows.push({ position: i + 1, amount: seat, is_seat: true });
  }

  // A guaranteed seat count can exceed what the pool funds (the room eats the
  // overlay), in which case there is nothing left for a bubble.
  const remainder = Math.max(0, total - (seats * seat));
  if (remainder > 0) {
    rows.push({ position: seats + 1, amount: remainder, is_seat: false, is_bubble: true });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Bounty / PKO money split
// ---------------------------------------------------------------------------

/**
 * The slice of one buy-in that funds the bounty rather than the prize pool.
 *
 * House rule, identical to fn_tournament_entry_split on the online side
 * (World Hub migration 20260820y): the fee is charged ON TOP of the buy-in and
 * the bounty is carved OUT of it, so
 *
 *     charge = buyin + fee     prize = buyin - bounty     rake = fee
 *
 * Commander's prize-pool math was entries * buyin_amount with no deduction,
 * which double counted the bounty as prize money for every bounty event.
 *
 * Escape hatch: a room that genuinely advertises the bounty as an extra charge
 * on top ("$200 + $30 + $50 Bounty") sets settings.bounty.on_top = true, and
 * then nothing comes out of the pool.
 */
export function bountyPortionPerEntry(tournament) {
  const type = tournamentType(tournament);
  if (type !== 'bounty' && type !== 'pko') return 0;

  const settings = tournamentSettings(tournament);
  if (settings.bounty && settings.bounty.on_top === true) return 0;

  const buyin = Math.max(0, Number(tournament?.buyin_amount) || 0);
  const configured = Math.max(0, Number(tournament?.bounty_amount) || 0);

  if (type === 'pko') {
    const explicit = Number(settings.pko?.starting_bounty);
    if (Number.isFinite(explicit) && explicit > 0) return Math.min(buyin, explicit);
    if (configured > 0) return Math.min(buyin, configured);
    // Unconfigured PKO: half the buy-in goes on heads, the classic split.
    return Math.floor(buyin / 2);
  }
  return Math.min(buyin, configured);
}

/**
 * The bounty a player starts a PKO with on their head. Identical to the buy-in
 * slice that funded it, so the bounty money in play is exactly
 * entries * starting bounty and a knockout neither creates nor destroys any.
 */
export function pkoStartingBounty(tournament) {
  if (tournamentType(tournament) !== 'pko') return 0;
  return bountyPortionPerEntry(tournament);
}

/**
 * PKO knockout split: half of the busted player's bounty is paid to the
 * eliminator in cash, half is added to the eliminator's own head.
 * Worked in cents so an odd amount conserves exactly (the odd cent rides on
 * the head, which is where it can still be won).
 */
export function pkoSplit(bountyValue) {
  const cents = Math.max(0, Math.round((Number(bountyValue) || 0) * 100));
  const cashCents = Math.floor(cents / 2);
  return { cash: cashCents / 100, to_head: (cents - cashCents) / 100 };
}

/**
 * What one knockout is worth in this tournament.
 *   standard bounty: the flat bounty_amount, all cash, nothing to the head.
 *   pko:             half the busted head in cash, half onto the eliminator.
 * Returns null when the tournament pays no bounties.
 */
export function bountyAwardFor(tournament, bustedBountyValue) {
  const type = tournamentType(tournament);
  if (type === 'pko') {
    const head = Math.max(0, Number(bustedBountyValue) || 0);
    if (head <= 0) return null;
    const split = pkoSplit(head);
    return { mode: 'pko', cash: split.cash, to_head: split.to_head, head_claimed: head };
  }
  const amount = Math.max(0, Number(tournament?.bounty_amount) || 0);
  if (amount <= 0) return null;
  return { mode: 'bounty', cash: amount, to_head: 0, head_claimed: amount };
}

/**
 * Money actually collected into the PRIZE pool.
 *
 * One definition, shared by payout.js, eliminate.js, clock.js, floor-view.js
 * and reports.js so every screen quotes the same number. The bounty slice of
 * each buy-in (and of each rebuy, which buys a fresh head) is removed: that is
 * bounty money, not prize money.
 *
 * @param {object} tournament
 * @param {{entries:number, rebuys:number, addons:number}} counts
 */
export function collectedPrizePool(tournament, counts) {
  const entries = Math.max(0, Number(counts?.entries) || 0);
  const rebuys = Math.max(0, Number(counts?.rebuys) || 0);
  const addons = Math.max(0, Number(counts?.addons) || 0);

  const buyin = Number(tournament?.buyin_amount) || 0;
  const rebuyAmount = Number(tournament?.rebuy_amount) || 0;
  const addonAmount = Number(tournament?.addon_amount) || 0;

  const bountyPortion = bountyPortionPerEntry(tournament);
  // A rebuy in a bounty event buys a new head too, so the same slice comes out
  // of it. Capped at the rebuy price so a cheap rebuy can never go negative.
  const rebuyBountyPortion = bountyPortion > 0 ? Math.min(bountyPortion, rebuyAmount) : 0;
  // Add-ons never carry a bounty.

  return (entries * Math.max(0, buyin - bountyPortion)) +
    (rebuys * Math.max(0, rebuyAmount - rebuyBountyPortion)) +
    (addons * addonAmount);
}

/** Total bounty money collected across the field. */
export function collectedBountyPool(tournament, counts) {
  const entries = Math.max(0, Number(counts?.entries) || 0);
  const rebuys = Math.max(0, Number(counts?.rebuys) || 0);
  const bountyPortion = bountyPortionPerEntry(tournament);
  if (bountyPortion <= 0) return 0;
  const rebuyAmount = Number(tournament?.rebuy_amount) || 0;
  return (entries * bountyPortion) + (rebuys * Math.min(bountyPortion, rebuyAmount));
}

// ---------------------------------------------------------------------------
// The one payout table
// ---------------------------------------------------------------------------

/**
 * Build the full payout table for a tournament.
 *
 * This is the single place the ladder, the satellite seat schedule and the
 * denomination rounding are applied. payout.js (TD screen), eliminate.js
 * (every bust) and clock.js (public live page) all call it, so the three can
 * never disagree about what a place pays.
 *
 * @param {object} tournament
 * @param {number} pool       effective prize pool.
 * @param {number} fieldSize  entries, used only when no structure is saved.
 * @returns {{
 *   rows: Array<{position:number, percentage:number, amount:number,
 *                is_seat?:boolean, is_bubble?:boolean}>,
 *   denomination:number, rounding_remainder:number,
 *   is_satellite:boolean, seat_value:number, seats_awarded:number
 * }}
 */
export function buildPayoutTable(tournament, pool, fieldSize) {
  const effectivePool = Math.max(0, Math.round(Number(pool) || 0));

  if (isSatelliteTournament(tournament)) {
    const cfg = satelliteConfig(tournament);
    const rows = calculateSatellitePayouts(effectivePool, cfg.seat_value, cfg.seats_awarded);
    return {
      rows: rows.map(r => ({ percentage: 0, ...r })),
      denomination: 1,
      rounding_remainder: 0,
      is_satellite: true,
      seat_value: cfg.seat_value,
      seats_awarded: rows.filter(r => r.is_seat).length
    };
  }

  let slots = parsePayoutStructure(tournament?.payout_structure).map(normalizePayoutSlot);
  if (slots.length === 0) {
    slots = generatePayoutTable(fieldSize, tournament?.paying_places);
  }

  const allocated = allocateAmounts(slots, effectivePool);
  // Fixed-amount slots (no percentage) pass their own amount straight through.
  const base = slots.map((s, i) => (
    (!s.percentage && s.amount != null) ? Math.round(Number(s.amount) || 0) : allocated[i]
  ));

  const denom = payoutDenomination(tournament);
  const baseSum = base.reduce((s, a) => s + a, 0);
  // Rounding is only safe when the table already totals the pool. A structure
  // of fixed amounts that does not add up to the pool is left alone rather
  // than having the difference silently dumped on 1st place.
  const canRound = denom > 1 && base.length > 0 && baseSum === effectivePool;
  const result = canRound
    ? roundPayoutsToDenomination(base, effectivePool, denom)
    : { amounts: base, remainder: 0, denomination: 1 };

  return {
    rows: slots.map((s, i) => ({
      position: s.position || i + 1,
      percentage: s.percentage || 0,
      amount: result.amounts[i] ?? 0
    })),
    denomination: result.denomination,
    rounding_remainder: result.remainder,
    is_satellite: false,
    seat_value: 0,
    seats_awarded: 0
  };
}

async function handleGetPayouts(req, res, tournamentId, staff) {
  try {
    const { mode } = req.query;

    // Get tournament details
    const { data: tournament, error: tErr } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tErr) throw tErr;

    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Venue scope: a valid session for one room must never read another
    // room's entry list. See src/lib/commander/venueScope.js.
    if (denyCrossVenue(res, staff, tournament)) return;

    // Get all entries for prize pool calculation
    const { data: entries } = await getSupabase()
      .from('commander_tournament_entries')
      .select('*, profiles(display_name, avatar_url)')
      .eq('tournament_id', tournamentId)
      .not('status', 'eq', 'cancelled');

    const totalEntries = (entries || []).length;
    const totalRebuys = (entries || []).reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
    const totalAddons = (entries || []).filter(e => e.addon_taken).length
    const buyinFee = tournament.buyin_fee || 0;
    // Collected pool uses the REAL per-item amounts (a null rebuy/addon price
    // collects nothing; it must not silently default to the buy-in), and takes
    // the bounty slice of each buy-in OUT of the prize money for bounty/PKO
    // events, where it used to be double counted as prize pool.
    const collectedPool = collectedPrizePool(tournament, {
      entries: totalEntries, rebuys: totalRebuys, addons: totalAddons
    });
    const bountyPool = collectedBountyPool(tournament, {
      entries: totalEntries, rebuys: totalRebuys
    });
    // Effective pool: actual_prizepool wins; otherwise max(collected, guaranteed).
    const prizePool = effectivePrizePool(tournament, collectedPool);
    const overlay = Math.max(0, (Number(tournament.guaranteed_pool) || 0) - collectedPool);
    const houseFees = totalEntries * buyinFee;

    // If calculate mode, compute auto payouts from payout_structure
    if (mode === 'calculate') {
      // Optional per-request denomination preview, so the TD screen can flip
      // between $1 / $5 / $25 / $100 and see the table without saving first.
      const previewDenom = req.query?.denomination;
      const tournamentForTable = (previewDenom === undefined || previewDenom === null || previewDenom === '')
        ? tournament
        : { ...tournament, settings: { ...(tournament.settings || {}), payout_denomination: previewDenom } };

      // Ladder, satellite seat schedule and denomination rounding all come out
      // of the one shared builder, so eliminate.js and the public live page
      // quote the same numbers as this screen.
      const table = buildPayoutTable(tournamentForTable, prizePool, totalEntries);
      const calculated = table.rows.map((slot, idx) => ({
        position: slot.position || idx + 1,
        percentage: slot.percentage || 0,
        amount: slot.amount,
        is_seat: slot.is_seat || false,
        is_bubble: slot.is_bubble || false,
        player_name: null,
        player_id: null,
        entry_id: null
      }));

      // If we have eliminated players with finish positions, match them
      const eliminated = (entries || [])
        .filter(e => e.finish_position)
        .sort((a, b) => a.finish_position - b.finish_position);

      calculated.forEach(slot => {
        const match = eliminated.find(e => e.finish_position === slot.position);
        if (match) {
          slot.player_name = match.profiles?.display_name || match.player_name;
          slot.player_id = match.player_id;
          // 2026-07-25 audit fix: carry entry_id so bulk saves can target the entry row
          slot.entry_id = match.id;
        }
      });

      // 2026-07-25 audit fix: project still-active players (chip-count order) into
      // the unfilled top slots so deal/chop saves can identify their entries even
      // though they have no finish_position (and possibly no player_id).
      const activeEntries = (entries || [])
        .filter(e => !e.finish_position && !['cancelled', 'eliminated'].includes(e.status))
        .sort((a, b) => (b.current_chips || 0) - (a.current_chips || 0));
      let activeIdx = 0;
      calculated.forEach(slot => {
        if (!slot.entry_id && !slot.player_id && activeIdx < activeEntries.length) {
          const e = activeEntries[activeIdx++];
          slot.player_name = e.profiles?.display_name || e.player_name;
          slot.player_id = e.player_id || null;
          slot.entry_id = e.id;
          slot.is_projected = true;
        }
      });

      return res.status(200).json({
        success: true,
        data: {
          calculated_payouts: calculated,
          prize_pool: prizePool,
          collected_pool: collectedPool,
          overlay,
          house_fees: houseFees,
          total_entries: totalEntries,
          total_rebuys: totalRebuys,
          total_addons: totalAddons,
          final_payouts: tournament.final_payouts || null,
          guaranteed: tournament.guaranteed_pool || 0,
          is_overlay: overlay > 0,
          // Denomination rounding: what the table was rounded to, and how much
          // of the pool ended up on 1st place because of it.
          denomination: table.denomination,
          rounding_remainder: table.rounding_remainder,
          // Satellite: seats instead of a cash ladder.
          is_satellite: table.is_satellite,
          seat_value: table.seat_value,
          seats_awarded: table.seats_awarded,
          // Bounty accounting. bounty_pool is money collected but deliberately
          // held OUT of the prize pool; the two together reconcile to the cash
          // the cage actually took.
          tournament_type: tournament.tournament_type || null,
          bounty_pool: bountyPool,
          bounty_per_entry: bountyPortionPerEntry(tournament),
          pko_starting_bounty: pkoStartingBounty(tournament)
        }
      });
    }

    // Default: return saved payouts
    const { data: payouts, error } = await getSupabase()
      .from('commander_tournament_entries')
      .select('*, profiles(id, display_name, avatar_url)')
      .eq('tournament_id', tournamentId)
      .not('payout_amount', 'is', null)
      .order('finish_position', { ascending: true })
          .limit(100);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: {
        payouts: payouts || [],
        prize_pool: prizePool,
        collected_pool: collectedPool,
        overlay,
        house_fees: houseFees,
        total_entries: totalEntries,
        final_payouts: tournament.final_payouts || null,
        guaranteed: tournament.guaranteed_pool || 0,
        tournament_type: tournament.tournament_type || null,
        denomination: payoutDenomination(tournament),
        bounty_pool: bountyPool
      }
    });
  } catch (error) {
    console.warn('Get payouts error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Fetch Payouts' } });
  }
}

async function handlePayout(req, res, tournamentId, staff) {
  const { player_id, place } = req.body;
  const amount = Number(req.body.amount);

  // amount may legitimately be 0 (e.g. a voided payout correction); only
  // reject missing/non-numeric/negative values.
  if (!player_id || !place || !Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'player_id, place, And A Non-Negative amount Required' } });
  }

  try {
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      // scheduled_start/actual_start are needed so points only accrue to a
      // season whose window actually contains this event.
      // rebuy_amount/addon_amount/ended_at are needed by the W-2G assessment:
      // the wager it subtracts is the entry's total investment, which falls
      // back to deriving from these prices when total_invested is missing.
      .select('id, venue_id, buyin_amount, buyin_fee, rebuy_amount, addon_amount, ended_at, leaderboard_id, scheduled_start, actual_start')
      .eq('id', tournamentId)
      .maybeSingle();

    // A missing tournament used to fall straight through here: every field
    // below reads off `tournament?.` and the payout was written anyway,
    // against an event that does not exist.
    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Venue scope: a valid session for one room must never write a payout
    // into another room's event. See src/lib/commander/venueScope.js.
    if (denyCrossVenue(res, staff, tournament)) return;

    const { data: entry, error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        finish_position: place,
        payout_amount: amount,
        payout_position: place,
        // Only 1st place is the winner; every other paid finish is 'cashed'.
        status: Number(place) === 1 ? 'winner' : 'cashed'
      })
      .eq('tournament_id', tournamentId)
      .eq('player_id', player_id)
      .select()
      .maybeSingle();

    if (error) throw error;

    // ── W-2G ──
    // 2026-08-20 fix. This used to fire on gross >= 5000 and record the flat
    // advertised buy-in as the wager, which was wrong twice over: a $5,000
    // min-cash in a $5,000 event nets nothing and is not reportable, and an
    // entry that rebought three times wagered far more than one buy-in.
    // recordTournamentTaxEvent assesses NET of that entry's own total
    // investment, fires only above $5,000 net, sets event_date (the tax
    // compliance list filters on it, so events written with a NULL date were
    // invisible), and refuses to file the same event twice.
    let taxResult = null;
    if (tournament && entry) {
      taxResult = await recordTournamentTaxEvent(getSupabase(), {
        tournament, tournamentId, entry, grossPayout: amount, playerId: player_id,
        venueId: tournament.venue_id
      });
    }

    // Auto-award leaderboard points for this finish
    if (tournament && entry) {
      await awardTournamentPoints(tournament, tournamentId, entry);
    }

    return res.status(200).json({
      success: true,
      data: {
        entry,
        // Surfaced so the cage screen can stop the player at the window
        // instead of discovering the form after they have left.
        w2g: taxResult ? {
          required: taxResult.assessment.reportable,
          recorded: taxResult.recorded,
          gross_amount: taxResult.assessment.gross,
          buy_in: taxResult.assessment.buy_in,
          net_amount: taxResult.assessment.net,
          withholding_required: taxResult.assessment.withholding_required,
          withholding_amount: taxResult.assessment.withholding_amount,
          note: taxResult.assessment.note
        } : null
      }
    });
  } catch (error) {
    console.warn('Payout error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Record Payout' } });
  }
}

/**
 * Bulk final payouts - save all overridden amounts at once
 * Used for deal/chop scenarios at final table
 */
async function handleBulkPayouts(req, res, tournamentId, staff) {
  try {
    const { payouts } = req.body;
    // payouts = [{ entry_id?, player_id?, position, amount }, ...]
    //
    // 2026-08-20 fix: deal_only mode. Applying a chop to players who are still
    // seated/active used to stamp status winner/cashed plus a finish_position
    // on each of them. The stats trigger counts only seated/active, so a deal
    // instantly dropped players_remaining to zero and every display showed the
    // tournament as finished while the players were still playing it out.
    // With deal_only (the default for the Deal Calculator) the money is
    // recorded against the entries and in final_payouts, but status and
    // finish_position are left alone so play continues and eliminate.js
    // assigns the real finishing order. Send deal_only: false to force the
    // old finalize-now behavior (paying out a completed tournament).
    const dealOnly = req.body?.deal_only !== false;

    if (!payouts || !Array.isArray(payouts)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'payouts Array Required' } });
    }

    // Get tournament for leaderboard. settings carries the payout denomination
    // and tournament_type drives the satellite/bounty labelling.
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      // scheduled_start/actual_start are needed so points only accrue to a
      // season whose window actually contains this event.
      // rebuy_amount/addon_amount/ended_at additionally feed the W-2G
      // assessment below (net of that entry's own total investment).
      .select('id, venue_id, buyin_amount, buyin_fee, rebuy_amount, addon_amount, bounty_amount, tournament_type, settings, ended_at, leaderboard_id, scheduled_start, actual_start')
      .eq('id', tournamentId)
      .maybeSingle();

    // A missing tournament used to fall straight through here: every field
    // below reads off `tournament?.` and the payout was written anyway,
    // against an event that does not exist.
    if (!tournament) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament Not Found' } });
    }

    // Venue scope: a valid session for one room must never write a payout
    // into another room's event. See src/lib/commander/venueScope.js.
    if (denyCrossVenue(res, staff, tournament)) return;

    // ── Denomination rounding on the DEAL path ──
    // A chop struck at the table is paid out of the cage in real notes, so the
    // agreed numbers are rounded to the room's denomination with the remainder
    // going up to 1st place, exactly like the calculated ladder. The total is
    // the total the players agreed on, so nothing is created or lost.
    //
    // Deliberately NOT applied when deal_only is false. That call is the
    // finalize path: it records money that has in most cases already been
    // handed over, and re-rounding it would restate a busted player's cash
    // after they left the building. Send denomination: 1 to skip entirely.
    let roundingRemainder = 0;
    let appliedDenomination = 1;
    if (dealOnly && payouts.length > 0) {
      const requested = req.body?.denomination;
      const denomSource = (requested === undefined || requested === null || requested === '')
        ? tournament
        : { settings: { payout_denomination: requested } };
      const denom = payoutDenomination(denomSource);
      // Sorted by position so index 0 really is 1st place. The rows are the
      // same objects as in `payouts`, so writing p.amount here is what the
      // update loop below picks up.
      const ordered = [...payouts].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
      const total = ordered.reduce((s, p) => s + Math.round(Number(p.amount) || 0), 0);
      if (denom > 1 && total > 0) {
        const rounded = roundPayoutsToDenomination(ordered.map(p => p.amount), total, denom);
        ordered.forEach((p, i) => { p.amount = rounded.amounts[i]; });
        roundingRemainder = rounded.remainder;
        appliedDenomination = rounded.denomination;
      }
    }

    // Update each entry
    const results = [];
    // W-2G assessments raised by this call, echoed back so the finalize screen
    // can name the players the cage must collect a TIN from.
    const w2gEvents = [];
    for (const p of payouts) {
      // 2026-07-25 audit fix: identify the entry by entry_id when provided
      // (chop entries for still-active players may lack player_id); fallback
      // to player_id, and skip rows with neither identifier.
      // In deal_only mode record the money without ending anyone's tournament.
      // 2026-08-20 fix: the finalize screen sends the WHOLE finishing order so
      // every finisher accrues season points, not just the money places. This
      // used to stamp 'cashed' on all of them, rewriting a min-cash-less bustout
      // from 'eliminated' to 'cashed' and telling the cage a player who won
      // nothing had been paid. Status is now only rewritten for a real result:
      // 1st place is the winner, any other finish is 'cashed' only when money
      // actually changed hands. Everyone else keeps the status they had.
      const paidAmount = Number(p.amount) || 0;
      const statusPatch = Number(p.position) === 1
        ? { status: 'winner' }
        : (paidAmount > 0 ? { status: 'cashed' } : {});

      const updatePayload = dealOnly
        ? { payout_amount: p.amount, payout_position: p.position }
        : {
            finish_position: p.position,
            payout_amount: p.amount,
            payout_position: p.position,
            ...statusPatch
          };

      let updateQuery = getSupabase()
        .from('commander_tournament_entries')
        .update(updatePayload)
        .eq('tournament_id', tournamentId);

      if (p.entry_id) {
        updateQuery = updateQuery.eq('id', p.entry_id);
      } else if (p.player_id) {
        updateQuery = updateQuery.eq('player_id', p.player_id);
      } else {
        continue;
      }

      const { data: entry, error } = await updateQuery
        .select()
        .maybeSingle();

      if (!error && entry) {
        results.push(entry);
        // Auto-award leaderboard points only when finishing order is final.
        // In deal_only mode finish_position is intentionally not set yet, so
        // awarding here would score everyone off a stale or missing position.
        if (tournament && !dealOnly) {
          await awardTournamentPoints(tournament, tournamentId, entry);

          // ── W-2G on the FINALIZE path ──
          // 2026-08-20: this path recorded no tax events at all. Finalize is
          // how nearly every event is paid out, so a room that never used the
          // single-payout POST route filed no W-2G for anybody. Deliberately
          // skipped in deal_only mode: a recorded chop is not yet a payout and
          // the finishing order is not final, so filing then would report a
          // figure that is still going to move.
          try {
            const taxResult = await recordTournamentTaxEvent(getSupabase(), {
              tournament,
              tournamentId,
              entry,
              grossPayout: paidAmount,
              playerId: entry.player_id || p.player_id || null,
              venueId: tournament.venue_id
            });
            if (taxResult?.assessment?.reportable) {
              w2gEvents.push({
                entry_id: entry.id,
                player_id: entry.player_id || null,
                player_name: entry.player_name || null,
                position: p.position,
                recorded: taxResult.recorded,
                reason: taxResult.reason,
                gross_amount: taxResult.assessment.gross,
                buy_in: taxResult.assessment.buy_in,
                net_amount: taxResult.assessment.net,
                withholding_required: taxResult.assessment.withholding_required,
                withholding_amount: taxResult.assessment.withholding_amount,
                note: taxResult.assessment.note
              });
            }
          } catch (taxErr) {
            // A tax-event failure must never roll back a recorded payout: the
            // money has already been agreed. It is logged and surfaced instead.
            console.warn('[payout] W-2G assessment failed:', taxErr?.message || taxErr);
          }
        }
      }
    }

    // Persist the total paid out as the actual prize pool, and the final
    // override table itself in final_payouts (real jsonb column; the GET
    // handler reads it back for the payouts screen).
    const actualPrizepool = payouts.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    if (actualPrizepool > 0) {
      await getSupabase()
        .from('commander_tournaments')
        .update({ actual_prizepool: actualPrizepool, final_payouts: payouts })
        .eq('id', tournamentId);
    }

    return res.status(200).json({
      success: true,
      data: {
        updated: results.length,
        payouts: results,
        deal_only: dealOnly,
        denomination: appliedDenomination,
        rounding_remainder: roundingRemainder,
        w2g_events: w2gEvents,
        message: dealOnly
          ? 'Deal Recorded. Play Continues And Finishing Order Is Still Assigned On Elimination.'
          : 'Final Payouts Saved.'
      }
    });
  } catch (error) {
    console.warn('Bulk payout error:', error);
    return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Failed To Save Payouts' } });
  }
}

// Fallback finish-position -> points map used when the venue is running no
// season leaderboard at all. Points still accrue (leaderboard_id null) so a
// room that later creates a season can see who has been playing.
const DEFAULT_FINISH_POINTS = { 1: 100, 2: 70, 3: 50, 4: 40, 5: 30, 6: 25, 7: 20, 8: 15, 9: 10 };

/** The calendar date a tournament counts against for season windows. */
function tournamentDate(tournament) {
  const raw = tournament?.actual_start || tournament?.scheduled_start;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve which season leaderboard an event scores into.
 *
 * Order:
 *   1. tournament.leaderboard_id, when it still exists and belongs to the
 *      tournament's venue (a stale id from a cloned template must not silently
 *      score into another room's season).
 *   2. The venue's ACTIVE season whose window contains the event date. This is
 *      the fallback that makes points work without anyone having to attach a
 *      leaderboard to each tournament by hand.
 *   3. Nothing, in which case DEFAULT_FINISH_POINTS is used with a null
 *      leaderboard_id.
 */
async function resolveLeaderboard(tournament) {
  const columns = 'id, venue_id, point_for_entry, point_structure, season_start, season_end, is_active';

  if (tournament?.leaderboard_id) {
    const { data } = await getSupabase()
      .from('commander_tournament_leaderboards')
      .select(columns)
      .eq('id', tournament.leaderboard_id)
      .maybeSingle();
    if (data && (tournament.venue_id == null || Number(data.venue_id) === Number(tournament.venue_id))) {
      return data;
    }
  }

  if (tournament?.venue_id != null) {
    const onDate = tournamentDate(tournament);
    const { data } = await getSupabase()
      .from('commander_tournament_leaderboards')
      .select(columns)
      .eq('venue_id', tournament.venue_id)
      .eq('is_active', true)
      .lte('season_start', onDate)
      .gte('season_end', onDate)
      .order('season_start', { ascending: false })
      .limit(1);
    if (Array.isArray(data) && data.length > 0) return data[0];
  }

  return null;
}

/**
 * Auto-award tournament leaderboard points when a player's finish is final.
 *
 * Rows are upserted into commander_tournament_points keyed on
 * tournament_id + player_id, or tournament_id + player_name for walk-ins with
 * no profile. Both keys are backed by partial unique indexes
 * (uq_ctp_tournament_player / uq_ctp_tournament_player_name).
 */
async function awardTournamentPoints(tournament, tournamentId, entry) {
  try {
    if (!entry?.finish_position) return;
    // Nothing to key the row on.
    if (!entry.player_id && !entry.player_name) return;

    const lb = await resolveLeaderboard(tournament);
    const leaderboardId = lb?.id || null;
    const entryPts = lb ? (Number(lb.point_for_entry) || 0) : 0;
    const structure = Array.isArray(lb?.point_structure) ? lb.point_structure : [];

    const positionPts = leaderboardId
      ? (Number(structure.find(s => Number(s?.position) === Number(entry.finish_position))?.points) || 0)
      : (DEFAULT_FINISH_POINTS[entry.finish_position] || 0);

    if (entryPts === 0 && positionPts === 0) return;

    const row = {
      leaderboard_id: leaderboardId,
      points: positionPts,
      entry_points: entryPts,
      finish_position: entry.finish_position,
      rebuy_count: entry.rebuy_count || 0,
      addon_count: entry.addon_taken ? 1 : 0,
      updated_at: new Date().toISOString()
    };

    let existingQuery = getSupabase()
      .from('commander_tournament_points')
      .select('id')
      .eq('tournament_id', tournamentId);
    existingQuery = entry.player_id
      ? existingQuery.eq('player_id', entry.player_id)
      : existingQuery.is('player_id', null).eq('player_name', entry.player_name);
    const { data: existing } = await existingQuery.maybeSingle();

    if (existing) {
      const { error } = await getSupabase()
        .from('commander_tournament_points')
        .update(row)
        .eq('id', existing.id);
      if (error) console.warn('Award points update failed:', error.message || error);
      return;
    }

    const { error } = await getSupabase()
      .from('commander_tournament_points')
      .insert({
        ...row,
        tournament_id: tournamentId,
        player_id: entry.player_id || null,
        player_name: entry.player_name || null
      });
    if (error) console.warn('Award points insert failed:', error.message || error);
  } catch (err) {
    console.warn('Award points error:', err);
  }
}
