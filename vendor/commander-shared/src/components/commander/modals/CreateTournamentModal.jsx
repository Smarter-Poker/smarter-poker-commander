/**
 * CreateTournamentModal - Enhanced with template picker + full configuration
 * Step 1: Choose Template or Start from Scratch
 * Step 2: Customize tournament details
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { memo, useState, useEffect } from 'react';
import {
  X, Trophy, Loader2,
  ChevronLeft, Zap, Crown, Target, RefreshCw, Rocket, Crosshair,
  Check, Settings, Layers, CalendarDays, LayoutGrid
} from 'lucide-react';
import BlindStructureEditor from '../tournaments/BlindStructureEditor';
import {
  TOURNAMENT_TEMPLATES,
  TOURNAMENT_TYPES,
  formatBuyin,
  formatChips,
  estimateDuration
} from '../tournaments/tournamentTemplates';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

const ICON_MAP = { Trophy, Zap, Crown, Target, RefreshCw, Rocket, Crosshair };

// Fallback blind structure for "Start from Scratch"
const SCRATCH_BLINDS = [
  { level: 1, small_blind: 25, big_blind: 50, ante: 0, duration: 20 },
  { level: 2, small_blind: 50, big_blind: 100, ante: 0, duration: 20 },
  { level: 3, small_blind: 75, big_blind: 150, ante: 0, duration: 20 },
  { level: 4, small_blind: 100, big_blind: 200, ante: 25, duration: 20 },
  { is_break: true, duration: 10, label: 'Break' },
  { level: 5, small_blind: 150, big_blind: 300, ante: 50, duration: 20 },
  { level: 6, small_blind: 200, big_blind: 400, ante: 50, duration: 20 },
  { level: 7, small_blind: 300, big_blind: 600, ante: 75, duration: 20 },
  { level: 8, small_blind: 400, big_blind: 800, ante: 100, duration: 20 },
  { is_break: true, duration: 10, label: 'Break' },
  { level: 9, small_blind: 500, big_blind: 1000, ante: 100, duration: 15 },
  { level: 10, small_blind: 600, big_blind: 1200, ante: 200, duration: 15 },
  { level: 11, small_blind: 800, big_blind: 1600, ante: 200, duration: 15 },
  { level: 12, small_blind: 1000, big_blind: 2000, ante: 300, duration: 15 },
];

function CreateTournamentModal({ isOpen, onClose, onSubmit, venueId }) {
  const [step, setStep] = useState(1); // 1 = template picker, 2 = customize
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  // Form state
  const [name, setName] = useState('');
  const [tournamentType, setTournamentType] = useState('freezeout');
  const [buyinAmount, setBuyinAmount] = useState(100);
  const [buyinFee, setBuyinFee] = useState(20);
  const [startingChips, setStartingChips] = useState(10000);
  const [scheduledStart, setScheduledStart] = useState('');
  const [maxEntries, setMaxEntries] = useState('');
  const [guaranteedPool, setGuaranteedPool] = useState('');
  // '' means "follow the suggestion" so the default keeps tracking max_entries
  // until the TD types a number of their own.
  const [tableCount, setTableCount] = useState('');
  const [lateRegLevels, setLateRegLevels] = useState(6);
  const [blindStructure, setBlindStructure] = useState(SCRATCH_BLINDS);
  const [showBlinds, setShowBlinds] = useState(false);

  // Rebuy/Addon/Bounty
  const [allowsRebuys, setAllowsRebuys] = useState(false);
  const [rebuyAmount, setRebuyAmount] = useState(0);
  const [rebuyChips, setRebuyChips] = useState(0);
  const [maxRebuys, setMaxRebuys] = useState(3);
  const [rebuyEndLevel, setRebuyEndLevel] = useState(6);
  const [allowsAddon, setAllowsAddon] = useState(false);
  const [addonAmount, setAddonAmount] = useState(0);
  const [addonChips, setAddonChips] = useState(0);
  const [bountyAmount, setBountyAmount] = useState(0);

  // Receipt settings
  const [printPlayerReceipt, setPrintPlayerReceipt] = useState(true);
  const [printDealerReceipt, setPrintDealerReceipt] = useState(true);
  const [printCageReceipt, setPrintCageReceipt] = useState(true);

  // Multi-day flight settings
  const [isMultiDay, setIsMultiDay] = useState(false);
  const [totalDays, setTotalDays] = useState(2);
  const [flightLabel, setFlightLabel] = useState('Day 1A');
  const [resumeTime, setResumeTime] = useState('');

  // Club Page sync
  const [postToClubPage, setPostToClubPage] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Blind structure validation, reported up by BlindStructureEditor. Errors
  // block creation; warnings are displayed by the editor and do not block.
  const [structureValidation, setStructureValidation] = useState(null);
  const structureErrors = (structureValidation?.errors || []).filter(e => e.severity === 'error');

  // Suggested table count: one nine-handed table per nine entrants, minimum 2.
  // Two is the floor because automatic table breaking never fires with fewer
  // than two tables assigned to the tournament.
  const suggestedTables = maxEntries
    ? Math.max(2, Math.ceil((parseInt(maxEntries, 10) || 0) / 9))
    : 2;
  const effectiveTableCount = tableCount === ''
    ? suggestedTables
    : Math.max(0, parseInt(tableCount, 10) || 0);

  // Set default scheduled start
  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    setScheduledStart(tomorrow.toISOString().slice(0, 16));
  }, []);

  function applyTemplate(template) {
    setSelectedTemplate(template);
    setName(template.name);
    setTournamentType(template.tournament_type);
    setBuyinAmount(template.buyin_amount);
    setBuyinFee(template.buyin_fee);
    setStartingChips(template.starting_chips);
    setLateRegLevels(template.late_registration_levels);
    setBlindStructure([...template.blind_structure]);
    setAllowsRebuys(template.allows_rebuys || false);
    setRebuyAmount(template.rebuy_amount || 0);
    setRebuyChips(template.rebuy_chips || 0);
    setMaxRebuys(template.max_rebuys || 3);
    setRebuyEndLevel(template.rebuy_end_level || 6);
    setAllowsAddon(template.allows_addon || false);
    setAddonAmount(template.addon_amount || 0);
    setAddonChips(template.addon_chips || 0);
    setBountyAmount(template.bounty_amount || 0);
    setStep(2);
  }

  function startFromScratch() {
    setSelectedTemplate(null);
    setName('');
    setTournamentType('freezeout');
    setBuyinAmount(100);
    setBuyinFee(20);
    setStartingChips(10000);
    setBlindStructure([...SCRATCH_BLINDS]);
    setAllowsRebuys(false);
    setAllowsAddon(false);
    setBountyAmount(0);
    setStep(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !scheduledStart) return;

    // The create API runs the same rules and answers 400. Stopping here means
    // the message names the level and the reason, and the blind structure
    // section is opened on the exact rows that are wrong.
    if (structureErrors.length > 0) {
      setShowBlinds(true);
      setError(
        `Blind Structure Cannot Be Saved: ${structureErrors[0].message}` +
        (structureErrors.length > 1
          ? ` And ${(structureErrors.length - 1).toLocaleString()} More Problem${structureErrors.length - 1 === 1 ? '' : 's'}.`
          : '')
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = {
        venue_id: venueId,
        name: name.trim(),
        tournament_type: tournamentType,
        buyin_amount: buyinAmount,
        buyin_fee: buyinFee,
        starting_chips: startingChips,
        scheduled_start: new Date(scheduledStart).toISOString(),
        max_entries: maxEntries ? parseInt(maxEntries) : null,
        guaranteed_pool: guaranteedPool ? parseInt(guaranteedPool) : null,
        blind_structure: blindStructure,
        late_registration_levels: lateRegLevels,
        allows_rebuys: allowsRebuys,
        rebuy_amount: allowsRebuys ? rebuyAmount : null,
        rebuy_chips: allowsRebuys ? rebuyChips : null,
        max_rebuys: allowsRebuys ? maxRebuys : null,
        rebuy_end_level: allowsRebuys ? rebuyEndLevel : null,
        allows_addon: allowsAddon,
        addon_amount: allowsAddon ? addonAmount : null,
        addon_chips: allowsAddon ? addonChips : null,
        bounty_amount: (tournamentType === 'bounty' || tournamentType === 'pko') ? bountyAmount : null,
        status: 'scheduled',
        broadcast_to_smarter: true,
        is_multi_day: isMultiDay,
        total_days: isMultiDay ? totalDays : 1,
        current_day: 1,
        flight_label: isMultiDay ? flightLabel : null,
        resume_time: isMultiDay && resumeTime ? new Date(resumeTime).toISOString() : null,
        settings: {
          receipts: {
            player: printPlayerReceipt,
            dealer: printDealerReceipt,
            cage: printCageReceipt
          }
        },
      };

      const staffSession = localStorage.getItem('commander_staff');
      const res = await fetch('/api/commander/tournaments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-staff-session': staffSession || '',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('API failure');
      const data = await res.json();

      if (data.success) {
        const created = data.data?.tournament || data.data;
        const newId = created?.id;

        // Assign physical tables. Without commander_tables rows carrying this
        // tournament_id, automatic table breaking never fires and the seat
        // draw has no real table numbers to draw against. Non-fatal: the
        // tournament exists either way, the TD is just told what failed.
        let tableWarning = null;
        if (newId && effectiveTableCount > 0) {
          try {
            const tr = await fetch(`/api/commander/tournaments/${newId}/tables`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-staff-session': staffSession || '',
              },
              body: JSON.stringify({ count: effectiveTableCount }),
            });
            const tj = await tr.json().catch(() => null);
            if (!tr.ok || !tj?.success) {
              tableWarning = tj?.error?.message || 'Tables Could Not Be Assigned Automatically.';
            }
          } catch (tableErr) {
            console.warn('Table assignment skipped:', tableErr);
            tableWarning = 'Tables Could Not Be Assigned Automatically.';
          }
        }
        // Sync to Club Page
        if (postToClubPage) {
          try {
            const syncPayload = {
                venue_id: venueId,
                tournament: {
                  ...(data.data?.tournament || {}),
                  name: name.trim(),
                  tournament_type: tournamentType,
                  buyin_amount: buyinAmount,
                  buyin_fee: buyinFee,
                  starting_chips: startingChips,
                  scheduled_start: new Date(scheduledStart).toISOString(),
                  guaranteed_pool: guaranteedPool ? parseInt(guaranteedPool) : null,
                  bounty_amount: (tournamentType === 'bounty' || tournamentType === 'pko') ? bountyAmount : null,
                },
              };
            const r = await fetch('/api/commander/sync-tournament-to-club', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-staff-session': staffSession || '',
              },
              body: JSON.stringify(syncPayload),
            });
            if (!r.ok) console.warn('Club sync failed');
          } catch (syncErr) {
            console.warn('Club Page sync skipped:', syncErr);
          }
        }

        broadcastChange('tournaments');
        // Second argument carries the non-fatal table-assignment warning so the
        // caller can toast it instead of losing it behind the closing modal.
        onSubmit(created, { tableWarning, tables_requested: effectiveTableCount });
        resetForm();
        onClose();
      } else {
        setError(data.error?.message || data.error || 'Failed To Create Tournament');
      }
    } catch (err) {
      setError('Connection Error. Please Try Again.');
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setStep(1);
    setSelectedTemplate(null);
    setName('');
    setTournamentType('freezeout');
    setBuyinAmount(100);
    setBuyinFee(20);
    setStartingChips(10000);
    setMaxEntries('');
    setGuaranteedPool('');
    setTableCount('');
    setBlindStructure([...SCRATCH_BLINDS]);
    setAllowsRebuys(false);
    setAllowsAddon(false);
    setBountyAmount(0);
    setIsMultiDay(false);
    setTotalDays(2);
    setFlightLabel('Day 1A');
    setResumeTime('');
    setPrintPlayerReceipt(true);
    setPrintDealerReceipt(true);
    setPrintCageReceipt(true);
    setError(null);
    setShowBlinds(false);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="p-1.5 hover:bg-[#132240] rounded-lg transition-colors"
              >
                <ChevronLeft className="w-5 h-5 text-[#64748B]" />
              </button>
            )}
            <div className="w-10 h-10 bg-[#22D3EE] rounded-lg flex items-center justify-center">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">
                {step === 1 ? 'Choose Template' : 'Create Tournament'}
              </h2>
              {step === 1 && (
                <p className="text-xs text-[#64748B]">Select A Template Or Start From Scratch</p>
              )}
            </div>
          </div>
          <button
            onClick={() => { resetForm(); onClose(); }}
            className="p-2 hover:bg-[#132240] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* STEP 1: Template Picker */}
        {step === 1 && (
          <div className="p-4 space-y-3">
            {/* Start from Scratch */}
            <button
              onClick={startFromScratch}
              className="w-full p-3 bg-[#0D192E] hover:bg-[#132240] border border-[#1E3A5F] rounded-lg transition-colors flex items-center gap-3 text-left"
            >
              <div className="w-10 h-10 bg-[#1E3A5F] rounded-lg flex items-center justify-center">
                <Settings className="w-5 h-5 text-[#94A3B8]" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Start From Scratch</p>
                <p className="text-xs text-[#64748B]">Build A Custom Tournament With Default Blinds</p>
              </div>
            </button>

            <div className="py-1">
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider">Pre-Built Templates</p>
            </div>

            {/* Template Cards */}
            {TOURNAMENT_TEMPLATES.map((template) => {
              const IconComponent = ICON_MAP[template.icon] || Trophy;
              return (
                <button
                  key={template.id}
                  onClick={() => applyTemplate(template)}
                  className="w-full p-3 bg-[#0D192E] hover:bg-[#132240] border border-[#1E3A5F] rounded-lg transition-colors flex items-center gap-3 text-left"
                >
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${template.color}20` }}
                  >
                    <IconComponent className="w-5 h-5" style={{ color: template.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{template.name}</p>
                    <p className="text-xs text-[#64748B]">
                      {formatBuyin(template.buyin_amount, template.buyin_fee, template.bounty_amount)} | {formatChips(template.starting_chips)} Chips | {template.estimated_duration}
                    </p>
                  </div>
                  <ChevronLeft className="w-4 h-4 text-[#64748B] rotate-180" />
                </button>
              );
            })}
          </div>
        )}

        {/* STEP 2: Customize */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            {error && (
              <div className="p-3 bg-[#EF4444]/10 rounded-lg">
                <p className="text-sm text-[#EF4444]">{error}</p>
              </div>
            )}

            {/* Template badge */}
            {selectedTemplate && (
              <div className="flex items-center gap-2 text-xs text-[#64748B]">
                <Check className="w-3.5 h-3.5 text-[#10B981]" />
                <span>Based On: <strong className="text-white">{selectedTemplate.name}</strong></span>
              </div>
            )}

            {/* Tournament Name */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Tournament Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Daily $150 NLH"
                className="cmd-input w-full h-12"
                required
              />
            </div>

            {/* Tournament Type */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Type</label>
              <div className="grid grid-cols-4 gap-2">
                {TOURNAMENT_TYPES.slice(0, 4).map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setTournamentType(type.value)}
                    className={`h-10 rounded-lg text-sm font-medium transition-colors ${tournamentType === type.value
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {TOURNAMENT_TYPES.slice(4).map((type) => (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setTournamentType(type.value)}
                    className={`h-10 rounded-lg text-sm font-medium transition-colors ${tournamentType === type.value
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Start Time */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Start Time</label>
              <input
                type="datetime-local"
                value={scheduledStart}
                onChange={(e) => setScheduledStart(e.target.value)}
                className="cmd-input w-full h-12"
                required
              />
            </div>

            {/* Buy-in */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Buy-In Amount</label>
              <div className="grid grid-cols-5 gap-2 mb-2">
                {[50, 100, 150, 200, 300].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => {
                      setBuyinAmount(amount);
                      setBuyinFee(Math.round(amount * 0.2));
                    }}
                    className={`h-9 rounded-lg text-sm font-medium transition-colors ${buyinAmount === amount
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    type="number"
                    value={buyinAmount}
                    onChange={(e) => setBuyinAmount(parseInt(e.target.value) || 0)}
                    className="cmd-input w-full h-10 text-center"
                  />
                  <p className="text-xs text-[#64748B] text-center mt-1">Buy-In</p>
                </div>
                <div>
                  <input
                    type="number"
                    value={buyinFee}
                    onChange={(e) => setBuyinFee(parseInt(e.target.value) || 0)}
                    className="cmd-input w-full h-10 text-center"
                  />
                  <p className="text-xs text-[#64748B] text-center mt-1">Fee</p>
                </div>
              </div>
            </div>

            {/* Starting Chips */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Starting Chips</label>
              <div className="flex gap-2 flex-wrap">
                {[5000, 10000, 15000, 20000, 25000, 30000].map((chips) => (
                  <button
                    key={chips}
                    type="button"
                    onClick={() => setStartingChips(chips)}
                    className={`flex-1 min-w-[50px] h-9 rounded-lg text-xs font-medium transition-colors ${startingChips === chips
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    {formatChips(chips)}
                  </button>
                ))}
              </div>
            </div>

            {/* Bounty (if bounty or PKO type) */}
            {(tournamentType === 'bounty' || tournamentType === 'pko') && (
              <div>
                <label className="block text-sm font-medium text-white mb-1">
                  {tournamentType === 'pko' ? 'Starting Bounty (Half Of Buy-In)' : 'Bounty Amount'}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[25, 50, 100, 200].map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBountyAmount(b)}
                      className={`h-9 rounded-lg text-sm font-medium transition-colors ${bountyAmount === b
                        ? 'bg-[#EF4444] text-white'
                        : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                        }`}
                    >
                      ${b}
                    </button>
                  ))}
                </div>
                {tournamentType === 'pko' && (
                  <p className="text-xs text-[#F97316] mt-2">
                    Progressive KO: When You Eliminate A Player, You Collect Half Their Bounty. The Other Half Is Added To Your Own Bounty, Making You A Bigger Target.
                  </p>
                )}
              </div>
            )}

            {/* Rebuy Settings (if rebuy type) */}
            {tournamentType === 'rebuy' && (
              <div className="space-y-3 p-3 bg-[#0D192E] rounded-lg border border-[#1E3A5F]">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-white">Rebuys</label>
                  <button
                    type="button"
                    onClick={() => setAllowsRebuys(!allowsRebuys)}
                    className={`w-10 h-6 rounded-full transition-colors ${allowsRebuys ? 'bg-[#10B981]' : 'bg-[#1E3A5F]'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${allowsRebuys ? 'translate-x-5' : 'translate-x-1'}`}></div>
                  </button>
                </div>
                {allowsRebuys && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[#64748B]">Rebuy Cost</label>
                      <input type="number" value={rebuyAmount} onChange={(e) => setRebuyAmount(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B]">Rebuy Chips</label>
                      <input type="number" value={rebuyChips} onChange={(e) => setRebuyChips(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B]">Max Rebuys</label>
                      <input type="number" value={maxRebuys} onChange={(e) => setMaxRebuys(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B]">End Level</label>
                      <input type="number" value={rebuyEndLevel} onChange={(e) => setRebuyEndLevel(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-[#1E3A5F]">
                  <label className="text-sm font-medium text-white">Add-On</label>
                  <button
                    type="button"
                    onClick={() => setAllowsAddon(!allowsAddon)}
                    className={`w-10 h-6 rounded-full transition-colors ${allowsAddon ? 'bg-[#A855F7]' : 'bg-[#1E3A5F]'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${allowsAddon ? 'translate-x-5' : 'translate-x-1'}`}></div>
                  </button>
                </div>
                {allowsAddon && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-[#64748B]">Add-On Cost</label>
                      <input type="number" value={addonAmount} onChange={(e) => setAddonAmount(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B]">Add-On Chips</label>
                      <input type="number" value={addonChips} onChange={(e) => setAddonChips(parseInt(e.target.value) || 0)} className="cmd-input w-full h-8 text-sm text-center" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Optional Fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-white mb-1">Max Entries</label>
                <input
                  type="number"
                  value={maxEntries}
                  onChange={(e) => setMaxEntries(e.target.value)}
                  placeholder="No Limit"
                  className="cmd-input w-full h-10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-white mb-1">Guaranteed Pool</label>
                <input
                  type="number"
                  value={guaranteedPool}
                  onChange={(e) => setGuaranteedPool(e.target.value)}
                  placeholder="Optional"
                  className="cmd-input w-full h-10"
                />
              </div>
            </div>

            {/* Tables */}
            <div>
              <label className="block text-sm font-medium text-white mb-1 flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-[#22D3EE]" />
                How Many Tables
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={tableCount === '' ? String(suggestedTables) : tableCount}
                onChange={(e) => setTableCount(e.target.value)}
                className="cmd-input w-full h-10"
              />
              <p className="text-xs text-[#64748B] mt-1">
                Tables Are Reserved For This Event The Moment It Is Created. Assigning At Least
                Two Enables Automatic Table Breaking And Gives The Seat Draw Real Table Numbers.
                Set To 0 To Assign Them Later.
              </p>
            </div>

            {/* Late Registration */}
            <div>
              <label className="block text-sm font-medium text-white mb-1">Late Registration (Levels)</label>
              <div className="grid grid-cols-5 gap-2">
                {[4, 6, 8, 10, 12].map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLateRegLevels(lvl)}
                    className={`h-9 rounded-lg text-sm font-medium transition-colors ${lateRegLevels === lvl
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                      }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Blind Structure Toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowBlinds(!showBlinds)}
                className="w-full p-3 bg-[#0D192E] rounded-lg flex items-center justify-between hover:bg-[#132240] transition-colors"
              >
                <span className="text-sm font-medium text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[#22D3EE]" />
                  Blind Structure ({blindStructure.filter(l => !l.is_break).length} Levels)
                </span>
                {structureErrors.length > 0 ? (
                  <span className="text-xs font-semibold text-[#EF4444]">
                    {structureErrors.length.toLocaleString()} Error{structureErrors.length === 1 ? '' : 's'}
                  </span>
                ) : (
                  <span className="text-xs text-[#22D3EE]">{estimateDuration(blindStructure)}</span>
                )}
              </button>
              {showBlinds && (
                <div className="mt-2 p-3 bg-[#0A1628] rounded-lg border border-[#1E3A5F]">
                  <BlindStructureEditor
                    structure={blindStructure}
                    onChange={setBlindStructure}
                    readOnly={false}
                    onValidationChange={setStructureValidation}
                  />
                </div>
              )}
            </div>

            {/* Receipt Settings */}
            <div className="p-3 bg-[#0D192E] rounded-lg space-y-2">
              <p className="text-xs font-medium text-[#64748B] uppercase tracking-wider mb-2">Registration Receipts</p>
              {[
                { label: 'Player Receipt', desc: 'Print Copy For The Player', value: printPlayerReceipt, setter: setPrintPlayerReceipt },
                { label: 'Dealer Receipt', desc: 'Print Copy For The Table Dealer', value: printDealerReceipt, setter: setPrintDealerReceipt },
                { label: 'Cashier Receipt', desc: 'Print Copy For The Cage', value: printCageReceipt, setter: setPrintCageReceipt },
              ].map((opt) => (
                <div key={opt.label} className="flex items-center justify-between py-1">
                  <div>
                    <p className="text-sm font-medium text-white">{opt.label}</p>
                    <p className="text-xs text-[#64748B]">{opt.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => opt.setter(!opt.value)}
                    className={`w-10 h-6 rounded-full transition-colors ${opt.value ? 'bg-[#10B981]' : 'bg-[#1E3A5F]'}`}
                  >
                    <div className={`w-4 h-4 bg-white rounded-full transition-transform ${opt.value ? 'translate-x-5' : 'translate-x-1'}`}></div>
                  </button>
                </div>
              ))}
            </div>

            {/* Multi-Day Event Toggle */}
            <div className="p-3 bg-[#0D192E] rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-[#F59E0B]" />
                  <div>
                    <p className="text-sm font-medium text-white">Multi-Day Event</p>
                    <p className="text-xs text-[#64748B]">Enable Flights And Bag-And-Tag</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsMultiDay(!isMultiDay)}
                  className={`w-10 h-6 rounded-full transition-colors ${isMultiDay ? 'bg-[#F59E0B]' : 'bg-[#1E3A5F]'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full transition-transform ${isMultiDay ? 'translate-x-5' : 'translate-x-1'}`}></div>
                </button>
              </div>
              {isMultiDay && (
                <div className="space-y-3 pt-2 border-t border-[#1E3A5F]">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-[#64748B]">Total Days</label>
                      <div className="grid grid-cols-3 gap-1 mt-1">
                        {[2, 3, 4].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setTotalDays(d)}
                            className={`h-8 rounded text-sm font-medium transition-colors ${totalDays === d
                              ? 'bg-[#F59E0B] text-white'
                              : 'bg-[#132240] text-white hover:bg-[#1E3A5F]'
                              }`}
                          >
                            {d} Days
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-[#64748B]">Flight Label</label>
                      <input
                        type="text"
                        value={flightLabel}
                        onChange={(e) => setFlightLabel(e.target.value)}
                        placeholder="e.g., Day 1A"
                        className="cmd-input w-full h-8 text-sm mt-1"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#64748B]">Day 2 Resume Time</label>
                    <input
                      type="datetime-local"
                      value={resumeTime}
                      onChange={(e) => setResumeTime(e.target.value)}
                      className="cmd-input w-full h-10 mt-1"
                    />
                  </div>
                  <p className="text-xs text-[#F59E0B]/80">
                    Players Will Be Notified When The Next Flight Resumes. Bag-And-Tag Chip Counts Can Be Recorded From The Tournament Manager.
                  </p>
                </div>
              )}
            </div>

            {/* Post to Club Page Toggle */}
            <div className="flex items-center justify-between p-3 bg-[#0D192E] rounded-lg">
              <div>
                <p className="text-sm font-medium text-white">Post To Club Page</p>
                <p className="text-xs text-[#64748B]">Auto-Add To Your Club Page Schedule</p>
              </div>
              <button
                type="button"
                onClick={() => setPostToClubPage(!postToClubPage)}
                className={`w-10 h-6 rounded-full transition-colors ${postToClubPage ? 'bg-[#22D3EE]' : 'bg-[#1E3A5F]'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${postToClubPage ? 'translate-x-5' : 'translate-x-1'}`}></div>
              </button>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !name.trim() || !scheduledStart}
              className="w-full h-12 cmd-btn cmd-btn-primary flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Trophy className="w-5 h-5" />
                  Create Tournament
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default memo(CreateTournamentModal);
