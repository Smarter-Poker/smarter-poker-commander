/**
 * Responsible Gaming Manager
 * /commander/responsible-gaming
 * Staff view: check player exclusion status, view active exclusions, venue compliance
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import {
  Shield, Search, Loader2, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, Ban, UserX, Users
} from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import useDebounce from '../../src/hooks/useDebounce';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

export default function ResponsibleGaming() {
  useEffect(() => { busEmit.sessionStart('commander-responsible-gaming'); }, []);
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [venueId, setVenueId] = useState(null);

  useEffect(() => {
    try { const s = getStaffData(); if (s.venue_id) setVenueId(s.venue_id); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  // Load members to check exclusion status
  const fetchMembers = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
      const json = await commanderFetchJSON(`/api/commander/members?venue_id=${venueId}&limit=200`);
      if (json.success) setMembers(json.data || []);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchMembers(_c.signal); return () => _c.abort(); }, [fetchMembers]);

  // Commander Data Bus — sync when members or exclusions change
  useCommanderSync(venueId || '', fetchMembers, { entities: ['members'] });

  // Search/check specific player
  const executeSearch = useCallback(async (query) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      // Search members first
      const res = await commanderFetch(`/api/commander/members/search?q=${encodeURIComponent(query)}&venue_id=${venueId}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      const players = json.data || json.members || [];

      if (players.length === 0) {
        setSearchResult({ found: false, query: searchQuery });
        return;
      }

      // Check exclusion status for each found player
      const results = [];
      for (const player of players.slice(0, 5)) {
        try {
          const checkRes = await commanderFetch(`/api/commander/responsible-gaming/check/${player.user_id || player.id}?venue_id=${venueId}`);
          if (!checkRes.ok) throw new Error(`Request failed (${checkRes.status})`);
          const checkJson = await checkRes.json();
          results.push({
            ...player,
            exclusion: checkJson.data || checkJson,
            is_excluded: checkJson.data?.is_excluded || checkJson.is_excluded || false
          });
        } catch {
          setLoading(false);
          results.push({ ...player, exclusion: null, is_excluded: false });
        }
      }
      setSearchResult({ found: true, players: results });
    } catch (err) {
      console.warn(err);
      setSearchResult({ found: false, error: true });
    }
    finally { setSearching(false); }
  }, [venueId]); // getToken is defined outside and uses local storage, safe to omit from deps

  useEffect(() => {
    if (debouncedSearchQuery && debouncedSearchQuery.trim()) {
      executeSearch(debouncedSearchQuery);
    } else {
      setSearchResult(null);
    }
  }, [debouncedSearchQuery, executeSearch]);

  const handleSearch = () => executeSearch(searchQuery);

  // Stats
  const totalMembers = members.length;
  const excludedMembers = members.filter(m => m.is_excluded || m.self_excluded).length;

  return (
    <CommanderLayout title="Responsible Gaming" backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander — Responsible Gaming"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <h1 className="text-lg font-bold text-white">Responsible Gaming</h1>
              <p className="text-xs text-[#B0B3B8]">Player Protection & Compliance</p>
            </div>
            <button onClick={fetchMembers} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
          </div>

          <div className="px-4 py-4 space-y-4">
            {/* Info banner */}
            <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-2xl p-4 flex items-start gap-3">
              <Shield className="w-5 h-5 text-[#1877F2] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm text-white font-medium">Player Safety First</p>
                <p className="text-xs text-[#B0B3B8] mt-1">Check Player Exclusion Status Before Seating. Self-Excluded Players Must Not Be Allowed To Play. Contact Management For Enforcement Questions.</p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4 text-center">
                <Users className="w-6 h-6 text-[#1877F2] mx-auto mb-1" />
                <p className="text-2xl font-bold text-white">{totalMembers}</p>
                <p className="text-xs text-[#B0B3B8]">Total Members</p>
              </div>
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4 text-center">
                <Ban className="w-6 h-6 text-[#EF4444] mx-auto mb-1" />
                <p className="text-2xl font-bold text-[#EF4444]">{excludedMembers}</p>
                <p className="text-xs text-[#B0B3B8]">Active Exclusions</p>
              </div>
            </div>

            {/* Player Check */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-3">Check Player Status</h3>
              <div className="flex gap-2">
                <input type="text" value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  className="flex-1 px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white text-sm focus:border-[#1877F2] focus:outline-none"
                  placeholder="Search By Name, Phone, Or Member #" />
                <button onClick={handleSearch} disabled={searching || !searchQuery.trim()}
                  className="px-4 py-3 rounded-xl bg-[#1877F2] text-white font-medium flex items-center gap-1.5 active:bg-[#1565D8] disabled:opacity-50">
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>

              {/* Search Results */}
              {searchResult && (
                <div className="mt-3 space-y-2">
                  {!searchResult.found ? (
                    <div className="py-4 text-center text-[#6A6B6D] text-sm">No players found for &quot;{searchResult.query}&quot;</div>
                  ) : (
                    searchResult.players.map((p, i) => (
                      <div key={i} className={`rounded-xl p-3 flex items-center gap-3 ${p.is_excluded ? 'bg-[#EF4444]/10 border border-[#EF4444]/30' : 'bg-[#31A24C]/10 border border-[#31A24C]/30'
                        }`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${p.is_excluded ? 'bg-[#EF4444]/20' : 'bg-[#31A24C]/20'
                          }`}>
                          {p.is_excluded ? <UserX className="w-5 h-5 text-[#EF4444]" /> : <CheckCircle2 className="w-5 h-5 text-[#31A24C]" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-white">
                            {p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Unknown'}
                          </p>
                          {p.is_excluded ? (
                            <p className="text-xs text-[#EF4444] font-medium">
                              EXCLUDED — Do not seat this player
                              {p.exclusion?.expires_at && ` (until ${new Date(p.exclusion.expires_at).toLocaleDateString()})`}
                            </p>
                          ) : (
                            <p className="text-xs text-[#31A24C]">Clear — OK To Seat</p>
                          )}
                        </div>
                        {p.is_excluded && (
                          <AlertTriangle className="w-6 h-6 text-[#EF4444] shrink-0" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Guidelines */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-3">Staff Guidelines</h3>
              <div className="space-y-3">
                {[
                  { icon: Search, text: 'Always Check New Players Before Seating', color: '#1877F2' },
                  { icon: Ban, text: 'Self-excluded Players Must Be Denied Entry To Gaming Areas', color: '#EF4444' },
                  { icon: Clock, text: 'Monitor For Signs Of Problem Gambling (chasing Losses, Extended Sessions)', color: '#F59E0B' },
                  { icon: Shield, text: 'Offer Responsible Gaming Resources When Asked', color: '#31A24C' },
                ].map((g, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <g.icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: g.color }} />
                    <p className="text-sm text-[#B0B3B8]">{g.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Resources */}
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl p-4">
              <h3 className="text-sm font-bold text-white mb-2">Resources</h3>
              <p className="text-xs text-[#B0B3B8]">National Problem Gambling Helpline: <span className="text-[#1877F2] font-mono">1-800-522-4700</span></p>
              <p className="text-xs text-[#B0B3B8] mt-1">Available 24/7 • Confidential</p>
            </div>
          </div>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
