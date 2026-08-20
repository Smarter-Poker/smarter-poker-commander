/**
 * Bounty and Progressive Knockout (PKO) accounting.
 *
 * Until now a knockout only did `bounties_collected += 1`. Nothing recorded
 * what a knockout was WORTH, so the cage had no figure to pay against, a PKO
 * head never grew, and undoing a bust could not put the money back.
 *
 * Two modes, both driven off tournament_type:
 *
 *   bounty  Every knockout pays the fixed tournament.bounty_amount in cash.
 *           Every head is worth the same all event.
 *
 *   pko     Every player carries a bounty. A knockout pays the eliminator HALF
 *           the busted player's head in cash and adds the other HALF to the
 *           eliminator's own head, so the bounty money in play is conserved
 *           exactly (see pkoSplit, which works in cents).
 *
 * Storage: commander_tournament_entries.bounty_value (what is on this
 * player's head right now) and .bounty_winnings (cash won from knockouts).
 * Those columns arrive with migration
 * 20260821130000_commander_entry_bounty_columns.sql. Everything here probes for
 * them once per process and falls back to the metadata jsonb, so the code is
 * correct both before and after the migration lands.
 *
 * All of the money maths is pure and lives in
 * pages/api/tournaments/[id]/payout.js, shared with the payout screens.
 */
import {
  bountyAwardFor,
  pkoStartingBounty
} from '../../../pages/api/tournaments/[id]/payout';

const WIDE_COLUMNS = 'id, player_id, player_name, status, bounties_collected, bounty_value, bounty_winnings, metadata';
const LEGACY_COLUMNS = 'id, player_id, player_name, status, bounties_collected, metadata';

// null = not probed yet, true/false = known. Probed once per process against
// the live schema rather than assumed, so a deploy that lands before the
// migration does not start throwing on every bust.
let _hasBountyColumns = null;

function isMissingColumnError(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === '42703' ||
    code === 'PGRST204' ||
    /column .* does not exist/i.test(message) ||
    /could not find the .* column/i.test(message);
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function metadataOf(row) {
  return (row && typeof row.metadata === 'object' && row.metadata) ? row.metadata : {};
}

/** Rounded to cents, which is what the numeric columns hold. */
function money(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

/**
 * The bounty a player starts with on their head when nothing has been
 * recorded yet.
 *   pko    : the buy-in slice that funded it (pkoStartingBounty)
 *   bounty : the flat tournament.bounty_amount
 */
export function defaultBountyValue(tournament) {
  const type = String(tournament?.tournament_type || '').trim().toLowerCase();
  if (type === 'pko') return money(pkoStartingBounty(tournament));
  if (type === 'bounty') return money(Math.max(0, toNumber(tournament?.bounty_amount, 0)));
  return 0;
}

/**
 * What is on this entry's head right now.
 * Column first, metadata fallback, then the tournament default. Never null.
 */
export function entryBountyValue(tournament, entry) {
  if (entry && entry.bounty_value !== null && entry.bounty_value !== undefined) {
    return money(Math.max(0, toNumber(entry.bounty_value, 0)));
  }
  const meta = metadataOf(entry).bounty_value;
  if (meta !== null && meta !== undefined) {
    return money(Math.max(0, toNumber(meta, 0)));
  }
  return defaultBountyValue(tournament);
}

/** Cash this entry has won from knockouts. Column first, metadata fallback. */
export function entryBountyWinnings(entry) {
  if (entry && entry.bounty_winnings !== null && entry.bounty_winnings !== undefined) {
    return money(Math.max(0, toNumber(entry.bounty_winnings, 0)));
  }
  return money(Math.max(0, toNumber(metadataOf(entry).bounty_winnings, 0)));
}

/** True when this tournament pays knockouts at all. */
export function hasBounties(tournament) {
  const type = String(tournament?.tournament_type || '').trim().toLowerCase();
  if (type === 'pko') return pkoStartingBounty(tournament) > 0;
  if (type === 'bounty') return toNumber(tournament?.bounty_amount, 0) > 0;
  return false;
}

/**
 * Read an entry with its bounty state, probing once for the new columns.
 * Returns { row, hasColumns } and never throws on a missing column.
 */
export async function readEntryBountyState(supabase, { entryId, tournamentId }) {
  if (!entryId) return { row: null, hasColumns: _hasBountyColumns === true };

  const query = (columns) => {
    let q = supabase
      .from('commander_tournament_entries')
      .select(columns)
      .eq('id', entryId);
    if (tournamentId) q = q.eq('tournament_id', tournamentId);
    return q.maybeSingle();
  };

  if (_hasBountyColumns !== false) {
    const { data, error } = await query(WIDE_COLUMNS);
    if (!error) {
      _hasBountyColumns = true;
      return { row: data || null, hasColumns: true };
    }
    if (!isMissingColumnError(error)) {
      console.warn('[tournamentBounty] entry read failed:', error.message || error);
      return { row: null, hasColumns: _hasBountyColumns === true };
    }
    _hasBountyColumns = false;
  }

  const { data, error } = await query(LEGACY_COLUMNS);
  if (error) {
    console.warn('[tournamentBounty] legacy entry read failed:', error.message || error);
    return { row: null, hasColumns: false };
  }
  return { row: data || null, hasColumns: false };
}

/**
 * Write bounty state onto an entry, using the columns when they exist and the
 * metadata jsonb when they do not.
 *
 * @param {object} patch { bounty_value?, bounty_winnings?, bounties_collected? }
 * @param {object} metaPatch extra keys merged into metadata either way.
 */
async function writeEntryBounty(supabase, { entryId, tournamentId, row, patch, metaPatch }) {
  const baseMeta = { ...metadataOf(row), ...(metaPatch || {}) };

  const run = async (payload) => {
    let q = supabase
      .from('commander_tournament_entries')
      .update(payload)
      .eq('id', entryId);
    if (tournamentId) q = q.eq('tournament_id', tournamentId);
    return q;
  };

  if (_hasBountyColumns !== false) {
    const payload = { metadata: baseMeta };
    if (patch.bounties_collected !== undefined) payload.bounties_collected = patch.bounties_collected;
    if (patch.bounty_value !== undefined) payload.bounty_value = patch.bounty_value;
    if (patch.bounty_winnings !== undefined) payload.bounty_winnings = patch.bounty_winnings;

    const { error } = await run(payload);
    if (!error) return true;
    if (!isMissingColumnError(error)) {
      console.warn('[tournamentBounty] bounty write failed:', error.message || error);
      return false;
    }
    _hasBountyColumns = false;
  }

  // Pre-migration fallback: the numbers live in metadata so no money is lost.
  // entryBountyValue/entryBountyWinnings read them back from here.
  const meta = { ...baseMeta };
  if (patch.bounty_value !== undefined) meta.bounty_value = patch.bounty_value;
  if (patch.bounty_winnings !== undefined) meta.bounty_winnings = patch.bounty_winnings;

  const payload = { metadata: meta };
  if (patch.bounties_collected !== undefined) payload.bounties_collected = patch.bounties_collected;

  const { error } = await run(payload);
  if (error) {
    console.warn('[tournamentBounty] metadata bounty write failed:', error.message || error);
    return false;
  }
  return true;
}

/**
 * Pay a knockout.
 *
 * MUST be called AFTER the race-guarded elimination write, exactly where the
 * old bounties_collected bump sat. Of two racing busts only one gets past the
 * guard, so only one can ever reach here and a double-tap cannot pay twice.
 *
 * @returns {Promise<null | {
 *   mode:'bounty'|'pko', awarded:boolean, cash:number, to_head:number,
 *   head_claimed:number, eliminator_bounty_value:number,
 *   eliminator_bounty_winnings:number, bounties_collected:number
 * }>}
 */
export async function applyKnockoutBounty(supabase, {
  tournament, tournamentId, bustedEntry, eliminatorEntryId
}) {
  if (!hasBounties(tournament)) return null;

  const bustedHead = entryBountyValue(tournament, bustedEntry);
  const award = bountyAwardFor(tournament, bustedHead);
  if (!award) return null;

  if (!eliminatorEntryId) {
    // Nobody was credited with the knockout. The head is deliberately left on
    // the busted entry so a TD correction can still find and award it.
    return {
      mode: award.mode, awarded: false, cash: 0, to_head: 0,
      head_claimed: bustedHead,
      eliminator_bounty_value: 0, eliminator_bounty_winnings: 0,
      bounties_collected: 0
    };
  }

  const { row: eliminator } = await readEntryBountyState(supabase, {
    entryId: eliminatorEntryId, tournamentId
  });
  if (!eliminator) {
    return {
      mode: award.mode, awarded: false, cash: 0, to_head: 0,
      head_claimed: bustedHead,
      eliminator_bounty_value: 0, eliminator_bounty_winnings: 0,
      bounties_collected: 0
    };
  }

  const nextWinnings = money(entryBountyWinnings(eliminator) + award.cash);
  const nextHead = money(entryBountyValue(tournament, eliminator) + award.to_head);
  const nextCount = Math.max(0, toNumber(eliminator.bounties_collected, 0)) + 1;
  const now = new Date().toISOString();

  const ok = await writeEntryBounty(supabase, {
    entryId: eliminatorEntryId,
    tournamentId,
    row: eliminator,
    patch: {
      bounties_collected: nextCount,
      bounty_value: nextHead,
      bounty_winnings: nextWinnings
    },
    metaPatch: { last_bounty_at: now }
  });

  if (!ok) {
    return {
      mode: award.mode, awarded: false, cash: 0, to_head: 0,
      head_claimed: bustedHead,
      eliminator_bounty_value: 0, eliminator_bounty_winnings: 0,
      bounties_collected: 0
    };
  }

  // The busted head has been claimed. Zero it so a later correction cannot
  // pay the same head twice, and record what it was worth so an elimination
  // undo can put it back exactly.
  if (bustedEntry?.id) {
    await writeEntryBounty(supabase, {
      entryId: bustedEntry.id,
      tournamentId,
      row: bustedEntry,
      patch: { bounty_value: 0 },
      metaPatch: {
        bounty_claimed_value: bustedHead,
        bounty_claimed_by: eliminatorEntryId,
        bounty_claimed_at: now
      }
    });
  }

  return {
    mode: award.mode,
    awarded: true,
    cash: award.cash,
    to_head: award.to_head,
    head_claimed: bustedHead,
    eliminator_bounty_value: nextHead,
    eliminator_bounty_winnings: nextWinnings,
    bounties_collected: nextCount
  };
}

/**
 * Undo a knockout payment (elimination undo).
 *
 * Takes the cash back off the eliminator, takes the half-head back off their
 * bounty, and puts the claimed head back on the restored player. Every figure
 * is floored at 0 so a partially-recorded historic bust cannot drive a balance
 * negative.
 *
 * @returns {Promise<null | { mode:string, reversed:boolean, cash:number,
 *   to_head:number, head_restored:number }>}
 */
export async function reverseKnockoutBounty(supabase, {
  tournament, tournamentId, restoredEntry, eliminatorEntryId
}) {
  if (!hasBounties(tournament)) return null;

  const meta = metadataOf(restoredEntry);
  // What the head was worth at the moment it was claimed. Falls back to the
  // tournament default for busts recorded before this bookkeeping existed.
  const claimed = (meta.bounty_claimed_value !== null && meta.bounty_claimed_value !== undefined)
    ? money(Math.max(0, toNumber(meta.bounty_claimed_value, 0)))
    : defaultBountyValue(tournament);

  const award = bountyAwardFor(tournament, claimed);
  if (!award) return null;

  let reversed = false;

  if (eliminatorEntryId) {
    const { row: eliminator } = await readEntryBountyState(supabase, {
      entryId: eliminatorEntryId, tournamentId
    });
    if (eliminator) {
      const nextWinnings = money(Math.max(0, entryBountyWinnings(eliminator) - award.cash));
      const nextHead = money(Math.max(0, entryBountyValue(tournament, eliminator) - award.to_head));
      const nextCount = Math.max(0, toNumber(eliminator.bounties_collected, 0) - 1);

      reversed = await writeEntryBounty(supabase, {
        entryId: eliminatorEntryId,
        tournamentId,
        row: eliminator,
        patch: {
          bounties_collected: nextCount,
          bounty_value: nextHead,
          bounty_winnings: nextWinnings
        },
        metaPatch: { last_bounty_reversed_at: new Date().toISOString() }
      });
    }
  }

  // Put the head back on the restored player either way: they are in the
  // tournament again, so somebody can win it.
  if (restoredEntry?.id) {
    const restoreMeta = { ...meta };
    delete restoreMeta.bounty_claimed_value;
    delete restoreMeta.bounty_claimed_by;
    delete restoreMeta.bounty_claimed_at;

    await writeEntryBounty(supabase, {
      entryId: restoredEntry.id,
      tournamentId,
      row: { ...restoredEntry, metadata: restoreMeta },
      patch: { bounty_value: claimed },
      metaPatch: {}
    });
  }

  return {
    mode: award.mode,
    reversed,
    cash: award.cash,
    to_head: award.to_head,
    head_restored: claimed
  };
}

/** Test seam: forget the probed column state. */
export function _resetBountyColumnProbe() {
  _hasBountyColumns = null;
}
