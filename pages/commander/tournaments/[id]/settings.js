/**
 * Tournament Settings & Structure Editor
 * /commander/tournaments/[id]/settings
 * 
 * - Edit blind structure (add/remove/reorder levels + breaks)
 * - Payout calculator (auto-compute based on entries and structure)
 * - Tournament configuration (buy-in, starting chips, late reg, rebuys)
 * - Save/load structure templates
 * - Print-ready blind structure sheet
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import { Save, Plus, Trash2, Clock, DollarSign, Coffee, ChevronUp, ChevronDown, Loader2, Settings, Check, ArrowLeft } from 'lucide-react';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../../src/engine/EventBus';
import { getStaffSession } from '../../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../../src/lib/commander/commanderFetch';

const parseBlinds = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.length > 0) { try { const p = JSON.parse(raw); if (Array.isArray(p)) return p; } catch (e) { console.warn('[App] Handled exception:', e); } }
  return [];
};

// ===== PRESET TEMPLATES =====
// All templates use BB Ante (ante = Big-Blind) and 10-min breaks every ~2 hours
// All templates support 40 levels to cover any tournament length
const STRUCTURE_TEMPLATES = {
  turbo: {
    name: 'Turbo',
    description: '10-min Levels, BB Ante, Fast Action (40 levels)',
    starting_chips: 10000,
    levels: [
      { small_blind: 25, big_blind: 50, ante: 0, duration: 10 },
      { small_blind: 50, big_blind: 100, ante: 0, duration: 10 },
      { small_blind: 75, big_blind: 150, ante: 150, duration: 10 },
      { small_blind: 100, big_blind: 200, ante: 200, duration: 10 },
      { small_blind: 150, big_blind: 300, ante: 300, duration: 10 },
      { small_blind: 200, big_blind: 400, ante: 400, duration: 10 },
      { is_break: true, duration: 10 },
      { small_blind: 300, big_blind: 600, ante: 600, duration: 10 },
      { small_blind: 400, big_blind: 800, ante: 800, duration: 10 },
      { small_blind: 500, big_blind: 1000, ante: 1000, duration: 10 },
      { small_blind: 700, big_blind: 1400, ante: 1400, duration: 10 },
      { small_blind: 1000, big_blind: 2000, ante: 2000, duration: 10 },
      { small_blind: 1500, big_blind: 3000, ante: 3000, duration: 10 },
      { is_break: true, duration: 10 },
      { small_blind: 2000, big_blind: 4000, ante: 4000, duration: 10 },
      { small_blind: 3000, big_blind: 6000, ante: 6000, duration: 10 },
      { small_blind: 4000, big_blind: 8000, ante: 8000, duration: 10 },
      { small_blind: 5000, big_blind: 10000, ante: 10000, duration: 10 },
      { small_blind: 6000, big_blind: 12000, ante: 12000, duration: 10 },
      { small_blind: 8000, big_blind: 16000, ante: 16000, duration: 10 },
      { is_break: true, duration: 10 },
      { small_blind: 10000, big_blind: 20000, ante: 20000, duration: 10 },
      { small_blind: 12000, big_blind: 25000, ante: 25000, duration: 10 },
      { small_blind: 15000, big_blind: 30000, ante: 30000, duration: 10 },
      { small_blind: 20000, big_blind: 40000, ante: 40000, duration: 10 },
      { small_blind: 25000, big_blind: 50000, ante: 50000, duration: 10 },
      { small_blind: 30000, big_blind: 60000, ante: 60000, duration: 10 },
      { is_break: true, duration: 10 },
      { small_blind: 40000, big_blind: 80000, ante: 80000, duration: 10 },
      { small_blind: 50000, big_blind: 100000, ante: 100000, duration: 10 },
      { small_blind: 60000, big_blind: 120000, ante: 120000, duration: 10 },
      { small_blind: 80000, big_blind: 160000, ante: 160000, duration: 10 },
      { small_blind: 100000, big_blind: 200000, ante: 200000, duration: 10 },
      { small_blind: 150000, big_blind: 300000, ante: 300000, duration: 10 },
      { is_break: true, duration: 10 },
      { small_blind: 200000, big_blind: 400000, ante: 400000, duration: 10 },
      { small_blind: 250000, big_blind: 500000, ante: 500000, duration: 10 },
      { small_blind: 300000, big_blind: 600000, ante: 600000, duration: 10 },
      { small_blind: 400000, big_blind: 800000, ante: 800000, duration: 10 },
      { small_blind: 500000, big_blind: 1000000, ante: 1000000, duration: 10 },
    ]
  },
  standard: {
    name: 'Standard',
    description: '20-min Levels, BB Ante, Balanced Pace (40 levels)',
    starting_chips: 15000,
    levels: [
      { small_blind: 25, big_blind: 50, ante: 0, duration: 20 },
      { small_blind: 50, big_blind: 100, ante: 0, duration: 20 },
      { small_blind: 75, big_blind: 150, ante: 150, duration: 20 },
      { small_blind: 100, big_blind: 200, ante: 200, duration: 20 },
      { small_blind: 150, big_blind: 300, ante: 300, duration: 20 },
      { small_blind: 200, big_blind: 400, ante: 400, duration: 20 },
      { is_break: true, duration: 15 },
      { small_blind: 300, big_blind: 600, ante: 600, duration: 20 },
      { small_blind: 400, big_blind: 800, ante: 800, duration: 20 },
      { small_blind: 500, big_blind: 1000, ante: 1000, duration: 20 },
      { small_blind: 600, big_blind: 1200, ante: 1200, duration: 20 },
      { small_blind: 800, big_blind: 1600, ante: 1600, duration: 20 },
      { small_blind: 1000, big_blind: 2000, ante: 2000, duration: 20 },
      { is_break: true, duration: 15 },
      { small_blind: 1500, big_blind: 3000, ante: 3000, duration: 20 },
      { small_blind: 2000, big_blind: 4000, ante: 4000, duration: 20 },
      { small_blind: 3000, big_blind: 6000, ante: 6000, duration: 20 },
      { small_blind: 4000, big_blind: 8000, ante: 8000, duration: 20 },
      { small_blind: 5000, big_blind: 10000, ante: 10000, duration: 20 },
      { small_blind: 6000, big_blind: 12000, ante: 12000, duration: 20 },
      { is_break: true, duration: 15 },
      { small_blind: 8000, big_blind: 16000, ante: 16000, duration: 20 },
      { small_blind: 10000, big_blind: 20000, ante: 20000, duration: 20 },
      { small_blind: 12000, big_blind: 25000, ante: 25000, duration: 20 },
      { small_blind: 15000, big_blind: 30000, ante: 30000, duration: 20 },
      { small_blind: 20000, big_blind: 40000, ante: 40000, duration: 20 },
      { small_blind: 25000, big_blind: 50000, ante: 50000, duration: 20 },
      { is_break: true, duration: 15 },
      { small_blind: 30000, big_blind: 60000, ante: 60000, duration: 20 },
      { small_blind: 40000, big_blind: 80000, ante: 80000, duration: 20 },
      { small_blind: 50000, big_blind: 100000, ante: 100000, duration: 20 },
      { small_blind: 60000, big_blind: 120000, ante: 120000, duration: 20 },
      { small_blind: 80000, big_blind: 160000, ante: 160000, duration: 20 },
      { small_blind: 100000, big_blind: 200000, ante: 200000, duration: 20 },
      { is_break: true, duration: 15 },
      { small_blind: 150000, big_blind: 300000, ante: 300000, duration: 20 },
      { small_blind: 200000, big_blind: 400000, ante: 400000, duration: 20 },
      { small_blind: 250000, big_blind: 500000, ante: 500000, duration: 20 },
      { small_blind: 300000, big_blind: 600000, ante: 600000, duration: 20 },
      { small_blind: 400000, big_blind: 800000, ante: 800000, duration: 20 },
      { small_blind: 500000, big_blind: 1000000, ante: 1000000, duration: 20 },
    ]
  },
  deep_stack: {
    name: 'Deep Stack',
    description: '30-min Levels, BB Ante, Lots of Play (40 levels)',
    starting_chips: 25000,
    levels: [
      { small_blind: 25, big_blind: 50, ante: 0, duration: 30 },
      { small_blind: 50, big_blind: 100, ante: 0, duration: 30 },
      { small_blind: 75, big_blind: 150, ante: 150, duration: 30 },
      { small_blind: 100, big_blind: 200, ante: 200, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 150, big_blind: 300, ante: 300, duration: 30 },
      { small_blind: 200, big_blind: 400, ante: 400, duration: 30 },
      { small_blind: 300, big_blind: 600, ante: 600, duration: 30 },
      { small_blind: 400, big_blind: 800, ante: 800, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 500, big_blind: 1000, ante: 1000, duration: 30 },
      { small_blind: 600, big_blind: 1200, ante: 1200, duration: 30 },
      { small_blind: 800, big_blind: 1600, ante: 1600, duration: 30 },
      { small_blind: 1000, big_blind: 2000, ante: 2000, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 1500, big_blind: 3000, ante: 3000, duration: 30 },
      { small_blind: 2000, big_blind: 4000, ante: 4000, duration: 30 },
      { small_blind: 3000, big_blind: 6000, ante: 6000, duration: 30 },
      { small_blind: 4000, big_blind: 8000, ante: 8000, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 5000, big_blind: 10000, ante: 10000, duration: 30 },
      { small_blind: 6000, big_blind: 12000, ante: 12000, duration: 30 },
      { small_blind: 8000, big_blind: 16000, ante: 16000, duration: 30 },
      { small_blind: 10000, big_blind: 20000, ante: 20000, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 12000, big_blind: 25000, ante: 25000, duration: 30 },
      { small_blind: 15000, big_blind: 30000, ante: 30000, duration: 30 },
      { small_blind: 20000, big_blind: 40000, ante: 40000, duration: 30 },
      { small_blind: 25000, big_blind: 50000, ante: 50000, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 30000, big_blind: 60000, ante: 60000, duration: 30 },
      { small_blind: 40000, big_blind: 80000, ante: 80000, duration: 30 },
      { small_blind: 50000, big_blind: 100000, ante: 100000, duration: 30 },
      { small_blind: 60000, big_blind: 120000, ante: 120000, duration: 30 },
      { is_break: true, duration: 20 },
      { small_blind: 80000, big_blind: 160000, ante: 160000, duration: 30 },
      { small_blind: 100000, big_blind: 200000, ante: 200000, duration: 30 },
      { small_blind: 150000, big_blind: 300000, ante: 300000, duration: 30 },
      { small_blind: 200000, big_blind: 400000, ante: 400000, duration: 30 },
      { small_blind: 250000, big_blind: 500000, ante: 500000, duration: 30 },
      { small_blind: 300000, big_blind: 600000, ante: 600000, duration: 30 },
    ]
  }
};

// ===== PAYOUT STRUCTURES =====
const PAYOUT_STRUCTURES = {
  conservative: {
    name: 'Conservative (Top 10%)',
    getPlaces: (entries) => Math.max(3, Math.ceil(entries * 0.10)),
    percentages: {
      3: [50, 30, 20],
      4: [45, 25, 18, 12],
      5: [40, 23, 16, 12, 9],
      6: [38, 22, 15, 11, 8, 6],
      7: [35, 20, 14, 11, 8, 7, 5],
      8: [33, 19, 13, 10, 8, 7, 5.5, 4.5],
      9: [31, 18, 12.5, 10, 8, 7, 5.5, 4.5, 3.5],
      10: [30, 17, 12, 9.5, 7.5, 6.5, 5.5, 4.5, 4, 3.5]
    }
  },
  standard: {
    name: 'Standard (Top 15%)',
    getPlaces: (entries) => Math.max(3, Math.ceil(entries * 0.15)),
    percentages: {
      3: [50, 30, 20],
      4: [43, 25, 18, 14],
      5: [38, 23, 16, 13, 10],
      6: [35, 21, 15, 12, 9.5, 7.5],
      7: [33, 20, 14, 11, 9, 7, 6],
      8: [30, 18, 13, 10, 8.5, 7.5, 7, 6],
      9: [28, 17, 12.5, 10, 8.5, 7.5, 6.5, 5.5, 4.5],
      10: [27, 16, 12, 9.5, 8, 7, 6, 5.5, 5, 4]
    }
  },
  flat: {
    name: 'Flat (Top 20%)',
    getPlaces: (entries) => Math.max(3, Math.ceil(entries * 0.20)),
    percentages: {
      3: [45, 30, 25],
      4: [40, 27, 19, 14],
      5: [35, 24, 17, 14, 10],
      6: [32, 22, 16, 13, 10, 7],
      7: [30, 20, 15, 12, 10, 7.5, 5.5],
      8: [28, 19, 14, 11, 9, 8, 6, 5],
      9: [26, 18, 13, 10.5, 9, 7.5, 6.5, 5.5, 4],
      10: [25, 17, 12.5, 10, 8.5, 7.5, 6.5, 5.5, 4.5, 3.5]
    }
  }
};

function calculatePayouts(entries, buyinAmount, structure) {
  if (!entries || !buyinAmount) return [];
  const pool = entries * buyinAmount;
  const places = Math.min(structure.getPlaces(entries), 10);
  const pcts = structure.percentages[places] || structure.percentages[3];
  return pcts.map((pct, i) => ({
    place: i + 1,
    percentage: pct,
    amount: Math.round(pool * pct / 100)
  }));
}

export default function TournamentSettings() {

  useEffect(() => { busEmit.sessionStart('commander-tournaments-id-settings'); }, []);
  const router = useRouter();
  const { id } = router.query;

  const [tournament, setTournament] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState('structure');

  // Config
  const [name, setName] = useState('');
  const [tournamentType, setTournamentType] = useState('freezeout');
  const [buyinAmount, setBuyinAmount] = useState(100);
  const [buyinFee, setBuyinFee] = useState(20);
  const [startingChips, setStartingChips] = useState(15000);
  const [maxEntries, setMaxEntries] = useState('');
  const [guaranteedPool, setGuaranteedPool] = useState('');
  const [rebuyAllowed, setRebuyAllowed] = useState(false);
  const [rebuyLevels, setRebuyLevels] = useState(4);
  const [rebuyCost, setRebuyCost] = useState(100);
  const [rebuyChips, setRebuyChips] = useState(10000);
  const [addonAllowed, setAddonAllowed] = useState(false);
  const [addonCost, setAddonCost] = useState(100);
  const [addonChips, setAddonChips] = useState(15000);
  const [lateRegLevels, setLateRegLevels] = useState(6);
  const [clockColor, setClockColor] = useState('navy');

  // Structure
  const [levels, setLevels] = useState([]);
  const [payoutStructure, setPayoutStructure] = useState('standard');
  const [estimatedEntries, setEstimatedEntries] = useState(30);
  const [customPayouts, setCustomPayouts] = useState([]);

  // Saved (venue-scoped) templates
  const [templates, setTemplates] = useState([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateBusy, setTemplateBusy] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Fetch tournament
  useEffect(() => {

  if (!router.isReady) return null;

    if (!id) return;
    const fetch_ = async () => {
        const controller = new AbortController();
        const { signal } = controller;
      try {
const json = await commanderFetchJSON(`/api/commander/tournaments/${id}`, {});
        if (json.success) {
          // 2026-07-25 audit fix: API payload is { data: { tournament } }
          const t = json.data.tournament;
          setTournament(t);
          setName(t.name || '');
          setTournamentType(t.tournament_type || 'freezeout');
          setBuyinAmount(t.buyin_amount || 100);
          setBuyinFee(t.buyin_fee || 20);
          setStartingChips(t.starting_chips || 15000);
          setMaxEntries(t.max_entries || '');
          setGuaranteedPool(t.guaranteed_pool || '');
          // 2026-07-25 audit fix: read the real production columns
          // (rebuy_amount / rebuy_end_level / addon_amount / late_registration_levels)
          setRebuyAllowed(t.allows_rebuys || t.rebuy_allowed || false);
          setRebuyLevels(t.rebuy_end_level || 4);
          setRebuyCost(t.rebuy_amount || 100);
          setRebuyChips(t.rebuy_chips || 10000);
          setAddonAllowed(t.allows_addon || t.addon_allowed || false);
          setAddonCost(t.addon_amount || 100);
          setAddonChips(t.addon_chips || 15000);
          setLateRegLevels(t.late_registration_levels || 6);
          setClockColor(t.settings?.clock_color || t.clock_color || 'navy');
          setLevels(parseBlinds(t.blind_structure).length > 0 ? parseBlinds(t.blind_structure) : STRUCTURE_TEMPLATES.standard.levels);
          if (t.entry_count) setEstimatedEntries(t.entry_count);
          else if (t.current_entries) setEstimatedEntries(t.current_entries);
          // 2026-07-30: payout_structure is the canonical jsonb array of { place, pct }.
          // Legacy rows may still hold a preset-key string (e.g. 'standard') — keep that
          // as the generator selection. Older drafts used a `custom_payouts` field that is
          // NOT a real column; fall back to it on read so saved payouts round-trip.
          const savedPayouts = Array.isArray(t.payout_structure)
            ? t.payout_structure
            : (Array.isArray(t.custom_payouts) ? t.custom_payouts : null);
          if (savedPayouts && savedPayouts.length > 0) {
            setCustomPayouts(savedPayouts.map((p, i) => ({
              place: p.place || i + 1,
              pct: Number(p.pct != null ? p.pct : p.percentage) || 0
            })));
            if (typeof t.payout_structure === 'string' && t.payout_structure) setPayoutStructure(t.payout_structure);
          } else {
            if (typeof t.payout_structure === 'string' && t.payout_structure) setPayoutStructure(t.payout_structure);
            const seedEntries = t.entry_count || t.current_entries || 30;
            const seedKey = (typeof t.payout_structure === 'string' && t.payout_structure) || 'standard';
            const seedStruct = PAYOUT_STRUCTURES[seedKey] || PAYOUT_STRUCTURES.standard;
            setCustomPayouts(calculatePayouts(seedEntries, t.buyin_amount || 100, seedStruct).map(p => ({ place: p.place, pct: p.percentage })));
          }
        }
      } catch (err) { console.warn(err); }
      finally { setLoading(false); }
    };
    fetch_();
  }, [id]);

  // ===== LEVEL MANAGEMENT =====
  const addLevel = () => {
    const lastLevel = levels.filter(l => !l.is_break).pop();
    setLevels([...levels, {
      small_blind: (lastLevel?.small_blind || 500) * 1.5,
      big_blind: (lastLevel?.big_blind || 1000) * 1.5,
      ante: (lastLevel?.ante || 100) * 1.5,
      duration: lastLevel?.duration || 20
    }]);
  };

  const addBreak = () => {
    setLevels([...levels, { is_break: true, duration: 10 }]);
  };

  const removeLevel = (index) => {
    setLevels(levels.filter((_, i) => i !== index));
  };

  const updateLevel = (index, field, value) => {
    const updated = [...levels];
    updated[index] = { ...updated[index], [field]: parseInt(value) || 0 };
    setLevels(updated);
  };

  const moveLevel = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= levels.length) return;
    const updated = [...levels];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    setLevels(updated);
  };

  const loadTemplate = (key) => {
    const template = STRUCTURE_TEMPLATES[key];
    setLevels(template.levels);
    setStartingChips(template.starting_chips);
  };

  // ===== PAYOUT MANAGEMENT =====
  // Canonical payout table is customPayouts: an array of { place, pct }.
  const genPayoutsFromPreset = (key) => {
    setPayoutStructure(key);
    const struct = PAYOUT_STRUCTURES[key] || PAYOUT_STRUCTURES.standard;
    setCustomPayouts(calculatePayouts(estimatedEntries, buyinAmount, struct).map(p => ({ place: p.place, pct: p.percentage })));
  };

  const updatePayoutPct = (index, value) => {
    const updated = [...customPayouts];
    updated[index] = { ...updated[index], pct: parseFloat(value) || 0 };
    setCustomPayouts(updated);
  };

  const addPayoutPlace = () => {
    setCustomPayouts([...customPayouts, { place: customPayouts.length + 1, pct: 0 }]);
  };

  const removePayoutPlace = (index) => {
    setCustomPayouts(customPayouts.filter((_, i) => i !== index).map((p, i) => ({ ...p, place: i + 1 })));
  };

  // ===== SAVED TEMPLATES (venue-scoped) =====
  const fetchTemplates = async () => {
    if (!tournament?.venue_id) return;
    try {
      const json = await commanderFetchJSON(`/api/commander/tournaments/templates?venue_id=${tournament.venue_id}`);
      if (json.success) setTemplates(json.data?.templates || []);
    } catch (err) { console.warn(err); }
  };

  const openTemplatePicker = () => {
    const next = !showTemplatePicker;
    setShowTemplatePicker(next);
    if (next) fetchTemplates();
  };

  const saveAsTemplate = async () => {
    if (!tournament?.venue_id || !templateName.trim()) return;
    setTemplateBusy(true);
    const payoutPayload = customPayouts.map((p, i) => ({ place: p.place || i + 1, pct: Number(p.pct) || 0 }));
    try {
      const res = await commanderFetch('/api/commander/tournaments/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: tournament.venue_id,
          name: templateName.trim(),
          tournament_type: tournamentType,
          buyin_amount: buyinAmount,
          buyin_fee: buyinFee,
          starting_chips: startingChips,
          blind_structure: levels,
          payout_structure: payoutPayload,
          late_registration_levels: lateRegLevels,
          allows_rebuys: rebuyAllowed,
          rebuy_amount: rebuyCost,
          rebuy_chips: rebuyChips,
          rebuy_end_level: rebuyLevels,
          allows_addon: addonAllowed,
          addon_amount: addonCost,
          addon_chips: addonChips,
          max_entries: maxEntries ? parseInt(maxEntries) : null,
          settings: { clock_color: clockColor }
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setTemplateName('');
        setToast({ type: 'success', text: 'Template saved.' });
        fetchTemplates();
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Failed to save template.' }); }
    finally { setTemplateBusy(false); }
  };

  const loadSavedTemplate = (tpl) => {
    if (!tpl) return;
    setName(tpl.name || name);
    if (tpl.tournament_type) setTournamentType(tpl.tournament_type);
    if (tpl.buyin_amount != null) setBuyinAmount(tpl.buyin_amount);
    if (tpl.buyin_fee != null) setBuyinFee(tpl.buyin_fee);
    if (tpl.starting_chips != null) setStartingChips(tpl.starting_chips);
    const tplLevels = parseBlinds(tpl.blind_structure);
    if (tplLevels.length > 0) setLevels(tplLevels);
    if (tpl.late_registration_levels != null) setLateRegLevels(tpl.late_registration_levels);
    setRebuyAllowed(tpl.allows_rebuys || false);
    if (tpl.rebuy_amount != null) setRebuyCost(tpl.rebuy_amount);
    if (tpl.rebuy_chips != null) setRebuyChips(tpl.rebuy_chips);
    if (tpl.rebuy_end_level != null) setRebuyLevels(tpl.rebuy_end_level);
    setAddonAllowed(tpl.allows_addon || false);
    if (tpl.addon_amount != null) setAddonCost(tpl.addon_amount);
    if (tpl.addon_chips != null) setAddonChips(tpl.addon_chips);
    if (tpl.max_entries != null) setMaxEntries(tpl.max_entries);
    if (Array.isArray(tpl.payout_structure) && tpl.payout_structure.length > 0) {
      setCustomPayouts(tpl.payout_structure.map((p, i) => ({ place: p.place || i + 1, pct: Number(p.pct != null ? p.pct : p.percentage) || 0 })));
    }
    setShowTemplatePicker(false);
    setToast({ type: 'success', text: `Loaded template "${tpl.name}".` });
  };

  // ===== SAVE =====
  const saveSettings = async () => {
    setSaving(true);
    // 2026-07-30: persist the canonical editable payout table as payout_structure
    // (array of { place, pct }) + paying_places. `custom_payouts` is not a real column.
    const payoutPayload = customPayouts.map((p, i) => ({ place: p.place || i + 1, pct: Number(p.pct) || 0 }));
    try {
const res = await commanderFetch(`/api/commander/tournaments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, tournament_type: tournamentType,
          buyin_amount: buyinAmount, buyin_fee: buyinFee,
          starting_chips: startingChips,
          max_entries: maxEntries ? parseInt(maxEntries) : null,
          guaranteed_pool: guaranteedPool ? parseInt(guaranteedPool) : null,
          // 2026-07-25 audit fix: PUT passes fields straight to the DB — use the
          // real column names, not the drifted rebuy_cost/rebuy_levels/addon_cost
          allows_rebuys: rebuyAllowed, rebuy_end_level: rebuyLevels,
          rebuy_amount: rebuyCost, rebuy_chips: rebuyChips,
          allows_addon: addonAllowed, addon_amount: addonCost, addon_chips: addonChips,
          late_registration_levels: lateRegLevels,
          blind_structure: levels,
          payout_structure: payoutPayload,
          paying_places: payoutPayload.length,
          settings: { clock_color: clockColor }
        })
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) { setSaved(true); setTimeout(() => setSaved(false), 2000); broadcastChange('tournaments'); }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setSaving(false); }
  };

  // Calculate payouts
  const totalPool = estimatedEntries * buyinAmount;
  // 2026-07-30: canonical editable payout table (array of { place, pct }) + live validation.
  const payoutSum = customPayouts.reduce((s, p) => s + (Number(p.pct) || 0), 0);
  const payoutSumOk = customPayouts.length > 0 && Math.abs(payoutSum - 100) <= 0.5;
  const payoutRows = customPayouts.map((p, i) => ({
    place: p.place || i + 1,
    pct: Number(p.pct) || 0,
    amount: Math.round(totalPool * (Number(p.pct) || 0) / 100)
  }));
  const totalMinutes = levels.reduce((sum, l) => sum + (l.duration || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const levelCount = levels.filter(l => !l.is_break).length;
  const breakCount = levels.filter(l => l.is_break).length;

  if (loading) return (
    <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
    </div>
  );

  const TABS = [
    { key: 'structure', label: 'Blind Structure', icon: Clock },
    { key: 'config', label: 'Configuration', icon: Settings },
    { key: 'payouts', label: 'Payouts', icon: DollarSign }
  ];

  return (
    <>
      <SEOHead
        title="Commander — Settings"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter'] flex flex-col">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => router.back()}
              className="p-1.5 rounded-lg transition-colors" style={{ background: '#3A3B3C', border: '1px solid #4A4B4C' }}>
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h1 className="text-lg font-bold text-white">Tournament Settings</h1>
              <p className="text-xs text-[#B0B3B8]">{name}</p>
            </div>
          </div>
          <button onClick={saveSettings} disabled={saving}
            className={`px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 ${saved ? 'bg-[#31A24C] text-white' : 'bg-[#1877F2] text-white active:bg-[#1565D8]'
              } disabled:opacity-50`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
              saved ? <Check className="w-4 h-4" /> :
                <Save className="w-4 h-4" />}
            {saved ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 flex gap-1">
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px ${activeTab === tab.key
                ? 'text-[#1877F2] border-[#1877F2]'
                : 'text-[#B0B3B8] border-transparent'
                }`}>
              <tab.icon className="w-4 h-4" /> {tab.label}
            </button>
          ))}
        </div>

        {/* Saved Templates toolbar */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-2 flex items-center gap-2 flex-wrap">
          <button onClick={openTemplatePicker}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#3A3B3C] text-[#E4E6EB] active:bg-[#4A4B4C]">
            {showTemplatePicker ? 'Hide Templates' : 'Load Template'}
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="Template name"
              className="px-2 py-1.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-xs text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none w-40 placeholder-[#6A6B6D]" />
            <button onClick={saveAsTemplate} disabled={templateBusy || !templateName.trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#1877F2] text-white disabled:opacity-50">
              {templateBusy ? 'Saving...' : 'Save as Template'}
            </button>
          </div>
          {showTemplatePicker && (
            <div className="w-full mt-2 border-t border-[#3A3B3C] pt-2">
              {templates.length === 0 ? (
                <p className="text-xs text-[#64748B]">No saved templates for this venue yet.</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                  {templates.map(tpl => (
                    <button key={tpl.id} onClick={() => loadSavedTemplate(tpl)}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#0D192E] hover:bg-[#132240] text-left">
                      <span className="text-sm text-[#E4E6EB]">{tpl.name}</span>
                      <span className="text-[10px] text-[#64748B]">{parseBlinds(tpl.blind_structure).filter(l => !l.is_break).length} levels</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pb-20">

          {/* ===== BLIND STRUCTURE TAB ===== */}
          {activeTab === 'structure' && (
            <div className="p-4 space-y-4">

              {/* Stats bar */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-lg font-bold text-white">{levelCount}</p>
                  <p className="text-[10px] text-[#B0B3B8]">Levels</p>
                </div>
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-lg font-bold text-white">{breakCount}</p>
                  <p className="text-[10px] text-[#B0B3B8]">Breaks</p>
                </div>
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-lg font-bold text-white">{totalMinutes}m</p>
                  <p className="text-[10px] text-[#B0B3B8]">Total</p>
                </div>
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-lg font-bold text-white">{totalHours}h</p>
                  <p className="text-[10px] text-[#B0B3B8]">Hours</p>
                </div>
              </div>

              {/* Templates */}
              <div>
                <p className="text-xs text-[#B0B3B8] mb-2 uppercase tracking-wider">Load Template</p>
                <div className="flex gap-2">
                  {Object.entries(STRUCTURE_TEMPLATES || {}).map(([key, template]) => (
                    <button key={key} onClick={() => loadTemplate(key)}
                      className="flex-1 py-2.5 rounded-lg bg-[#3A3B3C] text-sm text-[#E4E6EB] font-medium active:bg-[#4A4B4C]">
                      {template.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Level Table */}
              <div className="space-y-1">
                {/* Header */}
                <div className="grid grid-cols-[40px_1fr_1fr_1fr_60px_40px_40px] gap-1 px-2 text-[10px] text-[#B0B3B8] uppercase tracking-wider">
                  <span>#</span><span>Small</span><span>Big</span><span>Ante</span><span>Min</span><span></span><span></span>
                </div>

                {levels.map((level, i) => {
                  const levelNum = levels.slice(0, i + 1).filter(l => !l.is_break).length;

                  if (level.is_break) {
                    return (
                      <div key={i} className="bg-[#F59E0B]/10 border border-[#F59E0B]/30 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Coffee className="w-4 h-4 text-[#F59E0B]" />
                        <span className="text-sm font-medium text-[#F59E0B] flex-1">BREAK</span>
                        <input type="number" value={level.duration}
                          onChange={e => updateLevel(i, 'duration', e.target.value)}
                          className="w-14 px-2 py-1 bg-[#3A3B3C] rounded text-center text-sm text-white"
                        />
                        <span className="text-[10px] text-[#F59E0B]">Min</span>
                        <button onClick={() => moveLevel(i, -1)} className="p-1"><ChevronUp className="w-3.5 h-3.5 text-[#B0B3B8]" /></button>
                        <button onClick={() => moveLevel(i, 1)} className="p-1"><ChevronDown className="w-3.5 h-3.5 text-[#B0B3B8]" /></button>
                        <button onClick={() => removeLevel(i)} className="p-1"><Trash2 className="w-3.5 h-3.5 text-[#EF4444]" /></button>
                      </div>
                    );
                  }

                  return (
                    <div key={i} className="grid grid-cols-[40px_1fr_1fr_1fr_60px_40px_40px] gap-1 items-center bg-[#242526] border border-[#3A3B3C] rounded-lg px-2 py-1.5">
                      <span className="text-xs text-[#B0B3B8] font-mono">{levelNum}</span>
                      <input type="number" value={level.small_blind}
                        onChange={e => updateLevel(i, 'small_blind', e.target.value)}
                        className="px-2 py-1.5 bg-[#3A3B3C] rounded text-sm text-white text-center" />
                      <input type="number" value={level.big_blind}
                        onChange={e => updateLevel(i, 'big_blind', e.target.value)}
                        className="px-2 py-1.5 bg-[#3A3B3C] rounded text-sm text-white text-center" />
                      <input type="number" value={level.ante}
                        onChange={e => updateLevel(i, 'ante', e.target.value)}
                        className="px-2 py-1.5 bg-[#3A3B3C] rounded text-sm text-white text-center" />
                      <input type="number" value={level.duration}
                        onChange={e => updateLevel(i, 'duration', e.target.value)}
                        className="px-2 py-1.5 bg-[#3A3B3C] rounded text-sm text-white text-center" />
                      <div className="flex flex-col">
                        <button onClick={() => moveLevel(i, -1)} className="p-0.5"><ChevronUp className="w-3 h-3 text-[#B0B3B8]" /></button>
                        <button onClick={() => moveLevel(i, 1)} className="p-0.5"><ChevronDown className="w-3 h-3 text-[#B0B3B8]" /></button>
                      </div>
                      <button onClick={() => removeLevel(i)} className="p-1"><Trash2 className="w-3.5 h-3.5 text-[#EF4444]" /></button>
                    </div>
                  );
                })}
              </div>

              {/* Add buttons */}
              <div className="flex gap-2">
                <button onClick={addLevel}
                  className="flex-1 py-3 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/30 text-[#1877F2] text-sm font-medium flex items-center justify-center gap-2 active:bg-[#1877F2]/20">
                  <Plus className="w-4 h-4" /> Add Level
                </button>
                <button onClick={addBreak}
                  className="flex-1 py-3 rounded-xl bg-[#F59E0B]/10 border border-[#F59E0B]/30 text-[#F59E0B] text-sm font-medium flex items-center justify-center gap-2 active:bg-[#F59E0B]/20">
                  <Coffee className="w-4 h-4" /> Add Break
                </button>
              </div>
            </div>
          )}

          {/* ===== CONFIGURATION TAB ===== */}
          {activeTab === 'config' && (
            <div className="p-4 space-y-4">
              {/* Tournament Name */}
              <div>
                <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Tournament Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none" />
              </div>

              {/* Type */}
              <div>
                <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Tournament Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {['freezeout', 'rebuy', 'bounty', 'satellite'].map(type => (
                    <button key={type} onClick={() => setTournamentType(type)}
                      className={`py-2.5 rounded-lg text-sm font-medium capitalize ${tournamentType === type ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                        }`}>{type}</button>
                  ))}
                </div>
              </div>

              {/* Clock Color */}
              <div>
                <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Clock Color</label>
                <p className="text-[10px] text-[#64748B] mb-2">Assign a unique color to distinguish this tournament's clock display</p>
                <div className="grid grid-cols-6 gap-2">
                  {[
                    { key: 'navy', label: 'Navy', from: '#2C3E6B', to: '#1E2D52' },
                    { key: 'red', label: 'Red', from: '#6B2C2C', to: '#521E1E' },
                    { key: 'green', label: 'Green', from: '#2C6B3E', to: '#1E522D' },
                    { key: 'purple', label: 'Purple', from: '#4B2C6B', to: '#351E52' },
                    { key: 'gold', label: 'Gold', from: '#6B5C2C', to: '#52451E' },
                    { key: 'teal', label: 'Teal', from: '#2C5F6B', to: '#1E4852' },
                  ].map(c => (
                    <button key={c.key} onClick={() => setClockColor(c.key)}
                      className={`py-3 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${clockColor === c.key ? 'ring-2 ring-white ring-offset-2 ring-offset-[#18191A] scale-105' : 'opacity-70 hover:opacity-100'
                        }`}
                      style={{ background: `linear-gradient(180deg, ${c.from}, ${c.to})`, color: '#fff' }}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Buy-in */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Buy-In ($)</label>
                  <input type="number" value={buyinAmount} onChange={e => setBuyinAmount(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">House Fee ($)</label>
                  <input type="number" value={buyinFee} onChange={e => setBuyinFee(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none" />
                </div>
              </div>

              {/* Starting Chips + Late Reg */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Starting Chips</label>
                  <input type="number" value={startingChips} onChange={e => setStartingChips(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Late Reg (levels)</label>
                  <input type="number" value={lateRegLevels} onChange={e => setLateRegLevels(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none" />
                </div>
              </div>

              {/* Max Entries + Guarantee */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Max Entries</label>
                  <input type="number" value={maxEntries} onChange={e => setMaxEntries(e.target.value)}
                    placeholder="Unlimited"
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none placeholder-[#6A6B6D]" />
                </div>
                <div>
                  <label className="text-xs text-[#B0B3B8] uppercase tracking-wider block mb-1">Guarantee ($)</label>
                  <input type="number" value={guaranteedPool} onChange={e => setGuaranteedPool(e.target.value)}
                    placeholder="None"
                    className="w-full px-3 py-2.5 bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg text-[#E4E6EB] focus:border-[#1877F2] focus:outline-none placeholder-[#6A6B6D]" />
                </div>
              </div>

              {/* Rebuys */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Rebuys</span>
                  <button onClick={() => setRebuyAllowed(!rebuyAllowed)}
                    className={`w-12 h-6 rounded-full transition-colors ${rebuyAllowed ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${rebuyAllowed ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {rebuyAllowed && (
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[10px] text-[#B0B3B8]">Thru Level</label>
                      <input type="number" value={rebuyLevels} onChange={e => setRebuyLevels(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 bg-[#3A3B3C] rounded-lg text-sm text-white text-center" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#B0B3B8]">Cost ($)</label>
                      <input type="number" value={rebuyCost} onChange={e => setRebuyCost(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 bg-[#3A3B3C] rounded-lg text-sm text-white text-center" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#B0B3B8]">Chips</label>
                      <input type="number" value={rebuyChips} onChange={e => setRebuyChips(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 bg-[#3A3B3C] rounded-lg text-sm text-white text-center" />
                    </div>
                  </div>
                )}
              </div>

              {/* Add-ons */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C] space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Add-On</span>
                  <button onClick={() => setAddonAllowed(!addonAllowed)}
                    className={`w-12 h-6 rounded-full transition-colors ${addonAllowed ? 'bg-[#1877F2]' : 'bg-[#3A3B3C]'}`}>
                    <div className={`w-5 h-5 rounded-full bg-white transition-transform ${addonAllowed ? 'translate-x-6' : 'translate-x-0.5'}`} />
                  </button>
                </div>
                {addonAllowed && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-[#B0B3B8]">Cost ($)</label>
                      <input type="number" value={addonCost} onChange={e => setAddonCost(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 bg-[#3A3B3C] rounded-lg text-sm text-white text-center" />
                    </div>
                    <div>
                      <label className="text-[10px] text-[#B0B3B8]">Chips</label>
                      <input type="number" value={addonChips} onChange={e => setAddonChips(parseInt(e.target.value) || 0)}
                        className="w-full px-2 py-2 bg-[#3A3B3C] rounded-lg text-sm text-white text-center" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ===== PAYOUTS TAB ===== */}
          {activeTab === 'payouts' && (
            <div className="p-4 space-y-4">

              {/* Entries slider */}
              <div className="bg-[#242526] rounded-xl p-4 border border-[#3A3B3C]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-[#B0B3B8] uppercase tracking-wider">Estimated Entries</span>
                  <span className="text-lg font-bold text-white">{estimatedEntries}</span>
                </div>
                <input type="range" min="6" max="200" value={estimatedEntries}
                  onChange={e => setEstimatedEntries(parseInt(e.target.value))}
                  className="w-full accent-[#1877F2]" />
                <div className="flex justify-between text-[10px] text-[#B0B3B8]">
                  <span>6</span><span>50</span><span>100</span><span>150</span><span>200</span>
                </div>
              </div>

              {/* Pool summary */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-xs text-[#B0B3B8]">Prize Pool</p>
                  <p className="text-lg font-bold text-[#31A24C]">${totalPool.toLocaleString()}</p>
                </div>
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-xs text-[#B0B3B8]">House Revenue</p>
                  <p className="text-lg font-bold text-[#1877F2]">${(estimatedEntries * buyinFee).toLocaleString()}</p>
                </div>
                <div className="bg-[#242526] rounded-xl p-3 text-center border border-[#3A3B3C]">
                  <p className="text-xs text-[#B0B3B8]">Paid Places</p>
                  <p className="text-lg font-bold text-white">{payoutRows.length}</p>
                </div>
              </div>

              {/* Generate from preset */}
              <div>
                <p className="text-xs text-[#B0B3B8] uppercase tracking-wider mb-2">Generate From Preset</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(PAYOUT_STRUCTURES || {}).map(([key, struct]) => (
                    <button key={key} onClick={() => genPayoutsFromPreset(key)}
                      className={`py-2.5 rounded-lg text-xs font-medium ${payoutStructure === key ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                        }`}>{struct.name.split('(')[0].trim()}</button>
                  ))}
                </div>
                <p className="text-[10px] text-[#64748B] mt-2">Presets seed the table below from your estimated entries. Every place and percentage stays editable afterwards.</p>
              </div>

              {/* Total allocation validation */}
              <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${payoutSumOk
                ? 'bg-[#31A24C]/10 border-[#31A24C]/30'
                : 'bg-[#EF4444]/10 border-[#EF4444]/30'}`}>
                <span className="text-xs text-[#B0B3B8] uppercase tracking-wider">Total Allocation</span>
                <span className={`text-sm font-bold ${payoutSumOk ? 'text-[#31A24C]' : 'text-[#EF4444]'}`}>
                  {payoutSum.toFixed(2)}%{payoutSumOk ? '' : ' — must total 100%'}
                </span>
              </div>

              {/* Editable payout table */}
              <div className="space-y-1">
                <div className="grid grid-cols-[52px_1fr_1fr_40px] gap-2 px-2 text-[10px] text-[#B0B3B8] uppercase tracking-wider">
                  <span>Place</span><span>Percent</span><span className="text-right">Payout</span><span></span>
                </div>
                {payoutRows.map((p, i) => (
                  <div key={i}
                    className={`grid grid-cols-[52px_1fr_1fr_40px] gap-2 items-center px-2 py-1.5 rounded-lg ${p.place === 1 ? 'bg-[#F59E0B]/10 border border-[#F59E0B]/30' :
                      p.place === 2 ? 'bg-white/5 border border-white/10' :
                        p.place === 3 ? 'bg-[#B87333]/10 border border-[#B87333]/30' :
                          'bg-[#242526] border border-[#3A3B3C]'
                      }`}>
                    <span className="text-sm font-bold text-white pl-1">{p.place}</span>
                    <div className="flex items-center gap-1">
                      <input type="number" step="0.01" min="0" value={p.pct}
                        onChange={e => updatePayoutPct(i, e.target.value)}
                        className="w-20 px-2 py-1.5 bg-[#3A3B3C] rounded text-sm text-white text-center" />
                      <span className="text-xs text-[#B0B3B8]">%</span>
                    </div>
                    <span className="text-sm font-bold text-[#31A24C] text-right">${p.amount.toLocaleString()}</span>
                    <button onClick={() => removePayoutPlace(i)} className="p-1 justify-self-end"><Trash2 className="w-3.5 h-3.5 text-[#EF4444]" /></button>
                  </div>
                ))}
              </div>

              {/* Add place */}
              <button onClick={addPayoutPlace}
                className="w-full py-3 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/30 text-[#1877F2] text-sm font-medium flex items-center justify-center gap-2 active:bg-[#1877F2]/20">
                <Plus className="w-4 h-4" /> Add Place
              </button>

              {/* Guarantee check */}
              {guaranteedPool && totalPool < parseInt(guaranteedPool) && (
                <div className="bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-xl p-4">
                  <p className="text-sm text-[#EF4444] font-medium">
                    Pool (${totalPool.toLocaleString()}) is below guarantee (${parseInt(guaranteedPool).toLocaleString()}).
                    House covers ${(parseInt(guaranteedPool) - totalPool).toLocaleString()} overlay.
                  </p>
                </div>
              )}
            </div>
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
