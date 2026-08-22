/**
 * Database Error Helpers
 *
 * WHY THIS EXISTS
 * ---------------
 * Production now carries two PARTIAL UNIQUE indexes on
 * commander_tournament_entries:
 *
 *   uq_commander_entries_live_seat
 *     (tournament_id, table_number, seat_number)
 *     WHERE status IN ('registered','seated','active')
 *       AND table_number IS NOT NULL AND seat_number IS NOT NULL
 *
 *   uq_commander_entries_finish_position
 *     (tournament_id, finish_position) WHERE finish_position IS NOT NULL
 *
 * The database now REJECTS a double-booked chair and a duplicate finishing
 * place instead of quietly accepting them. That is the right behaviour, but it
 * means any write that touches table_number / seat_number / finish_position can
 * come back as Postgres error 23505 (unique_violation). Left alone, PostgREST
 * hands that to the route as a plain error and the floor sees an opaque 500
 * with no idea what to do next.
 *
 * Every such route funnels the error through here instead, so the TD always
 * gets the same actionable 409 with a Title Case message.
 *
 * BATCH ROUTES: a single row's 23505 must never abort the whole batch. Use
 * rowConflict() to record the row and keep going, then report how many
 * succeeded and how many collided.
 */

export const UNIQUE_VIOLATION = '23505';

// Index names as created in production. Matched against the error text so the
// message can name the real problem (a taken chair vs a taken finishing place).
const LIVE_SEAT_INDEX = 'uq_commander_entries_live_seat';
const FINISH_POSITION_INDEX = 'uq_commander_entries_finish_position';

/**
 * PostgREST spreads the detail across message/details/hint/constraint depending
 * on the version and the statement. Flatten them all before matching.
 */
function errorText(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  return [error.message, error.details, error.hint, error.constraint, error.constraint_name]
    .filter(Boolean)
    .join(' ');
}

/**
 * True when the write was rejected by a unique index.
 * The text fallback matters: an error raised inside an RPC surfaces the
 * violation text without always preserving the 23505 SQLSTATE.
 */
export function isUniqueViolation(error) {
  if (!error) return false;
  if (error.code === UNIQUE_VIOLATION) return true;
  return /duplicate key value violates unique constraint/i.test(errorText(error));
}

/**
 * 'seat' | 'finish_position' | 'unknown' | null (not a unique violation).
 */
export function uniqueViolationKind(error) {
  if (!isUniqueViolation(error)) return null;
  const text = errorText(error);
  if (text.includes(LIVE_SEAT_INDEX)) return 'seat';
  if (text.includes(FINISH_POSITION_INDEX)) return 'finish_position';
  return 'unknown';
}

const CODE_BY_KIND = {
  seat: 'SEAT_OCCUPIED',
  finish_position: 'FINISH_POSITION_TAKEN',
  unknown: 'WRITE_CONFLICT'
};

/**
 * Envelope error code for a rejected write. Falls back to DB_ERROR so a caller
 * can use this helper for every failure path, not just collisions.
 */
export function conflictCode(error) {
  const kind = uniqueViolationKind(error);
  return kind ? CODE_BY_KIND[kind] : 'DB_ERROR';
}

/**
 * Human message for the floor. Title Case, no em dashes, always says what to
 * do next.
 *
 * context: { tableNumber, seatNumber, playerName, finishPosition, action }
 */
export function conflictMessage(error, context = {}) {
  const kind = uniqueViolationKind(error);
  const { tableNumber, seatNumber, playerName, finishPosition, action } = context;

  if (kind === 'seat') {
    const where = (tableNumber != null && seatNumber != null)
      ? `Seat ${seatNumber} At Table ${tableNumber}`
      : 'That Seat';
    const who = playerName ? ` For ${playerName}` : '';
    return `${where} Is Already Taken${who}. Another Device Filled It First. Refresh The Table Map And Pick A Different Seat.`;
  }

  if (kind === 'finish_position') {
    const where = finishPosition != null
      ? `Finish Position ${finishPosition}`
      : 'That Finish Position';
    return `${where} Is Already Recorded For Another Player. Refresh The Finishing Order, Then Try Again.`;
  }

  if (kind === 'unknown') {
    return `${action || 'That Change'} Collided With Another Update On The Same Row. Refresh And Try Again.`;
  }

  return error?.message || 'The Database Rejected That Change.';
}

/**
 * Full { code, message } pair for an envelope.
 */
export function conflictError(error, context = {}) {
  return { code: conflictCode(error), message: conflictMessage(error, context) };
}

/**
 * Single-row routes: convert a 23505 into a 409 with an actionable message.
 * Returns true when the response has been sent, so the caller can bail out:
 *
 *   if (uErr) {
 *     if (seatConflictResponse(res, uErr, { tableNumber, seatNumber })) return;
 *     return res.status(500).json(...);
 *   }
 */
export function seatConflictResponse(res, error, context = {}) {
  if (!isUniqueViolation(error)) return false;
  res.status(409).json({ success: false, error: conflictError(error, context) });
  return true;
}

/**
 * Batch routes: describe ONE failed row without aborting the batch.
 * Returns { entry_id?, code, error, collision } so the per-row errors array
 * carries the same vocabulary the single-row routes use.
 */
export function rowConflict(error, context = {}) {
  const collision = isUniqueViolation(error);
  return {
    ...(context.entryId ? { entry_id: context.entryId } : {}),
    ...(context.playerName ? { player_name: context.playerName } : {}),
    code: conflictCode(error),
    error: collision ? conflictMessage(error, context) : (error?.message || 'Write Failed'),
    collision
  };
}

/**
 * How many rows in a per-row errors array were seat/position collisions rather
 * than ordinary write failures. Feeds the "N Seated, M Collided" summary line.
 */
export function countCollisions(errors) {
  return (errors || []).filter(e => e && e.collision === true).length;
}

/**
 * Standard batch summary sentence. Kept here so every batch route words it the
 * same way.
 */
export function batchSummary({ succeeded, failed, collided, noun = 'Player', verb = 'Updated' }) {
  const plural = succeeded === 1 ? '' : 's';
  if (!failed) return `${succeeded} ${noun}${plural} ${verb}.`;
  const collisionNote = collided > 0
    ? ` ${collided} Of Those Failed Because The Seat Or Finish Position Was Already Taken.`
    : '';
  return `${succeeded} ${noun}${plural} ${verb}, ${failed} Failed.${collisionNote}`;
}
