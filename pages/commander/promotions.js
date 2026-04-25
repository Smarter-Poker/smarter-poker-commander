/**
 * Staff Promotions Management Page
 * Create and manage venue promotions (bad beat, high hand, etc.)
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../src/lib/supabase';
import SEOHead from '../../src/components/seo/SEOHead';
import { Gift, Plus, Clock, DollarSign, Edit, Trash2, ToggleLeft, ToggleRight, Trophy, Zap, Target, Loader2, X, Check, Award, CheckCircle, User, BarChart3, CheckSquare, Square, GripVertical } from 'lucide-react';
import PromotionCard from '../../src/components/commander/promotions/PromotionCard';
import PromotionEditor from '../../src/components/commander/promotions/PromotionEditor';
import PromotionBuilder from '../../src/components/commander/promotions/PromotionBuilder';
import HighHandDisplay from '../../src/components/commander/promotions/HighHandDisplay';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getToken, getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const PROMO_TYPES = [
  { value: 'high_hand', label: 'High Hand', icon: Trophy, color: '#F59E0B' },
  { value: 'bad_beat', label: 'Bad Beat Jackpot', icon: Zap, color: '#EF4444' },
  { value: 'splash_pot', label: 'Splash Pot', icon: DollarSign, color: '#31A24C' },
  { value: 'hourly_drawing', label: 'Hourly Drawing', icon: Clock, color: '#1877F2' },
  { value: 'bonus', label: 'Player Bonus', icon: Gift, color: '#1877F2' },
  { value: 'tournament', label: 'Tournament Promo', icon: Target, color: '#EC4899' }
];

const HAND_RANKS = [
  { value: 10, label: 'Royal Flush' },
  { value: 9, label: 'Straight Flush' },
  { value: 8, label: 'Four Of A Kind' },
  { value: 7, label: 'Full House' },
  { value: 6, label: 'Flush' },
  { value: 5, label: 'Straight' },
  { value: 4, label: 'Three Of A Kind' },
  { value: 3, label: 'Two Pair' },
  { value: 2, label: 'One Pair' },
  { value: 1, label: 'High Card' }
];

/* EditPromoModal and CreatePromoModal replaced by shared PromotionEditor component */

function RecordHighHandModal({ isOpen, onClose, onSubmit, venueId, staff }) {
  const [formData, setFormData] = useState({
    player_name: '',
    hand_description: '',
    hand_rank: 8,
    table_number: '',
    prize_amount: 500,
    auto_verify: true
  });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!formData.player_name.trim() || !formData.hand_description.trim()) return;

    setSubmitting(true);
    try {
      const token = getToken();
const res = await commanderFetch('/api/commander/high-hands', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          venue_id: venueId,
          player_name: formData.player_name,
          hand_description: formData.hand_description,
          hand_rank: formData.hand_rank,
          table_number: formData.table_number || null,
          prize_amount: formData.prize_amount,
          auto_verify: formData.auto_verify
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();
      if (res.ok && data.high_hand) {
        onSubmit?.(data.high_hand);
        onClose();
        setFormData({
          player_name: '',
          hand_description: '',
          hand_rank: 8,
          table_number: '',
          prize_amount: 500,
          auto_verify: true
        });
      }
    } catch (error) {
      console.warn('Record high hand failed:', error);
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
          <h3 className="text-lg font-semibold text-white">Record High Hand</h3>
          <button onClick={onClose} className="p-2 hover:bg-[#3A3B3C] rounded-lg">
            <X className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-white mb-2">Player Name</label>
            <input
              type="text"
              value={formData.player_name}
              onChange={(e) => setFormData(prev => ({ ...prev, player_name: e.target.value }))}
              placeholder="e.g., John Smith"
              className="cmd-input w-full"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Hand Type</label>
            <select
              value={formData.hand_rank}
              onChange={(e) => setFormData(prev => ({ ...prev, hand_rank: parseInt(e.target.value) }))}
              className="cmd-input w-full"
            >
              {HAND_RANKS.map((rank) => (
                <option key={rank.value} value={rank.value}>{rank.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-white mb-2">Hand Description</label>
            <input
              type="text"
              value={formData.hand_description}
              onChange={(e) => setFormData(prev => ({ ...prev, hand_description: e.target.value }))}
              placeholder="e.g., Aces Full Of Kings, Quad Jacks"
              className="cmd-input w-full"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-white mb-2">Table Number</label>
              <input
                type="text"
                value={formData.table_number}
                onChange={(e) => setFormData(prev => ({ ...prev, table_number: e.target.value }))}
                placeholder="e.g., 5"
                className="cmd-input w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-white mb-2">Prize Amount</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#B0B3B8]" />
                <input
                  type="number"
                  value={formData.prize_amount}
                  onChange={(e) => setFormData(prev => ({ ...prev, prize_amount: parseInt(e.target.value) || 0 }))}
                  className="cmd-input w-full pl-10"
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 p-3 bg-[#3A3B3C] rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked={formData.auto_verify}
              onChange={(e) => setFormData(prev => ({ ...prev, auto_verify: e.target.checked }))}
              className="w-5 h-5 text-[#1877F2] border-[#3A3B3C] rounded focus:ring-[#1877F2]"
            />
            <div>
              <p className="font-medium text-white">Auto-verify This Hand</p>
              <p className="text-sm text-[#B0B3B8]">Mark as verified by {staff?.display_name || 'you'}</p>
            </div>
          </label>
        </div>

        <div className="p-4 border-t border-[#3A3B3C]">
          <button
            onClick={handleSubmit}
            disabled={!formData.player_name.trim() || !formData.hand_description.trim() || submitting}
            className="w-full h-12 bg-[#F59E0B] text-white font-semibold rounded-lg hover:bg-[#D97706] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Trophy className="w-5 h-5" />}
            Record High Hand
          </button>
        </div>
      </div>
    </div>
  );
}

function HighHandCard({ highHand, onVerify }) {
  const rankLabel = HAND_RANKS.find(r => r.value === highHand.hand_rank)?.label || 'Unknown';

  return (
    <div className="cmd-panel p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center">
            <Trophy className="w-5 h-5 text-[#F59E0B]" />
          </div>
          <div>
            <h3 className="font-semibold text-white">
              {highHand.profiles?.display_name || highHand.player_name || 'Unknown Player'}
            </h3>
            <p className="text-sm text-[#B0B3B8]">{highHand.hand_description}</p>
          </div>
        </div>
        {highHand.verified_at ? (
          <span className="flex items-center gap-1 px-2 py-1 bg-[#31A24C]/10 text-[#31A24C] text-xs font-medium rounded-full">
            <CheckCircle className="w-3 h-3" />
            Verified
          </span>
        ) : (
          <button
            onClick={() => onVerify?.(highHand)}
            className="cmd-btn cmd-btn-primary px-3 py-1 text-xs font-medium rounded-full"
          >
            Verify
          </button>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm text-[#B0B3B8]">
        <span className="flex items-center gap-1">
          <Award className="w-4 h-4" />
          {rankLabel}
        </span>
        {highHand.table_number && (
          <span>Table {highHand.table_number}</span>
        )}
        {highHand.prize_amount && (
          <span className="flex items-center gap-1">
            <DollarSign className="w-4 h-4" />
            ${highHand.prize_amount}
          </span>
        )}
        <span>
          {new Date(highHand.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

function CurrentHighHandBanner({ highHand }) {
  if (!highHand) return null;

  const rankLabel = HAND_RANKS.find(r => r.value === highHand.hand_rank)?.label || 'Unknown';

  return (
    <div className="bg-gradient-to-r from-[#F59E0B] to-[#D97706] rounded-xl p-4 text-white">
      <div className="flex items-center gap-2 mb-2">
        <Trophy className="w-5 h-5" />
        <span className="font-semibold">Current High Hand</span>
      </div>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xl font-bold">
            {highHand.profiles?.display_name || highHand.player_name || 'Unknown'}
          </p>
          <p className="text-white/90">{highHand.hand_description} ({rankLabel})</p>
        </div>
        {highHand.prize_amount && (
          <div className="text-right">
            <p className="text-sm text-white/80">Prize</p>
            <p className="text-2xl font-bold">${highHand.prize_amount}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* PromoCard removed — replaced by PromotionCard component */

export default function PromotionsPage() {
  const router = useRouter();

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-promotions'); }, []);

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [promotions, setPromotions] = useState([]);
  const [highHands, setHighHands] = useState([]);
  const [currentHighHand, setCurrentHighHand] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingPromo, setEditingPromo] = useState(null);
  const [showHighHandModal, setShowHighHandModal] = useState(false);
  const [filter, setFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('promotions');
  const [showAwardsModal, setShowAwardsModal] = useState(false);
  const [selectedPromoForAwards, setSelectedPromoForAwards] = useState(null);
  const [promoAwards, setPromoAwards] = useState([]);
  const [awardsLoading, setAwardsLoading] = useState(false);
  const [useWizard, setUseWizard] = useState(false);
  const [highHandPromo, setHighHandPromo] = useState(null);
  const [promoCodes, setPromoCodes] = useState([]);
  const [promoCodesLoading, setPromoCodesLoading] = useState(false);
  const [seedingPromos, setSeedingPromos] = useState(false);
  const [editingPromoCode, setEditingPromoCode] = useState(null);
  const [editCodeForm, setEditCodeForm] = useState({ code: '', description: '', max_uses: '' });

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }
    try {
      const staffData = JSON.parse(storedStaff);
      setStaff(staffData);
      setVenueId(staffData.venue_id);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  const fetchPromotions = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;
    if (!venueId) return;
    try {
      const token = getToken();
const data = await commanderFetchJSON(`/api/commander/promotions?venue_id=${venueId}`, {});
      if (data.success) {
        setPromotions(data.data?.promotions || []);
      }
    } catch (error) {
      console.warn('Fetch promotions failed:', error);
    } finally {
      setLoading(false);
    }
  }, [venueId]);

  const fetchHighHands = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;
    if (!venueId) return;
    try {
      const token = getToken();
const data = await commanderFetchJSON(`/api/commander/high-hands?venue_id=${venueId}&limit=20`, {});
      if (data.high_hands) {
        setHighHands(data.high_hands);
        setCurrentHighHand(data.current_high);
      }
      // Find active high hand promotion
      const hhPromo = promotions.find(p => p.promotion_type === 'high_hand' && (p.is_active || p.status === 'active'));
      if (hhPromo) setHighHandPromo(hhPromo);
    } catch (error) {
      console.warn('Fetch high hands failed:', error);
    }
  }, [venueId, promotions]);

  const fetchPromoCodes = useCallback(async () => {
    const controller = new AbortController();
    const { signal } = controller;
    setPromoCodesLoading(true);
    try {
      const token = getToken();
const res = await fetch('/api/promo/admin-promo-codes', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setPromoCodes(data.codes || []);
    } catch (err) { console.warn('Fetch promo codes error:', err); }
    finally { setPromoCodesLoading(false); }
  }, []);

  const seedPremadePromos = async () => {
    setSeedingPromos(true);
    try {
      const token = getToken();
const res = await fetch('/api/promo/seed-premade', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        setToast({ type: 'error', text: `${data.message}` });
        fetchPromoCodes();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to seed promos' });
      }
    } catch (err) { console.warn('Seed promos error:', err); setToast({ type: 'error', text: 'Failed to seed promos' }); }
    finally { setSeedingPromos(false); }
  };

  const togglePromoCode = async (code) => {
    try {
      const token = getToken();
const res = await fetch('/api/promo/admin-promo-codes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ id: code.id, is_active: !code.is_active })
      });
      if (res.ok) fetchPromoCodes();
    } catch (err) { console.warn('Toggle promo code error:', err); setToast({ type: 'error', text: 'Action failed: Toggle promo code. Please try again.' }); }
  };

  const deletePromoCode = async (code) => {
    if (!confirm(`Deactivate promo code "${code.code}"?`)) return;
    try {
      const token = getToken();
const res = await fetch(`/api/promo/admin-promo-codes?id=${code.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) fetchPromoCodes();
    } catch (err) { console.warn('Delete promo code error:', err); setToast({ type: 'error', text: 'Action failed: Delete promo code. Please try again.' }); }
  };

  const openEditPromoCode = (code) => {
    setEditCodeForm({ code: code.code, description: code.description || '', max_uses: code.max_uses ?? '' });
    setEditingPromoCode(code);
  };

  const savePromoCode = async () => {
    if (!editingPromoCode) return;
    try {
      const token = getToken();
const res = await fetch('/api/promo/admin-promo-codes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          id: editingPromoCode.id,
          code: editCodeForm.code,
          description: editCodeForm.description,
          max_uses: editCodeForm.max_uses === '' ? null : parseInt(editCodeForm.max_uses) })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      if (res.ok && data.success) {
        setEditingPromoCode(null);
        fetchPromoCodes();
      } else {
        setToast({ type: 'error', text: data.error || 'Failed to save' });
      }
    } catch (err) { console.warn('Save promo code error:', err); setToast({ type: 'error', text: 'Failed to save' }); }
  };

  useEffect(() => {
    if (venueId) {
      fetchPromotions();
      fetchHighHands();
    }
  }, [venueId, fetchPromotions, fetchHighHands]);

  // Commander Data Bus — sync promotions across tabs
  useCommanderSync(venueId, () => { fetchPromotions(); fetchHighHands(); }, { entities: ['settings'] });

  // ── Supabase Realtime — auto-refresh on promotion changes ──
  useEffect(() => {
    if (!venueId) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      const channel = supabase.channel(`promotions-realtime-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'commander_promotions', filter: `venue_id=eq.${venueId}` },
          () => { fetchPromotions(); }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnects = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[Promotions] Realtime channel error: ${status}`);
            if (reconnects < MAX_RECONNECT) {
              reconnects++;
              setTimeout(connectChannel, 3000 * reconnects);
            }
          }
        });
      currentChannel = channel;
    }

    connectChannel();
    return () => { if (currentChannel) supabase.removeChannel(currentChannel); };
  }, [venueId, fetchPromotions]);

  // ── Bulk selection state ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const toggleSelect = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selectedIds.size === filteredPromos.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPromos.map(p => p.id)));
    }
  };
  const clearSelection = () => setSelectedIds(new Set());
  async function bulkToggle(activate) {
    try {
      const token = getToken();
const results = await Promise.allSettled([...selectedIds].map(id =>
        commanderFetch(`/api/commander/promotions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: activate ? 'active' : 'draft', is_active: activate })
        }).then(r => { if (!r.ok) throw new Error('fail'); return r; })
      ));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) setToast({ type: 'error', text: `${failed} of ${selectedIds.size} operations failed` });
      clearSelection();
      broadcastChange('settings');
      fetchPromotions();
    } catch (error) {
      console.warn('Bulk toggle failed:', error);
      setToast({ type: 'error', text: 'Bulk operation failed: ' + error.message });
    }
  }
  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} promotion(s)?`)) return;
    try {
      const token = getToken();
const results = await Promise.allSettled([...selectedIds].map(id =>
        commanderFetch(`/api/commander/promotions/${id}`, { method: 'DELETE'})
        .then(r => { if (!r.ok) throw new Error('fail'); return r; })
      ));
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) setToast({ type: 'error', text: `${failed} of ${selectedIds.size} deletions failed` });
      clearSelection();
      broadcastChange('settings');
      fetchPromotions();
    } catch (error) {
      console.warn('Bulk delete failed:', error);
      setToast({ type: 'error', text: 'Bulk delete failed: ' + error.message });
    }
  }

  // ── Analytics computed data ──
  const analytics = useMemo(() => {
    if (!promotions.length) return null;
    const totalAwarded = promotions.reduce((s, p) => s + (p.total_awarded || 0), 0);
    const totalValue = promotions.reduce((s, p) => s + (p.total_value_awarded || 0), 0);
    const activeCount = promotions.filter(p => p.status === 'active' || p.is_active).length;
    const byType = {};
    promotions.forEach(p => {
      const t = p.promotion_type || 'other';
      if (!byType[t]) byType[t] = { count: 0, awarded: 0, value: 0 };
      byType[t].count++;
      byType[t].awarded += p.total_awarded || 0;
      byType[t].value += p.total_value_awarded || 0;
    });
    const draftCount = promotions.filter(p => p.status === 'draft').length;
    const expiredCount = promotions.filter(p => p.status === 'expired').length;
    const pausedCount = promotions.filter(p => p.status === 'paused').length;
    const avgPerAward = totalAwarded > 0 ? Math.round(totalValue / totalAwarded) : 0;
    return { totalAwarded, totalValue, activeCount, draftCount, expiredCount, pausedCount, total: promotions.length, byType, avgPerAward };
  }, [promotions]);

  useEffect(() => {
    if (activeTab === 'promo-codes' && promoCodes.length === 0) {
      fetchPromoCodes();
    }
  }, [activeTab, promoCodes.length, fetchPromoCodes]);

  async function handleViewAwards(promo) {
    setSelectedPromoForAwards(promo);
    setShowAwardsModal(true);
    setAwardsLoading(true);
    try {
      const token = getToken();
const data = await commanderFetchJSON(`/api/commander/promotions/${promo.id}/awards?limit=50`, {});
      setPromoAwards(data.awards || []);
    } catch (error) {
      console.warn('Fetch awards failed:', error);
      setPromoAwards([]);
    } finally {
      setAwardsLoading(false);
    }
  }

  async function handleVerifyHighHand(highHand) {
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/high-hands/${highHand.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'verify' })
      });
      if (res.ok) {
        fetchHighHands();
        broadcastChange('settings');
      }
    } catch (error) {
      setAwardsLoading(false);
      console.warn('Verify high hand failed:', error);
      setToast({ type: 'error', text: 'Verify high hand failed. Please check your connection and try again.' });
    }
  }

  async function handleToggle(promo) {
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/promotions/${promo.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !promo.is_active })
      });
      if (res.ok) {
        broadcastChange('settings');
        fetchPromotions();
      }
    } catch (error) {
      console.warn('Toggle failed:', error);
      setToast({ type: 'error', text: 'Failed to toggle promotion. Please try again.' });
    }
  }

  async function handleDelete(promo) {
    if (!confirm(`Delete "${promo.name}"?`)) return;
    try {
      const token = getToken();
const res = await commanderFetch(`/api/commander/promotions/${promo.id}`, { method: 'DELETE'});
      if (res.ok) {
        broadcastChange('settings');
        fetchPromotions();
      }
    } catch (error) {
      console.warn('Delete failed:', error);
      setToast({ type: 'error', text: 'Failed to delete promotion. Please try again.' });
    }
  }

  function handleEdit(promo) {
    setEditingPromo(promo);
    setShowEditModal(true);
  }

  async function handleDuplicate(promo) {
    try {
      const token = getToken();
const cloneData = {
        venue_id: venueId,
        name: `${promo.name} (Copy)`,
        description: promo.description,
        promotion_type: promo.promotion_type,
        prize_type: promo.prize_type,
        prize_value: promo.prize_value,
        prize_description: promo.prize_description,
        start_date: promo.start_date,
        end_date: promo.end_date,
        days_of_week: promo.days_of_week,
        start_time: promo.start_time,
        end_time: promo.end_time,
        is_recurring: promo.is_recurring,
        min_stakes: promo.min_stakes,
        min_hours_played: promo.min_hours_played,
        min_buyin: promo.min_buyin,
        game_types: promo.game_types,
        qualifying_hands: promo.qualifying_hands,
        is_featured: false,
        image_url: promo.image_url,
        terms_conditions: promo.terms_conditions,
        settings: promo.settings,
        status: 'draft'
      };
      const res = await commanderFetch('/api/commander/promotions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cloneData)
      });
      if (!res.ok) throw new Error('Request failed');
      const result = await res.json();
      if (result.promotion || result.success) {
        broadcastChange('settings');
        fetchPromotions();
      } else {
        setToast({ type: 'error', text: 'Duplicate failed: ' + (result.error || 'Unknown error') });
      }
    } catch (error) {
      console.warn('Duplicate promo failed:', error);
      setToast({ type: 'error', text: 'Duplicate failed: ' + error.message });
    }
  }

  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredPromos = promotions.filter(p => {
    if (filter === 'active') return p.is_active;
    if (filter === 'inactive') return !p.is_active;
    return true;
  }).sort((a, b) => ((a.settings?.display_order ?? 999) - (b.settings?.display_order ?? 999)));

  async function handleDragEnd(e) {
    if (!draggedId || !dragOverId || draggedId === dragOverId) {
      setDraggedId(null); setDragOverId(null); return;
    }
    const items = [...filteredPromos];
    const fromIdx = items.findIndex(p => p.id === draggedId);
    const toIdx = items.findIndex(p => p.id === dragOverId);
    if (fromIdx < 0 || toIdx < 0) { setDraggedId(null); setDragOverId(null); return; }
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    // Optimistic local update — shows instantly
    const reorderedPromos = promotions.map(p => {
      const idx = items.findIndex(i => i.id === p.id);
      if (idx < 0) return p;
      return { ...p, settings: { ...(p.settings || {}), display_order: idx } };
    });
    setPromotions(reorderedPromos);
    setDraggedId(null); setDragOverId(null);
    // Persist in background
    const token = getToken();
try {
      await Promise.allSettled(items.map((p, idx) =>
        commanderFetch(`/api/commander/promotions/${p.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { ...(p.settings || {}), display_order: idx } })
        }).then(r => { if (!r.ok) throw new Error('revert needed'); })
      ));
      broadcastChange('settings');
    } catch (err) {
      console.warn('Drag reorder save failed:', err);
      setToast({ type: 'error', text: 'Failed to save reorder. Reverting...' });
      fetchPromotions(); // Revert on failure
    }
  }

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Promotions | Commander" backHref="/commander/dashboard?card=displays">
      <>
        <SEOHead
          title="Commander — Promotions"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div style={{ minHeight: '100vh', background: '#18191A', fontFamily: 'Inter, sans-serif' }}>
          {/* ── Premium Header ── */}
          <header style={{
            position: 'sticky', top: 0, zIndex: 40,
            background: '#242526', borderBottom: '1px solid #3A3B3C' }}>
            <div style={{
              maxWidth: 960, margin: '0 auto', padding: '14px 20px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h1 style={{ fontSize: 20, fontWeight: 800, color: '#E4E6EB', margin: 0 }}>
                  Promotions
                </h1>
                <p style={{ fontSize: 13, color: '#8A8D91', margin: '2px 0 0' }}>
                  {activeTab === 'promotions'
                    ? `${promotions.length} Promotion${promotions.length !== 1 ? 's' : ''}`
                    : activeTab === 'high-hands'
                      ? `${highHands.length} High Hand${highHands.length !== 1 ? 's' : ''} Today`
                      : `${promoCodes.length} Promo Code${promoCodes.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              {activeTab === 'promotions' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={() => { setUseWizard(true); setShowCreateModal(true); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 16px', borderRadius: 8,
                      background: 'rgba(24,119,242,0.1)', color: '#1877F2',
                      border: '1px solid rgba(24,119,242,0.3)',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      transition: 'background 0.15s' }}
                  >
                    <Zap size={15} />
                    Wizard
                  </button>
                  <button
                    onClick={() => { setUseWizard(false); setShowCreateModal(true); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 16px', borderRadius: 8,
                      background: '#1877F2', color: '#fff',
                      border: 'none',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      transition: 'background 0.15s' }}
                  >
                    <Plus size={15} />
                    New Promo
                  </button>
                </div>
              ) : activeTab === 'high-hands' ? (
                <button
                  onClick={() => setShowHighHandModal(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 8,
                    background: '#F59E0B', color: '#fff',
                    border: 'none',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  <Trophy size={15} />
                  Record High Hand
                </button>
              ) : (
                <button
                  onClick={seedPremadePromos}
                  disabled={seedingPromos}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 16px', borderRadius: 8,
                    background: '#31A24C', color: '#fff',
                    border: 'none',
                    fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    opacity: seedingPromos ? 0.5 : 1 }}
                >
                  {seedingPromos ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  Load 25 Pre-Made
                </button>
              )}
            </div>

            {/* ── Tab Bar ── */}
            <div style={{
              maxWidth: 960, margin: '0 auto', padding: '0 20px',
              display: 'flex', gap: 0, borderTop: '1px solid #3A3B3C' }}>
              {[
                { key: 'promotions', label: 'Promotions', icon: Gift, color: '#1877F2' },
                { key: 'high-hands', label: 'High Hands', icon: Trophy, color: '#F59E0B' },
                { key: 'promo-codes', label: 'Promo Codes', icon: Target, color: '#31A24C' },
                { key: 'analytics', label: 'Analytics', icon: BarChart3, color: '#8B5CF6' },
              ].map(tab => {
                const isActive = activeTab === tab.key;
                const TabIcon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    style={{
                      padding: '12px 18px', border: 'none', cursor: 'pointer',
                      background: 'transparent',
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 13, fontWeight: isActive ? 700 : 500,
                      color: isActive ? tab.color : '#8A8D91',
                      borderBottom: `2px solid ${isActive ? tab.color : 'transparent'}`,
                      transition: 'color 0.15s, border-color 0.15s' }}
                  >
                    <TabIcon size={15} />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </header>

          {/* ── Main Content ── */}
          <main style={{ maxWidth: 960, margin: '0 auto', padding: '20px 20px 40px' }}>
            {activeTab === 'promotions' ? (
              <>
                {/* Filter Pills */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                  {['All', 'Active', 'Inactive'].map((f) => {
                    const filterVal = f.toLowerCase();
                    const isActive = filter === filterVal;
                    return (
                      <button
                        key={f}
                        onClick={() => setFilter(filterVal)}
                        style={{
                          padding: '7px 18px', borderRadius: 8,
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          background: isActive ? '#1877F2' : '#3A3B3C',
                          color: isActive ? '#fff' : '#B0B3B8',
                          border: isActive ? '1px solid #1877F2' : '1px solid #4E4F50',
                          transition: 'all 0.15s' }}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>

                {/* Bulk Action Toolbar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: selectedIds.size > 0 ? 16 : 0 }}>
                  <button
                    onClick={selectAll}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '6px 12px', borderRadius: 8,
                      background: selectedIds.size > 0 ? 'rgba(24,119,242,0.1)' : '#3A3B3C',
                      color: selectedIds.size > 0 ? '#1877F2' : '#8A8D91',
                      border: `1px solid ${selectedIds.size > 0 ? 'rgba(24,119,242,0.3)' : '#4E4F50'}`,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {selectedIds.size > 0 ? <CheckSquare size={14} /> : <Square size={14} />}
                    {selectedIds.size > 0 ? `${selectedIds.size} Selected` : 'Select'}
                  </button>
                  {selectedIds.size > 0 && (
                    <>
                      <button
                        onClick={() => bulkToggle(true)}
                        style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(49,162,76,0.1)', color: '#4ADE80', border: '1px solid rgba(49,162,76,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Activate All
                      </button>
                      <button
                        onClick={() => bulkToggle(false)}
                        style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.1)', color: '#FBBF24', border: '1px solid rgba(245,158,11,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Deactivate All
                      </button>
                      <button
                        onClick={bulkDelete}
                        style={{ padding: '6px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', color: '#F87171', border: '1px solid rgba(239,68,68,0.3)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        <Trash2 size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                        Delete
                      </button>
                      <button
                        onClick={clearSelection}
                        style={{ padding: '6px 12px', borderRadius: 8, background: '#3A3B3C', color: '#B0B3B8', border: '1px solid #4E4F50', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>

                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                    <Loader2 size={32} color="#1877F2" className="animate-spin" />
                  </div>
                ) : filteredPromos.length === 0 ? (
                  <div style={{
                    background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
                    padding: '48px 24px', textAlign: 'center' }}>
                    <Gift size={48} color="#3A3B3C" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#B0B3B8', fontSize: 15, fontWeight: 500, marginBottom: 8 }}>
                      {filter !== 'all' ? `No ${filter} promotions found` : 'No Promotions Yet'}
                    </p>
                    {filter !== 'all' ? (
                      <button
                        onClick={() => setFilter('all')}
                        style={{
                          padding: '8px 20px', borderRadius: 8,
                          background: '#3A3B3C', color: '#E4E6EB',
                          border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                          marginRight: 8 }}
                      >
                        Clear Filter
                      </button>
                    ) : null}
                    <button
                      onClick={() => setShowCreateModal(true)}
                      style={{
                        padding: '8px 20px', borderRadius: 8,
                        background: '#1877F2', color: '#fff',
                        border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Create Promotion
                    </button>
                  </div>
                ) : (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                    gap: 16 }}>
                    {filteredPromos.map((promo) => (
                      <div
                        key={promo.id}
                        style={{ position: 'relative', opacity: draggedId === promo.id ? 0.4 : 1, border: dragOverId === promo.id ? '2px dashed #1877F2' : '2px solid transparent', borderRadius: 14, transition: 'all 0.15s' }}
                        draggable
                        onDragStart={(e) => { setDraggedId(promo.id); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { e.preventDefault(); setDragOverId(promo.id); }}
                        onDragLeave={() => setDragOverId(null)}
                        onDrop={(e) => { e.preventDefault(); handleDragEnd(e); }}
                        onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                      >
                        {/* Drag Handle */}
                        <div style={{ position: 'absolute', top: 10, left: 8, zIndex: 10, cursor: 'grab', color: '#4E4F50', opacity: 0.5 }}>
                          <GripVertical size={18} />
                        </div>
                        {selectedIds.size > 0 && (
                          <button
                            onClick={() => toggleSelect(promo.id)}
                            style={{
                              position: 'absolute', top: 8, right: 8, zIndex: 10,
                              background: selectedIds.has(promo.id) ? '#1877F2' : '#3A3B3C',
                              border: '2px solid ' + (selectedIds.has(promo.id) ? '#1877F2' : '#4E4F50'),
                              borderRadius: 6, width: 24, height: 24,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              cursor: 'pointer', transition: 'all 0.15s' }}
                          >
                            {selectedIds.has(promo.id) && <Check size={14} color="#fff" />}
                          </button>
                        )}
                        <PromotionCard
                          promotion={promo}
                          onEdit={handleEdit}
                          onViewAwards={handleViewAwards}
                          onDuplicate={handleDuplicate}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : activeTab === 'high-hands' ? (
              <>
                <HighHandDisplay
                  promotion={highHandPromo}
                  currentHighHand={currentHighHand}
                  recentHighHands={highHands.slice(0, 5)}
                  isStaff={true}
                  onSubmitHand={async (handData) => {
                    try {
                      const token = getToken();
const res = await commanderFetch('/api/commander/high-hands', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                          venue_id: venueId,
                          ...handData
                        })
                      });
                      if (res.ok) {
                        fetchHighHands();
                        broadcastChange('settings');
                      }
                    } catch (error) {
                      console.warn('Submit high hand failed:', error);
                      setToast({ type: 'error', text: 'Failed to submit high hand. Please try again.' });
                    }
                  }}
                />

                <div style={{ marginTop: 16 }}>
                  <CurrentHighHandBanner highHand={currentHighHand} />
                </div>

                {loading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                    <Loader2 size={32} color="#F59E0B" className="animate-spin" />
                  </div>
                ) : highHands.length === 0 ? (
                  <div style={{
                    background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
                    padding: '48px 24px', textAlign: 'center', marginTop: 16 }}>
                    <Trophy size={48} color="#3A3B3C" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#B0B3B8', fontSize: 15, fontWeight: 500, marginBottom: 16 }}>
                      No High Hands Recorded Today
                    </p>
                    <button
                      onClick={() => setShowHighHandModal(true)}
                      style={{
                        padding: '10px 24px', borderRadius: 8,
                        background: '#F59E0B', color: '#fff',
                        border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                    >
                      Record High Hand
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#E4E6EB', margin: 0 }}>
                      Recent High Hands
                    </h3>
                    {highHands.map((hh) => (
                      <HighHandCard
                        key={hh.id}
                        highHand={hh}
                        onVerify={handleVerifyHighHand}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : activeTab === 'promo-codes' ? (
              /* === PROMO CODES TAB === */
              <>
                {promoCodesLoading ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
                    <Loader2 size={32} color="#31A24C" className="animate-spin" />
                  </div>
                ) : promoCodes.length === 0 ? (
                  <div style={{
                    background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
                    padding: '48px 24px', textAlign: 'center' }}>
                    <Target size={48} color="#3A3B3C" style={{ margin: '0 auto 12px' }} />
                    <p style={{ color: '#B0B3B8', fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
                      No Promo Codes Yet
                    </p>
                    <p style={{ color: '#8A8D91', fontSize: 13, marginBottom: 16 }}>
                      Click &quot;Load 25 Pre-Made&quot; Above To Add Ready-To-Use Promo Codes
                    </p>
                    <button
                      onClick={seedPremadePromos}
                      disabled={seedingPromos}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '10px 24px', borderRadius: 8,
                        background: '#31A24C', color: '#fff',
                        border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        opacity: seedingPromos ? 0.5 : 1 }}
                    >
                      {seedingPromos ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                      Load 25 Pre-Made Promo Codes
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <p style={{ fontSize: 13, color: '#8A8D91', margin: 0 }}>
                        {promoCodes.length} Promo Codes · {promoCodes.filter(c => c.is_active).length} Active
                      </p>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                      gap: 14 }}>
                      {promoCodes.map(code => (
                        <div key={code.id} style={{
                          background: '#242526', border: '1px solid #3A3B3C', borderRadius: 12,
                          padding: 16, transition: 'border-color 0.15s' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                background: 'rgba(49,162,76,0.15)', color: '#31A24C',
                                padding: '3px 10px', borderRadius: 6,
                                fontFamily: 'monospace', fontSize: 13, fontWeight: 700,
                                border: '1px solid rgba(49,162,76,0.3)' }}>{code.code}</span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                                padding: '3px 8px', borderRadius: 20,
                                background: code.is_active ? 'rgba(49,162,76,0.12)' : '#3A3B3C',
                                color: code.is_active ? '#4ADE80' : '#8A8D91',
                                border: `1px solid ${code.is_active ? 'rgba(49,162,76,0.3)' : '#4E4F50'}`,
                                textTransform: 'uppercase' }}>
                                {code.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                            <button
                              onClick={() => togglePromoCode(code)}
                              style={{
                                background: 'none', border: 'none', padding: 2, cursor: 'pointer',
                                color: code.is_active ? '#31A24C' : '#3A3B3C' }}
                            >
                              {code.is_active ? <ToggleRight size={26} /> : <ToggleLeft size={26} />}
                            </button>
                          </div>
                          <p style={{ fontSize: 13, color: '#E4E6EB', marginBottom: 6, lineHeight: 1.4 }}>{code.description}</p>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#8A8D91' }}>
                            <span>Type: {(code.reward_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                            <span>Value: {code.reward_value}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#8A8D91', marginTop: 4 }}>
                            <span>Uses: {code.promo_code_redemptions?.[0]?.count || code.times_used || 0}{code.max_uses ? ` / ${code.max_uses}` : ' / ∞'}</span>
                            {code.expires_at && <span>Exp: {new Date(code.expires_at).toLocaleDateString()}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid #3A3B3C' }}>
                            <button
                              onClick={() => openEditPromoCode(code)}
                              style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                padding: '8px 12px', borderRadius: 8,
                                background: 'transparent', color: '#1877F2',
                                border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                transition: 'background 0.15s' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(24,119,242,0.08)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <Edit size={13} />
                              Edit
                            </button>
                            <button
                              onClick={() => deletePromoCode(code)}
                              style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                                padding: '8px 12px', borderRadius: 8,
                                background: 'transparent', color: '#EF4444',
                                border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                transition: 'background 0.15s' }}
                              onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.08)'}
                              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                            >
                              <Trash2 size={13} />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : null}

            {/* ── Analytics Tab ── */}
            {activeTab === 'analytics' && (
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#E4E6EB', marginBottom: 20 }}>Promotions Analytics</h2>

                {analytics ? (
                  <>
                    {/* Summary Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 16 }}>
                      {[
                        { label: 'Total Promotions', value: analytics.total, color: '#1877F2', icon: Gift },
                        { label: 'Active Now', value: analytics.activeCount, color: '#4ADE80', icon: CheckCircle },
                        { label: 'Total Awarded', value: analytics.totalAwarded, color: '#F59E0B', icon: Award },
                        { label: 'Total Value', value: `$${analytics.totalValue.toLocaleString()}`, color: '#8B5CF6', icon: DollarSign },
                        { label: 'Avg Per Award', value: analytics.avgPerAward > 0 ? `$${analytics.avgPerAward.toLocaleString()}` : '—', color: '#22D3EE', icon: BarChart3 },
                      ].map((card, i) => {
                        const CardIcon = card.icon;
                        return (
                          <div key={i} style={{
                            background: '#242526', border: '1px solid #3A3B3C', borderRadius: 12,
                            padding: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${card.color}15`, border: `1px solid ${card.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CardIcon size={16} color={card.color} />
                              </div>
                              <span style={{ fontSize: 12, color: '#8A8D91', fontWeight: 500 }}>{card.label}</span>
                            </div>
                            <span style={{ fontSize: 24, fontWeight: 800, color: '#E4E6EB' }}>{card.value}</span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Status Breakdown */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
                      {[
                        { label: 'Draft', value: analytics.draftCount, color: '#9CA3AF' },
                        { label: 'Active', value: analytics.activeCount, color: '#4ADE80' },
                        { label: 'Expired', value: analytics.expiredCount, color: '#F87171' },
                        { label: 'Paused', value: analytics.pausedCount, color: '#FBBF24' },
                      ].map((s, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 20, background: '#242526', border: '1px solid #3A3B3C' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
                          <span style={{ fontSize: 12, color: '#B0B3B8', fontWeight: 500 }}>{s.label}: <strong style={{ color: '#E4E6EB' }}>{s.value}</strong></span>
                        </div>
                      ))}
                    </div>

                    {/* Per-Type Breakdown */}
                    <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: 12, overflow: 'hidden' }}>
                      <div style={{ padding: '14px 18px', borderBottom: '1px solid #3A3B3C' }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: '#E4E6EB', margin: 0 }}>By Promotion Type</h3>
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #3A3B3C' }}>
                            <th style={{ textAlign: 'left', padding: '10px 18px', fontSize: 12, fontWeight: 600, color: '#8A8D91' }}>Type</th>
                            <th style={{ textAlign: 'center', padding: '10px 18px', fontSize: 12, fontWeight: 600, color: '#8A8D91' }}>Count</th>
                            <th style={{ textAlign: 'center', padding: '10px 18px', fontSize: 12, fontWeight: 600, color: '#8A8D91' }}>Awarded</th>
                            <th style={{ textAlign: 'right', padding: '10px 18px', fontSize: 12, fontWeight: 600, color: '#8A8D91' }}>Total Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(analytics.byType || {}).map(([type, data]) => (
                            <tr key={type} style={{ borderBottom: '1px solid rgba(58,59,60,0.5)' }}>
                              <td style={{ padding: '10px 18px', fontSize: 13, color: '#E4E6EB', fontWeight: 600 }}>
                                {type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                              </td>
                              <td style={{ padding: '10px 18px', fontSize: 13, color: '#B0B3B8', textAlign: 'center' }}>{data.count}</td>
                              <td style={{ padding: '10px 18px', fontSize: 13, color: '#B0B3B8', textAlign: 'center' }}>{data.awarded}</td>
                              <td style={{ padding: '10px 18px', fontSize: 13, color: '#4ADE80', fontWeight: 600, textAlign: 'right' }}>${data.value.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: '#8A8D91' }}>
                    <BarChart3 size={48} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                    <p>No promotion data available</p>
                  </div>
                )}
              </div>
            )}
          </main>
        </div>

        {/* === EDIT PROMO CODE MODAL === */}
        {editingPromoCode && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
            <div style={{
              background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
              width: '100%', maxWidth: 440, padding: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#E4E6EB' }}>Edit Promo Code</h3>
                <button
                  onClick={() => setEditingPromoCode(null)}
                  style={{ background: 'none', border: 'none', color: '#8A8D91', cursor: 'pointer', padding: 4 }}
                >
                  <X size={20} />
                </button>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Code Name
                </label>
                <input
                  value={editCodeForm.code}
                  onChange={e => setEditCodeForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: '#18191A', border: '1px solid #3A3B3C', color: '#E4E6EB',
                    fontSize: 15, fontFamily: 'monospace', fontWeight: 700,
                    outline: 'none' }}
                  placeholder="e.g. WELCOME50"
                />
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Description
                </label>
                <input
                  value={editCodeForm.description}
                  onChange={e => setEditCodeForm(f => ({ ...f, description: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: '#18191A', border: '1px solid #3A3B3C', color: '#E4E6EB',
                    fontSize: 14, outline: 'none' }}
                  placeholder="Promotion description"
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Max Uses <span style={{ fontWeight: 400, textTransform: 'none' }}>(leave blank for unlimited)</span>
                </label>
                <input
                  type="number"
                  value={editCodeForm.max_uses}
                  onChange={e => setEditCodeForm(f => ({ ...f, max_uses: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 8,
                    background: '#18191A', border: '1px solid #3A3B3C', color: '#E4E6EB',
                    fontSize: 15, outline: 'none' }}
                  placeholder="∞ Unlimited"
                  min="0"
                />
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setEditingPromoCode(null)}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 8,
                    background: '#3A3B3C', color: '#E4E6EB', border: 'none',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={savePromoCode}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 8,
                    background: '#1877F2', color: '#fff', border: 'none',
                    fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                >
                  <Check size={15} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle' }} />
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {showCreateModal && (
          useWizard ? (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
              <div className="cmd-panel w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">Promotion Wizard</h3>
                  <button
                    onClick={() => { setUseWizard(false); setShowCreateModal(false); }}
                    className="p-2 hover:bg-[#3A3B3C] rounded-lg"
                  >
                    <X className="w-5 h-5 text-[#B0B3B8]" />
                  </button>
                </div>
                <PromotionBuilder
                  venueId={venueId}
                  onSubmit={async (data) => {
                    try {
                      const token = getToken();
const res = await commanderFetch('/api/commander/promotions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                      });
                      if (!res.ok) throw new Error('Request failed');
                      const result = await res.json();
                      if (result.promotion || result.success) {
                        broadcastChange('settings');
                        fetchPromotions();
                        setShowCreateModal(false);
                        setUseWizard(false);
                      } else {
                        setToast({ type: 'error', text: 'Create failed: ' + (result.error || 'Unknown error') });
                      }
                    } catch (error) {
                      console.warn('Create promo failed:', error);
                      setToast({ type: 'error', text: 'Create failed: ' + error.message });
                    }
                  }}
                  onCancel={() => { setUseWizard(false); setShowCreateModal(false); }}
                />
              </div>
            </div>
          ) : (
            <PromotionEditor
              venueId={venueId}
              onSave={async (data) => {
                try {
                  const token = getToken();
const res = await commanderFetch('/api/commander/promotions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                  });
                  if (!res.ok) throw new Error('Request failed');
                  const result = await res.json();
                  if (result.promotion || result.success) {
                    broadcastChange('settings');
                    fetchPromotions();
                    setShowCreateModal(false);
                  } else {
                    setToast({ type: 'error', text: 'Create failed: ' + (result.error || 'Unknown error') });
                  }
                } catch (error) {
                  console.warn('Create promo failed:', error);
                  setToast({ type: 'error', text: 'Create failed: ' + error.message });
                }
              }}
              onClose={() => setShowCreateModal(false)}
            />
          )
        )}

        {showEditModal && editingPromo && (
          <PromotionEditor
            promotion={editingPromo}
            venueId={venueId}
            onSave={async (data) => {
              try {
                const token = getToken();
const res = await commanderFetch(`/api/commander/promotions/${editingPromo.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(data)
                });
                if (!res.ok) throw new Error('Request failed');
                const result = await res.json();
                if (result.success || result.promotion) {
                  fetchPromotions();
                  broadcastChange('settings');
                  setShowEditModal(false);
                  setEditingPromo(null);
                } else {
                  setToast({ type: 'error', text: 'Update failed: ' + (result.error || 'Unknown error') });
                }
              } catch (error) {
                console.warn('Update promo failed:', error);
                setToast({ type: 'error', text: 'Update failed: ' + error.message });
              }
            }}
            onDelete={async (id) => {
              if (!confirm('Delete this promotion?')) return;
              try {
const res = await commanderFetch(`/api/commander/promotions/${id}`, { method: 'DELETE'});
                if (res.ok) {
                  fetchPromotions();
                  broadcastChange('settings');
                  setShowEditModal(false);
                  setEditingPromo(null);
                }
              } catch (error) {
                console.warn('Delete failed:', error);
                setToast({ type: 'error', text: 'Failed to delete promotion. Please try again.' });
              }
            }}
            onClose={() => {
              setShowEditModal(false);
              setEditingPromo(null);
            }}
          />
        )}

        <RecordHighHandModal
          isOpen={showHighHandModal}
          onClose={() => setShowHighHandModal(false)}
          onSubmit={() => fetchHighHands()}
          venueId={venueId}
          staff={staff}
        />

        {/* Awards Modal */}
        {showAwardsModal && selectedPromoForAwards && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="cmd-panel cmd-corner-lights w-full max-w-lg max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-[#3A3B3C]">
                <div>
                  <h3 className="text-lg font-semibold text-white">Awards</h3>
                  <p className="text-sm text-[#B0B3B8]">{selectedPromoForAwards.name}</p>
                </div>
                <button
                  onClick={() => { setShowAwardsModal(false); setSelectedPromoForAwards(null); setPromoAwards([]); }}
                  className="p-2 hover:bg-[#3A3B3C] rounded-lg"
                >
                  <X className="w-5 h-5 text-[#B0B3B8]" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {awardsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-[#1877F2]" />
                  </div>
                ) : promoAwards.length === 0 ? (
                  <div className="text-center py-8">
                    <Award className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                    <p className="text-[#B0B3B8]">No Awards Recorded Yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {promoAwards.map((award) => (
                      <div key={award.id} className="p-3 bg-[#3A3B3C] rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-[#1877F2]/10 flex items-center justify-center">
                              {award.profiles?.avatar_url ? (
                                <img src={award.profiles.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                              ) : (
                                <User className="w-4 h-4 text-[#1877F2]" />
                              )}
                            </div>
                            <span className="font-medium text-white text-sm">
                              {award.profiles?.display_name || award.player_name || 'Unknown'}
                            </span>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${award.status === 'approved'
                            ? 'bg-[#31A24C]/10 text-[#31A24C]'
                            : award.status === 'pending'
                              ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
                              : 'bg-[#3A3B3C]/10 text-[#B0B3B8]'
                            }`}>
                            {award.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-[#B0B3B8]">
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            ${award.prize_value?.toLocaleString() || 0}
                          </span>
                          {award.prize_description && (
                            <span>{award.prize_description}</span>
                          )}
                          <span className="ml-auto">
                            {new Date(award.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <style>{`
`}</style>
      </>
    
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
