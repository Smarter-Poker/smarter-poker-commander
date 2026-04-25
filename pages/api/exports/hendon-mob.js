/**
 * Hendon Mob Tournament Export API
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6
 * GET /api/commander/exports/hendon-mob?tournament_id=xxx - Export tournament for Hendon Mob
 *
 * Hendon Mob format requirements:
 * - CSV with specific columns
 * - Player names, finish positions, winnings
 * - Tournament details header
 */
import { createClient } from '../../../src/lib/supabaseServerClient';
import { withRateLimit } from '../../../src/lib/commander/rateLimit';
import { logAction, AuditActions } from '../../../src/lib/commander/audit';
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

async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: authData, error: authError } = await getSupabase().auth.getUser(token);
    const user = authData?.user;

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const { tournament_id, format = 'csv' } = req.query;

    if (!tournament_id) {
      return res.status(400).json({ error: 'Tournament ID required' });
    }

    // Get tournament details
    const { data: tournament, error: tournamentError } = await getSupabase()
      .from('commander_tournaments')
      .select(`
        *,
        poker_venues:venue_id (id, name, city, state, country)
      `)
      .eq('id', tournament_id)
      .maybeSingle();

    if (tournamentError || !tournament) {
      return res.status(404).json({ error: 'Tournament not found' });
    }

    // Check if staff
    const { data: staff } = await getSupabase()
      .from('commander_staff')
      .select('id, role')
      .eq('venue_id', tournament.venue_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!staff || !['owner', 'manager'].includes(staff.role)) {
      return res.status(403).json({ error: 'Manager access required to export' });
    }

    // Get tournament entries with results
    const { data: entries, error: entriesError } = await getSupabase()
      .from('commander_tournament_entries')
      .select(`
        *,
        profiles:player_id (id, display_name, first_name, last_name, city, state, country)
      `)
      .eq('tournament_id', tournament_id)
      .order('finish_position', { ascending: true, nullsFirst: false })
          .limit(100);

    if (entriesError) throw entriesError;

    // Log audit
    await logAction(AuditActions.EXPORT_DOWNLOAD, {
      venueId: tournament.venue_id,
      userId: user.id,
      staffId: staff.id,
      actorType: 'staff',
      targetType: 'tournament',
      targetId: tournament_id,
      metadata: { format: 'hendon_mob' },
      req
    });

    // Build Hendon Mob format
    if (format === 'json') {
      return res.status(200).json(buildHendonMobJSON(tournament, entries));
    }

    // CSV format (default)
    const csv = buildHendonMobCSV(tournament, entries);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="hendon_mob_${tournament_id}.csv"`);
    return res.status(200).send(csv);

  } catch (error) {
    try { reportApiError(error, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('Hendon Mob export error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Build Hendon Mob CSV format
 *
 * Hendon Mob CSV format:
 * Tournament Name, Date, Buy-in, Entries, Prize Pool
 * Position, Player Name, Prize, Country, City
 */
function buildHendonMobCSV(tournament, entries) {
  const lines = [];
  const venue = tournament.poker_venues;

  // Tournament header info
  lines.push('# HENDON MOB TOURNAMENT IMPORT FORMAT');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Tournament details section
  lines.push('[TOURNAMENT]');
  lines.push(`Name,${escapeCSV(tournament.name)}`);
  lines.push(`Date,${formatDate(tournament.scheduled_start)}`);
  lines.push(`Venue,${escapeCSV(venue?.name || 'Unknown')}`);
  lines.push(`City,${escapeCSV(venue?.city || '')}`);
  lines.push(`State,${escapeCSV(venue?.state || '')}`);
  lines.push(`Country,${escapeCSV(venue?.country || 'USA')}`);
  lines.push(`Buy-in,${tournament.buyin_amount || 0}`);
  lines.push(`Fee,${tournament.buyin_fee || 0}`);
  lines.push(`Total Buy-in,${(tournament.buyin_amount || 0) + (tournament.buyin_fee || 0)}`);
  const totalRebuys = entries.reduce((sum, e) => sum + (e.rebuy_count || 0), 0);
  const totalAddons = entries.filter(e => e.addon_taken).length;
  lines.push(`Entries,${tournament.current_entries || entries.length}`);
  lines.push(`Rebuys,${totalRebuys}`);
  lines.push(`Add-ons,${totalAddons}`);
  lines.push(`Prize Pool,${tournament.guaranteed_pool || 0}`);
  lines.push(`Game Type,${(tournament.tournament_type || 'freezeout').toUpperCase()}`);
  lines.push(`Tournament Type,${tournament.tournament_type || 'freezeout'}`);
  lines.push('');

  // Results section
  lines.push('[RESULTS]');
  lines.push('Position,First Name,Last Name,Display Name,Prize,Country,City,State,Player ID');

  // Sort by finish position (ITM first, then eliminated players)
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.finish_position && b.finish_position) {
      return a.finish_position - b.finish_position;
    }
    if (a.finish_position) return -1;
    if (b.finish_position) return 1;
    return 0;
  });

  // Only include players with finish positions (ITM or all finishers)
  const resultsEntries = sortedEntries.filter(e => e.finish_position);

  for (const entry of resultsEntries) {
    const profile = entry.profiles;
    const firstName = profile?.first_name || profile?.display_name?.split(' ')[0] || 'Unknown';
    const lastName = profile?.last_name || profile?.display_name?.split(' ').slice(1).join(' ') || '';
    const displayName = profile?.display_name || entry.player_name || 'Unknown';
    const prize = entry.payout_amount || 0;
    const country = profile?.country || 'USA';
    const city = profile?.city || '';
    const state = profile?.state || '';
    const playerId = entry.player_id || '';

    lines.push([
      entry.finish_position,
      escapeCSV(firstName),
      escapeCSV(lastName),
      escapeCSV(displayName),
      prize,
      escapeCSV(country),
      escapeCSV(city),
      escapeCSV(state),
      playerId
    ].join(','));
  }

  lines.push('');
  lines.push(`# Total Paid: ${resultsEntries.filter(e => e.payout_amount > 0).length}`);
  lines.push(`# Total Prize Money: ${resultsEntries.reduce((sum, e) => sum + (e.payout_amount || 0), 0)}`);

  return lines.join('\n');
}

/**
 * Build Hendon Mob JSON format
 */
function buildHendonMobJSON(tournament, entries) {
  const venue = tournament.poker_venues;

  const sortedEntries = [...entries].sort((a, b) => {
    if (a.finish_position && b.finish_position) {
      return a.finish_position - b.finish_position;
    }
    if (a.finish_position) return -1;
    if (b.finish_position) return 1;
    return 0;
  });

  return {
    format: 'hendon_mob_v1',
    generated_at: new Date().toISOString(),
    tournament: {
      name: tournament.name,
      date: formatDate(tournament.scheduled_start),
      venue: {
        name: venue?.name || 'Unknown',
        city: venue?.city || '',
        state: venue?.state || '',
        country: venue?.country || 'USA'
      },
      buy_in: tournament.buyin_amount || 0,
      fee: tournament.buyin_fee || 0,
      total_buy_in: (tournament.buyin_amount || 0) + (tournament.buyin_fee || 0),
      entries: tournament.current_entries || entries.length,
      rebuys: entries.reduce((sum, e) => sum + (e.rebuy_count || 0), 0),
      addons: entries.filter(e => e.addon_taken).length,
      prize_pool: tournament.guaranteed_pool || 0,
      game_type: (tournament.tournament_type || 'freezeout').toUpperCase(),
      tournament_type: tournament.tournament_type || 'freezeout'
    },
    results: sortedEntries
      .filter(e => e.finish_position)
      .map(entry => {
        const profile = entry.profiles;
        return {
          position: entry.finish_position,
          first_name: profile?.first_name || profile?.display_name?.split(' ')[0] || 'Unknown',
          last_name: profile?.last_name || profile?.display_name?.split(' ').slice(1).join(' ') || '',
          display_name: profile?.display_name || entry.player_name || 'Unknown',
          prize: entry.payout_amount || 0,
          country: profile?.country || 'USA',
          city: profile?.city || '',
          state: profile?.state || '',
          player_id: entry.player_id || null,
          smarter_poker_id: entry.player_id || null
        };
      }),
    summary: {
      total_paid: sortedEntries.filter(e => e.payout_amount > 0).length,
      total_prize_money: sortedEntries.reduce((sum, e) => sum + (e.payout_amount || 0), 0)
    }
  };
}

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

export default withRateLimit(handler, 'export');
