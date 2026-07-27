/**
 * PromotionEditor Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, Calendar, DollarSign } from 'lucide-react';

const PROMOTION_TYPES = [
  { value: 'high_hand', label: 'High Hand' },
  { value: 'bad_beat', label: 'Bad Beat' },
  { value: 'splash_pot', label: 'Splash Pot' },
  { value: 'happy_hour', label: 'Happy Hour' },
  { value: 'new_player', label: 'New Player Bonus' },
  { value: 'referral', label: 'Referral Bonus' },
  { value: 'loyalty', label: 'Loyalty Reward' },
  { value: 'tournament_bonus', label: 'Tournament Bonus' },
  { value: 'cash_back', label: 'Cash Back' },
  { value: 'drawing', label: 'Drawing' },
  { value: 'custom', label: 'Custom' },
  { value: 'other', label: 'Other' }
];

const PRIZE_TYPES = [
  { value: 'cash', label: 'Cash' },
  { value: 'chips', label: 'Chips' },
  { value: 'freeroll', label: 'Freeroll Entry' },
  { value: 'merchandise', label: 'Merchandise' },
  { value: 'points', label: 'Points' },
  { value: 'other', label: 'Other' }
];

const GAME_TYPES = [
  { value: 'nlhe', label: "No Limit Hold'em" },
  { value: 'plo', label: 'Pot Limit Omaha' },
  { value: 'limit', label: 'Limit' },
  { value: 'mixed', label: 'Mixed Games' },
  { value: 'all', label: 'All Games' }
];

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' }
];

export default function PromotionEditor({
  promotion = null,
  venueId,
  onSave,
  onDelete,
  onClose,
  isLoading = false
}) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    promotion_type: 'high_hand',
    prize_type: 'cash',
    prize_value: '',
    prize_description: '',
    start_date: '',
    end_date: '',
    days_of_week: [],
    start_time: '',
    end_time: '',
    is_recurring: false,
    min_stakes: '',
    min_hours_played: '',
    min_buyin: '',
    game_types: [],
    qualifying_hands: '',
    status: 'draft',
    is_featured: false,
    terms_conditions: '',
    image_url: ''
  });

  useEffect(() => {
    if (promotion) {
      setFormData({
        name: promotion.name || '',
        description: promotion.description || '',
        promotion_type: promotion.promotion_type || 'high_hand',
        prize_type: promotion.prize_type || 'cash',
        prize_value: promotion.prize_value || '',
        prize_description: promotion.prize_description || '',
        start_date: promotion.start_date || '',
        end_date: promotion.end_date || '',
        days_of_week: promotion.days_of_week || [],
        start_time: promotion.start_time || '',
        end_time: promotion.end_time || '',
        is_recurring: promotion.is_recurring || false,
        min_stakes: promotion.min_stakes || '',
        min_hours_played: promotion.min_hours_played || '',
        min_buyin: promotion.min_buyin || '',
        game_types: promotion.game_types || [],
        qualifying_hands: promotion.qualifying_hands || '',
        status: promotion.status || 'draft',
        is_featured: promotion.is_featured || false,
        terms_conditions: promotion.terms_conditions || '',
        image_url: promotion.image_url || ''
      });
    }
  }, [promotion]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleDayToggle = (day) => {
    setFormData(prev => ({
      ...prev,
      days_of_week: prev.days_of_week.includes(day)
        ? prev.days_of_week.filter(d => d !== day)
        : [...prev.days_of_week, day].sort()
    }));
  };

  const handleGameTypeToggle = (gameType) => {
    setFormData(prev => ({
      ...prev,
      game_types: prev.game_types.includes(gameType)
        ? prev.game_types.filter(g => g !== gameType)
        : [...prev.game_types, gameType]
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Sync is_active with status to keep both fields consistent
    const isActive = formData.status === 'active';
    const data = {
      ...formData,
      venue_id: venueId,
      is_active: isActive,
      prize_value: formData.prize_value ? parseInt(formData.prize_value) : null,
      min_hours_played: formData.min_hours_played ? parseFloat(formData.min_hours_played) : null,
      min_buyin: formData.min_buyin ? parseInt(formData.min_buyin) : null,
      image_url: formData.image_url || null
    };
    onSave(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto cmd-panel cmd-corner-lights">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between p-4 border-b border-[#4A5E78] bg-[#132240] rounded-t-xl">
          <h2 className="text-lg font-semibold text-white">
            {promotion ? 'Edit Promotion' : 'New Promotion'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#132240] transition-colors"
          >
            <X size={20} className="text-[#64748B]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#64748B] uppercase">Basic Information</h3>

            <div>
              <label className="block text-sm text-[#64748B] mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className="cmd-input w-full px-3 py-2"
                placeholder="e.g., High Hand Bonus"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-[#64748B] mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => handleChange('description', e.target.value)}
                className="cmd-input w-full px-3 py-2"
                rows={3}
                placeholder="Describe The Promotion..."
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#64748B] mb-1">Promotion Type *</label>
                <select
                  value={formData.promotion_type}
                  onChange={(e) => handleChange('promotion_type', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  required
                >
                  {PROMOTION_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => handleChange('status', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                >
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            </div>
          </div>

          {/* Prize */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#64748B] uppercase flex items-center gap-2">
              <DollarSign size={14} />
              Prize Details
            </h3>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-[#64748B] mb-1">Prize Type</label>
                <select
                  value={formData.prize_type}
                  onChange={(e) => handleChange('prize_type', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                >
                  {PRIZE_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">Prize Value</label>
                <input
                  type="number"
                  value={formData.prize_value}
                  onChange={(e) => handleChange('prize_value', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  placeholder="100"
                />
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">Description</label>
                <input
                  type="text"
                  value={formData.prize_description}
                  onChange={(e) => handleChange('prize_description', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  placeholder="e.g., $100 Cash"
                />
              </div>
            </div>
          </div>

          {/* Schedule */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#64748B] uppercase flex items-center gap-2">
              <Calendar size={14} />
              Schedule
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#64748B] mb-1">Start Date</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => handleChange('start_date', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">End Date</label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => handleChange('end_date', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#64748B] mb-1">Start Time</label>
                <input
                  type="time"
                  value={formData.start_time}
                  onChange={(e) => handleChange('start_time', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                />
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">End Time</label>
                <input
                  type="time"
                  value={formData.end_time}
                  onChange={(e) => handleChange('end_time', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#64748B] mb-2">Days Of Week</label>
              <div className="flex gap-2">
                {DAYS_OF_WEEK.map(day => (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => handleDayToggle(day.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${formData.days_of_week.includes(day.value)
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-[#64748B]'
                      }`}
                  >
                    {day.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_recurring}
                onChange={(e) => handleChange('is_recurring', e.target.checked)}
                className="w-4 h-4 rounded text-[#22D3EE] focus:ring-[#22D3EE] border-[#4A5E78]"
              />
              <span className="text-sm text-gray-300">Recurring Promotion</span>
            </label>
          </div>

          {/* Requirements */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#64748B] uppercase">Requirements</h3>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-[#64748B] mb-1">Min Stakes</label>
                <input
                  type="text"
                  value={formData.min_stakes}
                  onChange={(e) => handleChange('min_stakes', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  placeholder="1/2"
                />
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">Min Hours</label>
                <input
                  type="number"
                  step="0.5"
                  value={formData.min_hours_played}
                  onChange={(e) => handleChange('min_hours_played', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  placeholder="2"
                />
              </div>

              <div>
                <label className="block text-sm text-[#64748B] mb-1">Min Buy-in</label>
                <input
                  type="number"
                  value={formData.min_buyin}
                  onChange={(e) => handleChange('min_buyin', e.target.value)}
                  className="cmd-input w-full px-3 py-2"
                  placeholder="100"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#64748B] mb-2">Eligible Games</label>
              <div className="flex flex-wrap gap-2">
                {GAME_TYPES.map(game => (
                  <button
                    key={game.value}
                    type="button"
                    onClick={() => handleGameTypeToggle(game.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${formData.game_types.includes(game.value)
                      ? 'bg-[#22D3EE] text-white'
                      : 'bg-[#0D192E] text-[#64748B]'
                      }`}
                  >
                    {game.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm text-[#64748B] mb-1">Qualifying Hands</label>
              <input
                type="text"
                value={formData.qualifying_hands}
                onChange={(e) => handleChange('qualifying_hands', e.target.value)}
                className="cmd-input w-full px-3 py-2"
                placeholder="e.g., Aces Full Or Better"
              />
            </div>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[#64748B] uppercase">Options</h3>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_featured}
                onChange={(e) => handleChange('is_featured', e.target.checked)}
                className="w-4 h-4 rounded text-[#22D3EE] focus:ring-[#22D3EE] border-[#4A5E78]"
              />
              <span className="text-sm text-gray-300">Featured Promotion (highlighted)</span>
            </label>

            <div>
              <label className="block text-sm text-[#64748B] mb-1">Terms & Conditions</label>
              <textarea
                value={formData.terms_conditions}
                onChange={(e) => handleChange('terms_conditions', e.target.value)}
                className="cmd-input w-full px-3 py-2"
                rows={3}
                placeholder="Enter Any Terms And Conditions..."
              />
            </div>

            <div>
              <label className="block text-sm text-[#64748B] mb-1">Image URL (optional)</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={formData.image_url}
                  onChange={(e) => handleChange('image_url', e.target.value)}
                  className="cmd-input flex-1 px-3 py-2"
                  placeholder="https://example.com/promo-image.jpg"
                />
                {formData.image_url && (
                  <div style={{ width: 40, height: 40, borderRadius: 8, overflow: 'hidden', border: '1px solid #4A5E78', flexShrink: 0 }}>
                    <img src={formData.image_url} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-[#4A5E78]">
            {promotion && onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(promotion.id)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-red-400 hover:bg-red-900/20 transition-colors"
                disabled={isLoading}
              >
                <Trash2 size={16} />
                Delete
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="cmd-btn cmd-btn-secondary px-4 py-2"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="cmd-btn cmd-btn-primary flex items-center gap-2 px-6 py-2 disabled:opacity-50"
                disabled={isLoading || !formData.name}
              >
                <Save size={16} />
                {isLoading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
