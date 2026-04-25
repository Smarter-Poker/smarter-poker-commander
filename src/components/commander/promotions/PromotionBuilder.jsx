/**
 * PromotionBuilder Component - Step-by-step promotion creation wizard
 * Reference: SCOPE_LOCK.md - Phase 5 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import {
  Gift, DollarSign, Calendar, Clock, Settings,
  ChevronRight, ChevronLeft, Check, X, Star, Zap, Sparkles
} from 'lucide-react';

const PROMOTION_TYPES = [
  { value: 'high_hand', label: 'High Hand', description: 'Award Best Hand Each Period', color: '#22C55E', icon: Star },
  { value: 'bad_beat', label: 'Bad Beat', description: 'Jackpot for Qualifying Bad Beats', color: '#EF4444', icon: Zap },
  { value: 'splash_pot', label: 'Splash Pot', description: 'Random Pot Bonuses', color: '#3B82F6', icon: DollarSign },
  { value: 'happy_hour', label: 'Happy Hour', description: 'Time-based Bonus Rewards', color: '#F59E0B', icon: Clock },
  { value: 'new_player', label: 'New Player', description: 'First-time Player Bonus', color: '#8B5CF6', icon: Gift },
  { value: 'referral', label: 'Referral', description: 'Refer a Friend Rewards', color: '#EC4899', icon: Gift },
  { value: 'loyalty', label: 'Loyalty', description: 'Reward Returning Players', color: '#22D3EE', icon: Star },
  { value: 'drawing', label: 'Drawing', description: 'Raffle / Drawing Entry', color: '#F97316', icon: Gift },
  { value: 'custom', label: 'Custom', description: 'Define Your Own Promotion', color: '#6B7280', icon: Settings }
];

const PRIZE_TYPES = [
  { value: 'cash', label: 'Cash' },
  { value: 'chips', label: 'Chips' },
  { value: 'freeroll', label: 'Freeroll Entry' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'points', label: 'Points/Diamonds' },
  { value: 'other', label: 'Other' }
];

const GAME_TYPE_OPTIONS = [
  { value: 'all', label: 'All Games' },
  { value: 'nlhe', label: 'NLHE' },
  { value: 'plo', label: 'PLO' },
  { value: 'limit', label: 'Limit' },
  { value: 'mixed', label: 'Mixed' }
];

const STEPS = [
  { key: 'type', label: 'Type', icon: Gift },
  { key: 'details', label: 'Details', icon: Settings },
  { key: 'prize', label: 'Prize', icon: DollarSign },
  { key: 'schedule', label: 'Schedule', icon: Calendar },
  { key: 'review', label: 'Review', icon: Check }
];

/** Pre-built templates with sensible defaults per type */
const TEMPLATE_DEFAULTS = {
  high_hand: { name: 'High Hand Bonus', description: 'Win a bonus for the highest hand of the hour! Quads or better qualify.', prize_type: 'cash', prize_amount: '500', qualifying_hand: 'Quads or Better', game_types: ['all'], max_winners: 1 },
  bad_beat: { name: 'Bad Beat Jackpot', description: 'Lose with quad Jacks or better to win the progressive bad beat jackpot!', prize_type: 'cash', prize_amount: '25000', qualifying_hand: 'Quad Jacks Beaten', game_types: ['all'], max_winners: 3 },
  splash_pot: { name: 'Splash Pot', description: 'Every 30 minutes, a random pot gets a cash bonus added!', prize_type: 'cash', prize_amount: '100', game_types: ['all'], max_winners: 1 },
  happy_hour: { name: 'Happy Hour', description: 'Double comp points during happy hour! 4 PM - 7 PM daily.', prize_type: 'points', prize_amount: '50', start_time: '16:00', end_time: '19:00', game_types: ['all'], max_winners: 99 },
  new_player: { name: 'New Player Freeroll', description: 'First-time players receive a free tournament entry worth $1,000!', prize_type: 'freeroll', prize_amount: '1000', game_types: ['all'], max_winners: 1 },
  referral: { name: 'Bring a Friend Bonus', description: 'Refer a friend and both of you receive a cash bonus when they play their first session!', prize_type: 'cash', prize_amount: '50', game_types: ['all'], max_winners: 99 },
  loyalty: { name: 'Loyalty Double Points', description: 'Earn double comp points all weekend long — Friday through Sunday.', prize_type: 'points', prize_amount: '', prize_description: '2x points', is_recurring: true, recurring_days: [5, 6, 0], game_types: ['all'], max_winners: 99 },
  drawing: { name: 'Prize Drawing', description: 'Earn 1 raffle ticket every hour of play. Drawing held at closing!', prize_type: 'cash', prize_amount: '500', game_types: ['all'], max_winners: 1 },
  custom: { name: '', description: '', prize_type: 'cash', prize_amount: '', game_types: ['all'], max_winners: 1 }
};

export default function PromotionBuilder({
  venueId,
  onSubmit,
  onCancel,
  isLoading = false
}) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState({
    promotion_type: '',
    name: '',
    description: '',
    game_types: ['all'],
    min_stakes: '',
    qualifying_hand: '',
    prize_type: 'cash',
    prize_amount: '',
    prize_description: '',
    max_winners: 1,
    start_date: '',
    end_date: '',
    start_time: '',
    end_time: '',
    is_recurring: false,
    recurring_days: [],
    is_featured: false,
    image_url: ''
  });
  const [useTemplate, setUseTemplate] = useState(true);

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const toggleGameType = (type) => {
    setFormData(prev => {
      if (type === 'all') return { ...prev, game_types: ['all'] };
      const types = prev.game_types.filter(t => t !== 'all');
      const exists = types.includes(type);
      const updated = exists ? types.filter(t => t !== type) : [...types, type];
      return { ...prev, game_types: updated.length === 0 ? ['all'] : updated };
    });
  };

  const toggleDay = (day) => {
    setFormData(prev => {
      const days = prev.recurring_days.includes(day)
        ? prev.recurring_days.filter(d => d !== day)
        : [...prev.recurring_days, day];
      return { ...prev, recurring_days: days };
    });
  };

  const canProceed = () => {
    switch (step) {
      case 0: return !!formData.promotion_type;
      case 1: return formData.name.trim().length > 0;
      case 2: return formData.prize_amount || formData.prize_description;
      case 3: return formData.start_date;
      default: return true;
    }
  };

  const handleSubmit = () => {
    onSubmit?.({
      venue_id: venueId,
      name: formData.name,
      description: formData.description,
      promotion_type: formData.promotion_type,
      prize_type: formData.prize_type,
      prize_value: formData.prize_amount ? parseFloat(formData.prize_amount) : null,
      prize_description: formData.prize_description,
      start_date: formData.start_date || null,
      end_date: formData.end_date || null,
      start_time: formData.start_time || null,
      end_time: formData.end_time || null,
      is_recurring: formData.is_recurring,
      days_of_week: formData.recurring_days.length > 0 ? formData.recurring_days : null,
      game_types: formData.game_types,
      min_stakes: formData.min_stakes || null,
      qualifying_hands: formData.qualifying_hand || null,
      is_featured: formData.is_featured,
      image_url: formData.image_url || null,
      status: 'active',
      settings: { max_winners: parseInt(formData.max_winners) || 1 }
    });
  };

  const selectedType = PROMOTION_TYPES.find(t => t.value === formData.promotion_type);

  return (
    <div className="space-y-4">
      {/* Step Indicator */}
      <div className="cmd-panel p-4">
        <div className="flex items-center justify-between">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isActive = i === step;
            const isDone = i < step;

            return (
              <div key={s.key} className="flex items-center">
                <button
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isActive
                    ? 'bg-[#22D3EE]/20 text-[#22D3EE]'
                    : isDone
                      ? 'text-[#10B981] hover:bg-[#132240]'
                      : 'text-[#4A5E78]'
                    }`}
                >
                  {isDone ? (
                    <Check size={16} className="text-[#10B981]" />
                  ) : (
                    <Icon size={16} />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </button>
                {i < STEPS.length - 1 && (
                  <ChevronRight size={16} className="text-[#4A5E78] mx-1" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="cmd-panel cmd-corner-lights p-5">
        {/* Step 0: Select Type */}
        {step === 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white">Choose Promotion Type</h3>
              <button
                onClick={() => setUseTemplate(!useTemplate)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${useTemplate ? 'border-[#F59E0B] bg-[#F59E0B]/10 text-[#F59E0B]' : 'border-[#4A5E78] text-[#64748B]'
                  }`}
              >
                <Sparkles size={14} />
                {useTemplate ? 'Templates On' : 'Templates Off'}
              </button>
            </div>
            {useTemplate && (
              <p className="text-xs text-[#64748B] mb-3 -mt-2">Selecting a type will auto-fill recommended settings. You can edit everything on the next steps.</p>
            )}
            <div className="grid grid-cols-3 gap-3">
              {PROMOTION_TYPES.map(type => {
                const Icon = type.icon;
                const isSelected = formData.promotion_type === type.value;

                return (
                  <button
                    key={type.value}
                    onClick={() => {
                      updateField('promotion_type', type.value);
                      if (useTemplate && TEMPLATE_DEFAULTS[type.value]) {
                        const tpl = TEMPLATE_DEFAULTS[type.value];
                        setFormData(prev => ({
                          ...prev,
                          promotion_type: type.value,
                          name: tpl.name || prev.name,
                          description: tpl.description || prev.description,
                          prize_type: tpl.prize_type || prev.prize_type,
                          prize_amount: tpl.prize_amount || prev.prize_amount,
                          prize_description: tpl.prize_description || prev.prize_description || '',
                          qualifying_hand: tpl.qualifying_hand || prev.qualifying_hand || '',
                          game_types: tpl.game_types || prev.game_types,
                          max_winners: tpl.max_winners || prev.max_winners,
                          start_time: tpl.start_time || prev.start_time,
                          end_time: tpl.end_time || prev.end_time,
                          is_recurring: tpl.is_recurring || false,
                          recurring_days: tpl.recurring_days || [],
                        }));
                      }
                    }}
                    className={`p-4 rounded-lg border text-left transition-colors ${isSelected
                      ? 'border-[#22D3EE] bg-[#22D3EE]/10'
                      : 'border-[#4A5E78] hover:border-[#64748B]'
                      }`}
                  >
                    <Icon size={24} style={{ color: type.color }} />
                    <p className="font-medium text-white mt-2">{type.label}</p>
                    <p className="text-xs text-[#64748B] mt-1">{type.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 1: Details */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Promotion Details</h3>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
                Name <span className="text-[#EF4444]">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder={selectedType ? `${selectedType.label} Promotion` : 'Promotion name'}
                className="w-full cmd-input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                placeholder="Describe The Promotion Rules..."
                className="w-full cmd-input min-h-[80px] resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Game Types</label>
              <div className="flex gap-2 flex-wrap">
                {GAME_TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => toggleGameType(opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${formData.game_types.includes(opt.value)
                      ? 'border-[#22D3EE] bg-[#22D3EE]/10 text-[#22D3EE]'
                      : 'border-[#4A5E78] text-[#64748B] hover:border-[#64748B]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Min Stakes</label>
                <input
                  type="text"
                  value={formData.min_stakes}
                  onChange={(e) => updateField('min_stakes', e.target.value)}
                  placeholder="e.g., 1/2"
                  className="w-full cmd-input"
                />
              </div>
              {(formData.promotion_type === 'high_hand' || formData.promotion_type === 'bad_beat') && (
                <div>
                  <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Qualifying Hand</label>
                  <input
                    type="text"
                    value={formData.qualifying_hand}
                    onChange={(e) => updateField('qualifying_hand', e.target.value)}
                    placeholder="e.g., Aces Full"
                    className="w-full cmd-input"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Image URL (optional)</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formData.image_url}
                  onChange={(e) => updateField('image_url', e.target.value)}
                  placeholder="https://example.com/promo-image.jpg"
                  className="flex-1 cmd-input"
                />
                {formData.image_url && (
                  <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: '1px solid #4A5E78', flexShrink: 0 }}>
                    <img src={formData.image_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Prize */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Prize Configuration</h3>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Prize Type</label>
              <div className="flex gap-2 flex-wrap">
                {PRIZE_TYPES.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateField('prize_type', opt.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${formData.prize_type === opt.value
                      ? 'border-[#22D3EE] bg-[#22D3EE]/10 text-[#22D3EE]'
                      : 'border-[#4A5E78] text-[#64748B] hover:border-[#64748B]'
                      }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
                  Prize Amount ($)
                </label>
                <input
                  type="number"
                  value={formData.prize_amount}
                  onChange={(e) => updateField('prize_amount', e.target.value)}
                  placeholder="500"
                  className="w-full cmd-input"
                  min="0"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
                  Max Winners
                </label>
                <input
                  type="number"
                  value={formData.max_winners}
                  onChange={(e) => updateField('max_winners', e.target.value)}
                  className="w-full cmd-input"
                  min="1"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
                Prize Description
              </label>
              <input
                type="text"
                value={formData.prize_description}
                onChange={(e) => updateField('prize_description', e.target.value)}
                placeholder="Describe The Prize Details..."
                className="w-full cmd-input"
              />
            </div>

            <label className="flex items-center gap-3 cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={formData.is_featured}
                onChange={(e) => updateField('is_featured', e.target.checked)}
                className="w-5 h-5 rounded border-[#4A5E78]"
              />
              <span className="text-sm text-[#94A3B8]">Feature This Promotion (shown Prominently)</span>
            </label>
          </div>
        )}

        {/* Step 3: Schedule */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Schedule</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">
                  Start Date <span className="text-[#EF4444]">*</span>
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => updateField('start_date', e.target.value)}
                  className="w-full cmd-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => updateField('end_date', e.target.value)}
                  className="w-full cmd-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Start Time</label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => updateField('start_time', e.target.value)}
                  className="w-full cmd-input"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">End Time</label>
                <input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => updateField('end_time', e.target.value)}
                  className="w-full cmd-input"
                />
              </div>
            </div>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_recurring}
                onChange={(e) => updateField('is_recurring', e.target.checked)}
                className="w-5 h-5 rounded border-[#4A5E78]"
              />
              <span className="text-sm text-[#94A3B8]">Recurring Promotion</span>
            </label>

            {formData.is_recurring && (
              <div>
                <label className="block text-sm font-medium text-[#94A3B8] mb-1.5">Repeat On</label>
                <div className="flex gap-2">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                    <button
                      key={day}
                      onClick={() => toggleDay(i)}
                      className={`w-10 h-10 rounded-lg text-xs font-medium border transition-colors ${formData.recurring_days.includes(i)
                        ? 'border-[#22D3EE] bg-[#22D3EE]/10 text-[#22D3EE]'
                        : 'border-[#4A5E78] text-[#64748B] hover:border-[#64748B]'
                        }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">Review Promotion</h3>

            <div className="bg-[#0B1426] rounded-lg p-4 space-y-3">
              {selectedType && (
                <div className="flex items-center gap-2">
                  <selectedType.icon size={20} style={{ color: selectedType.color }} />
                  <span className="font-medium text-white">{selectedType.label}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-[#64748B]">Name:</span>
                  <span className="text-white ml-2">{formData.name}</span>
                </div>
                {formData.description && (
                  <div className="col-span-2">
                    <span className="text-[#64748B]">Description:</span>
                    <span className="text-white ml-2">{formData.description}</span>
                  </div>
                )}
                <div>
                  <span className="text-[#64748B]">Prize:</span>
                  <span className="text-[#10B981] ml-2">
                    {formData.prize_amount ? `$${formData.prize_amount}` : formData.prize_description || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B]">Prize Type:</span>
                  <span className="text-white ml-2">{formData.prize_type}</span>
                </div>
                <div>
                  <span className="text-[#64748B]">Max Winners:</span>
                  <span className="text-white ml-2">{formData.max_winners}</span>
                </div>
                <div>
                  <span className="text-[#64748B]">Games:</span>
                  <span className="text-white ml-2">{formData.game_types.join(', ')}</span>
                </div>
                <div>
                  <span className="text-[#64748B]">Start:</span>
                  <span className="text-white ml-2">{formData.start_date || '-'}</span>
                </div>
                <div>
                  <span className="text-[#64748B]">End:</span>
                  <span className="text-white ml-2">{formData.end_date || 'Ongoing'}</span>
                </div>
                {formData.is_recurring && (
                  <div className="col-span-2">
                    <span className="text-[#64748B]">Recurring:</span>
                    <span className="text-white ml-2">
                      {formData.recurring_days.map(d =>
                        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]
                      ).join(', ')}
                    </span>
                  </div>
                )}
                {formData.is_featured && (
                  <div className="col-span-2">
                    <span className="text-[#F59E0B]">Featured Promotion</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        {step > 0 ? (
          <button
            onClick={() => setStep(step - 1)}
            className="flex items-center gap-2 px-6 h-12 border rounded-xl font-medium"
            style={{ borderColor: '#4A5E78', color: '#64748B' }}
          >
            <ChevronLeft size={18} />
            Back
          </button>
        ) : (
          <button
            onClick={onCancel}
            className="flex items-center gap-2 px-6 h-12 border rounded-xl font-medium"
            style={{ borderColor: '#4A5E78', color: '#64748B' }}
          >
            <X size={18} />
            Cancel
          </button>
        )}

        <div className="flex-1" />

        {step < STEPS.length - 1 ? (
          <button
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            className="cmd-btn cmd-btn-primary flex items-center gap-2 px-6 h-12 rounded-xl font-medium disabled:opacity-50"
          >
            Next
            <ChevronRight size={18} />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isLoading || !canProceed()}
            className="flex items-center gap-2 px-6 h-12 rounded-xl font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: '#10B981' }}
          >
            <Check size={18} />
            {isLoading ? 'Creating...' : 'Create Promotion'}
          </button>
        )}
      </div>
    </div>
  );
}
