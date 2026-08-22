/**
 * Waitlist Player View - Read-Only Desk Clone
 * /commander/displays/waitlist
 * Exact visual duplicate of /commander/waitlist/desk
 * but fully read-only - no action buttons, no modals, no editing.
 * Auto-refreshes every 5 seconds. Designed for TV / player-facing display.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';

import useCommanderSync from '../../../src/lib/commander/useCommanderSync';
import { Loader2, Users, ArrowLeft, CheckCircle } from 'lucide-react';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import useWakeLock from '../../../src/hooks/useWakeLock';
import { busEmit } from '../../../src/engine/EventBus';
import { getVenueId, getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { titleCase } from '../../../src/lib/commander/formatters';
import { lighten, darken } from '../../../src/lib/commander/colorUtils';

// titleCase imported from '@/lib/commander/formatters'

const GAMES_PER_PAGE = 4;
const ROTATE_INTERVAL = 10000;

// Default customization - matches desk.js exactly
const DEFAULT_CUSTOM = {
  headerColor: '#B8860B',
  accentColor: '#D4AF37',
  bgColor: '#000000',
  cardBgColor: '#050505',
  textColor: '#E0E0E0',
  borderColor: '#666666',
  logoUrl: '',
  tickerMessage: '',
  gameTypes: [],
  playerFontSize: 28 };

export default function WaitlistDisplay() {
  useEffect(() => { busEmit.sessionStart('commander-displays-waitlist'); }, []);
  const router = useRouter();
  const [tables, setTables] = useState([]);
  const [waitlists, setWaitlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venueName, setVenueName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [custom, setCustom] = useState(DEFAULT_CUSTOM);
  useWakeLock();

  // Load venue info
  useEffect(() => {
    try {
      const staff = getStaffData();
      if (staff.venue_name) setVenueName(staff.venue_name);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  // Fetch customization settings - periodic re-fetch so desk changes sync
  const fetchSettings = useCallback(async (signal) => {
    try {
const opts = signal ? { signal }
        : {};
      const json = await commanderFetchJSON('/api/commander/settings', opts);
      if (json.success && json.data?.desk_customization) {
        setCustom(prev => ({ ...prev, ...json.data.desk_customization }));
      }
    } catch (err) { if (err.name !== 'AbortError') { /* non-fatal */ } }
  }, []);

  useEffect(() => {
    fetchSettings();
    const settingsInterval = setInterval(fetchSettings, 30000); // Re-fetch settings every 30s
    return () => clearInterval(settingsInterval);
  }, [fetchSettings]);

  // fetchData - EXACT copy of desk.js logic (desk is source of truth)
  const fetchData = useCallback(async (signal) => {
    try {
const staffData = getStaffData();
      const vid = staffData.venue_id || '';
      const headers = { };
      const opts = signal ? { headers, signal } : { headers };
      const [tabRes, wlRes] = await Promise.all([
        commanderFetch(`/api/commander/tables?venue_id=${vid}`, opts).catch(() => ({ ok: false })),
        commanderFetch(`/api/commander/waitlist?venue_id=${vid}`, opts).catch(() => ({ ok: false }))
      ]);
      if (!tabRes.ok) throw new Error(`Request failed (${tabRes.status})`);
      const tabJson = await tabRes.json();
      if (!wlRes.ok) throw new Error(`Request failed (${wlRes.status})`);
      const wlJson = await wlRes.json();
      if (tabJson.success) setTables(tabJson.data?.tables || tabJson.data || []);
      if (wlJson.success) {
        const entries = wlJson.data || [];
        setWaitlists(entries);
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchData(controller.signal);
    const interval = setInterval(fetchData, 30000); // fallback - real-time sync handles instant updates
    return () => { controller.abort(); clearInterval(interval); };
  }, [fetchData]);

  // Real-time Supabase subscription - same as desk.js
  const [venueId] = useState(() => {
    return getVenueId();
  });
  useCommanderSync(venueId, fetchData, { entities: ['waitlist', 'tables', 'games'] });

  // ── GROUP & SORT (identical to desk.js) ──────────────────────────
  const waitlistByGame = {};
  // Seed with custom game types so empty columns persist
  if (custom.gameTypes && custom.gameTypes.length > 0) {
    custom.gameTypes.forEach(label => {
      if (!waitlistByGame[label]) waitlistByGame[label] = [];
    });
  }
  // Also seed from active tables
  tables.forEach(t => {
    if (t.is_active === false || t.status === 'maintenance') return;
    const games = Array.isArray(t.commander_games) ? t.commander_games : [];
    const activeGame = games.find(g => g.status !== 'closed') || games[0];
    const gameType = (t.game_type || activeGame?.game_type || '').toUpperCase();
    const stakes = (t.stakes || activeGame?.stakes || '').trim();
    if (!gameType) return;
    const key = stakes ? `${gameType} ${stakes}` : gameType;
    if (!waitlistByGame[key]) waitlistByGame[key] = [];
  });
  waitlists.filter(w => w.status === 'waiting' || w.status === 'called').forEach(w => {
    const key = w.stakes ? `${(w.game_type || 'NLH').toUpperCase()} ${w.stakes}` : (w.game_type || 'Unknown').toUpperCase();
    if (!waitlistByGame[key]) waitlistByGame[key] = [];
    waitlistByGame[key].push(w);
  });
  Object.values(waitlistByGame || {}).forEach(entries => {
    entries.sort((a, b) => {
      if (a.status === 'called' && b.status !== 'called') return -1;
      if (b.status === 'called' && a.status !== 'called') return 1;
      const posA = a.position ?? 9999;
      const posB = b.position ?? 9999;
      if (posA !== posB) return posA - posB;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  });

  const getTableNums = (gameLabel) => {
    const parts = gameLabel.split(' ');
    const gameType = parts[0];
    const stakes = parts.slice(1).join(' ');
    const cleanStakes = stakes.replace(/\$/g, '');
    const cleanLabel = gameLabel.replace(/\$/g, '');
    return tables
      .filter(t => {
        if (t.is_active === false || t.status === 'maintenance') return false;
        const games = Array.isArray(t.commander_games) ? t.commander_games : [];
        const activeGame = games.find(g => g.status !== 'closed') || games[0];
        const tGame = (t.game_type || activeGame?.game_type || '').toUpperCase();
        const tStakes = (t.stakes || activeGame?.stakes || '').trim();
        const cleanTStakes = tStakes.replace(/\$/g, '');
        if (tGame === gameType && cleanTStakes === cleanStakes) return true;
        if (tGame === gameType && !cleanTStakes && !cleanStakes) return true;
        return `${tGame} ${cleanTStakes}`.trim() === cleanLabel;
      })
      .map(t => t.table_number)
      .sort((a, b) => a - b);
  };

  const breakTables = tables
    .filter(t => t.status === 'break' || t.status === 'dealer_break')
    .map(t => t.table_number)
    .sort((a, b) => a - b);

  const activeTables = tables.filter(t => t.is_active !== false && t.status !== 'maintenance');
  const totalWaiting = waitlists.filter(w => w.status === 'waiting').length;
  const gameEntries = Object.entries(waitlistByGame || {});

  // ── PAGINATION ─────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(gameEntries.length / GAMES_PER_PAGE));
  const visibleGames = gameEntries.slice(
    currentPage * GAMES_PER_PAGE,
    (currentPage + 1) * GAMES_PER_PAGE
  );

  useEffect(() => {
    if (totalPages <= 1) return;
    const timer = setInterval(() => {
      setCurrentPage(prev => (prev + 1) % totalPages);
    }, ROTATE_INTERVAL);
    return () => clearInterval(timer);
  }, [totalPages]);

  useEffect(() => {
    if (currentPage >= totalPages) setCurrentPage(0);
  }, [totalPages, currentPage]);

  // Ticker
  const CALL_EXPIRY_MINUTES = 10;
  const tickerParts = [];
  if (breakTables.length > 0) tickerParts.push(`BREAK ${breakTables.join('--')}`);
  if (custom.tickerMessage) tickerParts.push(custom.tickerMessage);
  else tickerParts.push('Download the Smarter Poker App for live waitlist updates');
  tickerParts.push(`${totalWaiting} players currently waiting`);
  const tickerMessage = tickerParts.join('   \u00A0\u00A0\u00A0-\u00A0\u00A0\u00A0   ');

  // ── DYNAMIC STYLES ──────────────────────────────────────────────
  const c = custom;
  const headerGradient = `linear-gradient(180deg, ${lighten(c.headerColor, 15)}, ${c.headerColor}, ${darken(c.headerColor, 25)})`;
  const headerBorderBottom = `2px solid ${darken(c.headerColor, 30)}`;

  if (loading) {
    return <div style={{ minHeight: '100vh', background: c.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 className="animate-spin" size={32} color={c.accentColor} />
    </div>;
  }

  return (
    <>
      <SEOHead title="Player View - Poker Waiting List" noindex={true} />
      <div style={{ minHeight: '100vh', background: c.bgColor, color: c.textColor, fontFamily: "var(--font-inter), 'Segoe UI', sans-serif", display: 'flex', flexDirection: 'column' }}>

        {/* ═══ TOP BAR ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', borderBottom: `2px solid ${c.borderColor}44`, background: c.cardBgColor }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '0 0 auto' }}>
            <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={16} color={c.accentColor} />
            </button>
            {c.logoUrl && <img src={c.logoUrl} alt="" style={{ height: '64px', width: 'auto', borderRadius: '6px', objectFit: 'contain' }}  loading="lazy" />}
            <span style={{ fontSize: '22px', fontWeight: 700, color: c.accentColor, letterSpacing: '0.5px', textTransform: 'uppercase', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {venueName || 'Poker Room'}
            </span>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <span style={{ fontSize: '36px', fontWeight: 800, color: c.accentColor, letterSpacing: '4px', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              POKER WAITING LIST
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: '0 0 auto' }}>
            <span style={{ fontSize: '13px', color: `${c.textColor}88`, textAlign: 'right', lineHeight: '1.3', letterSpacing: '0.3px', textTransform: 'uppercase' }}>
              Powered By<br /><strong>Club Commander</strong>
            </span>
          </div>
        </div>

        {/* ═══ STATUS BAR (read-only - no buttons) ═══ */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 16px', borderBottom: `1px solid ${c.borderColor}33`, background: c.cardBgColor }}>
          <span style={{ fontSize: '18px', color: `${c.textColor}88`, fontWeight: 600 }}>
            {totalWaiting} waiting &bull; {gameEntries.length} game{gameEntries.length !== 1 ? 's' : ''}
            {totalPages > 1 && <span style={{ marginLeft: '8px', color: c.accentColor }}>Page {currentPage + 1}/{totalPages}</span>}
          </span>
          <span style={{ fontSize: '13px', color: `${c.textColor}44`, fontWeight: 500 }}>
            PLAYER VIEW - READ ONLY
          </span>
        </div>

        {/* ═══ BRAVO GRID ═══ */}
        {gameEntries.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
            <Users size={40} color={`${c.textColor}33`} />
            <p style={{ color: `${c.textColor}66`, marginTop: '12px', fontSize: '16px' }}>No Games Currently Running</p>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', padding: '12px 16px', gap: '2px', alignItems: 'stretch' }}>
            {visibleGames.map(([gameLabel, entries]) => {
              const tableNums = getTableNums(gameLabel);
              return (
                <div key={gameLabel} style={{ flex: '0 0 calc(25% - 2px)', maxWidth: 'calc(25% - 2px)', minWidth: '140px', border: `3px solid ${c.borderColor}`, borderRadius: '4px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  {/* Header */}
                  <div
                    style={{ padding: '14px 10px', textAlign: 'center', fontWeight: 800, fontSize: '26px', color: '#fff', textTransform: 'uppercase', letterSpacing: '1px', background: headerGradient, textShadow: '0 2px 4px rgba(0,0,0,0.5)', borderBottom: headerBorderBottom }}
                  >
                    {gameLabel}
                  </div>
                  {/* Table Numbers */}
                  <div style={{ padding: '4px 8px', textAlign: 'center', fontSize: '14px', color: `${c.textColor}99`, borderBottom: `1px solid ${c.borderColor}55`, background: c.cardBgColor, fontWeight: 600, letterSpacing: '0.5px' }}>
                    {tableNums.length > 0 ? tableNums.map((tn, i) => (
                      <span key={tn}>
                        {i > 0 && ' · '}
                        <span style={{ color: i === 0 ? c.accentColor : `${c.textColor}77` }}>
                          T{tn}{tableNums.length > 1 ? (i === 0 ? ' ★' : ' ⇢') : ''}
                        </span>
                      </span>
                    )) : '-'}
                  </div>
                  {/* Player Names (read-only - no click actions) */}
                  <div style={{ flex: 1, background: c.bgColor }}>
                    {entries.map((entry) => {
                      const isCalled = entry.status === 'called';
                      const hasApp = entry.signup_method === 'app';
                      const isWeb = entry.signup_method === 'web';
                      const isCheckedIn = !!entry.checked_in_at;
                      const webMinutesLeft = isWeb && !isCheckedIn && entry.created_at
                        ? Math.max(0, Math.ceil((new Date(entry.created_at).getTime() + 60 * 60 * 1000 - Date.now()) / 60000))
                        : null;
                      const isExpired = webMinutesLeft !== null && webMinutesLeft <= 0;
                      const calledMinutesLeft = isCalled && entry.last_called_at
                        ? Math.max(0, Math.ceil((new Date(entry.last_called_at).getTime() + CALL_EXPIRY_MINUTES * 60 * 1000 - Date.now()) / 60000))
                        : null;
                      return (
                        <div key={entry.id}
                          style={{
                            padding: '8px 12px', borderBottom: `1px solid ${c.bgColor === '#000000' ? '#1a1a1a' : c.borderColor + '22'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            backgroundColor: isCalled ? `${c.accentColor}14` : isExpired ? 'rgba(239,68,68,0.08)' : 'transparent'
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            {hasApp && <span style={{ color: c.accentColor, fontSize: '16px' }}>♦</span>}
                            {isWeb && !isCheckedIn && (
                              <span style={{ fontSize: '11px', fontWeight: 800, color: '#fff', background: isExpired ? '#EF4444' : '#3B82F6', padding: '1px 5px', borderRadius: '3px', letterSpacing: '0.5px', lineHeight: '16px' }}>
                                {isExpired ? '⚠ EXPIRED' : 'WEB'}
                              </span>
                            )}
                            {isWeb && isCheckedIn && (
                              <CheckCircle size={14} style={{ color: '#10B981' }} />
                            )}
                            <span style={{ fontSize: `${c.playerFontSize}px`, fontWeight: 700, letterSpacing: '0.3px', color: isCalled ? c.accentColor : isExpired ? '#EF4444' : c.textColor }}>
                              {titleCase(entry.player_name)}
                            </span>
                            {isWeb && !isCheckedIn && webMinutesLeft !== null && !isExpired && (
                              <span style={{ fontSize: '12px', color: webMinutesLeft <= 10 ? '#F59E0B' : '#64748B', fontWeight: 600 }}>
                                {webMinutesLeft}m
                              </span>
                            )}
                          </span>
                          {isCalled && (
                            <span style={{ fontSize: '12px', fontWeight: 800, color: c.bgColor, background: calledMinutesLeft !== null && calledMinutesLeft <= 3 ? '#EF4444' : c.accentColor, padding: '2px 6px', borderRadius: '3px', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              TEXTED{calledMinutesLeft !== null ? ` ${calledMinutesLeft}m` : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Count footer (instead of Join button) */}
                  <div style={{ padding: '8px', background: c.cardBgColor, borderTop: `1px solid ${c.borderColor}44`, marginTop: 'auto', textAlign: 'center' }}>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: `${c.textColor}66`, letterSpacing: '1px', textTransform: 'uppercase' }}>
                      {entries.length} {entries.length === 1 ? 'Player' : 'Players'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ PAGE DOTS ═══ */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', padding: '6px 0', background: c.cardBgColor }}>
            {Array.from({ length: totalPages }, (_, i) => (
              <span
                key={i}
                onClick={() => setCurrentPage(i)}
                style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  cursor: 'pointer', transition: 'all 0.2s',
                  background: i === currentPage ? c.accentColor : `${c.textColor}33`,
                  transform: i === currentPage ? 'scale(1.3)' : 'scale(1)'
                }}
              />
            ))}
          </div>
        )}

        {/* ═══ SCROLLING TICKER ═══ */}
        <div style={{ padding: '18px 0', borderTop: `2px solid ${c.borderColor}55`, background: c.cardBgColor, overflow: 'hidden', whiteSpace: 'nowrap', position: 'relative' }}>
          <div style={{ display: 'inline-flex', animation: 'tickerScroll 30s linear infinite' }}>
            <span style={{ fontSize: '39px', color: c.accentColor, fontWeight: 700, letterSpacing: '1px', paddingRight: '150px', whiteSpace: 'nowrap' }}>{tickerMessage}</span>
            <span style={{ fontSize: '39px', color: c.accentColor, fontWeight: 700, letterSpacing: '1px', paddingRight: '150px', whiteSpace: 'nowrap' }}>{tickerMessage}</span>
          </div>
        </div>

        {/* ═══ DEALER PUSH & BREAK TICKER ═══ */}
        <DealerTicker
          accentColor={c.accentColor}
          bgColor={c.cardBgColor}
          fontSize={24}
          borderColor={c.borderColor}
          speed={20}
          showBorder={true}
        />
      </div>

      <style>{`
        @keyframes tickerScroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </>
  );
}

// lighten, darken imported from '@/lib/commander/colorUtils'
