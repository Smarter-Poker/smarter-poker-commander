/**
 * Blind Structure Validation
 *
 * One shared rule set for every surface that can write a blind structure:
 * the tournament settings screen, the BlindStructureEditor, the create API
 * (pages/api/tournaments/index.js) and the update API
 * (pages/api/tournaments/[id].js).
 *
 * WHY THIS EXISTS
 * Nothing used to stop a structure where the blinds went DOWN, the ante was
 * bigger than the big blind, a level ran for 0 minutes, or the very first row
 * was a break. Every one of those silently breaks the clock: the level-up
 * handler advances into a row it cannot read, the display shows a level that
 * is smaller than the one before it, and a 0-minute level rolls the clock
 * forward forever. A tournament is unrecoverable at that point.
 *
 * SHAPE OF A STRUCTURE
 * Playing levels and breaks live in ONE array, in order:
 *   { level, small_blind, big_blind, ante, duration }
 *   { is_break: true, duration, label }
 * The duration key is `duration` on newer rows and `duration_minutes` on older
 * ones, so every read goes through levelDuration().
 *
 * SEVERITY
 *   'error'   -> blocks the save. The structure is broken, not unusual.
 *   'warning' -> shown, does not block. Legitimate structures (turbos, deep
 *                stacks, non-standard blind ladders) trip these on purpose.
 */

// Warning thresholds. Deliberately wide: a real turbo runs 8-minute levels and
// a deep-stack live event runs 90, and neither is a mistake.
export const MIN_REASONABLE_DURATION = 5;
export const MAX_REASONABLE_DURATION = 120;
export const MAX_REASONABLE_JUMP = 2.5;
// A structure longer than this with no break at all is almost certainly an
// oversight rather than a design choice.
export const BREAKLESS_LEVEL_THRESHOLD = 8;

/**
 * Duration in minutes for a level or break row, tolerating both key names.
 * Returns null when the row carries no usable duration at all, which is a
 * different thing from a duration of 0.
 */
export function levelDuration(row) {
  if (!row || typeof row !== 'object') return null;
  const raw = row.duration != null ? row.duration : row.duration_minutes;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Accept an array, or a JSON string holding one, and return an array.
 * Anything else becomes an empty array so callers only handle one shape.
 */
export function coerceStructure(structure) {
  let s = structure;
  if (typeof s === 'string') {
    try { s = JSON.parse(s); } catch { s = null; }
  }
  return Array.isArray(s) ? s : [];
}

function isBreakRow(row) {
  return !!(row && row.is_break);
}

/**
 * Legacy key aliases seen in production (verified 2026-08-20: 12 stored
 * structures use { big, small } instead of { big_blind, small_blind }).
 * Nothing in the app reads those keys, so those events display 0/0 blinds on
 * the clock and open with empty inputs in the settings screen. Normalising
 * here means the validator does not raise a false "no big blind" error, and
 * any screen that loads through normalizeStructure writes the canonical keys
 * back on the next save, which repairs the row.
 */
const BIG_BLIND_ALIASES = ['big_blind', 'big', 'bb', 'bigBlind'];
const SMALL_BLIND_ALIASES = ['small_blind', 'small', 'sb', 'smallBlind'];

function firstDefined(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** Canonical copy of one row. Unknown keys are preserved, never dropped. */
export function normalizeLevel(row) {
  if (!row || typeof row !== 'object') return row;
  if (isBreakRow(row)) {
    const d = levelDuration(row);
    return { ...row, ...(d != null && row.duration === undefined ? { duration: d } : {}) };
  }

  const bb = firstDefined(row, BIG_BLIND_ALIASES);
  const sb = firstDefined(row, SMALL_BLIND_ALIASES);
  const d = levelDuration(row);

  return {
    ...row,
    ...(bb !== undefined ? { big_blind: Number(bb) } : {}),
    ...(sb !== undefined ? { small_blind: Number(sb) } : {}),
    ...(d != null && row.duration === undefined ? { duration: d } : {}),
  };
}

/** Canonical copy of a whole structure. */
export function normalizeStructure(structure) {
  return coerceStructure(structure).map(normalizeLevel);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Validate a blind structure.
 *
 * @param {Array|string} structure - the level/break array (or JSON of one)
 * @returns {{
 *   valid: boolean,
 *   errors: Array<{ level_index: number|null, code: string, message: string, severity: 'error'|'warning' }>,
 *   summary: { playing_levels: number, breaks: number, total_minutes: number, first_break_after: number|null }
 * }}
 *
 * `valid` is false ONLY when at least one entry has severity 'error'.
 * Warnings are returned in the same array so a caller can render them inline
 * against the level they belong to.
 */
export function validateBlindStructure(structure) {
  // Normalised first so a legacy { big, small } row is judged on its actual
  // blinds rather than reported as having none.
  const rows = normalizeStructure(structure);
  const errors = [];

  const push = (level_index, code, message, severity) => {
    errors.push({ level_index, code, message, severity });
  };

  // ── Summary (computed even for a broken structure, so the UI can still
  //    render the header while the errors are being fixed) ──────────────────
  let playingLevels = 0;
  let breaks = 0;
  let totalMinutes = 0;
  let firstBreakAfter = null;

  rows.forEach((row) => {
    const d = levelDuration(row);
    if (d != null && d > 0) totalMinutes += d;
    if (isBreakRow(row)) {
      breaks += 1;
      if (firstBreakAfter === null) firstBreakAfter = playingLevels;
    } else {
      playingLevels += 1;
    }
  });

  const summary = {
    playing_levels: playingLevels,
    breaks,
    total_minutes: totalMinutes,
    first_break_after: firstBreakAfter,
  };

  // ── ERROR: nothing to play ───────────────────────────────────────────────
  if (rows.length === 0) {
    push(null, 'EMPTY_STRUCTURE', 'The Blind Structure Is Empty. Add At Least One Playing Level.', 'error');
    return { valid: false, errors, summary };
  }

  if (playingLevels === 0) {
    push(null, 'NO_PLAYING_LEVELS', 'The Structure Has No Playing Levels, Only Breaks.', 'error');
  }

  // ── ERROR: a break cannot be the very first row ──────────────────────────
  // The clock starts on row 0. Starting on a break means the event opens on a
  // break nobody called, and the first playing level never gets announced.
  if (isBreakRow(rows[0])) {
    push(0, 'BREAK_FIRST', 'A Break Cannot Be The First Row. Level 1 Must Be A Playing Level.', 'error');
  }

  // ── Per-row checks ───────────────────────────────────────────────────────
  let previousPlaying = null;
  let playingSeen = 0;

  rows.forEach((row, index) => {
    const isBreak = isBreakRow(row);
    const duration = levelDuration(row);
    const label = isBreak
      ? (row.label || 'Break')
      : `Level ${row.level != null ? row.level : playingSeen + 1}`;

    // Duration applies to breaks and playing levels alike. A 0-minute row
    // makes the clock roll straight through it, over and over.
    if (duration === null) {
      push(index, 'MISSING_DURATION', `${label} Has No Duration. Set The Length In Minutes.`, 'error');
    } else if (duration <= 0) {
      push(index, 'ZERO_DURATION', `${label} Has A Duration Of ${duration.toLocaleString()} Minutes. It Must Be At Least 1 Minute.`, 'error');
    } else {
      if (duration < MIN_REASONABLE_DURATION) {
        push(index, 'SHORT_DURATION', `${label} Runs Only ${duration.toLocaleString()} Minutes. Confirm That Is Intended.`, 'warning');
      }
      if (duration > MAX_REASONABLE_DURATION) {
        push(index, 'LONG_DURATION', `${label} Runs ${duration.toLocaleString()} Minutes. Confirm That Is Intended.`, 'warning');
      }
    }

    if (isBreak) return;

    playingSeen += 1;

    const sb = num(row.small_blind);
    const bb = num(row.big_blind);
    const ante = num(row.ante);

    // Blinds have to be real numbers above zero, or the table has no bets.
    if (bb <= 0) {
      push(index, 'INVALID_BIG_BLIND', `${label} Has No Big Blind. Enter A Big Blind Above Zero.`, 'error');
    }
    if (sb <= 0) {
      push(index, 'INVALID_SMALL_BLIND', `${label} Has No Small Blind. Enter A Small Blind Above Zero.`, 'error');
    }

    // The small blind is by definition the smaller of the two.
    if (sb > 0 && bb > 0 && sb > bb) {
      push(index, 'SMALL_BLIND_EXCEEDS_BIG', `${label}: Small Blind ${sb.toLocaleString()} Is Larger Than Big Blind ${bb.toLocaleString()}.`, 'error');
    }

    // An ante bigger than the big blind is a typo in every real structure.
    if (ante > 0 && bb > 0 && ante > bb) {
      push(index, 'ANTE_EXCEEDS_BIG_BLIND', `${label}: Ante ${ante.toLocaleString()} Is Larger Than The Big Blind ${bb.toLocaleString()}.`, 'error');
    }

    if (previousPlaying) {
      const prevBb = num(previousPlaying.big_blind);

      // Blinds must go UP. Equal counts as broken too: two identical levels
      // in a row means the ladder stalls and the clock has nothing to raise.
      if (bb > 0 && prevBb > 0 && bb <= prevBb) {
        push(
          index,
          'BLINDS_NOT_INCREASING',
          `${label}: Big Blind ${bb.toLocaleString()} Is Not Higher Than The Previous Level's ${prevBb.toLocaleString()}.`,
          'error'
        );
      } else if (bb > 0 && prevBb > 0 && bb > prevBb * MAX_REASONABLE_JUMP) {
        const factor = (bb / prevBb).toFixed(1);
        push(
          index,
          'LARGE_BLIND_JUMP',
          `${label}: Big Blind Jumps ${factor}x From ${prevBb.toLocaleString()} To ${bb.toLocaleString()}. Confirm That Is Intended.`,
          'warning'
        );
      }
    }

    // Non-multiple big blinds are legal but awkward at the table (they force
    // odd change on every blind post), so this warns rather than blocks.
    if (sb > 0 && bb > 0 && bb % sb !== 0) {
      push(
        index,
        'BIG_BLIND_NOT_MULTIPLE',
        `${label}: Big Blind ${bb.toLocaleString()} Is Not A Multiple Of Small Blind ${sb.toLocaleString()}.`,
        'warning'
      );
    }

    previousPlaying = row;
  });

  // ── WARNING: a long structure with no break at all ───────────────────────
  if (breaks === 0 && playingLevels > BREAKLESS_LEVEL_THRESHOLD) {
    push(
      null,
      'NO_BREAKS',
      `${playingLevels.toLocaleString()} Levels With No Break. Add A Break So The Room Can Colour Up And The Dealers Can Rotate.`,
      'warning'
    );
  }

  const valid = !errors.some(e => e.severity === 'error');
  return { valid, errors, summary };
}

/** Only the blocking entries. */
export function structureErrors(result) {
  return (result?.errors || []).filter(e => e.severity === 'error');
}

/** Only the advisory entries. */
export function structureWarnings(result) {
  return (result?.errors || []).filter(e => e.severity === 'warning');
}

/**
 * One-line summary of the blocking problems, for an API error message.
 * Capped so a 40-level structure with a systematic mistake cannot produce a
 * multi-kilobyte error string.
 */
export function describeStructureErrors(result, max = 4) {
  const hard = structureErrors(result);
  if (hard.length === 0) return '';
  const shown = hard.slice(0, max).map(e => e.message).join(' ');
  return hard.length > max
    ? `${shown} And ${(hard.length - max).toLocaleString()} More Problem${hard.length - max === 1 ? '' : 's'}.`
    : shown;
}

/**
 * API-side gate, shared by tournament create and tournament update.
 *
 * The older validateTournamentPayload check only asks "is this an array with a
 * playing level in it". This asks whether the structure can actually be RUN:
 * blinds that go up, antes under the big blind, real durations, no break on
 * row one. A structure that fails any of those breaks the clock the moment the
 * event starts, and there is no clean way to fix it mid-event.
 *
 * @returns {null|{ code: string, message: string, errors: Array }}
 *   null when the structure is acceptable (warnings never block), otherwise
 *   the body for a 400 `error` envelope.
 */
export function structureRejection(blindStructure) {
  if (blindStructure === undefined || blindStructure === null) return null;
  const rows = coerceStructure(blindStructure);
  // An empty/unparseable structure is reported by the shape check instead, so
  // the caller does not get two different errors for the same mistake.
  if (rows.length === 0) return null;

  const result = validateBlindStructure(rows);
  if (result.valid) return null;

  return {
    code: 'INVALID_BLIND_STRUCTURE',
    message: describeStructureErrors(result),
    // Per-level detail so the editor can highlight the offending rows instead
    // of showing one flat sentence.
    errors: structureErrors(result)
  };
}

export default validateBlindStructure;
