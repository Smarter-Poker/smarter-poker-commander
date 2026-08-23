/**
 * Tournament Registration API
 * POST /api/commander/tournaments/:id/register
 * DELETE /api/commander/tournaments/:id/register
 * 
 * Push Notifications: Fires registration confirmation to player
 * Auto-Stories: Creates "Just registered" story
 */
import { createClient } from '../../../../src/lib/supabaseServerClient';
import { guardStaff } from '../../../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../../../src/lib/apiRateLimit';
import {
  sendPushNotification,
  isOneSignalConfigured
} from '../../../../src/lib/commander/pushNotifications';
import { logAction } from '../../../../src/lib/commander/audit';
import { reportApiError } from '../../../../src/lib/sentryWrap';
import { claimOpenSeat } from '../../../../src/lib/commander/tournamentSeating';
import { isUniqueViolation, conflictError } from '../../../../src/lib/commander/dbErrors';
import {
  CASH_TX_PAYMENT_METHODS,
  normalizeCashTxPaymentMethod
} from '../../../../src/lib/commander/paymentMethods';
import { denyCrossVenue, isSameVenue } from '../../../../src/lib/commander/venueScope';

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
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    // Auth guard: require staff auth
    const _staff = await guardStaff(req, res);
    if (!_staff) return;

    const { id } = req.query;

    if (req.method === 'POST') {
      return handleRegister(req, res, id, _staff);
    } else if (req.method === 'DELETE') {
      return handleUnregister(req, res, id, _staff);
    }

    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: { code: 'SERVER_ERROR', message: 'Internal Server Error' } });
  }
}

// 2026-08-22: commander_tournament_entries.payment_method and
// commander_cash_transactions.payment_method are guarded by CHECK constraints
// that are now IDENTICAL - both accept the same eight values, verified live.
//
// The two hand-maintained lists that used to sit here were both stale. The
// cash-drawer one carried four values and the comment beside it claimed that
// column's CHECK was "narrower"; it is not, and has not been since the
// migration that widened it. The effect was silent: a buy-in genuinely taken
// on chips, credit or by transfer fell through the includes() below and was
// FILED AS CASH, so the reconciliation's by-payment-method breakdown did not
// match what the cage actually did. Nothing errored.
//
// Both now come from the single shared vocabulary.
const ENTRY_PAYMENT_METHODS = CASH_TX_PAYMENT_METHODS;

// registerPlayerForTournament returns a { status, body } pair instead of
// writing to `res`, so the same code path serves the HTTP route AND the
// waitlist conversion route (which registers several players in one request).
const _result = (status, body) => ({ status, body });

/**
 * Resolve the verified staff session to a real commander_staff.id.
 * verifyStaffSession can return a SYNTHETIC owner object whose `id` is an auth
 * user id, not a commander_staff row - writing that into cashier_staff_id would
 * violate the FK and reject the entire registration insert. Returns null when
 * the session does not map to a real staff row (attribution left NULL rather
 * than faked).
 */
async function resolveCashierStaffId(staff) {
  if (!staff?.id) return null;
  const { data, error } = await getSupabase()
    .from('commander_staff')
    .select('id')
    .eq('id', staff.id)
    .maybeSingle();
  if (error) {
    console.error('[tournaments/register] commander_staff lookup failed', {
      staff_id: staff.id, code: error.code, message: error.message, details: error.details,
    });
    return null;
  }
  if (!data) {
    console.warn('[tournaments/register] staff session did not resolve to a commander_staff row; leaving cashier_staff_id NULL', { staff_id: staff.id });
    return null;
  }
  return data.id;
}

async function handleRegister(req, res, tournamentId, staff) {
  const result = await registerPlayerForTournament({
    tournamentId,
    body: req.body || {},
    staff,
    req
  });
  return res.status(result.status).json(result.body);
}

/**
 * Register one player into one tournament.
 *
 * Extracted from the POST handler (2026-08-20) so the waitlist conversion
 * route can reuse it instead of re-implementing capacity checks, the
 * self-exclusion gate, spending limits, the cash-drawer write, the late-reg
 * cutoff and the auto-seat. Every one of those is a rule the cage depends on;
 * a second copy would drift.
 *
 * Returns { status, body } instead of writing to `res` so it can be called
 * from another route in a loop.
 *
 * @param {object}   args
 * @param {string}   args.tournamentId
 * @param {object}   args.body   - the register payload (player_id, payment_method, reentry_of, as_alternate, player_name)
 * @param {object}   args.staff  - the verified staff session
 * @param {object}   args.req    - the original request, for audit attribution
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function registerPlayerForTournament({ tournamentId, body = {}, staff, req }) {
  const { player_id } = body;

  // payment_method is optional. Reject an unknown value outright rather than
  // silently coercing it - a wrong payment method on a money row is worse than
  // a missing one.
  const rawPaymentMethod = body?.payment_method;
  let paymentMethod = null;
  if (rawPaymentMethod !== undefined && rawPaymentMethod !== null && rawPaymentMethod !== '') {
    if (!ENTRY_PAYMENT_METHODS.includes(rawPaymentMethod)) {
      return _result(400, {
        success: false,
        error: {
          code: 'INVALID_PAYMENT_METHOD',
          message: `payment_method Must Be One Of: ${ENTRY_PAYMENT_METHODS.join(', ')}`,
        },
      });
    }
    paymentMethod = rawPaymentMethod;
  }

  if (!player_id) {
    return _result(400, {
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'player_id Required' }
    });
  }

  // RE-ENTRY vs REBUY (2026-08-20)
  //
  // A REBUY tops up the SAME entry: same row, rebuy_count + 1, one entry in the
  // field. It lives at entries/[entryId]/rebuy.
  //
  // A RE-ENTRY is a brand new entry after a bust: a NEW row with its own
  // starting stack, counting as an ADDITIONAL entry toward the prize pool. The
  // busted row is left exactly as it is, so it keeps its finish_position and any
  // payout already recorded against it.
  //
  // The floor screens already routed Re-Entry here, but they sent nothing to say
  // so: the new row was indistinguishable from a first-time registration and the
  // two entries were never linked. reentry_of carries the busted entry's id, is
  // validated below, and is stamped on the new row.
  const reentryOf = (typeof body?.reentry_of === 'string' && body.reentry_of.trim())
    ? body.reentry_of.trim()
    : null;

  try {
    // Get tournament details
    const { data: tournament, error: tError } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tError || !tournament) {
      return _result(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // Venue scope. This function returns a { status, body } pair rather than
    // writing to `res` (it also serves the waitlist-conversion route), so the
    // shared denyCrossVenue guard cannot be used here - the predicate is.
    // A staff session for one room must never register a player into another
    // room's event, or put that room's cash in this drawer.
    if (!isSameVenue(staff, tournament)) {
      return _result(403, {
        success: false,
        error: { code: 'WRONG_VENUE', message: 'Tournament Belongs To A Different Venue' }
      });
    }

    // Check if registration is open.
    // 2026-08-20 fix: 'registration' is the value
    // commander_tournaments_status_check actually allows; 'registering' is not
    // and never matched a row. A tournament whose registration had been OPENED
    // was therefore the one state in which nobody could register. Both are
    // listed so an older caller sending the wrong value still resolves.
    if (!['scheduled', 'registration', 'registering', 'running'].includes(tournament.status)) {
      return _result(400, {
        success: false,
        error: { code: 'REGISTRATION_CLOSED', message: 'Registration Is Closed' }
      });
    }

    // 2026-07-25 audit fix: enforce late-registration cutoff (current_level is 0-indexed)
    if (tournament.status === 'running' && tournament.late_registration_levels != null) {
      if ((tournament.current_level + 1) > tournament.late_registration_levels) {
        return _result(400, {
          success: false,
          error: { code: 'LATE_REG_CLOSED', message: 'Late Registration Is Closed' }
        });
      }
    }

    // Validate the re-entry link before anything is written. A bad link is
    // rejected outright rather than quietly dropped: an unlinked re-entry looks
    // exactly like a first-time registration in every report.
    let priorEntry = null;
    if (reentryOf) {
      const { data: prior, error: priorErr } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_id, player_name, status, finish_position, payout_amount, metadata')
        .eq('id', reentryOf)
        .eq('tournament_id', tournamentId)
        .maybeSingle();

      if (priorErr) {
        console.error('[tournaments/register] reentry_of lookup failed', {
          tournamentId, reentry_of: reentryOf,
          code: priorErr.code, message: priorErr.message, details: priorErr.details,
        });
        return _result(500, {
          success: false,
          error: { code: 'DB_ERROR', message: 'Failed To Read The Original Entry' }
        });
      }
      if (!prior) {
        return _result(404, {
          success: false,
          error: { code: 'ORIGINAL_ENTRY_NOT_FOUND', message: 'The Original Entry Was Not Found In This Tournament' }
        });
      }
      if (prior.player_id && String(prior.player_id) !== String(player_id)) {
        return _result(400, {
          success: false,
          error: {
            code: 'REENTRY_PLAYER_MISMATCH',
            message: 'The Original Entry Belongs To A Different Player. Re-Entry Must Be For The Same Player.'
          }
        });
      }
      // Only a busted entry can be re-entered. A player who is still in the
      // event wants a REBUY (same entry, more chips), not a second entry.
      if (prior.status !== 'eliminated') {
        return _result(400, {
          success: false,
          error: {
            code: 'REENTRY_NOT_ELIGIBLE',
            message: `That Player Is Still In The Tournament (Status ${prior.status}). Use Rebuy Instead Of Re-Entry.`
          }
        });
      }
      priorEntry = prior;
    }

    // Parallel validation: existing registration, capacity, exclusions, and spending limits
    const [existingResult, capacityResult, exclusionResult, limitsResult] = await Promise.all([
      getSupabase()
        .from('commander_tournament_entries')
        .select('id, status')
        .eq('tournament_id', tournamentId)
        .eq('player_id', player_id)
        .not('status', 'in', '("eliminated","cancelled")')
        .maybeSingle(),
      getSupabase()
        .from('commander_tournament_entries')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId)
        // Field size against max_entries. A 'bagged' player still occupies an
        // entry in the event, so they count: without this a multi-day field
        // would appear to have room and the room could oversell Day 2.
        .in('status', ['registered', 'seated', 'active', 'bagged'])
        .limit(100),
      getSupabase()
        .from('commander_self_exclusions')
        .select('id, exclusion_type, expires_at')
        .eq('player_id', player_id)
        .or(`venue_id.eq.${tournament.venue_id},scope.eq.network`)
        .is('lifted_at', null)
        .or('expires_at.is.null,expires_at.gt.now()')
        .limit(1)
        .maybeSingle(),
      getSupabase()
        .from('commander_spending_limits')
        .select('daily_limit')
        .eq('player_id', player_id)
        .maybeSingle()
    ]);

    // ── EVERY ONE OF THESE FOUR GATES USED TO FAIL OPEN ───────────────────
    // supabase-js RESOLVES on a PostgREST error rather than rejecting, so
    // Promise.all above never throws. Each destructure below took `data` and
    // dropped `error`, which meant an errored query was indistinguishable from
    // a clean "nothing found":
    //
    //   capacity  -> count undefined; `undefined >= max_entries` is false, so
    //                the field cap was bypassed and the room oversold.
    //   exclusion -> undefined, so A SELF-EXCLUDED PLAYER WAS REGISTERED AND
    //                CHARGED. The .or() filter is built by interpolating
    //                tournament.venue_id, and a null there produces the literal
    //                `venue_id.eq.null`, which is exactly the malformed filter
    //                that errors here.
    //   limits    -> undefined, so the daily spend limit was skipped entirely.
    //   existing  -> undefined, so a duplicate registration and a duplicate
    //                cash-drawer row both went through.
    //
    // A gate that cannot be evaluated is not a gate that passed. Refuse.
    const gateFailure = [
      ['existing registration', existingResult?.error],
      ['field capacity', capacityResult?.error],
      ['self-exclusion', exclusionResult?.error],
      ['spending limits', limitsResult?.error]
    ].find(([, err]) => !!err);

    if (gateFailure) {
      const [gateName, gateErr] = gateFailure;
      console.error('[tournaments/register] registration gate could not be evaluated', {
        tournamentId, player_id, gate: gateName,
        code: gateErr.code, message: gateErr.message, details: gateErr.details
      });
      return _result(503, {
        success: false,
        error: {
          code: 'GATE_CHECK_FAILED',
          message: 'Registration Checks Could Not Be Completed. Please Try Again.'
        }
      });
    }

    const { data: existing } = existingResult;
    if (existing) {
      return _result(400, {
        success: false,
        error: { code: 'ALREADY_REGISTERED', message: 'Already Registered' }
      });
    }

    // Full field: instead of a hard reject, offer the alternates list
    // (TableCaptain waitlist behavior). The alternate pays now and is seated
    // automatically as seats free up during registration. Pass
    // as_alternate: false to keep the old hard-reject behavior.
    const { count } = capacityResult;
    let registerAsAlternate = false;
    if (tournament.max_entries && count >= tournament.max_entries) {
      if (body?.as_alternate === false) {
        return _result(400, {
          success: false,
          error: { code: 'TOURNAMENT_FULL', message: 'Tournament Is Full' }
        });
      }
      registerAsAlternate = true;
    }

    const { data: exclusion } = exclusionResult;
    if (exclusion) {
      return _result(403, {
        success: false,
        error: {
          code: 'SELF_EXCLUDED',
          message: 'You Have An Active Self-Exclusion And Cannot Register At This Time.',
          exclusion_type: exclusion.exclusion_type,
          expires_at: exclusion.expires_at
        }
      });
    }

    const { data: limits } = limitsResult;

    if (limits?.daily_limit) {
      // Get today's tournament registrations total
      const today = new Date().toISOString().split('T')[0];
      const { data: todayEntries } = await getSupabase()
        .from('commander_tournament_entries')
        .select('total_invested')
        .eq('player_id', player_id)
        .gte('registered_at', today)
        .neq('status', 'cancelled');

      const todaySpend = (todayEntries || []).reduce((sum, e) => sum + (e.total_invested || 0), 0);

      // The new charge is buy-in PLUS fee (total_invested on prior entries
      // includes the fee, so the comparison must too).
      const newCharge = (tournament.buyin_amount || 0) + (tournament.buyin_fee || 0);
      if (todaySpend + newCharge > limits.daily_limit) {
        return _result(403, {
          success: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `Registration Would Exceed Your Daily Limit Of $${limits.daily_limit}`,
            current_spend: todaySpend,
            limit: limits.daily_limit
          }
        });
      }
    }

    // 2026-07-28: cashier attribution comes ONLY from the verified staff session
    // (guardStaff -> verifyStaffSession). It is never read from the request body,
    // which would make the control forgeable.
    const cashierStaffId = await resolveCashierStaffId(staff);

    // Create entry (total_invested is auto-calculated by DB trigger)
    const { data: entry, error } = await getSupabase()
      .from('commander_tournament_entries')
      .insert({
        tournament_id: tournamentId,
        player_id,
        registration_method: 'app',
        status: registerAsAlternate ? 'alternate' : 'registered',
        cashier_staff_id: cashierStaffId,
        payment_method: paymentMethod,
        // Re-entry marker. Stored on the row itself so the link travels with the
        // entry and is visible without joining the audit log. The ORIGINAL entry
        // is deliberately not touched: it keeps its finish_position and its
        // recorded payout, which is what the finishing order and the money
        // reports read.
        ...(priorEntry ? {
          metadata: {
            is_reentry: true,
            reentry_of: priorEntry.id,
            reentry_at: new Date().toISOString(),
            reentry_from_finish_position: priorEntry.finish_position ?? null
          }
        } : {})
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error('[tournaments/register] commander_tournament_entries insert failed', {
        tournamentId, player_id, cashier_staff_id: cashierStaffId,
        payment_method: paymentMethod, reentry_of: priorEntry?.id || null,
        code: error.code, message: error.message, details: error.details,
      });
      throw error;
    }

    // --- FINANCIAL FRAUD PROTECTION ---
    // Record the cash liability atomically with the registration.
    // This prevents a split-brain vulnerability where the client tab closes after creating the registration
    // but before logging the cash drawer transaction.
    const totalAmount = (tournament.buyin_amount || 0) + (tournament.buyin_fee || 0);
    // 2026-07-25 audit fix: hoist pName so the audit log below can also see it
    let pName = null;
    if (totalAmount > 0) {
      const { data: profile } = await getSupabase().from('profiles').select('display_name, first_name, last_name').eq('id', player_id).maybeSingle();
      pName = body.player_name || profile?.display_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Unknown Player';

      // 2026-07-28 audit fix: link the cash-drawer row to the tournament
      // (commander_cash_transactions.tournament_id), and surface the insert
      // error - this write previously discarded it, so a rejected buy_in row
      // left the registration recorded with no matching cash liability.
      const { error: cashTxError } = await getSupabase().from('commander_cash_transactions').insert({
        venue_id: tournament.venue_id,
        tournament_id: tournamentId,
        player_name: pName,
        type: 'buy_in',
        amount: totalAmount,
        // Only forward a method this table's CHECK constraint accepts; otherwise
        // keep the column's existing default behaviour.
        // Case-insensitive and defaulting, so an unexpected value can never
        // reject the whole drawer insert - but a LEGAL one is now stored as
        // itself rather than being quietly relabelled 'cash'.
        payment_method: normalizeCashTxPaymentMethod(paymentMethod),
        // 2026-07-25 audit fix: _staff is out of scope here; use the staff param
        processed_by: staff.id || null,
        notes: `Tournament: ${tournament.name || 'Tournament'} (Buy-In: $${tournament.buyin_amount || 0}, Fee: $${tournament.buyin_fee || 0})`
      });

      if (cashTxError) {
        console.error('[tournaments/register] commander_cash_transactions buy_in insert failed', {
          tournamentId, player_id, amount: totalAmount,
          code: cashTxError.code, message: cashTxError.message, details: cashTxError.details,
        });
        throw cashTxError;
      }
    }

    // Note: current_entries is auto-updated by the update_tournament_stats trigger

    // --- Random Seat Draw For Late Registrations ---
    // While the tournament is running, a new registrant is seated immediately
    // at a random open seat on the least-occupied table (TableCaptain behavior).
    // Pre-start registrations stay 'registered' until the seat draw runs.
    let seatAssignment = null;
    if (!registerAsAlternate && tournament.status === 'running' && entry) {
      try {
        // Atomic claim: picking and taking the seat in one locked statement
        // stops a late registration and an alternate promotion landing in the
        // same chair.
        const seat = await claimOpenSeat(getSupabase(), tournamentId, entry.id, 'registered');
        if (seat) {
          seatAssignment = seat;
          const { data: seatedEntry } = await getSupabase()
            .from('commander_tournament_entries')
            .select()
            .eq('id', entry.id)
            .maybeSingle();
          if (seatedEntry) {
            entry.status = seatedEntry.status;
            entry.table_number = seatedEntry.table_number;
            entry.seat_number = seatedEntry.seat_number;
            entry.current_chips = seatedEntry.current_chips;
          }
        }
      } catch (seatErr) {
        console.warn('[register.js] Auto-seat failed (entry stays registered):', seatErr.message);
      }
    }

    // --- Push Notification: Registration Confirmation ---
    if (player_id && isOneSignalConfigured()) {
      const startTime = tournament.scheduled_start
        ? new Date(tournament.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'TBD';
      const pushMessage = registerAsAlternate
        ? `The Field Is Full. You Are On The Alternates List For ${tournament.name}. We Will Seat You As Soon As A Seat Opens.`
        : seatAssignment
          ? `You Are Registered For ${tournament.name}! Table ${seatAssignment.table_number}, Seat ${seatAssignment.seat_number}.`
          : `You're Registered For ${tournament.name}! Starts At ${startTime}.`;
      await sendPushNotification({
        externalUserIds: [player_id],
        title: registerAsAlternate ? 'Added To Alternates List' : 'Registration Confirmed',
        message: pushMessage,
        url: `/hub/commander/tournament/${tournamentId}/my-status`,
        data: { type: 'tournament_registered', tournament_id: tournamentId }
      }).catch(err => console.warn('[register.js] Push failed:', err.message));
    }

    // --- Auto-Story: Registration ---
    if (player_id) {
      try {
        await getSupabase()
          .from('social_stories')
          .insert({
            author_id: player_id,
            content: `Just Registered For ${tournament.name}! Let's Go!`,
            media_type: 'text',
            background_color: 'linear-gradient(135deg, #1877F2 0%, #0A5DC2 100%)'
          });
      } catch (err) {
        console.warn('[register.js] Auto-story failed:', err.message);
      }
    }

    // Audit log. A re-entry is recorded as its own action so the cage can tell
    // second entries from first entries without diffing the entries table.
    await logAction(
      priorEntry
        ? { action: 'reenter_player', category: 'tournament' }
        : { action: 'register_player', category: 'tournament' },
      {
        venueId: tournament.venue_id,
        staffId: staff.id,
        targetId: player_id,
        targetType: 'commander_tournament_entries',
        targetName: pName || 'Player',
        metadata: {
          tournament_id: tournamentId,
          amount: totalAmount,
          entry_id: entry?.id || null,
          // logAudit accepts targetName but does not forward it to
          // log_audit_event, so the name is carried here where it persists.
          player_name: pName || null,
          ...(priorEntry ? {
            is_reentry: true,
            reentry_of: priorEntry.id,
            original_finish_position: priorEntry.finish_position ?? null
          } : {})
        },
        req
      }
    );

    const registeredWord = priorEntry ? 'Re-Entered' : 'Registered';

    return _result(201, {
      success: true,
      data: {
        entry,
        is_alternate: registerAsAlternate || undefined,
        seat_assignment: seatAssignment || undefined,
        // Present only on a true re-entry. The original entry is untouched and
        // its finish position is echoed back so the floor can see the link.
        is_reentry: priorEntry ? true : undefined,
        reentry_of: priorEntry ? priorEntry.id : undefined,
        original_finish_position: priorEntry ? (priorEntry.finish_position ?? null) : undefined,
        message: registerAsAlternate
          ? 'Field Is Full. Player Added To The Alternates List.'
          : seatAssignment
            ? `${registeredWord} And Seated At Table ${seatAssignment.table_number}, Seat ${seatAssignment.seat_number}.`
            : `${registeredWord}.`
      }
    });
  } catch (error) {
    console.warn('Register error:', error);
    // uq_commander_entries_live_seat can reject the auto-seat that follows a
    // late registration. That is a seat collision the cashier can act on, not a
    // server fault, so it must never surface as a 500.
    if (isUniqueViolation(error)) {
      return _result(409, { success: false, error: conflictError(error, { action: 'Registration' }) });
    }
    return _result(500, {
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed To Register' }
    });
  }
}

async function handleUnregister(req, res, tournamentId, staff) {
  const { player_id } = req.body;

  if (!player_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'player_id Required' }
    });
  }

  try {
    // Check tournament status (venue_id is needed for the audit log below;
    // previously only status was selected, so the log recorded undefined,
    // and a missing tournament crashed the log call).
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('status, venue_id')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament Not Found' }
      });
    }

    // Venue scope: unregistering is a write on another room's field.
    if (denyCrossVenue(res, staff, tournament)) return;

    if (tournament.status === 'running' || tournament.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: { code: 'TOURNAMENT_STARTED', message: 'Cannot Unregister After Tournament Starts' }
      });
    }

    // 2026-08-20: alternates can cancel too (they were stuck before, the
    // filter only matched status 'registered').
    const { error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        notes: 'Registration cancelled'
      })
      .eq('tournament_id', tournamentId)
      .eq('player_id', player_id)
      .in('status', ['registered', 'alternate']);

    if (error) throw error;

    // A cancellation can free a spot in a previously full field: promote the
    // longest-waiting alternate to 'registered' (seat comes at the draw).
    let promotedAlternate = null;
    try {
      const { data: alternates } = await getSupabase()
        .from('commander_tournament_entries')
        .select('id, player_name')
        .eq('tournament_id', tournamentId)
        .eq('status', 'alternate')
        .order('registered_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .limit(1);
      const next = alternates && alternates[0];
      if (next) {
        const { data: flipped } = await getSupabase()
          .from('commander_tournament_entries')
          .update({ status: 'registered' })
          .eq('id', next.id)
          .eq('status', 'alternate')
          .select('id, player_name, status')
          .maybeSingle();
        if (flipped) promotedAlternate = flipped;
      }
    } catch (altErr) {
      console.warn('[register.js] Alternate promotion after cancel failed:', altErr.message);
    }

    // Audit log
    await logAction({ action: 'unregister_player', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: player_id,
      targetType: 'commander_tournament_entries',
      metadata: { tournament_id: tournamentId },
      req
    });

    return res.status(200).json({
      success: true,
      data: {
        message: 'Registration Cancelled',
        promoted_alternate: promotedAlternate || undefined
      }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Unregister error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed To Unregister' }
    });
  }
}
