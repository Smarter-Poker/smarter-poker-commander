/**
 * W-2G Assessment For Poker Tournaments
 *
 * THE RULE
 * --------
 * A poker tournament is reportable on NET winnings, not gross. Per the IRS
 * Instructions for Forms W-2G and 5754 ("Poker Tournaments"), the reportable
 * amount is the proceeds the cage hands over MINUS the amount wagered, and the
 * form is required when that NET figure is MORE THAN $5,000.
 *
 * What the code used to do:  gross >= 5000  ->  file a W-2G.
 * What that got wrong:
 *   - A $5,000 min-cash in a $5,000 event nets $0 and is NOT reportable. The
 *     old rule filed a form on it and told the player money was withheld.
 *   - A $5,000 payout in a $100 event nets $4,900 and is NOT reportable
 *     either, because the threshold is "more than $5,000", not "at least".
 *   - Nothing recorded the wager, so the figure on the form was the gross.
 *
 * ONE ENTRY IS ONE WAGER
 * ----------------------
 * The wager subtracted is THAT ENTRY'S OWN investment, not the player's whole
 * day. A re-entry is a separate wager on a separate entry row
 * (commander_tournament_entries.is_reentry / .reentry_of), so a player who
 * fires three bullets and cashes the third deducts only the third bullet.
 * Combining the three would understate the reportable amount, which is the
 * player's job to net out on their own return, not the room's job to net out
 * on the form. Rebuys and add-ons DO belong in the wager: they are additional
 * money placed on the same entry, and total_invested already carries them.
 *
 * BACKUP WITHHOLDING
 * ------------------
 * Regular gambling withholding does not apply to poker tournaments. What DOES
 * apply is 24% BACKUP withholding, and only when the winner does not furnish a
 * correct TIN. There is no TIN/SSN column anywhere in this database (verified
 * against the live schema 2026-08-20: commander_members carries id_type /
 * id_number, which is a photo-ID number, not a taxpayer identification
 * number). We therefore never assert that withholding is required. The event
 * is flagged with a note so the cage collects the TIN at the window and the
 * manager sets withholding on the event if the player refuses.
 *
 * Everything above `recordTournamentTaxEvent` is PURE, so the TD screens can
 * import it to warn a floor before the player leaves the building.
 */

/** Reportable when NET is strictly greater than this. */
export const W2G_NET_THRESHOLD = 5000;

/** Backup withholding rate when no TIN is furnished. */
export const FEDERAL_BACKUP_WITHHOLDING_RATE = 0.24;

/**
 * FALSE until a TIN column exists. Kept as an exported flag rather than a
 * magic false so the day a TIN field is added there is exactly one place to
 * flip, and every screen picks the change up.
 */
export const TIN_ON_FILE_SUPPORTED = false;

export const NO_TIN_NOTE =
  'Net Of Buy-In Under IRS W-2G Rules. No Taxpayer Identification Number Is Stored By This System, ' +
  'So Backup Withholding Was Not Applied Automatically. Collect The Player TIN At The Window And ' +
  'Apply 24% Backup Withholding Manually If It Is Refused.';

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Rounded to cents, which is what the numeric columns hold. */
function money(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

/**
 * What THIS ENTRY wagered.
 *
 * commander_tournament_entries.total_invested is maintained by a DB trigger
 * and is the authoritative figure. It is only derived from the tournament
 * prices when the column is missing or zero, which happens on rows written
 * before the trigger existed. Deriving is never allowed to silently disagree
 * with a real stored value.
 *
 * @param {object} tournament
 * @param {object} entry
 * @returns {number}
 */
export function entryTotalInvested(tournament, entry) {
  const stored = toNumber(entry?.total_invested, 0);
  if (stored > 0) return money(stored);

  const buyin = Math.max(0, toNumber(tournament?.buyin_amount, 0));
  const fee = Math.max(0, toNumber(tournament?.buyin_fee, 0));
  const rebuyAmount = Math.max(0, toNumber(tournament?.rebuy_amount, 0));
  const addonAmount = Math.max(0, toNumber(tournament?.addon_amount, 0));
  const rebuys = Math.max(0, toNumber(entry?.rebuy_count, 0));
  const addons = entry?.addon_taken ? 1 : 0;

  return money(buyin + fee + (rebuys * rebuyAmount) + (addons * addonAmount));
}

/**
 * Assess one payout against the W-2G rule.
 *
 * @param {object}  args
 * @param {number}  args.grossPayout    what the cage hands over.
 * @param {number}  args.totalInvested  what this entry wagered.
 * @param {boolean|null} [args.hasTin]  true/false when known, null when the
 *                                      system cannot know (the current state).
 * @returns {{
 *   gross: number, buy_in: number, net: number, reportable: boolean,
 *   threshold: number, withholding_required: boolean,
 *   withholding_rate: number, withholding_amount: number,
 *   tin_status: 'on_file'|'missing'|'unknown', note: string|null
 * }}
 */
export function assessW2G({ grossPayout, totalInvested, hasTin = null }) {
  const gross = money(Math.max(0, toNumber(grossPayout, 0)));
  const buyIn = money(Math.max(0, toNumber(totalInvested, 0)));
  const net = money(gross - buyIn);
  const reportable = net > W2G_NET_THRESHOLD;

  const tinKnown = TIN_ON_FILE_SUPPORTED && (hasTin === true || hasTin === false);
  const tinStatus = tinKnown ? (hasTin ? 'on_file' : 'missing') : 'unknown';

  // Only a KNOWN missing TIN triggers backup withholding. Unknown never does:
  // withholding money from a player on a guess is worse than filing the form
  // and collecting the TIN at the window.
  const withholdingRequired = reportable && tinStatus === 'missing';
  const withholdingRate = withholdingRequired ? FEDERAL_BACKUP_WITHHOLDING_RATE : 0;
  const withholdingAmount = withholdingRequired ? money(net * FEDERAL_BACKUP_WITHHOLDING_RATE) : 0;

  return {
    gross,
    buy_in: buyIn,
    net,
    reportable,
    threshold: W2G_NET_THRESHOLD,
    withholding_required: withholdingRequired,
    withholding_rate: withholdingRate,
    withholding_amount: withholdingAmount,
    tin_status: tinStatus,
    note: reportable && tinStatus === 'unknown' ? NO_TIN_NOTE : null
  };
}

/** Assess an entry row directly. Convenience for the TD screens and reports. */
export function assessEntryW2G(tournament, entry, grossPayoutOverride) {
  const gross = grossPayoutOverride !== undefined && grossPayoutOverride !== null
    ? grossPayoutOverride
    : entry?.payout_amount;
  return assessW2G({
    grossPayout: gross,
    totalInvested: entryTotalInvested(tournament, entry)
  });
}

/** The calendar date a tournament's tax events fall on. */
export function taxEventDate(tournament) {
  const raw = tournament?.ended_at || tournament?.actual_start || tournament?.scheduled_start;
  const d = raw ? new Date(raw) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist/i.test(message) ||
    /could not find the .* column/i.test(message);
}

/**
 * Record a tournament W-2G tax event, once.
 *
 * Writes gross_amount, buy_in and net_amount, sets event_date (the list API
 * filters on it, so an event written with a NULL date was invisible in the tax
 * compliance screen), and links the event to the tournament and the entry when
 * those columns exist.
 *
 * tournament_id / entry_id arrive with migration
 * 20260821160000_commander_tax_events_tournament_link.sql. The insert probes
 * for them and retries without, so a deploy that lands before the migration
 * still records the event rather than failing the payout that triggered it.
 *
 * NOTHING IS BACKFILLED. Historic tax events are left exactly as written.
 *
 * @returns {Promise<{recorded:boolean, reason:string, assessment:object, event:object|null}>}
 */
export async function recordTournamentTaxEvent(supabase, {
  tournament, tournamentId, entry, grossPayout, playerId, venueId
}) {
  const assessment = assessEntryW2G(tournament, entry, grossPayout);

  if (!assessment.reportable) {
    return { recorded: false, reason: 'below_threshold', assessment, event: null };
  }

  const resolvedVenueId = venueId ?? tournament?.venue_id ?? null;
  const resolvedPlayerId = playerId ?? entry?.player_id ?? null;
  const resolvedTournamentId = tournamentId ?? tournament?.id ?? null;
  const eventDate = taxEventDate(tournament);

  const row = {
    venue_id: resolvedVenueId,
    player_id: resolvedPlayerId,
    event_type: 'tournament_win',
    event_date: eventDate,
    gross_amount: assessment.gross,
    buy_in: assessment.buy_in,
    net_amount: assessment.net,
    withholding_required: assessment.withholding_required,
    withholding_rate: assessment.withholding_rate || null,
    withholding_amount: assessment.withholding_amount || null,
    notes: assessment.note
  };

  const linked = {
    ...row,
    tournament_id: resolvedTournamentId,
    entry_id: entry?.id || null
  };

  // ── Dedupe ──
  // Finalize can legitimately be pressed twice. Without this, the second press
  // files a second W-2G against the same player for the same event.
  try {
    let existing = null;
    if (resolvedTournamentId && entry?.id) {
      const { data, error } = await supabase
        .from('commander_tax_events')
        .select('id')
        .eq('tournament_id', resolvedTournamentId)
        .eq('entry_id', entry.id)
        .maybeSingle();
      if (!error) existing = data;
      else if (!isMissingColumnError(error)) {
        console.warn('[taxEvents] dedupe lookup failed:', error.message || error);
      }
    }
    if (!existing) {
      // Fallback key for a schema without the link columns, and for walk-ins
      // with no player_id: same venue, same day, same gross, same type.
      let q = supabase
        .from('commander_tax_events')
        .select('id')
        .eq('event_type', 'tournament_win')
        .eq('event_date', eventDate)
        .eq('gross_amount', assessment.gross);
      q = resolvedVenueId != null ? q.eq('venue_id', resolvedVenueId) : q.is('venue_id', null);
      q = resolvedPlayerId ? q.eq('player_id', resolvedPlayerId) : q.is('player_id', null);
      const { data, error } = await q.limit(1).maybeSingle();
      if (!error) existing = data;
    }
    if (existing) {
      return { recorded: false, reason: 'already_recorded', assessment, event: existing };
    }
  } catch (err) {
    console.warn('[taxEvents] dedupe check threw:', err?.message || err);
  }

  let { data, error } = await supabase
    .from('commander_tax_events')
    .insert(linked)
    .select()
    .maybeSingle();

  if (error && isMissingColumnError(error)) {
    ({ data, error } = await supabase
      .from('commander_tax_events')
      .insert(row)
      .select()
      .maybeSingle());
  }

  if (error) {
    console.warn('[taxEvents] insert failed:', error.message || error);
    return { recorded: false, reason: 'insert_failed', assessment, event: null };
  }

  return { recorded: true, reason: 'recorded', assessment, event: data || null };
}
