/**
 * High Hands Tracker
 * /commander/high-hands
 * Record new high hands, verify, view current leader, history
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Plus, Trophy, CheckCircle2, Loader2, RefreshCw, Trash2, Star, X, Crown } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const HAND_RANKS = [
  'Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House',
  'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'One Pair'
];

const RANK_SCORES = {
  'Royal Flush': 10, 'Straight Flush': 9, 'Four of a Kind': 8,
  'Full House': 7, 'Flush': 6, 'Straight': 5,
  'Three of a Kind': 4, 'Two Pair': 3, 'One Pair': 2
};

export default function HighHands() {
  const router = useRouter();
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-high-hands'); }, []);
  const [highHands, setHighHands] = useState([]);
  const [currentHigh, setCurrentHigh] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [venueId, setVenueId] = useState(null);
  const [message, setMessage] = useState(null);

  // Form state
  const [form, setForm] = useState({
    player_name: '', hand_description: '', hand_rank: '', table_number: '', prize_amount: ''
  });

  useEffect(() => {
    try { const s = getStaffData(); if (s.venue_id) setVenueId(s.venue_id); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
  }, []);

  const fetchData = useCallback(async () => {
    if (!venueId) return;
    setLoading(true);
    try {
const json = await commanderFetchJSON(`/api/commander/high-hands?venue_id=${venueId}&limit=50`, {});
      setHighHands(json.high_hands || []);
      setCurrentHigh(json.current_high || null);
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, [venueId]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  // Commander Data Bus - sync high hands across tabs
  useCommanderSync(venueId, fetchData, { entities: ['settings'] });

  const handleSubmit = async () => {
    if (!form.player_name || !form.hand_rank) return;
    setSubmitting(true);
    try {
const res = await commanderFetch('/api/commander/high-hands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          player_name: form.player_name,
          hand_description: `${form.hand_rank}${form.hand_description ? ', ' + form.hand_description : ''}`,
          hand_rank: RANK_SCORES[form.hand_rank] || 0,
          table_number: form.table_number ? parseInt(form.table_number) : null,
          prize_amount: form.prize_amount ? parseFloat(form.prize_amount) : null,
          auto_verify: true
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (res.ok && json.high_hand) {
        setMessage({ type: 'success', text: 'High Hand Recorded!' });
        busEmit.celebration('confetti');
        setShowForm(false);
        setForm({ player_name: '', hand_description: '', hand_rank: '', table_number: '', prize_amount: '' });
        broadcastChange('settings');
        fetchData();
      } else {
        setMessage({ type: 'error', text: json.error || 'Failed To Record' });
      }
    } catch (err) { setMessage({ type: 'error', text: 'Network Error' }); }
    finally { setSubmitting(false); }
  };

  const handleVerify = async (id) => {
    try {
const res = await commanderFetch(`/api/commander/high-hands/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify' })
      });
      if (res.ok) {
        broadcastChange('settings');
        fetchData();
      }
    } catch (err) { console.warn(err); setMessage({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete This High Hand?')) return;
    try {
const res = await commanderFetch(`/api/commander/high-hands/${id}`, {
        method: 'DELETE'});
      if (res.ok) {
        broadcastChange('settings');
        fetchData();
      }
    } catch (err) { console.warn(err); setMessage({ type: 'error', text: 'Action Failed. Please Check Your Connection And Try Again.' }); }
  };

  useEffect(() => {
    if (message) { const t = setTimeout(() => setMessage(null), 3000); return () => clearTimeout(t); }
  }, [message]);

  const today = new Date().toISOString().split('T')[0];
  const todayHands = highHands.filter(h => h.created_at?.startsWith(today));

  return (
    <CommanderLayout title="High Hands" backHref="/commander/dashboard?card=displays">
      <>
        <SEOHead
          title="Commander - High Hands"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-[#B0B3B8]">{todayHands.length} Today</p>
            </div>
            <button onClick={fetchData} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
            <button onClick={() => setShowForm(true)} className="px-3 py-2 rounded-lg bg-[#1877F2] text-white text-sm font-medium flex items-center gap-1.5 active:bg-[#1565D8]">
              <Plus className="w-4 h-4" /> Record
            </button>
          </div>

          {message && (
            <div className={`mx-4 mt-3 px-4 py-2.5 rounded-xl text-sm font-medium ${message.type === 'success' ? 'bg-[#31A24C]/15 text-[#31A24C]' : 'bg-[#EF4444]/15 text-[#EF4444]'
              }`}>{message.text}</div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
          ) : (
            <div className="px-4 py-4 space-y-4">
              {/* Current Leader */}
              <div className="bg-gradient-to-br from-[#F59E0B]/20 to-[#F59E0B]/5 border border-[#F59E0B]/30 rounded-2xl p-5 text-center">
                <Crown className="w-8 h-8 text-[#F59E0B] mx-auto mb-2" />
                <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-1">Current High Hand</p>
                {currentHigh ? (
                  <>
                    <p className="text-2xl font-bold text-white">{currentHigh.hand_description || currentHigh.notes || currentHigh.hand_rank}</p>
                    <p className="text-sm text-[#F59E0B] mt-1">
                      {currentHigh.player_name || currentHigh.profiles?.display_name || 'Unknown'}
                      {currentHigh.prize_amount > 0 && ` - $${currentHigh.prize_amount}`}
                    </p>
                  </>
                ) : (
                  <p className="text-lg text-[#6A6B6D]">No Qualifying Hands Today</p>
                )}
              </div>

              {/* Today's hands */}
              <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">Today&apos;s Hands</h3>
                  <span className="text-xs text-[#B0B3B8]">{todayHands.length} Recorded</span>
                </div>
                {todayHands.length > 0 ? (
                  <div className="divide-y divide-[#3A3B3C]">
                    {todayHands.map(h => (
                      <div key={h.id} className="px-4 py-3 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[#F59E0B]/15 flex items-center justify-center shrink-0">
                          <Star className="w-5 h-5 text-[#F59E0B]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{h.hand_description || h.notes || h.hand_rank}</p>
                          <p className="text-xs text-[#B0B3B8]">
                            {h.player_name || h.profiles?.display_name || 'Unknown'}
                            {h.table_number && ` • T${h.table_number}`}
                            {h.prize_amount > 0 && ` • $${h.prize_amount}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!h.verified_at && (
                            <button onClick={() => handleVerify(h.id)} className="w-8 h-8 rounded-lg bg-[#31A24C]/10 flex items-center justify-center active:bg-[#31A24C]/20" title="Verify">
                              <CheckCircle2 className="w-4 h-4 text-[#31A24C]" />
                            </button>
                          )}
                          {h.verified_at && <span className="text-[10px] text-[#31A24C] font-bold">✓</span>}
                          {!h.verified_at && (
                            <button onClick={() => handleDelete(h.id)} className="w-8 h-8 rounded-lg bg-[#EF4444]/10 flex items-center justify-center active:bg-[#EF4444]/20" title="Delete">
                              <Trash2 className="w-4 h-4 text-[#EF4444]" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-[#6A6B6D] text-sm">No Hands Recorded Today</div>
                )}
              </div>

              {/* History */}
              {highHands.filter(h => !h.created_at?.startsWith(today)).length > 0 && (
                <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#3A3B3C]">
                    <h3 className="text-sm font-bold text-white">Previous Hands</h3>
                  </div>
                  <div className="divide-y divide-[#3A3B3C]">
                    {highHands.filter(h => !h.created_at?.startsWith(today)).slice(0, 20).map(h => (
                      <div key={h.id} className="px-4 py-2.5 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-[#E4E6EB] truncate">{h.hand_description || h.notes || h.hand_rank}</p>
                          <p className="text-xs text-[#6A6B6D]">
                            {h.player_name || h.profiles?.display_name || 'Unknown'} •{' '}
                            {h.created_at ? new Date(h.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                          </p>
                        </div>
                        {h.verified_at && <span className="text-[10px] text-[#31A24C] font-bold px-2 py-0.5 bg-[#31A24C]/10 rounded-full">Verified</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Record Form Modal */}
          {showForm && (
            <div className="fixed inset-0 bg-black/70 z-50 flex items-end">
              <div className="bg-[#242526] w-full rounded-t-3xl max-h-[85vh] overflow-y-auto">
                <div className="px-4 py-4 border-b border-[#3A3B3C] flex items-center justify-between">
                  <h2 className="text-lg font-bold text-white">Record High Hand</h2>
                  <button onClick={() => setShowForm(false)} className="p-2 rounded-lg active:bg-[#3A3B3C]"><X className="w-5 h-5 text-[#B0B3B8]" /></button>
                </div>
                <div className="p-4 space-y-4">
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1.5 block">Player Name *</label>
                    <input type="text" value={form.player_name} onChange={e => setForm({ ...form, player_name: e.target.value })}
                      className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white focus:border-[#1877F2] focus:outline-none"
                      placeholder="Player Name" />
                  </div>
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1.5 block">Hand Rank *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {HAND_RANKS.map(rank => (
                        <button key={rank} onClick={() => setForm({ ...form, hand_rank: rank })}
                          className={`py-2.5 rounded-xl text-xs font-semibold ${form.hand_rank === rank ? 'bg-[#F59E0B] text-black' : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
                            }`}>{rank}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#B0B3B8] mb-1.5 block">Description (Cards)</label>
                    <input type="text" value={form.hand_description} onChange={e => setForm({ ...form, hand_description: e.target.value })}
                      className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white focus:border-[#1877F2] focus:outline-none"
                      placeholder="E.g., Aces Full Of Kings, Quad Jacks" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#B0B3B8] mb-1.5 block">Table #</label>
                      <input type="number" value={form.table_number} onChange={e => setForm({ ...form, table_number: e.target.value })}
                        className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white focus:border-[#1877F2] focus:outline-none"
                        placeholder="Table" />
                    </div>
                    <div>
                      <label className="text-xs text-[#B0B3B8] mb-1.5 block">Prize $</label>
                      <input type="number" step="0.01" value={form.prize_amount} onChange={e => setForm({ ...form, prize_amount: e.target.value })}
                        className="w-full px-4 py-3 bg-[#3A3B3C] border border-[#4E4F50] rounded-xl text-white focus:border-[#1877F2] focus:outline-none"
                        placeholder="0.00" />
                    </div>
                  </div>
                  <button onClick={handleSubmit} disabled={submitting || !form.player_name || !form.hand_rank}
                    className="w-full py-4 rounded-xl bg-[#F59E0B] text-black font-bold text-base flex items-center justify-center gap-2 active:bg-[#D97706] disabled:opacity-50">
                    {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trophy className="w-5 h-5" />}
                    Record High Hand
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <style>{`
`}</style>
      </>
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
