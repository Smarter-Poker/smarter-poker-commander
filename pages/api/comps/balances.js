/**
 * Comp Balances API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * GET /api/commander/comps/balances - List player balances (staff) or get own balance
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { guardWriteStaff } from '../../../src/lib/commander/auth';
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

export default async function handler(req, res) {
  try {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (!applyRateLimit(req, res, LIMITS.write)) return;
    }

    const staffAuth = await guardWriteStaff(req, res); if (!staffAuth) return;

    if (req.method === 'GET') {
      return getBalances(req, res);
    }
    if (req.method === 'POST') {
      return awardComp(req, res, staffAuth);
    }
    if (req.method === 'PATCH') {
      return voidComp(req, res, staffAuth);
    }

    res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });

  } catch (err) {
    try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function awardComp(req, res, staffAuth) {
  try {
    // staffAuth: { id, venue_id, role, is_active } from guardWriteStaff
    // display_name comes from request body (authorized_by) — set by PIN verifier
    const staffRecord = staffAuth;

    // ── ROLE CHECK: Only owner, manager, dualrate can issue comps ──
    const compRoles = ['owner', 'manager', 'dualrate'];
    if (staffRecord && staffRecord !== true && staffRecord.role && !compRoles.includes(staffRecord.role)) {
      return res.status(403).json({ success: false, error: `Comp issuance requires Owner, Manager, or Dual Rate role. Current role: ${staffRecord.role}` });
    }

    const { member_id, amount, reason, type, authorized_by, authorized_pin, comp_category, notes, membership_days } = req.body;
    if (!member_id) return res.status(400).json({ success: false, error: 'member_id required' });

    // Membership comps need duration, other comps need amount
    if (!membership_days && !amount) {
      return res.status(400).json({ success: false, error: 'amount or membership_days required' });
    }

    // Get the member — check commander_members first, then commander_staff
    let member = null;

    // Attempt 1: Direct lookup in commander_members by ID
    const { data: directMember } = await getSupabase()
      .from('commander_members')
      .select('id, venue_id, first_name, last_name, comp_balance, comp_lifetime_earned, comp_lifetime_redeemed, membership_status, membership_expires, membership_tier, time_balance_minutes')
      .eq('id', member_id)
      .maybeSingle();

    if (directMember) {
      member = directMember;
    } else {
      // Attempt 2: member_id might be a commander_staff UUID
      const { data: staffMember } = await getSupabase()
        .from('commander_staff')
        .select('id, venue_id, display_name, user_id, role')
        .eq('id', member_id)
        .maybeSingle();

      if (staffMember) {
        // Check if this staff member already has a commander_members record (via name + venue)
        const nameParts = (staffMember.display_name || '').trim().split(/\s+/);
        const sfFirst = nameParts[0] || '';
        const sfLast = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
        if (sfFirst) {
          // Attempt 1: Exact first+last match
          let matchQuery = getSupabase()
            .from('commander_members')
            .select('id, venue_id, first_name, last_name, comp_balance, comp_lifetime_earned, comp_lifetime_redeemed, membership_status, membership_expires, membership_tier, time_balance_minutes')
            .eq('venue_id', staffRecord.venue_id)
            .ilike('first_name', sfFirst);
          if (sfLast) matchQuery = matchQuery.ilike('last_name', sfLast);
          const { data: existingMember } = await matchQuery.maybeSingle();
          if (existingMember) {
            member = existingMember;
          } else {
            // Attempt 2: Broader fuzzy search to catch name format differences
            const { data: broaderMatch } = await getSupabase()
              .from('commander_members')
              .select('id, venue_id, first_name, last_name, comp_balance, comp_lifetime_earned, comp_lifetime_redeemed, membership_status, membership_expires, membership_tier, time_balance_minutes')
              .eq('venue_id', staffRecord.venue_id)
              .or(`first_name.ilike.%${sfFirst}%,last_name.ilike.%${sfLast || sfFirst}%`)
              .limit(5);

            const realMatch = broaderMatch?.find(m => {
              const fMatch = (m.first_name || '').toLowerCase().includes(sfFirst.toLowerCase()) || sfFirst.toLowerCase().includes((m.first_name || '').toLowerCase());
              const lMatch = sfLast ? ((m.last_name || '').toLowerCase().includes(sfLast.toLowerCase()) || sfLast.toLowerCase().includes((m.last_name || '').toLowerCase())) : true;
              return fMatch && lMatch;
            });

            if (realMatch) {
              member = realMatch;
            }
          }
        }

        // If STILL no member found, return an error instead of auto-creating
        // This prevents ghost duplicate records
        if (!member) {
          return res.status(404).json({
            success: false,
            error: `No member record found for staff "${staffMember.display_name}". Please register them as a member first via the cashier or member registration.`
          });
        }
      }
    }

    if (!member) return res.status(404).json({ success: false, error: 'Member not found' });

    // Check membership status — provide specific messaging
    // BYPASS for free_membership comps: the whole point is to renew/activate membership
    const isMembershipComp = comp_category === 'free_membership' || (membership_days && parseInt(membership_days) > 0);
    const mStatus = (member.membership_status || 'active').toLowerCase();
    if (!isMembershipComp) {
      if (mStatus === 'expired') {
        const expDate = member.membership_expires ? new Date(member.membership_expires).toLocaleDateString() : 'unknown';
        return res.status(403).json({ success: false, error: `Membership Expired (${expDate}) — Please Renew Before Issuing Comps` });
      }
      if (mStatus === 'suspended') {
        return res.status(403).json({ success: false, error: 'Membership Is Suspended — Cannot Issue Comps To This Member' });
      }
    }
    if (mStatus === 'banned') {
      return res.status(403).json({ success: false, error: 'Member Is Banned — Cannot Issue Comps' });
    }

    // Verify staff is at the same venue as the member
    if (String(staffRecord.venue_id) !== String(member.venue_id)) {
      return res.status(403).json({ success: false, error: 'Staff not authorized for this venue' });
    }

    // ═══ MEMBERSHIP COMP: Extend membership_expires ═══
    if (membership_days && parseInt(membership_days) > 0) {
      const days = parseInt(membership_days);
      const compCost = parseFloat(amount) || 0; // Dollar value of the comped membership
      const now = new Date();
      const currentExpiry = member.membership_expires ? new Date(member.membership_expires) : null;
      const startDate = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
      const newExpiry = new Date(startDate);
      newExpiry.setDate(newExpiry.getDate() + days);

      // Update membership status + expiry, and track expense in lifetime_earned
      const updateFields = { membership_status: 'active', membership_expires: newExpiry.toISOString() };
      if (compCost > 0) {
        updateFields.comp_lifetime_earned = (member.comp_lifetime_earned || 0) + compCost;
      }

      const { error: updateErr } = await getSupabase()
        .from('commander_members')
        .update(updateFields)
        .eq('id', member.id);

      if (updateErr) throw updateErr;

      const { error: logErr1 } = await getSupabase().from('commander_member_comp_log').insert({
        venue_id: member.venue_id, member_id: member.id, amount: compCost,
        type: type || 'award', reason: reason || `Free Membership — ${days} days`,
        authorized_by: authorized_by || 'Staff', authorized_pin: authorized_pin || false,
        processed_by: staffRecord.id, balance_after: member.comp_balance || 0,
        comp_category: 'free_membership', notes: notes || null
      });
      if (logErr1) console.warn('Comp log insert failed:', logErr1);

      return res.json({
        success: true,
        data: {
          member_id: member.id, amount: compCost, membership_days: days,
          membership_expires: newExpiry.toISOString(), new_balance: member.comp_balance || 0,
          authorized_by: authorized_by || 'Staff'
        }
      });
    }

    // ═══ FREE TIME COMP: Add time_balance_minutes + comp_balance ═══
    if (comp_category === 'free_time' && req.body.time_minutes) {
      const timeMinutes = parseInt(req.body.time_minutes);
      if (timeMinutes <= 0) return res.status(400).json({ success: false, error: 'time_minutes must be positive' });

      const dollarValue = parseFloat(amount) || 0;

      // Update time_balance_minutes and comp tracking
      const updateFields = {
        time_balance_minutes: (member.time_balance_minutes || 0) + timeMinutes,
      };
      if (dollarValue > 0) {
        updateFields.comp_balance = Math.round(((member.comp_balance || 0) + dollarValue) * 100) / 100;
        updateFields.comp_lifetime_earned = (member.comp_lifetime_earned || 0) + dollarValue;
      }

      const { error: updateErr } = await getSupabase()
        .from('commander_members')
        .update(updateFields)
        .eq('id', member.id);

      if (updateErr) throw updateErr;

      const hrs = Math.floor(timeMinutes / 60);
      const mins = timeMinutes % 60;
      const timeLabel = hrs > 0 ? `${hrs}h${mins > 0 ? ` ${mins}m` : ''}` : `${mins}m`;

      const { error: logErr2 } = await getSupabase().from('commander_member_comp_log').insert({
        venue_id: member.venue_id, member_id: member.id, amount: dollarValue,
        type: type || 'award', reason: reason || `Free Time — ${timeLabel}`,
        authorized_by: authorized_by || 'Staff', authorized_pin: authorized_pin || false,
        processed_by: staffRecord.id, balance_after: updateFields.comp_balance || member.comp_balance || 0,
        comp_category: 'free_time', notes: `${timeMinutes} minutes${notes ? ' — ' + notes : ''}`
      });
      if (logErr2) console.warn('Comp log insert failed:', logErr2);

      return res.json({
        success: true,
        data: {
          member_id: member.id, amount: dollarValue, time_minutes: timeMinutes,
          new_balance: updateFields.comp_balance || member.comp_balance || 0,
          new_time_balance: updateFields.time_balance_minutes,
          authorized_by: authorized_by || 'Staff'
        }
      });
    }

    // ═══ FREE TIME COMP: Validate time_minutes is required ═══
    if (comp_category === 'free_time' && !req.body.time_minutes) {
      return res.status(400).json({ success: false, error: 'time_minutes required for free_time comps' });
    }

    // ═══ DOLLAR COMP: Update comp_balance ═══
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Amount must be a positive number' });
    }
    const newBalance = (member.comp_balance || 0) + parsedAmount;

    const updateFields = { comp_balance: Math.round(newBalance * 100) / 100 };
    if (parsedAmount > 0) {
      updateFields.comp_lifetime_earned = (member.comp_lifetime_earned || 0) + parsedAmount;
    } else {
      updateFields.comp_lifetime_redeemed = (member.comp_lifetime_redeemed || 0) + Math.abs(parsedAmount);
    }

    // Optimistic locking: ensure balance hasn't changed since we read it
    const { data: updated, error: updateErr } = await getSupabase()
      .from('commander_members')
      .update(updateFields)
      .eq('id', member.id)
      .eq('comp_balance', member.comp_balance || 0)
      .select('id')
      .maybeSingle();

    if (updateErr) throw updateErr;
    if (!updated) {
      return res.status(409).json({ success: false, error: 'Balance changed concurrently — please retry' });
    }

    const { error: logErr3 } = await getSupabase().from('commander_member_comp_log').insert({
      venue_id: member.venue_id, member_id: member.id, amount: parsedAmount,
      type: type || 'award', reason: reason || 'Manual comp award',
      authorized_by: authorized_by || 'Staff', authorized_pin: authorized_pin || false,
      processed_by: staffRecord.id, balance_after: Math.round(newBalance * 100) / 100,
      comp_category: comp_category || 'cash_bonus', notes: notes || null
    });
    if (logErr3) console.warn('Comp log insert failed:', logErr3);

    return res.json({
      success: true,
      data: {
        member_id: member.id, amount: parsedAmount,
        new_balance: Math.round(newBalance * 100) / 100,
        authorized_by: authorized_by || 'Staff'
      }
    });
  } catch (error) {
    console.warn('Award comp error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getBalances(req, res) {
  try {
    const { venue_id, history } = req.query;

    // If history=true, return comp log for the venue
    if (history && venue_id) {
      const { data: logs, error } = await getSupabase()
        .from('commander_member_comp_log')
        .select('*')
        .eq('venue_id', venue_id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) return res.json({ success: true, data: { transactions: [] } });

      // Enrich with member names
      const memberIds = [...new Set(logs.map(l => l.member_id))];
      const { data: members } = await getSupabase()
        .from('commander_members')
        .select('id, first_name, last_name')
        .in('id', memberIds.length > 0 ? memberIds : ['none'])

      const memberMap = {};
      (members || []).forEach(m => { memberMap[m.id] = `${m.first_name} ${m.last_name}`; });

      return res.json({
        success: true,
        data: {
          transactions: logs.map(l => ({
            ...l,
            member_name: memberMap[l.member_id] || 'Unknown'
          }))
        }
      });
    }

    // Auth: prefer x-staff-session, fallback to Bearer token
    let userId = null;
    const staffSessionHeader = req.headers['x-staff-session'];
    if (staffSessionHeader) {
      try {
        const session = JSON.parse(staffSessionHeader);
        if (session.user_id) userId = session.user_id;
        else if (session.id) {
          // PIN-based session — look up user_id from commander_staff
          const { data: staffRow } = await getSupabase()
            .from('commander_staff')
            .select('user_id')
            .eq('id', session.id)
            .maybeSingle();
          if (staffRow?.user_id) userId = staffRow.user_id;
        }
      } catch { /* invalid session */ }
    }

    if (!userId) {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (authError || !user) return res.status(401).json({ success: false, error: 'Session expired — please refresh the page' });
      userId = user.id;
    }

    const { player_id, sort_by = 'current_balance', limit: rawLimit = '50', offset: rawOffset = '0' } = req.query;
    const limit = Math.min(parseInt(rawLimit) || 50, 500);
    const offset = parseInt(rawOffset) || 0;

    // If no venue_id, return user's balances across all venues
    if (!venue_id) {
      const { data: balances, error } = await getSupabase()
        .from('commander_comp_balances')
        .select(`
          *,
          poker_venues:venue_id (id, name, city, state)
        `)
        .eq('player_id', userId)
        .order('current_balance', { ascending: false });

      if (error) throw error;

      // Calculate totals
      const totalBalance = balances?.reduce((sum, b) => sum + parseFloat(b.current_balance || 0), 0) || 0;
      const totalLifetime = balances?.reduce((sum, b) => sum + parseFloat(b.lifetime_earned || 0), 0) || 0;

      // Get total hours from sessions
      const { data: sessions } = await getSupabase()
        .from('commander_player_sessions')
        .select('total_time_minutes')
        .eq('player_id', userId);

      const totalHours = sessions?.reduce((sum, s) => sum + ((s.total_time_minutes || 0) / 60), 0) || 0;

      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json({
        success: true,
        data: {
          balances,
          balance: Math.round(totalBalance * 100) / 100,
          lifetime_earned: Math.round(totalLifetime * 100) / 100,
          total_hours: Math.round(totalHours * 10) / 10
        }
      });
    }

    // Check if user is staff at this venue
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', venue_id)
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    // If staff, can view all balances
    if (staff) {
      let query = getSupabase()
        .from('commander_comp_balances')
        .select(`
          *,
          profiles:player_id (id, display_name, avatar_url, email)
        `, { count: 'exact' })
        .eq('venue_id', venue_id);

      if (player_id) {
        query = query.eq('player_id', player_id);
      }

      const validSortFields = ['current_balance', 'lifetime_earned', 'lifetime_redeemed', 'last_earned_at'];
      const sortField = validSortFields.includes(sort_by) ? sort_by : 'current_balance';
      query = query.order(sortField, { ascending: false });

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) throw error;

      // Calculate totals
      const { data: totals } = await getSupabase()
        .from('commander_comp_balances')
        .select('current_balance, lifetime_earned, lifetime_redeemed')
        .eq('venue_id', venue_id);

      const summary = totals?.reduce((acc, b) => ({
        total_outstanding: acc.total_outstanding + parseFloat(b.current_balance || 0),
        total_earned: acc.total_earned + parseFloat(b.lifetime_earned || 0),
        total_redeemed: acc.total_redeemed + parseFloat(b.lifetime_redeemed || 0)
      }), { total_outstanding: 0, total_earned: 0, total_redeemed: 0 });

      return res.status(200).json({
        balances: data,
        total: count,
        summary,
        limit,
        offset
      });
    }

    // Non-staff can only see their own balance
    const { data: balance, error } = await getSupabase()
      .from('commander_comp_balances')
      .select(`
        *,
        poker_venues:venue_id (id, name, city, state)
      `)
      .eq('venue_id', venue_id)
      .eq('player_id', userId)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;

    return res.status(200).json({
      balance: balance || {
        current_balance: 0,
        lifetime_earned: 0,
        lifetime_redeemed: 0
      }
    });
  } catch (error) {
    console.warn('Get comp balances error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

// ═══════════════════════════════════════════
// PATCH — Void / Revoke a comp
// ═══════════════════════════════════════════
async function voidComp(req, res, staffAuth) {
  try {
    const { comp_log_id, authorized_by, authorized_pin, void_reason } = req.body;
    if (!comp_log_id) return res.status(400).json({ success: false, error: 'comp_log_id required' });

    // ── ROLE CHECK: Only owner, manager, dualrate can void comps ──
    const compRoles = ['owner', 'manager', 'dualrate'];
    if (staffAuth && staffAuth !== true && staffAuth.role && !compRoles.includes(staffAuth.role)) {
      return res.status(403).json({ success: false, error: `Void/revoke requires Owner, Manager, or Dual Rate role. Current role: ${staffAuth.role}` });
    }

    // 1. Fetch the original comp log entry
    const { data: logEntry, error: logErr } = await getSupabase()
      .from('commander_member_comp_log')
      .select('*')
      .eq('id', comp_log_id)
      .maybeSingle();

    if (logErr || !logEntry) return res.status(404).json({ success: false, error: 'Comp log entry not found' });

    // 2. Check if already voided (prevent double-void)
    if (logEntry.type === 'void') return res.status(400).json({ success: false, error: 'This is already a void entry' });

    // Check if there's already a void entry referencing this one
    const { data: existingVoid } = await getSupabase()
      .from('commander_member_comp_log')
      .select('id')
      .eq('venue_id', logEntry.venue_id)
      .eq('member_id', logEntry.member_id)
      .eq('type', 'void')
      .like('notes', `VOID-REF:${comp_log_id} |%`)
      .maybeSingle();

    if (existingVoid) return res.status(400).json({ success: false, error: 'This comp has already been voided' });

    // 3. Fetch the member
    const { data: member, error: memberErr } = await getSupabase()
      .from('commander_members')
      .select('id, comp_balance, comp_lifetime_earned, comp_lifetime_redeemed, time_balance_minutes, membership_status, membership_expires')
      .eq('id', logEntry.member_id)
      .maybeSingle();

    if (memberErr || !member) return res.status(404).json({ success: false, error: 'Member not found' });

    // 4. Verify staff has access to this venue
    if (String(staffAuth.venue_id) !== String(logEntry.venue_id)) {
      return res.status(403).json({ success: false, error: 'Staff not authorized for this venue' });
    }

    const updateFields = {};
    const compCategory = logEntry.comp_category || 'cash_bonus';
    const originalAmount = parseFloat(logEntry.amount) || 0;

    // 5. Reverse based on comp category
    if (compCategory === 'free_membership') {
      // Revert membership: if comp extended it, we can't perfectly undo but we set to expired
      updateFields.membership_status = 'expired';
      updateFields.membership_expires = new Date().toISOString();
      // Also reverse the comp_lifetime_earned for the dollar cost
      if (originalAmount > 0) {
        updateFields.comp_lifetime_redeemed = (member.comp_lifetime_redeemed || 0) + originalAmount;
      }
    } else if (compCategory === 'free_time') {
      // Reverse time_balance_minutes — parse from notes (e.g., "120 minutes")
      const minuteMatch = (logEntry.notes || '').match(/^(\d+)\s*minutes/);
      if (minuteMatch) {
        const mins = parseInt(minuteMatch[1]);
        updateFields.time_balance_minutes = Math.max(0, (member.time_balance_minutes || 0) - mins);
      }
      // Also reverse dollar comp_balance
      if (originalAmount > 0) {
        updateFields.comp_balance = Math.max(0, Math.round(((member.comp_balance || 0) - originalAmount) * 100) / 100);
        updateFields.comp_lifetime_redeemed = (member.comp_lifetime_redeemed || 0) + originalAmount;
      }
    } else {
      // Dollar-based comps: reverse comp_balance
      if (originalAmount > 0) {
        updateFields.comp_balance = Math.max(0, Math.round(((member.comp_balance || 0) - originalAmount) * 100) / 100);
        updateFields.comp_lifetime_redeemed = (member.comp_lifetime_redeemed || 0) + originalAmount;
      }
    }

    // 6. Update the member record
    if (Object.keys(updateFields || {}).length > 0) {
      // Optimistic locking: ensure balance hasn't changed since we read it
      const { data: updated, error: updateErr } = await getSupabase()
        .from('commander_members')
        .update(updateFields)
        .eq('id', member.id)
        .eq('comp_balance', member.comp_balance || 0)
        .select('id')
        .maybeSingle();

      if (updateErr) throw updateErr;
      if (!updated) {
        return res.status(409).json({ success: false, error: 'Balance changed concurrently — please retry' });
      }
    }

    // 7. Log the void with full audit trail
    const { error: voidLogErr } = await getSupabase().from('commander_member_comp_log').insert({
      venue_id: logEntry.venue_id,
      member_id: logEntry.member_id,
      amount: -originalAmount, // Negative to indicate reversal
      type: 'void',
      reason: `VOIDED: ${logEntry.reason || logEntry.comp_category || 'Comp'}`,
      authorized_by: authorized_by || 'Staff',
      authorized_pin: authorized_pin || false,
      processed_by: staffAuth.id,
      balance_after: updateFields.comp_balance !== undefined ? updateFields.comp_balance : (member.comp_balance || 0),
      comp_category: compCategory,
      notes: `VOID-REF:${comp_log_id} | ${void_reason || 'Voided by staff'}`,
    });
    if (voidLogErr) console.warn('Void comp log insert failed:', voidLogErr);

    return res.json({
      success: true,
      data: {
        voided_comp_id: comp_log_id,
        member_id: member.id,
        reversed_amount: originalAmount,
        new_balance: updateFields.comp_balance !== undefined ? updateFields.comp_balance : (member.comp_balance || 0),
        comp_category: compCategory,
        voided_by: authorized_by || 'Staff',
      }
    });
  } catch (error) {
      try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Void comp error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
