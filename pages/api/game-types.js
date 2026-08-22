/**
 * Game Types Configuration API
 * GET    /api/commander/game-types - List game types for venue
 * POST   /api/commander/game-types - Create new game type
 * PUT    /api/commander/game-types?id=X - Update game type
 * DELETE /api/commander/game-types?id=X - Deactivate game type
 */
import { createClient } from '../../src/lib/supabaseServerClient';
import { guardManager } from '../../src/lib/commander/auth';
import { applyRateLimit, LIMITS } from '../../src/lib/apiRateLimit';
import { reportApiError } from '../../src/lib/sentryWrap';

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

    const _g = await guardManager(req, res); if (!_g) return;

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).json({ success: false, error: 'Authorization required' });
      const token = authHeader.replace('Bearer ', '');
      const { data: authData } = await getSupabase().auth.getUser(token);
      const user = authData?.user;
      if (!user) return res.status(401).json({ success: false, error: 'Invalid token' });

      // MULTI-CLUB FIX (2026-08-20): the ACTIVE venue comes from the
      // HMAC-verified staff session guardManager already validated (_g) —
      // never from "the user's first staff row". The old unscoped
      // .eq('user_id').maybeSingle() lookup ERRORED for anyone with staff
      // rows at 2+ venues (every multi-club owner) and could resolve the
      // wrong venue for staff working at several rooms.
      let staff = { venue_id: _g.venue_id, role: _g.role, name: _g.display_name || 'Staff' };

      if (!staff.venue_id) {
        // Legacy fallback (sessions without venue_id): scoped, deterministic
        const { data: staffRow } = await getSupabase()
          .from('commander_staff')
          .select('venue_id, role, name:display_name')
          .or(`user_id.eq.${user.id},linked_user_id.eq.${user.id}`)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        if (staffRow) {
          staff = staffRow;
        } else {
          const { data: sub } = await getSupabase()
            .from('commander_subscriptions')
            .select('id, venue_id, owner_id')
            .eq('owner_id', user.id)
            .in('status', ['active', 'trialing'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (sub) staff = { venue_id: sub.venue_id, role: 'owner', name: 'Owner' };
        }
      }
      if (!staff?.venue_id) return res.status(403).json({ success: false, error: 'Staff access required' });

      const venueId = staff.venue_id;

      // GET - List all game types
      if (req.method === 'GET') {
        // Game type catalog changes rarely - safe to cache 5 minutes at edge
        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
        const showInactive = req.query.include_inactive === 'true';
        let query = getSupabase()
          .from('commander_game_types')
          .select('*')
          .eq('venue_id', venueId)
          .order('sort_order', { ascending: true })
          .order('name', { ascending: true })
          .limit(100);

        if (!showInactive) {
          query = query.eq('is_active', true)
            .limit(100);
        }

        const { data, error } = await query;
        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        return res.status(200).json({ success: true, data: data || [] });
      }

      // POST - Create new game type
      if (req.method === 'POST') {
        if (!['owner', 'manager'].includes(staff.role)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const { name, short_code, stakes, min_buyin, max_buyin, max_players,
          rake_type, rake_percent, rake_cap, time_rate, color, notes, sort_order } = req.body;

        if (!name || !short_code || !stakes) {
          return res.status(400).json({ success: false, error: 'Name, short code, and stakes are required' });
        }

        const { data, error } = await getSupabase()
          .from('commander_game_types')
          .insert({
            venue_id: venueId,
            name, short_code: short_code.toUpperCase(), stakes,
            min_buyin: min_buyin || 100,
            max_buyin: max_buyin || 0,
            max_players: max_players || 9,
            rake_type: rake_type || 'pot',
            rake_percent: rake_percent || 5.00,
            rake_cap: rake_cap || 15.00,
            time_rate: time_rate || 0,
            color: color || '#1877F2',
            notes: notes || null,
            sort_order: sort_order || 0
          })
          .select()
          .maybeSingle();

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        if (!data) return res.status(500).json({ success: false, error: 'Failed to create game type' });

        // Log
        await getSupabase().from('commander_system_log').insert({
          venue_id: venueId,
          action: 'game_type_created',
          details: { game_type_id: data.id, name, stakes },
          performed_by: user.id,
          performed_by_name: staff.name
        });

        return res.status(201).json({ success: true, data });
      }

      // PUT - Update game type
      if (req.method === 'PUT') {
        if (!['owner', 'manager'].includes(staff.role)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: 'Game type ID required' });

        const updates = {};
        const allowed = ['name', 'short_code', 'stakes', 'min_buyin', 'max_buyin', 'max_players',
          'rake_type', 'rake_percent', 'rake_cap', 'time_rate', 'color', 'notes',
          'sort_order', 'is_active'];
        for (const key of allowed) {
          if (req.body[key] !== undefined) {
            updates[key] = key === 'short_code' ? req.body[key].toUpperCase() : req.body[key];
          }
        }
        updates.updated_at = new Date().toISOString();

        const { data, error } = await getSupabase()
          .from('commander_game_types')
          .update(updates)
          .eq('id', id)
          .eq('venue_id', venueId)
          .select()
          .maybeSingle();

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        if (!data) return res.status(404).json({ success: false, error: 'Game type not found' });
        return res.status(200).json({ success: true, data });
      }

      // DELETE - Soft delete (deactivate)
      if (req.method === 'DELETE') {
        if (!['owner', 'manager'].includes(staff.role)) {
          return res.status(403).json({ success: false, error: 'Manager access required' });
        }

        const id = req.query.id;
        if (!id) return res.status(400).json({ success: false, error: 'Game type ID required' });

        const { data, error } = await getSupabase()
          .from('commander_game_types')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('venue_id', venueId)
          .select()
          .maybeSingle();

        if (error) return res.status(500).json({ success: false, error: 'Internal server error' });
        if (!data) return res.status(404).json({ success: false, error: 'Game type not found' });
        return res.status(200).json({ success: true, data });
      }

      return res.status(405).json({ success: false, error: 'Method not allowed' });
    } catch (err) {
      console.warn('Game types API error:', err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }

  } catch (err) {
      try { reportApiError(err, req); } catch (_sentryErr) { console.warn('[App] Handled exception:', _sentryErr?.message || _sentryErr); }
    console.warn('[API Error]', err);
    if (!res.headersSent) return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
