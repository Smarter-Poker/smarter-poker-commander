/**
 * Must-Move Games Manager — Chain-Based Horizontal Layout
 * /commander/must-move
 * Chain movement: T7 → T4 → T1 (players move one step at a time)
 * Horizontal card layout — must-move lists displayed beside the game
 */
import { useState, useEffect, useCallback } from 'react';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  ArrowRightLeft, Loader2, RefreshCw, Users, Unlink,
  CheckCircle2, AlertTriangle, Crown, ArrowRight,
  Hash, List, ChevronRight
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const GAME_LABELS = { nlh: 'NLH', plo: 'PLO', plo5: 'PLO5', NLH: 'NLH', PLO: 'PLO', mixed: 'Mixed', limit: 'Limit', stud: 'Stud', razz: 'Razz', other: 'Other' };

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function ordinal(n) {
  if (n === 0) return 'Main';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export default function MustMoveManager() {
  useEffect(() => { busEmit.sessionStart('commander-must-move'); }, []);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [moveLoading, setMoveLoading] = useState(null);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    try {
      const s = getStaffData();
      if (s.venue_id) setVenueId(s.venue_id);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async (signal) => {
    if (!venueId) return;
    setLoading(true);
    try {
      const res = await commanderFetch(`/api/commander/games/must-move-status?venue_id=${venueId}`, { ...(signal instanceof AbortSignal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) setData(json.data);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    if (!venueId) return;
    const _cp = new AbortController();
    const iv = setInterval(() => fetchData(_cp.signal), 15000);
    return () => { _cp.abort(); clearInterval(iv); };
  }, [venueId, fetchData]);

  // Cross-tab + cross-device real-time sync
  useCommanderSync(venueId, fetchData, { entities: ['games', 'tables'] });

  // Unlink must-move
  const unlinkMustMove = async (gameId) => {
    setActionLoading(gameId);
    try {
      const json = await commanderFetchJSON(`/api/commander/games/${gameId}/must-move`, {
        method: 'DELETE'});
      if (json.success) {
        setMessage({ type: 'success', text: 'Must-Move Removed' });
        fetchData();
        broadcastChange('games');
      } else {
        setMessage({ type: 'error', text: json.error?.message || 'Failed To Unlink' });
      }
    } catch (err) { setMessage({ type: 'error', text: 'Network Error' }); }
    finally { setActionLoading(null); }
  };

  // Move next player to the NEXT table in chain (not always main)
  const movePlayer = async (mustMoveGameId, targetGameId) => {
    setMoveLoading(mustMoveGameId);
    try {
      const res = await commanderFetch('/api/commander/games/must-move-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ must_move_game_id: mustMoveGameId, target_game_id: targetGameId })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setMessage({ type: 'success', text: json.data.message });
        fetchData();
        broadcastChange('games');
      } else {
        setMessage({ type: 'error', text: json.error || 'Failed To Move Player' });
      }
    } catch (err) { setMessage({ type: 'error', text: 'Network Error' }); }
    finally { setMoveLoading(null); }
  };

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }
  }, [message]);

  const groups = data?.must_move_groups || [];
  const singles = data?.single_games || [];

  return (
    <CommanderLayout title="Must-Move Games" backHref="/commander/dashboard?card=floor">
      <SEOHead
        title="Commander — Must-Move Games"
        description="Club Commander Must-Move Games Management."
        noindex={true}
      />
      <div style={{ minHeight: '100vh', background: '#18191A', color: '#E4E6EB', fontFamily: "var(--font-inter), sans-serif" }}>
        {/* Header */}
        <div style={{
          background: '#242526', borderBottom: '1px solid #3A3B3C',
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ArrowRightLeft size={20} color="#F59E0B" />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: 18, fontWeight: 800, color: '#E4E6EB', margin: 0 }}>Must-Move Games</h1>
            <p style={{ fontSize: 12, color: '#8A8D91', margin: 0 }}>
              {data?.total_active || 0} Active Games · {groups.length} Must-Move Group{groups.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={() => fetchData()} style={{
            padding: 8, borderRadius: 8, background: '#3A3B3C', border: '1px solid #4E4F50',
            cursor: 'pointer', color: '#B0B3B8' }}>
            <RefreshCw size={16} />
          </button>
        </div>

        {/* Message Toast */}
        {message && (
          <div style={{
            margin: '12px 16px', padding: '12px 16px', borderRadius: 12,
            display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
            background: message.type === 'success' ? 'rgba(49,162,76,0.12)' : 'rgba(239,68,68,0.12)',
            color: message.type === 'success' ? '#4ADE80' : '#F87171',
            border: `1px solid ${message.type === 'success' ? 'rgba(49,162,76,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            {message.text}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
            <Loader2 size={32} color="#1877F2" className="animate-spin" />
          </div>
        ) : (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* How Chain-Based Must-Move Works */}
            <div style={{
              background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 14, padding: '14px 16px' }}>
              <p style={{ fontSize: 13, color: '#B0B3B8', margin: 0, lineHeight: 1.6 }}>
                <span style={{ color: '#F59E0B', fontWeight: 700 }}>Chain Movement:</span> Players move
                <strong style={{ color: '#F59E0B' }}> one table at a time</strong> toward the main game.
                Example: Table 7 → Table 4 → Table 1 (Main). The longest-sitting player moves first.
              </p>
            </div>

            {/* ── Must-Move Groups ── */}
            {groups.length > 0 ? groups.map((group, gi) => {
              const chain = group.chain || group.all;
              const mainGame = group.main || chain[0];
              const gameLabel = `${GAME_LABELS[group.game_type] || group.game_type} ${group.stakes}`;

              return (
                <div key={gi} style={{
                  background: '#242526', border: '1px solid #3A3B3C',
                  borderRadius: 14, overflow: 'hidden' }}>
                  {/* Group Header */}
                  <div style={{
                    padding: '14px 18px', borderBottom: '1px solid #3A3B3C',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: '#E4E6EB' }}>
                        {gameLabel}
                      </div>
                      <div style={{ fontSize: 12, color: '#8A8D91', marginTop: 2 }}>
                        {chain.length} Table{chain.length !== 1 ? 's' : ''} Running · Chain: {chain.map(g => `T${g.table_number}`).join(' → ')}
                      </div>
                    </div>
                    {group.waitlist_count > 0 && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '4px 10px', borderRadius: 8,
                        background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)',
                        color: '#A78BFA', fontSize: 11, fontWeight: 700 }}>
                        <List size={12} /> {group.waitlist_count} Waiting
                      </div>
                    )}
                  </div>

                  {/* ── Horizontal Chain Layout ── */}
                  <div style={{
                    padding: 16,
                    display: 'flex',
                    gap: 0,
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch' }}>

                    {/* Render chain in REVERSE order: furthest table first (left) → main game last (right) */}
                    {[...chain].reverse().map((game, revIdx) => {
                      const chainIdx = chain.length - 1 - revIdx; // actual chain position
                      const isMain = chainIdx === 0;
                      const isLinked = game.is_must_move && game.parent_game_id;
                      const targetGame = !isMain ? chain[chainIdx - 1] : null;
                      const targetOpenSeats = targetGame ? (targetGame.max_seats - targetGame.player_count) : 0;
                      const canMove = isLinked && targetOpenSeats > 0 && game.seats.length > 0;
                      const nextPlayer = game.seats.length > 0 ? game.seats[0] : null;

                      return (
                        <div key={game.id} style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                          {/* Table Card */}
                          <div style={{
                            width: 280, minHeight: 200,
                            border: `1px solid ${isMain ? 'rgba(49,162,76,0.4)' : isLinked ? 'rgba(245,158,11,0.3)' : '#3A3B3C'}`,
                            background: isMain ? 'rgba(49,162,76,0.06)' : isLinked ? 'rgba(245,158,11,0.04)' : '#2D2E2F',
                            borderRadius: 12,
                            display: 'flex', flexDirection: 'column',
                            overflow: 'hidden' }}>
                            {/* Card Header */}
                            <div style={{
                              padding: '12px 14px',
                              borderBottom: `1px solid ${isMain ? 'rgba(49,162,76,0.2)' : 'rgba(58,59,60,0.6)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {isMain ? <Crown size={16} color="#31A24C" /> : <ArrowRightLeft size={14} color="#F59E0B" />}
                                <div>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: '#E4E6EB' }}>
                                    Table {game.table_number}
                                  </div>
                                  <div style={{
                                    fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                                    color: isMain ? '#4ADE80' : '#F59E0B',
                                    textTransform: 'uppercase' }}>
                                    {isMain ? 'Main Game' : `${ordinal(chainIdx)} Table → T${targetGame?.table_number}`}
                                  </div>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 16, fontWeight: 800, color: '#E4E6EB' }}>
                                  {game.player_count}/{game.max_seats}
                                </div>
                                {!isMain && (
                                  <div style={{
                                    fontSize: 10, fontWeight: 700,
                                    color: targetOpenSeats > 0 ? '#4ADE80' : '#F87171' }}>
                                    {targetOpenSeats > 0 ? `${targetOpenSeats} Open At T${targetGame?.table_number}` : `T${targetGame?.table_number} Full`}
                                  </div>
                                )}
                                {isMain && (
                                  <div style={{
                                    fontSize: 10, fontWeight: 700,
                                    color: (game.max_seats - game.player_count) > 0 ? '#4ADE80' : '#F87171' }}>
                                    {(game.max_seats - game.player_count) > 0 ? `${game.max_seats - game.player_count} Open` : 'Full'}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Must-Move Queue / Content */}
                            <div style={{ flex: 1, padding: '8px 12px', overflow: 'auto' }}>
                              {isMain ? (
                                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                                  <Crown size={28} color="#31A24C" style={{ margin: '0 auto 8px' }} />
                                  <div style={{ fontSize: 13, fontWeight: 700, color: '#4ADE80' }}>Featured Game</div>
                                  <div style={{ fontSize: 11, color: '#8A8D91', marginTop: 4 }}>
                                    Players Move Here
                                  </div>
                                </div>
                              ) : isLinked && game.seats.length > 0 ? (
                                <>
                                  <div style={{
                                    fontSize: 10, fontWeight: 700, color: '#8A8D91',
                                    textTransform: 'uppercase', letterSpacing: 0.8,
                                    marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Users size={10} /> {gameLabel} Must Move List
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                    {game.seats.map((seat, idx) => {
                                      const isNext = idx === 0;
                                      return (
                                        <div key={seat.id} style={{
                                          display: 'flex', alignItems: 'center', gap: 6,
                                          padding: '6px 8px', borderRadius: 8,
                                          background: isNext ? 'rgba(24,119,242,0.1)' : 'transparent',
                                          border: isNext ? '1px solid rgba(24,119,242,0.25)' : '1px solid transparent' }}>
                                          <div style={{
                                            width: 20, height: 20, borderRadius: 5,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 10, fontWeight: 800, flexShrink: 0,
                                            background: isNext ? '#1877F2' : '#3A3B3C',
                                            color: isNext ? '#fff' : '#8A8D91' }}>
                                            {idx + 1}
                                          </div>
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{
                                              fontSize: 12, fontWeight: isNext ? 700 : 500,
                                              color: isNext ? '#E4E6EB' : '#B0B3B8',
                                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {seat.player_name || 'Unknown'}
                                            </div>
                                            <div style={{ fontSize: 9, color: '#8A8D91' }}>
                                              Seat {seat.seat_number} · {timeAgo(seat.seated_at)}
                                            </div>
                                          </div>
                                          {isNext && (
                                            <div style={{
                                              padding: '2px 6px', borderRadius: 4,
                                              background: targetOpenSeats > 0 ? '#1877F2' : 'rgba(239,68,68,0.15)',
                                              color: targetOpenSeats > 0 ? '#fff' : '#F87171',
                                              fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
                                              whiteSpace: 'nowrap' }}>
                                              {targetOpenSeats > 0 ? 'Next' : 'Wait'}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </>
                              ) : isLinked ? (
                                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                                  <Users size={24} color="#3A3B3C" style={{ margin: '0 auto 6px' }} />
                                  <div style={{ fontSize: 12, color: '#8A8D91' }}>No Players Seated</div>
                                </div>
                              ) : (
                                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                                  <div style={{ fontSize: 12, color: '#8A8D91' }}>Not Linked</div>
                                </div>
                              )}
                            </div>

                            {/* Action Buttons */}
                            {!isMain && (
                              <div style={{
                                padding: '8px 12px 12px',
                                display: 'flex', gap: 6, borderTop: '1px solid rgba(58,59,60,0.5)' }}>
                                {isLinked ? (
                                  <>
                                    <button onClick={() => movePlayer(game.id, targetGame.id)}
                                      disabled={!canMove || moveLoading === game.id}
                                      style={{
                                        flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                                        cursor: canMove ? 'pointer' : 'not-allowed',
                                        background: canMove ? '#1877F2' : '#3A3B3C',
                                        color: canMove ? '#fff' : '#8A8D91',
                                        border: 'none',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                                        opacity: moveLoading === game.id ? 0.6 : 1 }}>
                                      {moveLoading === game.id
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <ArrowRight size={12} />}
                                      {canMove
                                        ? `Move → T${targetGame?.table_number}`
                                        : targetOpenSeats === 0 ? `T${targetGame?.table_number} Full` : 'No Players'}
                                    </button>
                                    <button onClick={() => unlinkMustMove(game.id)}
                                      disabled={actionLoading === game.id}
                                      style={{
                                        padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                                        background: '#3A3B3C', color: '#B0B3B8',
                                        border: 'none', fontSize: 11, fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: 3 }}>
                                      {actionLoading === game.id ? <Loader2 size={10} className="animate-spin" /> : <Unlink size={10} />}
                                      Unlink
                                    </button>
                                  </>
                                ) : (
                                  <div style={{ fontSize: 11, color: '#8A8D91', padding: '4px 0' }}>Auto-Linked On Refresh</div>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Chain Arrow (between cards, except after the last card) */}
                          {revIdx < chain.length - 1 && (
                            <div style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              padding: '0 8px', flexShrink: 0 }}>
                              <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                <ChevronRight size={20} color="#F59E0B" />
                                <div style={{ fontSize: 9, color: '#8A8D91', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                  Move
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }) : (
              <div style={{
                background: '#242526', border: '1px solid #3A3B3C',
                borderRadius: 14, padding: 40, textAlign: 'center' }}>
                <ArrowRightLeft size={40} color="#3A3B3C" style={{ margin: '0 auto 12px' }} />
                <p style={{ color: '#B0B3B8', fontSize: 14, margin: '0 0 4px' }}>No Must-Move Games Active</p>
                <p style={{ color: '#8A8D91', fontSize: 12, margin: 0 }}>
                  Must-Move Activates When 2+ Tables Run The Same Game Type And Stakes
                </p>
              </div>
            )}

            {/* Single-Table Games */}
            {singles.length > 0 && (
              <div style={{
                background: '#242526', border: '1px solid #3A3B3C',
                borderRadius: 14, padding: 16 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: '#B0B3B8',
                  marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Hash size={14} /> Single-Table Games ({singles.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {singles.map(g => (
                    <div key={g.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '10px 12px', background: '#3A3B3C', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#E4E6EB' }}>
                          {GAME_LABELS[g.game_type] || g.game_type} {g.stakes}
                        </div>
                        <div style={{ fontSize: 11, color: '#8A8D91' }}>Table {g.table_number}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#E4E6EB' }}>
                        {g.player_count}/{g.max_seats}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}
