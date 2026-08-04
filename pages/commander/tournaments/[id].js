/**
 * Tournament Detail Page - Manage a specific tournament
 * Shows clock, entries, eliminations, and payouts
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect, useCallback } from 'react';
import SkeletonDark from '../../../src/components/ui/SkeletonDark';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import {
  Trophy,
  Clock,
  Users,
  DollarSign,
  Play,
  Pause,
  SkipForward,
  UserMinus,
  UserPlus,
  Award,
  ExternalLink,
  RefreshCw,
  XCircle
} from 'lucide-react';
import EliminatePlayerModal from '../../../src/components/commander/modals/EliminatePlayerModal';
import PayoutModal from '../../../src/components/commander/modals/PayoutModal';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { busEmit, eventBus, EventType } from '../../../src/engine/EventBus';
import useTrainingBus from '../../../src/hooks/useTrainingBus';
import { getStaffSession, getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../../src/components/commander/shared/ConfirmModal";

const STATUS_CONFIG = {
  scheduled: { bg: 'bg-[#64748B]/10', text: 'text-[#64748B]', label: 'Scheduled' },
  registering: { bg: 'bg-[#22D3EE]/10', text: 'text-[#22D3EE]', label: 'Registration Open' },
  running: { bg: 'bg-[#10B981]/10', text: 'text-[#10B981]', label: 'Running' },
  paused: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', label: 'Paused' }, // 2026-07-25 audit fix
  break: { bg: 'bg-[#F59E0B]/10', text: 'text-[#F59E0B]', label: 'On Break' },
  final_table: { bg: 'bg-[#8B5CF6]/10', text: 'text-[#8B5CF6]', label: 'Final Table' },
  completed: { bg: 'bg-[#64748B]/10', text: 'text-[#64748B]', label: 'Completed' },
  cancelled: { bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', label: 'Cancelled' }
};

function formatTime(seconds) {
  if (!seconds || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function TournamentDetailPage() {
  useTrainingBus('commander-tournaments-id');

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-tournaments-id'); }, []);
  const router = useRouter();
  const { id } = router.query;

  const [staff, setStaff] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clockRunning, setClockRunning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  // 2026-07-25 audit fix: clock data comes from the clock API, not tournament columns
  const [clockInfo, setClockInfo] = useState(null);

  const [showEliminateModal, setShowEliminateModal] = useState(false);
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [closing, setClosing] = useState(false);

  // Extract venueId for sync
  const [venueId] = useState(() => {
    if (typeof window === 'undefined') return null;
    return getVenueId();
  });

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Check staff session
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!router.isReady) return;
    const storedStaff = getStaffSession();

    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      setStaff(staffData);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  // Fetch tournament data
  const fetchTournament = useCallback(async (signal) => {
    if (!id) return;

    try {
const headers = { };
      const fo = signal ? { headers, signal } : { headers };
      // 2026-07-25 audit fix: the tournament API never returns clock_status /
      // time_remaining / current blinds — fetch the clock endpoint alongside.
      const [tournamentRes, entriesRes, clockRes] = await Promise.all([
        commanderFetch(`/api/commander/tournaments/${id}`, fo).catch(() => ({ ok: false })),
        commanderFetch(`/api/commander/tournaments/${id}/entries`, fo).catch(() => ({ ok: false })),
        commanderFetch(`/api/commander/tournaments/${id}/clock`, fo).catch(() => ({ ok: false }))
      ]);

      if (!tournamentRes.ok) throw new Error(`Request failed (${tournamentRes.status})`);
      const tournamentData = await tournamentRes.json();
      if (!entriesRes.ok) throw new Error(`Request failed (${entriesRes.status})`);
      const entriesData = await entriesRes.json();

      if (tournamentData.success) {
        setTournament(tournamentData.data.tournament);
      }

      if (clockRes.ok) {
        const clockData = await clockRes.json();
        if (clockData.success && clockData.data) {
          setClockInfo(clockData.data);
          setClockRunning(clockData.data.clock?.isRunning || false);
          setTimeRemaining(clockData.data.clock?.timeRemaining || 0);
        }
      }

      if (entriesData.success) {
        setEntries(entriesData.data.entries || []);
      }
    } catch (error) {
      if (error.name !== 'AbortError') console.warn('Failed to fetch tournament:', error);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Commander Data Bus — instant sync for tournament changes across devices
  useCommanderSync(venueId, fetchTournament, { entities: ['tournaments'] });

  useEffect(() => {
    if (staff && id) {
      const _c = new AbortController();
      fetchTournament(_c.signal);
      return () => _c.abort();
    }
  }, [staff, id, fetchTournament]);

  // EventBus: refresh when mutations happen on other pages (admin creates table, etc.)
  useEffect(() => {
    const unsub = eventBus.on(EventType.DATA_MUTATED, (e) => {
      const relevant = ['tournament_created', 'tournament_registration', 'tournament_updated', 'table_action'];
      if (relevant.includes(e?.payload?.entity)) fetchTournament();
    });
    return () => unsub();
  }, [fetchTournament]);

  // Clock countdown
  useEffect(() => {
    if (!clockRunning || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          setClockRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [clockRunning, timeRemaining]);

  // Clock actions
  async function handleClockAction(action) {
    try {
const res = await commanderFetch(`/api/commander/tournaments/${id}/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (data.success) {
        fetchTournament();
        broadcastChange('tournaments');
      }
    } catch (error) {
      console.warn('Clock action failed:', error);
      setToast({ type: 'error', text: 'Clock action failed. Please try again.' });
    }
  }

  // Tournament status update
  async function handleStatusChange(newStatus) {
    try {
const res = await commanderFetch(`/api/commander/tournaments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (data.success) {
        fetchTournament();
        broadcastChange('tournaments');
      }
    } catch (error) {
      console.warn('Status change failed:', error);
      setToast({ type: 'error', text: 'Status change failed. Please try again.' });
    }
  }

  // View public clock
  function openPublicClock() {
    window.open(`/commander/tournaments/${id}/clock-display`, '_blank');
  }

  const activeEntries = entries.filter(e => e.status === 'active');
  const eliminatedEntries = entries.filter(e => e.status === 'eliminated')
    .sort((a, b) => (a.finish_position || 999) - (b.finish_position || 999));

  const status = STATUS_CONFIG[tournament?.status] || STATUS_CONFIG.scheduled;

  if (!staff || loading) {
    return (
      <div className="cmd-page" style={{ padding: 16 }}>
        <SkeletonDark variant="tournament" />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <div className="text-center">
          <Trophy className="w-12 h-12 text-[#4A5E78] mx-auto mb-3" />
          <p className="text-[#64748B]">Tournament Not Found</p>
          <button
            onClick={() => router.push('/commander/tournaments')}
            className="mt-4 px-4 py-2 cmd-btn cmd-btn-primary rounded-lg"
          >
            Back to Tournaments
          </button>
        </div>
      </div>
    );
  }

  return (
    <CommanderLayout title={`${tournament.name} | Commander`} backHref="/commander/dashboard?card=tournaments">
      <SEOHead
        title="Commander — Details"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="cmd-page">
        {/* Header */}
        <header className="cmd-header-bar sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="font-bold text-white">{tournament.name}</h1>
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${status.bg} ${status.text}`}>
                  {status.label}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchTournament}
                className="p-2 hover:bg-[#132240] rounded-lg transition-colors"
              >
                <RefreshCw className="w-5 h-5 text-[#64748B]" />
              </button>
              <button
                onClick={openPublicClock}
                className="flex items-center gap-2 px-3 py-2 border border-[#4A5E78] rounded-lg hover:bg-[#132240] transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-[#64748B]" />
                <span className="text-sm font-medium text-white">Public Clock</span>
              </button>
              <button
                onClick={() => router.push(`/commander/tournaments/${tournament.id}/settings`)}
                className="flex items-center gap-2 px-3 py-2 border border-[#4A5E78] rounded-lg hover:bg-[#132240] transition-colors"
              >
                <span className="text-sm font-medium text-white">Settings</span>
              </button>
              <button
                onClick={() => router.push(`/commander/td/${tournament.id}`)}
                className="flex items-center gap-2 px-3 py-2 bg-[#1877F2] rounded-lg hover:bg-[#1565D8] transition-colors"
              >
                <span className="text-sm font-medium text-white">TD Tablet</span>
              </button>
              {!['completed', 'cancelled'].includes(tournament.status) && (
                <button
                  onClick={async () => {
                    if (!confirm(`Close tournament "${tournament.name}"? This will cancel the tournament and cannot be undone.`)) return;
                    setClosing(true);
                    try {
const json = await commanderFetchJSON(`/api/commander/tournaments/${tournament.id}`, {
                        method: 'DELETE'});
                      if (json.success) {
                        fetchTournament();
                        broadcastChange('tournaments');
                      } else {
                        setToast({ type: 'error', text: 'Failed to close tournament. Please try again.' });
                      }
                    } catch (err) {
                      console.warn(err);
                      setToast({ type: 'error', text: 'Failed to close tournament' });
                    } finally {
                      setClosing(false);
                    }
                  }}
                  disabled={closing}
                  className="flex items-center gap-2 px-3 py-2 border border-[#EF4444]/40 rounded-lg hover:bg-[#EF4444]/10 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4 text-[#EF4444]" />
                  <span className="text-sm font-medium text-[#EF4444]">{closing ? 'Closing...' : 'Close'}</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
          {/* Clock Section */}
          {/* 2026-07-25 audit fix: clock display driven by the clock API payload
              (currentBlind/clock), and 'paused' status included so Resume is reachable */}
          {['running', 'paused', 'break', 'final_table'].includes(tournament.status) && (
            <div className="bg-[#1F2937] rounded-xl p-6 text-white">
              <div className="text-center mb-6">
                <p className="text-sm text-gray-400 mb-1">
                  Level {clockInfo?.currentBlind?.level || (tournament.current_level || 0) + 1}
                </p>
                <p className="text-6xl font-bold font-mono">
                  {formatTime(timeRemaining)}
                </p>
                <p className="text-lg text-gray-300 mt-2">
                  Blinds: {clockInfo?.currentBlind?.smallBlind ?? 25}/{clockInfo?.currentBlind?.bigBlind ?? 50}
                  {(clockInfo?.currentBlind?.ante || 0) > 0 && ` (${clockInfo.currentBlind.ante} ante)`}
                </p>
              </div>

              <div className="flex justify-center gap-3">
                <button
                  onClick={() => handleClockAction(tournament.status === 'paused' ? 'resume' : 'pause')}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-medium ${tournament.status !== 'paused'
                    ? 'bg-[#F59E0B] hover:bg-[#D97706]'
                    : 'bg-[#10B981] hover:bg-[#059669]'
                    }`}
                >
                  {tournament.status !== 'paused' ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                  {tournament.status !== 'paused' ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => handleClockAction('next_level')}
                  className="flex items-center gap-2 px-6 py-3 bg-white/10 rounded-lg font-medium hover:bg-white/20"
                >
                  <SkipForward className="w-5 h-5" />
                  Next Level
                </button>
              </div>
            </div>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-4 gap-4">
            <div className="cmd-panel p-4 text-center">
              <Users className="w-5 h-5 text-[#22D3EE] mx-auto mb-1" />
              <p className="text-2xl font-bold text-white">{activeEntries.length}</p>
              <p className="text-xs text-[#64748B]">Remaining</p>
            </div>
            <div className="cmd-panel p-4 text-center">
              <Trophy className="w-5 h-5 text-[#F59E0B] mx-auto mb-1" />
              <p className="text-2xl font-bold text-white">{entries.length}</p>
              <p className="text-xs text-[#64748B]">Entries</p>
            </div>
            <div className="cmd-panel p-4 text-center">
              <DollarSign className="w-5 h-5 text-[#10B981] mx-auto mb-1" />
              <p className="text-2xl font-bold text-[#10B981]">
                ${(tournament.actual_prizepool || entries.length * (tournament.buyin_amount || 0)).toLocaleString()}
              </p>
              <p className="text-xs text-[#64748B]">Prize Pool</p>
            </div>
            <div className="cmd-panel p-4 text-center">
              <Clock className="w-5 h-5 text-[#8B5CF6] mx-auto mb-1" />
              <p className="text-2xl font-bold text-white">{tournament.current_level || 1}</p>
              <p className="text-xs text-[#64748B]">Level</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-4">
            {tournament.status === 'scheduled' && (
              <button
                onClick={() => handleStatusChange('registering')}
                className="flex items-center justify-center gap-2 p-4 cmd-btn cmd-btn-primary rounded-xl font-medium transition-colors"
              >
                <UserPlus className="w-5 h-5" />
                Open Registration
              </button>
            )}

            {tournament.status === 'registering' && (
              <button
                onClick={() => handleStatusChange('running')}
                className="flex items-center justify-center gap-2 p-4 bg-[#10B981] text-white rounded-xl font-medium hover:bg-[#059669] transition-colors"
              >
                <Play className="w-5 h-5" />
                Start Tournament
              </button>
            )}

            {['running', 'break', 'final_table'].includes(tournament.status) && (
              <>
                <button
                  onClick={() => setShowEliminateModal(true)}
                  className="flex items-center justify-center gap-2 p-4 bg-[#EF4444] text-white rounded-xl font-medium hover:bg-[#DC2626] transition-colors"
                >
                  <UserMinus className="w-5 h-5" />
                  Eliminate Player
                </button>
                <button
                  onClick={() => setShowPayoutModal(true)}
                  className="flex items-center justify-center gap-2 p-4 bg-[#10B981] text-white rounded-xl font-medium hover:bg-[#059669] transition-colors"
                >
                  <Award className="w-5 h-5" />
                  Payouts
                </button>
              </>
            )}

            {tournament.status === 'running' && activeEntries.length <= 9 && (
              <button
                onClick={() => handleStatusChange('final_table')}
                className="flex items-center justify-center gap-2 p-4 bg-[#8B5CF6] text-white rounded-xl font-medium hover:bg-[#7C3AED] transition-colors col-span-2"
              >
                <Trophy className="w-5 h-5" />
                Final Table
              </button>
            )}
          </div>

          {/* Players Section */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Active Players */}
            <div className="cmd-panel">
              <div className="p-4 border-b border-[#4A5E78]">
                <h3 className="font-semibold text-white">
                  Active Players ({activeEntries.length})
                </h3>
              </div>
              <div className="divide-y divide-[#4A5E78] max-h-80 overflow-y-auto">
                {activeEntries.length === 0 ? (
                  <div className="p-4 text-center text-[#64748B]">
                    No active players
                  </div>
                ) : (
                  activeEntries.map((entry) => (
                    <div key={entry.id} className="p-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-white">
                          {entry.player_name || entry.profiles?.display_name || 'Unknown'}
                        </p>
                        {entry.seat_number && (
                          <p className="text-sm text-[#64748B]">Seat {entry.seat_number}</p>
                        )}
                      </div>
                      <span className="text-sm text-[#64748B]">
                        {/* 2026-08-04 audit fix: entries expose current_chips, not total_chips */}
                        {entry.current_chips?.toLocaleString() || tournament.starting_chips?.toLocaleString() || '10,000'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Eliminated Players */}
            <div className="cmd-panel">
              <div className="p-4 border-b border-[#4A5E78]">
                <h3 className="font-semibold text-white">
                  Eliminated ({eliminatedEntries.length})
                </h3>
              </div>
              <div className="divide-y divide-[#4A5E78] max-h-80 overflow-y-auto">
                {eliminatedEntries.length === 0 ? (
                  <div className="p-4 text-center text-[#64748B]">
                    No eliminations yet
                  </div>
                ) : (
                  eliminatedEntries.map((entry) => (
                    <div key={entry.id} className="p-3 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-[#0D192E] rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-[#64748B]">
                            {entry.finish_position || '-'}
                          </span>
                        </div>
                        <p className="font-medium text-white">
                          {entry.player_name || entry.profiles?.display_name || 'Unknown'}
                        </p>
                      </div>
                      {entry.payout_amount > 0 && (
                        <span className="text-sm font-medium text-[#10B981]">
                          ${entry.payout_amount.toLocaleString()}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Modals */}
      <EliminatePlayerModal
        isOpen={showEliminateModal}
        onClose={() => setShowEliminateModal(false)}
        onSubmit={() => {
          setShowEliminateModal(false);
          fetchTournament();
        }}
        tournament={tournament}
        entries={entries}
      />

      <PayoutModal
        isOpen={showPayoutModal}
        onClose={() => setShowPayoutModal(false)}
        onSubmit={() => {
          setShowPayoutModal(false);
          fetchTournament();
        }}
        tournament={tournament}
        entries={entries}
      />

    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideUp 0.3s ease',
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
