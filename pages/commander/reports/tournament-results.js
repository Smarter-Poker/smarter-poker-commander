/**
 * Tournament Results Report
 * /commander/reports/tournament-results
 * Lists completed tournaments with entries, prize pools, top finishers, payouts
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Trophy, ChevronDown, Loader2 } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

export default function TournamentResultsReport() {
  useEffect(() => { busEmit.sessionStart('commander-reports-tournament-results'); }, []);
  const router = useRouter();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const fetchTournaments = async () => {
        const controller = new AbortController();
        const { signal } = controller;
      try {
const json = await commanderFetchJSON('/api/commander/tournaments?status=completed&limit=50', {});
        if (json.success) {
          const list = json.data?.tournaments || (Array.isArray(json.data) ? json.data : []);
          setTournaments(list);
        }
      } catch (err) { console.warn(err); }
      finally { setLoading(false); }
    };
    fetchTournaments();
  }, []);

  const fetchEntries = async (tournamentId) => {
    if (expanded === tournamentId) { setExpanded(null); return; }
    setExpanded(tournamentId);
    try {
const json = await commanderFetchJSON(`/api/commander/tournaments/${tournamentId}/entries?status=all`, {});
      if (json.success) {
        // Entries API nests under data.entries — data itself is an object
        const entries = Array.isArray(json.data?.entries) ? json.data.entries
          : (Array.isArray(json.data) ? json.data : []);
        setTournaments(prev => prev.map(t =>
          t.id === tournamentId ? { ...t, entries } : t
        ));
      }
    } catch (err) { console.warn(err); }
  };

  return (
    <CommanderLayout title="Tournament Results" backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander — Tournament Results"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
            <h1 className="text-lg font-bold text-white">Tournament Results</h1>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
          ) : tournaments.length === 0 ? (
            <div className="text-center py-20">
              <Trophy className="w-10 h-10 text-[#3A3B3C] mx-auto mb-3" />
              <p className="text-[#B0B3B8]">No Completed Tournaments Yet</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {tournaments.map(t => (
                <div key={t.id} className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                  <button onClick={() => fetchEntries(t.id)}
                    className="w-full p-4 flex items-center gap-3 active:bg-[#3A3B3C] text-left">
                    <Trophy className="w-6 h-6 text-[#F59E0B]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-white truncate">{t.name}</p>
                      <div className="flex items-center gap-3 text-xs text-[#B0B3B8] mt-0.5">
                        <span>{t.start_time ? new Date(t.start_time).toLocaleDateString() : '--'}</span>
                        <span>{t.total_entries || '?'} entries</span>
                        <span className="text-[#31A24C] font-medium">${(t.actual_prizepool || t.prize_pool || 0).toLocaleString()}</span>
                      </div>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-[#B0B3B8] transition-transform ${expanded === t.id ? 'rotate-180' : ''}`} />
                  </button>

                  {expanded === t.id && t.entries && (
                    <div className="border-t border-[#3A3B3C] px-4 py-3">
                      <div className="space-y-1">
                        {t.entries
                          .filter(e => e.finish_position)
                          .sort((a, b) => a.finish_position - b.finish_position)
                          .slice(0, 20)
                          .map(e => (
                            <div key={e.id} className="flex items-center gap-3 py-2">
                              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${e.finish_position === 1 ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                                e.finish_position <= 3 ? 'bg-[#1877F2]/20 text-[#1877F2]' :
                                  'bg-[#3A3B3C] text-[#B0B3B8]'
                                }`}>
                                {e.finish_position}
                              </span>
                              <span className="flex-1 text-sm text-[#E4E6EB]">{e.player_name}</span>
                              {e.payout_amount > 0 && (
                                <span className="text-sm font-medium text-[#31A24C]">${e.payout_amount.toLocaleString()}</span>
                              )}
                            </div>
                          ))}
                      </div>
                      {t.entries.length > 20 && (
                        <p className="text-xs text-[#B0B3B8] text-center mt-2">
                          Showing top 20 of {t.entries.length} entries
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    </CommanderLayout>
  );
}
