/**
 * Dealer Rotation Manager — Complete Rebuild
 * /commander/dealer-rotation
 *
 * Floor managers use this to:
 * - See all active dealers grouped by status (Dealing / Break / Available)
 * - Push dealers to new tables with visual countdown timer
 * - Send dealers on break / return from break
 * - View unassigned tables that need a dealer
 * - See today's rotation history per dealer
 * - Auto-refresh every 10 seconds
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  RefreshCw, Clock, Users, ArrowRightLeft, Coffee,
  CheckCircle2, AlertTriangle, RotateCcw, ChevronDown, ChevronUp, History
} from 'lucide-react';
import dynamic from 'next/dynamic';
const SkeletonDark = dynamic(() => import('../../src/components/ui/SkeletonDark'), { ssr: false });
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const PUSH_THRESHOLD = 30; // minutes before highlighting for rotation
const PUSH_WARNING = 25;   // minutes before showing amber warning

function minutesSince(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function formatTime(dateStr) {
  if (!dateStr) return '--';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function DealerRotation() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-dealer-rotation'); }, []);
  const [dealers, setDealers] = useState([]);
  const [tables, setTables] = useState([]);
  const [games, setGames] = useState([]);
  const [rotations, setRotations] = useState([]);
  const [history, setHistory] = useState([]); // ended rotations for today
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());
  const [pushTarget, setPushTarget] = useState(null);
  const [actionLoading, setActionLoading] = useState(null); // dealerId being acted on
  const [showHistory, setShowHistory] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const getHeaders = () => ({
    'Content-Type': 'application/json'
  });

  const fetchData = useCallback(async (signal) => {
    try {
      const venueId = getVenueId();
      if (!venueId) { setLoading(false); return; }
      const headers = getHeaders();

      const [dealersRes, tablesRes, rotationsRes, gamesRes] = await Promise.all([
        commanderFetch(`/api/commander/dealers?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
        commanderFetch(`/api/commander/tables?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
        commanderFetch(`/api/commander/dealers/rotations?venue_id=${venueId}&include_ended=1`, { headers }).then(r => r.json()).catch(() => ({})),
        commanderFetch(`/api/commander/games/venue/${venueId}`, { headers }).then(r => r.json()).catch(() => ({}))
      ]);

      // Parse dealers — API returns { dealers: [...] } or { data: { dealers: [...] } }
      const dealersArr = dealersRes.data?.dealers || dealersRes.dealers || (Array.isArray(dealersRes.data) ? dealersRes.data : []);
      setDealers(dealersArr.filter(d => d.is_active !== false));

      // Parse tables
      const tablesArr = tablesRes.data?.tables || (Array.isArray(tablesRes.data) ? tablesRes.data : []);
      setTables(tablesArr);

      // Parse games — API returns { data: { games: [...] } }
      const gamesArr = gamesRes.data?.games || (Array.isArray(gamesRes.data) ? gamesRes.data : []);
      setGames(gamesArr);

      // Parse rotations — API returns { rotations: [...] } — split active vs history
      const allRotations = rotationsRes.data?.rotations || (Array.isArray(rotationsRes.data) ? rotationsRes.data : []);
      const active = allRotations.filter(r => !r.ended_at);
      const ended = allRotations.filter(r => r.ended_at);
      setRotations(active);
      setHistory(ended);
    } catch (err) { console.warn('[DealerRotation] fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const _c = new AbortController();
    fetchData(_c.signal);
    const poll = setInterval(() => fetchData(_c.signal), 30000); // fallback — real-time sync handles instant updates
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { _c.abort(); clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  // Commander Data Bus — sync dealers + tables across tabs
  useCommanderSync(getVenueId(), fetchData, { entities: ['dealers', 'tables', 'games'] });

  // ── Actions ──────────────────────────────────────────

  const callAction = async (action, dealerId, tableId = null) => {
    setActionLoading(dealerId);
    try {
      const venueId = getVenueId();
      const res = await commanderFetch('/api/commander/dealers/rotations', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          venue_id: venueId,
          dealer_id: dealerId || undefined,
          table_id: tableId || undefined,
          action
        })
      });
      if (res.ok) {
        setPushTarget(null);
        await fetchData();
        broadcastChange('dealers');
        broadcastChange('tables');
      }
    } catch (err) { console.warn(`[DealerRotation] ${action} error:`, err); setToast({ type: 'error', text: `Action failed: ${action}. Please try again.` }); }
    finally { setActionLoading(null); }
  };

  const pushDealer = (dealerId, tableId) => callAction('push', dealerId, tableId);
  const sendOnBreak = (dealerId) => callAction('break', dealerId);
  const returnFromBreak = (dealerId) => callAction('return', dealerId);
  const assignDealer = (dealerId, tableId) => callAction(null, dealerId, tableId);

  // ── Derived Data ─────────────────────────────────────

  // Get tables with running games
  const activeTables = tables.filter(t => {
    const hasGame = games.some(g =>
      (g.table_id === t.id || g.table_number === t.table_number) &&
      ['running', 'waiting', 'active'].includes(g.status)
    );
    return t.status === 'in_use' || hasGame;
  });

  // Current rotation lookup
  const getActiveRotation = (dealerId) => rotations.find(r => {
    const did = r.commander_dealers?.id || r.dealer_id;
    return did === dealerId;
  });

  // Assigned table IDs from rotations
  const assignedTableIds = new Set(rotations.map(r => {
    const tbl = r.commander_tables;
    return tbl?.id || r.table_id;
  }));

  // Unassigned active tables
  const unassignedTables = activeTables.filter(t => !assignedTableIds.has(t.id));

  // Group dealers
  const dealingDealers = dealers.filter(d => getActiveRotation(d.id));
  const breakDealers = dealers.filter(d => !getActiveRotation(d.id) && (d.current_status === 'on_break'));
  const availableDealers = dealers.filter(d =>
    !getActiveRotation(d.id) && d.current_status !== 'on_break'
  );

  // Get table info for a rotation
  const getTableInfo = (rotation) => {
    const tbl = rotation?.commander_tables;
    const tableNum = tbl?.table_number || rotation?.table_number;
    const game = rotation?.commander_games;
    const matchedTable = tableNum ? tables.find(t => t.table_number === tableNum) : null;
    const matchedGame = games.find(g =>
      g.table_id === (tbl?.id || rotation?.table_id) ||
      g.table_number === tableNum
    );
    return {
      number: tableNum || '?',
      gameType: game?.game_type || matchedGame?.game_type || matchedTable?.game_type || '',
      stakes: game?.stakes || matchedGame?.stakes || matchedTable?.stakes || ''
    };
  };

  // ── Loading State ───────────────────────────────────

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#18191A', padding: 16 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ background: '#2A2B2C', height: 22, width: 180, borderRadius: 6, marginBottom: 16 }} />
        <SkeletonDark variant="dealer-rotation" />
      </div>
    </div>
  );

  return (
    <CommanderLayout title="Dealer Rotation" backHref="/commander/dashboard?card=floor">
      <SEOHead title="Commander — Dealer Rotation" description="Club Commander Dealer Rotation Manager" noindex={true} />

      <style>{`
        .dr-page { min-height: 100vh; background: #0a0a0a; color: #E4E6EB; font-family: 'Inter', sans-serif; }
        .dr-stats { background: linear-gradient(180deg, #111 0%, #0a0a0a 100%); border-bottom: 1px solid #222; padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
        .dr-stats-left { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
        .dr-stat { font-size: 13px; color: #888; }
        .dr-stat b { color: #E4E6EB; font-weight: 700; }
        .dr-refresh { background: none; border: 1px solid #333; border-radius: 8px; padding: 6px 8px; cursor: pointer; color: #888; display: flex; align-items: center; }
        .dr-refresh:active { background: #222; }

        .dr-grid { display: grid; grid-template-columns: 1fr 320px; gap: 0; }
        @media (max-width: 768px) { .dr-grid { grid-template-columns: 1fr; } }

        .dr-main { padding: 16px; border-right: 1px solid #1a1a1a; }
        .dr-sidebar { padding: 16px; }

        .dr-section-title { font-size: 12px; font-weight: 700; color: #666; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }

        .dr-card { background: #111; border: 1px solid #222; border-radius: 12px; margin-bottom: 10px; overflow: hidden; transition: border-color 0.2s; }
        .dr-card.warning { border-color: rgba(245, 158, 11, 0.4); }
        .dr-card.overdue { border-color: rgba(239, 68, 68, 0.4); }
        .dr-card-body { padding: 12px 16px; display: flex; align-items: center; gap: 12px; }
        .dr-avatar { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 16px; flex-shrink: 0; }
        .dr-avatar.dealing { background: rgba(24, 119, 242, 0.12); color: #4A9AF5; }
        .dr-avatar.warning { background: rgba(245, 158, 11, 0.12); color: #F59E0B; }
        .dr-avatar.overdue { background: rgba(239, 68, 68, 0.12); color: #EF4444; }
        .dr-name { font-size: 15px; font-weight: 600; color: #fff; }
        .dr-meta { font-size: 12px; color: #666; margin-top: 2px; }
        .dr-badge { font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: auto; flex-shrink: 0; }
        .dr-badge.push { background: rgba(245, 158, 11, 0.15); color: #F59E0B; }
        .dr-badge.overdue-badge { background: rgba(239, 68, 68, 0.15); color: #EF4444; }

        .dr-actions { display: flex; border-top: 1px solid #1a1a1a; }
        .dr-action-btn { flex: 1; padding: 10px; font-size: 12px; font-weight: 600; background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: background 0.15s; }
        .dr-action-btn:not(:last-child) { border-right: 1px solid #1a1a1a; }
        .dr-action-btn.push-btn { color: #4A9AF5; }
        .dr-action-btn.push-btn:hover { background: rgba(24, 119, 242, 0.08); }
        .dr-action-btn.break-btn { color: #F59E0B; }
        .dr-action-btn.break-btn:hover { background: rgba(245, 158, 11, 0.08); }

        .dr-push-panel { padding: 12px 16px; border-top: 1px solid #1a1a1a; background: #0d0d0d; }
        .dr-push-label { font-size: 11px; color: #666; margin-bottom: 8px; font-weight: 600; }
        .dr-push-tables { display: flex; flex-wrap: wrap; gap: 6px; }
        .dr-push-table { padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid #333; background: #1a1a1a; color: #ccc; transition: all 0.15s; }
        .dr-push-table:hover { border-color: #4A9AF5; color: #4A9AF5; background: rgba(24, 119, 242, 0.08); }
        .dr-push-table.current { opacity: 0.3; cursor: default; }
        .dr-push-cancel { padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid #333; background: #1a1a1a; color: #888; }

        .dr-break-card { background: #111; border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 10px; padding: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
        .dr-break-icon { width: 32px; height: 32px; border-radius: 50%; background: rgba(245, 158, 11, 0.1); display: flex; align-items: center; justify-content: center; }
        .dr-break-time { font-size: 11px; color: rgba(245, 158, 11, 0.7); }
        .dr-return-btn { margin-left: auto; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; background: rgba(49, 162, 76, 0.15); color: #31A24C; border: 1px solid rgba(49, 162, 76, 0.3); cursor: pointer; }
        .dr-return-btn:hover { background: rgba(49, 162, 76, 0.25); }

        .dr-available-card { background: #111; border: 1px solid #1a1a1a; border-radius: 10px; padding: 12px; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
        .dr-available-dot { width: 8px; height: 8px; border-radius: 50%; background: #31A24C; flex-shrink: 0; }
        .dr-assign-btn { margin-left: auto; padding: 6px 12px; border-radius: 8px; font-size: 11px; font-weight: 700; background: rgba(24, 119, 242, 0.15); color: #4A9AF5; border: 1px solid rgba(24, 119, 242, 0.3); cursor: pointer; }
        .dr-assign-btn:hover { background: rgba(24, 119, 242, 0.25); }

        .dr-warning-box { background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.2); border-radius: 10px; padding: 12px; margin-bottom: 16px; }
        .dr-warning-title { font-size: 13px; font-weight: 700; color: #F59E0B; display: flex; align-items: center; gap: 6px; }
        .dr-warning-detail { font-size: 12px; color: #888; margin-top: 4px; }

        .dr-history-toggle { background: none; border: 1px solid #222; border-radius: 8px; padding: 8px 14px; color: #888; font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 6px; margin-top: 16px; width: 100%; justify-content: center; }
        .dr-history-toggle:hover { border-color: #444; color: #ccc; }

        .dr-timeline { margin-top: 10px; }
        .dr-timeline-item { display: flex; align-items: flex-start; gap: 10px; padding: 6px 0; font-size: 12px; color: #666; }
        .dr-timeline-dot { width: 6px; height: 6px; border-radius: 50%; background: #333; margin-top: 5px; flex-shrink: 0; }
        .dr-timeline-text b { color: #999; }

        .dr-empty { text-align: center; padding: 20px; color: #444; font-size: 14px; }

        @keyframes dr-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .dr-pulse { animation: dr-pulse 2s ease-in-out infinite; }
      `}</style>

      <div className="dr-page">

        {/* ── Stats Bar ── */}
        <div className="dr-stats">
          <div className="dr-stats-left">
            <span className="dr-stat"><b>{dealers.length}</b> Dealers</span>
            <span className="dr-stat"><b>{dealingDealers.length}</b> Dealing</span>
            <span className="dr-stat"><b>{breakDealers.length}</b> Break</span>
            <span className="dr-stat"><b>{availableDealers.length}</b> Available</span>
            {unassignedTables.length > 0 && (
              <span className="dr-stat" style={{ color: '#F59E0B' }}>
                <b>{unassignedTables.length}</b> Tables Need Dealer
              </span>
            )}
          </div>
          <button className="dr-refresh" onClick={fetchData} title="Refresh">
            <RefreshCw style={{ width: 16, height: 16 }} />
          </button>
        </div>

        <div className="dr-grid">

          {/* ── LEFT: Currently Dealing ── */}
          <div className="dr-main">

            {/* Unassigned tables warning */}
            {unassignedTables.length > 0 && (
              <div className="dr-warning-box">
                <div className="dr-warning-title">
                  <AlertTriangle style={{ width: 16, height: 16 }} />
                  {unassignedTables.length} Active Table{unassignedTables.length > 1 ? 's' : ''} Without a Dealer
                </div>
                <div className="dr-warning-detail">
                  Tables: {unassignedTables.map(t => `T${t.table_number}`).join(', ')}
                </div>
              </div>
            )}

            <div className="dr-section-title">
              <Users style={{ width: 14, height: 14 }} /> At Table ({dealingDealers.length})
            </div>

            {dealingDealers.length === 0 ? (
              <div className="dr-empty">No Dealers Currently Assigned</div>
            ) : (
              dealingDealers.map(dealer => {
                const rotation = getActiveRotation(dealer.id);
                const tableInfo = getTableInfo(rotation);
                const mins = minutesSince(rotation?.started_at);
                const isWarning = mins >= PUSH_WARNING && mins < PUSH_THRESHOLD;
                const isOverdue = mins >= PUSH_THRESHOLD;
                const isLoading = actionLoading === dealer.id;
                const cardClass = `dr-card ${isOverdue ? 'overdue' : isWarning ? 'warning' : ''}`;
                const avatarClass = `dr-avatar ${isOverdue ? 'overdue' : isWarning ? 'warning' : 'dealing'}`;

                return (
                  <div key={dealer.id} className={cardClass}>
                    <div className="dr-card-body">
                      <div className={avatarClass}>T{tableInfo.number}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="dr-name">{dealer.name || dealer.display_name}</div>
                        <div className="dr-meta">
                          {tableInfo.gameType && `${tableInfo.gameType.toUpperCase()} `}
                          {tableInfo.stakes && `${tableInfo.stakes} · `}
                          <span style={{ color: isOverdue ? '#EF4444' : isWarning ? '#F59E0B' : '#666', fontWeight: isOverdue || isWarning ? 700 : 400 }}>
                            {mins}m
                          </span>
                          {rotation?.started_at && ` · Started ${formatTime(rotation.started_at)}`}
                        </div>
                      </div>
                      {isOverdue && <span className="dr-badge overdue-badge">PUSH NOW</span>}
                      {isWarning && !isOverdue && <span className="dr-badge push">PUSH SOON</span>}
                    </div>

                    {pushTarget === dealer.id ? (
                      <div className="dr-push-panel">
                        <div className="dr-push-label">Push To Table:</div>
                        <div className="dr-push-tables">
                          {activeTables.map(t => {
                            const isCurrent = t.id === (rotation?.commander_tables?.id || rotation?.table_id);
                            return (
                              <button key={t.id}
                                className={`dr-push-table ${isCurrent ? 'current' : ''}`}
                                disabled={isCurrent || isLoading}
                                onClick={() => !isCurrent && pushDealer(dealer.id, t.id)}
                              >T{t.table_number}</button>
                            );
                          })}
                          <button className="dr-push-cancel" onClick={() => setPushTarget(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <div className="dr-actions">
                        <button className="dr-action-btn push-btn" onClick={() => setPushTarget(dealer.id)} disabled={isLoading}>
                          <ArrowRightLeft style={{ width: 14, height: 14 }} /> Push
                        </button>
                        <button className="dr-action-btn break-btn" onClick={() => sendOnBreak(dealer.id)} disabled={isLoading}>
                          <Coffee style={{ width: 14, height: 14 }} /> Break
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* ── Rotation History Toggle ── */}
            <button className="dr-history-toggle" onClick={() => setShowHistory(!showHistory)}>
              <History style={{ width: 14, height: 14 }} />
              Rotation History ({history.length})
              {showHistory ? <ChevronUp style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
            </button>

            {showHistory && history.length > 0 && (
              <div className="dr-timeline">
                {history.slice(0, 20).map(r => {
                  const dealerName = r.commander_dealers?.name || r.dealer_name || 'Unknown';
                  const tableNum = r.commander_tables?.table_number || r.table_number || '?';
                  const gameName = r.commander_games?.game_type || '';
                  return (
                    <div key={r.id} className="dr-timeline-item">
                      <div className="dr-timeline-dot" />
                      <div className="dr-timeline-text">
                        <b>{dealerName}</b> → T{tableNum}
                        {gameName ? ` (${gameName.toUpperCase()})` : ''}
                        &nbsp;· {formatTime(r.started_at)} – {formatTime(r.ended_at)}
                        &nbsp;({minutesSince(r.started_at) - minutesSince(r.ended_at)}m)
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {showHistory && history.length === 0 && (
              <div className="dr-empty" style={{ marginTop: 8 }}>No rotation history yet today</div>
            )}
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div className="dr-sidebar">

            {/* On Break */}
            <div className="dr-section-title">
              <Coffee style={{ width: 14, height: 14, color: '#F59E0B' }} /> On Break ({breakDealers.length})
            </div>
            {breakDealers.length === 0 ? (
              <div className="dr-empty" style={{ fontSize: 12, padding: 12 }}>No Dealers On Break</div>
            ) : (
              breakDealers.map(d => (
                <div key={d.id} className="dr-break-card dr-pulse">
                  <div className="dr-break-icon">
                    <Coffee style={{ width: 16, height: 16, color: '#F59E0B' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>{d.name || d.display_name}</div>
                    <div className="dr-break-time">
                      {d.break_started_at ? `${minutesSince(d.break_started_at)}m on break` : 'On break'}
                    </div>
                  </div>
                  <button className="dr-return-btn" onClick={() => returnFromBreak(d.id)}
                    disabled={actionLoading === d.id}>
                    <RotateCcw style={{ width: 12, height: 12, display: 'inline', verticalAlign: 'middle', marginRight: 3 }} />
                    Return
                  </button>
                </div>
              ))
            )}

            {/* Available */}
            <div className="dr-section-title" style={{ marginTop: 20 }}>
              <CheckCircle2 style={{ width: 14, height: 14, color: '#31A24C' }} /> Available ({availableDealers.length})
            </div>
            {availableDealers.length === 0 ? (
              <div className="dr-empty" style={{ fontSize: 12, padding: 12 }}>No Dealers Available</div>
            ) : (
              availableDealers.map(d => (
                <div key={d.id} className="dr-available-card">
                  <div className="dr-available-dot" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: '#ccc' }}>{d.name || d.display_name}</div>
                    {d.certified_games && (
                      <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>
                        {(Array.isArray(d.certified_games) ? d.certified_games : []).map(g => g.toUpperCase()).join(' · ')}
                      </div>
                    )}
                  </div>
                  {unassignedTables.length > 0 && (
                    <button className="dr-assign-btn"
                      onClick={() => assignDealer(d.id, unassignedTables[0]?.id)}
                      disabled={actionLoading === d.id}>
                      Assign → T{unassignedTables[0]?.table_number}
                    </button>
                  )}
                </div>
              ))
            )}

            {/* Quick Stats */}
            <div style={{ marginTop: 24, padding: 14, background: '#111', border: '1px solid #1a1a1a', borderRadius: 10 }}>
              <div className="dr-section-title" style={{ marginBottom: 8 }}>
                <Clock style={{ width: 14, height: 14 }} /> Shift Summary
              </div>
              <div style={{ fontSize: 12, color: '#666', lineHeight: 1.8 }}>
                <div>Active Tables: <b style={{ color: '#ccc' }}>{activeTables.length}</b></div>
                <div>Total Rotations Today: <b style={{ color: '#ccc' }}>{history.length + rotations.length}</b></div>
                <div>Avg Time at Table: <b style={{ color: '#ccc' }}>
                  {dealingDealers.length > 0
                    ? `${Math.round(dealingDealers.reduce((sum, d) => sum + minutesSince(getActiveRotation(d.id)?.started_at), 0) / dealingDealers.length)}m`
                    : '--'}
                </b></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
  );
}
