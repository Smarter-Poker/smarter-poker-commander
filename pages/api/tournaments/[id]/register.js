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

let _supabase = null;
function getSupabase() {
    if (!_supabase) {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kuklfnapbkmacvwxktbh.supabase.co';
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        _supabase = createClient(url, key);
    }
    return _supabase;
}

// Auth: STAFF — requires valid staff session
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
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// 2026-07-28: commander_tournament_entries.payment_method is CHECK-constrained.
const ENTRY_PAYMENT_METHODS = ['cash', 'card', 'credit', 'comp', 'chips', 'transfer', 'other'];
// commander_cash_transactions.payment_method has a NARROWER CHECK — passing an
// entry-only value ('credit'/'chips'/'transfer'/'other') would make the whole
// cash-drawer insert fail, so it is only forwarded when it is legal there.
const CASH_TX_PAYMENT_METHODS = ['cash', 'card', 'comp', 'marker'];

/**
 * Resolve the verified staff session to a real commander_staff.id.
 * verifyStaffSession can return a SYNTHETIC owner object whose `id` is an auth
 * user id, not a commander_staff row — writing that into cashier_staff_id would
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
  const { player_id } = req.body;

  // payment_method is optional. Reject an unknown value outright rather than
  // silently coercing it — a wrong payment method on a money row is worse than
  // a missing one.
  const rawPaymentMethod = req.body?.payment_method;
  let paymentMethod = null;
  if (rawPaymentMethod !== undefined && rawPaymentMethod !== null && rawPaymentMethod !== '') {
    if (!ENTRY_PAYMENT_METHODS.includes(rawPaymentMethod)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAYMENT_METHOD',
          message: `payment_method must be one of: ${ENTRY_PAYMENT_METHODS.join(', ')}`,
        },
      });
    }
    paymentMethod = rawPaymentMethod;
  }

  if (!player_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'player_id required' }
    });
  }

  try {
    // Get tournament details
    const { data: tournament, error: tError } = await getSupabase()
      .from('commander_tournaments')
      .select('*')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tError || !tournament) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Tournament not found' }
      });
    }

    // Check if registration is open
    if (!['scheduled', 'registering', 'running'].includes(tournament.status)) {
      return res.status(400).json({
        success: false,
        error: { code: 'REGISTRATION_CLOSED', message: 'Registration is closed' }
      });
    }

    // 2026-07-25 audit fix: enforce late-registration cutoff (current_level is 0-indexed)
    if (tournament.status === 'running' && tournament.late_registration_levels != null) {
      if ((tournament.current_level + 1) > tournament.late_registration_levels) {
        return res.status(400).json({
          success: false,
          error: { code: 'LATE_REG_CLOSED', message: 'Late registration is closed' }
        });
      }
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
        .in('status', ['registered', 'seated', 'active'])
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

    const { data: existing } = existingResult;
    if (existing) {
      return res.status(400).json({
        success: false,
        error: { code: 'ALREADY_REGISTERED', message: 'Already registered' }
      });
    }

    const { count } = capacityResult;
    if (tournament.max_entries && count >= tournament.max_entries) {
      return res.status(400).json({
        success: false,
        error: { code: 'TOURNAMENT_FULL', message: 'Tournament is full' }
      });
    }

    const { data: exclusion } = exclusionResult;
    if (exclusion) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'SELF_EXCLUDED',
          message: 'You have an active self-exclusion and cannot register at this time.',
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

      if (todaySpend + tournament.buyin_amount > limits.daily_limit) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'LIMIT_EXCEEDED',
            message: `Registration would exceed your daily limit of $${limits.daily_limit}`,
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
        status: 'registered',
        cashier_staff_id: cashierStaffId,
        payment_method: paymentMethod
      })
      .select()
      .maybeSingle();

    if (error) {
      console.error('[tournaments/register] commander_tournament_entries insert failed', {
        tournamentId, player_id, cashier_staff_id: cashierStaffId,
        payment_method: paymentMethod,
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
      pName = req.body.player_name || profile?.display_name || `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || 'Unknown Player';

      // 2026-07-28 audit fix: link the cash-drawer row to the tournament
      // (commander_cash_transactions.tournament_id), and surface the insert
      // error — this write previously discarded it, so a rejected buy_in row
      // left the registration recorded with no matching cash liability.
      const { error: cashTxError } = await getSupabase().from('commander_cash_transactions').insert({
        venue_id: tournament.venue_id,
        tournament_id: tournamentId,
        player_name: pName,
        type: 'buy_in',
        amount: totalAmount,
        // Only forward a method this table's CHECK constraint accepts; otherwise
        // keep the column's existing default behaviour.
        payment_method: (paymentMethod && CASH_TX_PAYMENT_METHODS.includes(paymentMethod))
          ? paymentMethod
          : 'cash',
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

    // XP system removed

    // --- Push Notification: Registration Confirmation ---
    if (player_id && isOneSignalConfigured()) {
      const startTime = tournament.scheduled_start
        ? new Date(tournament.scheduled_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : 'TBD';
      await sendPushNotification({
        externalUserIds: [player_id],
        title: 'Registration Confirmed',
        message: `You're registered for ${tournament.name}! Starts at ${startTime}.`,
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
            content: `Just registered for ${tournament.name}! Let's go!`,
            media_type: 'text',
            background_color: 'linear-gradient(135deg, #1877F2 0%, #0A5DC2 100%)'
          });
      } catch (err) {
        console.warn('[register.js] Auto-story failed:', err.message);
      }
    }

    // Audit log
    await logAction({ action: 'register_player', category: 'tournament' }, {
      venueId: tournament.venue_id,
      staffId: staff.id,
      targetId: player_id,
      targetType: 'commander_tournament_entries',
      targetName: pName || 'Player',
      metadata: { tournament_id: tournamentId, amount: totalAmount },
      req
    });

    return res.status(201).json({
      success: true,
      data: { entry }
    });
  } catch (error) {
    console.warn('Register error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to register' }
    });
  }
}

async function handleUnregister(req, res, tournamentId, staff) {
  const { player_id } = req.body;

  if (!player_id) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_FIELDS', message: 'player_id required' }
    });
  }

  try {
    // Check tournament status
    const { data: tournament } = await getSupabase()
      .from('commander_tournaments')
      .select('status')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tournament?.status === 'running' || tournament?.status === 'completed') {
      return res.status(400).json({
        success: false,
        error: { code: 'TOURNAMENT_STARTED', message: 'Cannot unregister after tournament starts' }
      });
    }

    const { error } = await getSupabase()
      .from('commander_tournament_entries')
      .update({
        status: 'cancelled',
        notes: 'Registration cancelled'
      })
      .eq('tournament_id', tournamentId)
      .eq('player_id', player_id)
      .eq('status', 'registered');

    if (error) throw error;

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
      data: { message: 'Registration cancelled' }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Unregister error:', error);
    return res.status(500).json({
      success: false,
      error: { code: 'SERVER_ERROR', message: 'Failed to unregister' }
    });
  }
}
