/**
 * Open Cash Game
 * /commander/open-game
 * 
 * Quick flow for floor manager to open a new cash game:
 * 1. Select game type + stakes
 * 2. Pick table number
 * 3. Auto-pull from waitlist or manually seat players
 * 4. Table goes live
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Check, ChevronRight, Loader2, Play, AlertTriangle } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const GAME_TYPES = [
  { type: 'NLH', name: "No Limit Hold'em", color: '#1877F2' },
  { type: 'PLO', name: 'Pot Limit Omaha', color: '#31A24C' },
  { type: 'Mixed', name: 'Mixed Game', color: '#F59E0B' },
  { type: 'Omaha', name: 'Omaha Hi-Lo', color: '#EF4444' },
  { type: 'Stud', name: '7-Card Stud', color: '#A855F7' }
];

const COMMON_STAKES = {
  NLH: ['$1/$2', '$1/$3', '$2/$5', '$5/$10', '$10/$25'],
  PLO: ['$1/$2', '$2/$5', '$5/$10', '$5/$25'],
  Mixed: ['$2/$4', '$4/$8', '$10/$20'],
  Omaha: ['$2/$4', '$4/$8', '$5/$10'],
  Stud: ['$1/$3', '$2/$4', '$3/$6']
};

export default function OpenGame() {

  useEffect(() => { busEmit.sessionStart('commander-open-game'); }, []);
  const router = useRouter();

  const [step, setStep] = useState(1); // 1: game, 2: table, 3: confirm
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedStakes, setSelectedStakes] = useState(null);
  const [customStakes, setCustomStakes] = useState('');
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [waitlistPlayers, setWaitlistPlayers] = useState([]);
  const [opening, setOpening] = useState(false);
  const [loading, setLoading] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // fetchTables declared first — must precede useEffect/useCommanderSync that reference it
  const fetchTables = useCallback(async () => {
    setLoading(true);
    try {
const venueId = getVenueId();
const json = await commanderFetchJSON(`/api/commander/tables?venue_id=${venueId}`, {});
      if (json.success) {
        const tablesArr = Array.isArray(json.data) ? json.data
          : Array.isArray(json.data?.tables) ? json.data.tables : [];
        setTables(tablesArr.filter(t => t.status === 'available' || !t.status));
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, []);

  // Fetch available tables when on step 2
  useEffect(() => {
    if (step !== 2) return;
    fetchTables();
  }, [step, fetchTables]);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  useCommanderSync(getVenueId(), fetchTables, { entities: ['games', 'tables'] });

  // Fetch waitlist for this game type
  useEffect(() => {
    if (step !== 3 || !selectedGame) return;
    const controller = new AbortController();
    const fetchWaitlist = async () => {
      try {
const venueId = getVenueId();
const json = await commanderFetchJSON(`/api/commander/waitlist?venue_id=${venueId}`, { signal: controller.signal });
        if (json.success) {
          const matching = (json.data || []).filter(w =>
            w.status === 'waiting' &&
            (w.game_type || '').toLowerCase().includes(selectedGame.type.toLowerCase())
          );
          setWaitlistPlayers(matching.slice(0, 10));
        }
      } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    setLoading(false);
    };
    fetchWaitlist();
    return () => controller.abort();
  }, [step, selectedGame]);

  const stakes = selectedStakes || customStakes;

  const openTable = async () => {
    setOpening(true);
    try {
const venueId = getVenueId();
const headers = { 'Content-Type': 'application/json' };
      const gameTypeLower = selectedGame.type.toLowerCase();

      // 1. Create the game record in commander_games
      const gameRes = await commanderFetch('/api/commander/games', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          venue_id: venueId,
          table_id: selectedTable.id,
          game_type: gameTypeLower,
          stakes: stakes,
          max_players: selectedTable.max_seats || selectedTable.seats || 9
        })
      });
      // 2026-08-04 audit fix: do not abort the flow when game creation fails —
      // the block below already handles gameJson.success === false by falling
      // back to updating the table only.
      const gameJson = await gameRes.json().catch(() => ({ success: false }));
      if (!gameJson.success) {
        console.warn('Failed to create game:', gameJson.error);
        // Fallback: still update table even if game creation fails
      }

      // 2. Update table status to active
      const res = await commanderFetch(`/api/commander/tables/${selectedTable.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          status: 'in_use',
          game_type: gameTypeLower,
          stakes: stakes
        })
      });

      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success || gameJson.success) {
        // Broadcast to all other tabs so they update instantly
        broadcastChange('games');
        broadcastChange('tables');
        const tNum = selectedTable.table_number || selectedTable.number;
        // Navigate to dealer view for this table
        router.push(`/commander/dealer/${tNum}`);
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setOpening(false); }
  };

  return (
    <CommanderLayout title="Open Cash Game" backHref="/commander/dashboard?card=floor">
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Progress bar */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <p className="text-xs text-[#B0B3B8]">Step {step} of 3</p>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3].map(s => (
              <div key={s} className={`w-2.5 h-2.5 rounded-full ${s <= step ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'}`} />
            ))}
          </div>
        </div>

        <div className="p-4 space-y-4 max-w-lg mx-auto">

          {/* STEP 1: Select Game + Stakes */}
          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-white">Select Game Type</h2>
              <div className="space-y-2">
                {GAME_TYPES.map(game => (
                  <button key={game.type}
                    onClick={() => { setSelectedGame(game); setSelectedStakes(null); }}
                    className={`w-full px-4 py-4 rounded-xl text-left flex items-center gap-3 border-2 ${selectedGame?.type === game.type
                      ? `border-[${game.color}] bg-[${game.color}]/10`
                      : 'border-[#3A3B3C] bg-[#242526]'
                      }`}
                    style={selectedGame?.type === game.type ? { borderColor: game.color, backgroundColor: `${game.color}10` } : {}}>
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: game.color }} />
                    <div>
                      <p className="text-base font-semibold text-white">{game.name}</p>
                      <p className="text-xs text-[#B0B3B8]">{game.type}</p>
                    </div>
                  </button>
                ))}
              </div>

              {selectedGame && (
                <>
                  <h2 className="text-xl font-bold text-white mt-6">Select Stakes</h2>
                  <div className="grid grid-cols-3 gap-2">
                    {(COMMON_STAKES[selectedGame.type] || []).map(s => (
                      <button key={s} onClick={() => { setSelectedStakes(s); setCustomStakes(''); }}
                        className={`py-3 rounded-xl text-sm font-semibold ${selectedStakes === s ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#E4E6EB]'
                          }`}>{s}</button>
                    ))}
                  </div>
                  <input type="text" value={customStakes}
                    onChange={e => { setCustomStakes(e.target.value); setSelectedStakes(null); }}
                    placeholder="Custom Stakes (e.g. $5/$10/$25)"
                    className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4A4B4C] rounded-xl text-[#E4E6EB] placeholder-[#6A6B6D] focus:outline-none focus:border-[#1877F2]" />
                </>
              )}

              {selectedGame && stakes && (
                <button onClick={() => setStep(2)}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8]">
                  Next <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}

          {/* STEP 2: Select Table */}
          {step === 2 && (
            <>
              <h2 className="text-xl font-bold text-white">
                Select Table for {selectedGame?.name} {stakes}
              </h2>

              {loading ? (
                <div className="py-10 flex justify-center">
                  <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                </div>
              ) : tables.length === 0 ? (
                <div className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-xl p-4 text-center">
                  <AlertTriangle className="w-8 h-8 text-[#F59E0B] mx-auto mb-2" />
                  <p className="text-[#F59E0B] font-medium">No Available Tables</p>
                  <p className="text-sm text-[#B0B3B8] mt-1">All Tables Are Currently In Use Or Need To Be Added In Tables & Floor.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tables.sort((a, b) => (a.table_number || a.number || 0) - (b.table_number || b.number || 0)).map(t => {
                    const tNum = t.table_number || t.number;
                    const isSelected = selectedTable?.id === t.id;
                    return (
                      <button key={t.id || tNum} onClick={() => setSelectedTable(t)}
                        className={`w-full px-4 py-4 rounded-xl text-left flex items-center justify-between border-2 ${isSelected ? 'border-[#1877F2] bg-[#1877F2]/10' : 'border-[#3A3B3C] bg-[#242526]'
                          }`}>
                        <div>
                          <p className="text-lg font-bold text-white">Table {tNum}</p>
                          <p className="text-xs text-[#B0B3B8]">{t.max_seats || t.seats || 9} seats</p>
                        </div>
                        {isSelected && <Check className="w-6 h-6 text-[#1877F2]" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedTable && (
                <button onClick={() => setStep(3)}
                  className="w-full py-4 rounded-xl bg-[#1877F2] text-white text-lg font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8]">
                  Next <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </>
          )}

          {/* STEP 3: Confirm + Open */}
          {step === 3 && (
            <>
              <h2 className="text-xl font-bold text-white">Confirm & Open</h2>

              {/* Summary card */}
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B0B3B8]">Game</span>
                  <span className="text-base font-bold text-white">{selectedGame?.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B0B3B8]">Stakes</span>
                  <span className="text-base font-bold text-white">{stakes}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B0B3B8]">Table</span>
                  <span className="text-base font-bold text-white">Table {selectedTable?.table_number || selectedTable?.number}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#B0B3B8]">Seats</span>
                  <span className="text-base font-bold text-white">{selectedTable?.max_seats || selectedTable?.seats || 9}</span>
                </div>
              </div>

              {/* Waitlist players */}
              {waitlistPlayers.length > 0 && (
                <div className="bg-[#31A24C]/10 border border-[#31A24C]/30 rounded-xl p-4">
                  <p className="text-sm font-semibold text-[#31A24C] mb-2">
                    {waitlistPlayers.length} players waiting for {selectedGame?.type}
                  </p>
                  <div className="space-y-1">
                    {waitlistPlayers.map((p, i) => (
                      <div key={p.id || i} className="flex items-center gap-2 text-sm">
                        <span className="text-white/40 w-5">{i + 1}.</span>
                        <span className="text-white">{p.player_name || p.name || 'Player'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={openTable} disabled={opening}
                className="w-full py-5 rounded-2xl bg-[#31A24C] text-white text-xl font-semibold flex items-center justify-center gap-3 active:bg-[#28883F] disabled:opacity-50">
                {opening ? <Loader2 className="w-6 h-6 animate-spin" /> : <Play className="w-6 h-6" />}
                Open Table
              </button>
            </>
          )}
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
