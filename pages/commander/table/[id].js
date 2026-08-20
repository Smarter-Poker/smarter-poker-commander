/**
 * Table Seating View
 * /commander/table/[id]
 * 
 * Visual overhead view of a single table:
 * - Seat-by-seat layout in an oval/table shape
 * - Each occupied seat shows player name, time remaining
 * - Empty seats are tappable to seat a player
 * - Color-coded time warnings
 * - Dealer position indicator
 * - Quick actions: seat from waitlist, remove player, add time
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { Plus, RefreshCw, UserPlus, ArrowLeft } from 'lucide-react';
import dynamic from 'next/dynamic';
const SkeletonDark = dynamic(() => import('../../../src/components/ui/SkeletonDark'), { ssr: false });
import { busEmit } from '../../../src/engine/EventBus';
import { getVenueId, getStaffData } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

function formatCountdown(minutes) {
  if (!minutes && minutes !== 0) return '--:--';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}` : `${m}m`;
}

export default function TableSeating() {

  useEffect(() => { busEmit.sessionStart('commander-table-id'); }, []);
  const router = useRouter();
  const { id } = router.query;
  const [table, setTable] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSeatPicker, setShowSeatPicker] = useState(null); // seat number to fill

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // fetchData declared first - must precede useEffect/useCommanderSync that reference it
  const fetchData = async (signal) => {
    try {
const venueId = getVenueId();
const headers = { };
      const fo = signal ? { headers, signal } : { headers };
      // 2026-07-25 audit fix: the sessions handler wants table=<number> and
      // venue_id, not table_id (uuid) + status - load the table first, then
      // query sessions by its table_number.
      const [tableRes, waitlistRes] = await Promise.all([
        commanderFetch(`/api/commander/tables/${id}`, fo).then(r => r.json()).catch(() => ({ data: null })),
        commanderFetch(`/api/commander/waitlist?venue_id=${venueId}`, fo).then(r => r.json()).catch(() => ({ data: [] }))
      ]);
      const tableData = tableRes.data || (tableRes.success ? tableRes : null);
      if (tableData) setTable(tableData);
      let sessionsArr = [];
      const tableNumber = tableData?.table_number || tableData?.number;
      if (tableNumber !== undefined && tableNumber !== null && venueId) {
        const sessionsRes = await commanderFetch(`/api/commander/dealer/sessions?table=${tableNumber}&venue_id=${venueId}`, fo)
          .then(r => r.json()).catch(() => ({ data: [] }));
        sessionsArr = Array.isArray(sessionsRes.data) ? sessionsRes.data : [];
      }
      // 2026-07-25 audit fix: handler returns session_status (already filtered to active-ish states)
      setSessions(sessionsArr.filter(s => (s.session_status || s.status) === 'active'));
      const waitlistArr = Array.isArray(waitlistRes.data) ? waitlistRes.data : [];
      setWaitlist(waitlistArr.filter(w => w.status === 'waiting'));
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  };

  useEffect(() => {

  if (!router.isReady) return null;

    if (!id) return;
    const _c = new AbortController();
    fetchData(_c.signal);
    const poll = setInterval(() => fetchData(_c.signal), 30000); // fallback - real-time sync handles instant updates
    return () => { _c.abort(); clearInterval(poll); };
  }, [id]);

  // Real-time sync - instant cross-tab + cross-device updates
  const venueId = typeof window !== 'undefined'
    ? (() => { try { return getStaffData().venue_id || ''; } catch { return ''; } })()
    : '';
  useCommanderSync(venueId, fetchData, { entities: ['tables', 'games', 'waitlist'] });
  const removePlayer = async (sessionId) => {
    try {
const res = await commanderFetch(`/api/commander/dealer/sessions/${sessionId}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'removed' })
      });
      if (res.ok) {
        fetchData();
        broadcastChange('tables');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#18191A]" style={{ padding: 16 }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ background: '#2A2B2C', height: 22, width: 160, borderRadius: 6, marginBottom: 12 }} />
        <SkeletonDark variant="stat-cards" count={3} />
        <div style={{ marginTop: 12 }}>
          <SkeletonDark variant="table-rows" rows={6} />
        </div>
      </div>
    </div>
  );

  if (!table) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center text-white">Table Not Found</div>
  );

  const maxSeats = table.max_seats || table.seats || 9;
  const tableNum = table.table_number || table.number;

  // Map sessions to seats
  const seatMap = {};
  sessions.forEach(s => { seatMap[s.seat_number] = s; });

  // Compute time remaining for each session
  const getTimeRemaining = (session) => {
    if (!session) return null;
    const total = (session.time_allocated_minutes || 0) + (session.time_added_minutes || 0);
    if (!total) return null;
    const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60000);
    return total - elapsed;
  };

  // Position seats in oval
  const getSeatPosition = (index, total) => {
    const angle = (index / total) * 2 * Math.PI - Math.PI / 2;
    const radiusX = 42;
    const radiusY = 35;
    return {
      left: `${50 + radiusX * Math.cos(angle)}%`,
      top: `${50 + radiusY * Math.sin(angle)}%`
    };
  };

  return (
    <>
      <SEOHead
        title="Commander - Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push('/commander/tables')} className="p-2 rounded-lg flex-shrink-0" style={{ background: '#3A3B3C', border: '1px solid #4A4B4C' }}><ArrowLeft className="w-5 h-5 text-white" /></button>
            <div>
              <h1 className="text-lg font-bold text-white">Table {tableNum}</h1>
              <p className="text-xs text-[#B0B3B8]">
                {table.game_type || 'Cash'} {table.stakes || ''} · {sessions.length}/{maxSeats} seats
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-1 rounded ${table.status === 'active' ? 'bg-[#31A24C]/20 text-[#31A24C]' :
              table.status === 'open' ? 'bg-[#1877F2]/20 text-[#1877F2]' :
                'bg-[#3A3B3C] text-[#B0B3B8]'
              }`}>{table.status}</span>
            <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]">
              <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
            </button>
          </div>
        </div>

        {/* Table visual */}
        <div className="p-4">
          <div className="relative mx-auto" style={{ width: '100%', maxWidth: 400, height: 350 }}>
            {/* Table felt */}
            <div className="absolute inset-[15%] rounded-[50%] bg-[#0F5132] border-4 border-[#1A7A4A] shadow-lg flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-bold text-white/30">T{tableNum}</p>
                <p className="text-xs text-white/15">{table.game_type || ''}</p>
              </div>
            </div>

            {/* Seats */}
            {Array.from({ length: maxSeats }).map((_, i) => {
              const seatNum = i + 1;
              const session = seatMap[seatNum];
              const pos = getSeatPosition(i, maxSeats);
              const timeLeft = getTimeRemaining(session);
              const timeColor = timeLeft === null ? '#B0B3B8'
                : timeLeft <= 0 ? '#EF4444'
                  : timeLeft <= 15 ? '#F59E0B'
                    : '#31A24C';

              return (
                <div key={seatNum}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.left, top: pos.top, width: 72, height: 72 }}>
                  {session ? (
                    <button onClick={() => removePlayer(session.id)}
                      className="w-full h-full rounded-full border-2 flex flex-col items-center justify-center text-center p-1"
                      style={{ backgroundColor: `${timeColor}15`, borderColor: `${timeColor}60` }}>
                      <p className="text-[9px] font-semibold text-white truncate w-full px-1" style={{ lineHeight: '1.1' }}>
                        {session.player_name?.split(' ')[0] || `S${seatNum}`}
                      </p>
                      {timeLeft !== null && (
                        <p className="text-xs font-bold" style={{ color: timeColor }}>
                          {formatCountdown(Math.max(0, timeLeft))}
                        </p>
                      )}
                      <p className="text-[8px] text-[#B0B3B8]">Seat {seatNum}</p>
                    </button>
                  ) : (
                    <button onClick={() => setShowSeatPicker(seatNum)}
                      className="w-full h-full rounded-full border-2 border-dashed border-[#3A3B3C] flex flex-col items-center justify-center bg-[#242526] active:bg-[#3A3B3C]">
                      <Plus className="w-4 h-4 text-[#6A6B6D]" />
                      <p className="text-[8px] text-[#6A6B6D]">Seat {seatNum}</p>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Seat picker modal */}
        {showSeatPicker && (
          <div className="px-4 pb-4">
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-white">Seat {showSeatPicker} - Seat a Player</h3>
                <button onClick={() => setShowSeatPicker(null)} className="text-xs text-[#B0B3B8]">Cancel</button>
              </div>

              {waitlist.length > 0 && (
                <>
                  <p className="text-xs text-[#B0B3B8] mb-2">From Waitlist:</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto mb-3">
                    {waitlist.slice(0, 8).map(w => (
                      <button key={w.id}
                        onClick={() => {
                          router.push(`/commander/dealer/${tableNum}?seat=${showSeatPicker}&player=${w.id}`);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-[#3A3B3C] text-left active:bg-[#4A4B4C]">
                        <UserPlus className="w-4 h-4 text-[#1877F2]" />
                        <span className="text-sm text-white">{w.player_name || w.name}</span>
                        <span className="text-[10px] text-[#B0B3B8] ml-auto">{w.game_type}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button onClick={() => router.push(`/commander/dealer/${tableNum}?seat=${showSeatPicker}`)}
                className="w-full py-3 rounded-lg bg-[#1877F2] text-white text-sm font-semibold active:bg-[#1565D8]">
                Open Dealer View
              </button>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="px-4 py-3 flex items-center justify-center gap-4 text-[10px] text-[#B0B3B8]">
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#31A24C]" /> {'>'}15m</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#F59E0B]" /> {'<'}15m</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#EF4444]" /> Expired</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full border border-dashed border-[#3A3B3C]" /> Empty</span>
        </div>
      </div>
      <style>{`
`}</style>
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </>
  );
}
