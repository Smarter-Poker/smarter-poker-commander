/**
 * CreateGameForm Component - Create/edit home game events
 * Reference: SCOPE_LOCK.md - Phase 4 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import { Users, Lock, Globe, Save, X
} from 'lucide-react';

const GAME_TYPES = [
  { value: 'nlhe', label: "No Limit Hold'em" },
  { value: 'plo', label: 'Pot Limit Omaha' },
  { value: 'plo5', label: 'PLO-5' },
  { value: 'mixed', label: 'Mixed Games' },
  { value: 'limit', label: 'Limit Hold\'em' },
  { value: 'stud', label: 'Stud' },
  { value: 'other', label: 'Other' }
];

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Public', icon: Globe, description: 'Anyone Can See and Request to Join' },
  { value: 'friends', label: 'Friends Only', icon: Users, description: 'Only Your Friends Can See This Game' },
  { value: 'private', label: 'Private', icon: Lock, description: 'Invite Code Required to Join' }
];

export default function CreateGameForm({
  initialData = {},
  groupId,
  onSubmit,
  onCancel,
  isEditing = false,
  isLoading = false
}) {
  const [formData, setFormData] = useState({
    title: initialData.title || '',
    description: initialData.description || '',
    game_type: initialData.game_type || 'nlhe',
    stakes: initialData.stakes || '',
    buy_in_min: initialData.buy_in_min || '',
    buy_in_max: initialData.buy_in_max || '',
    max_players: initialData.max_players || 9,
    event_date: initialData.event_date || '',
    start_time: initialData.start_time || '',
    end_time: initialData.end_time || '',
    address: initialData.address || '',
    city: initialData.city || '',
    state: initialData.state || '',
    zip: initialData.zip || '',
    visibility: initialData.visibility || 'friends',
    requires_approval: initialData.requires_approval !== undefined ? initialData.requires_approval : true,
    allow_guests: initialData.allow_guests || false,
    notes: initialData.notes || ''
  });

  const [errors, setErrors] = useState({});

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const validate = () => {
    const newErrors = {};
    if (!formData.title.trim()) newErrors.title = 'Title is required';
    if (!formData.game_type) newErrors.game_type = 'Game type is required';
    if (!formData.stakes.trim()) newErrors.stakes = 'Stakes are required';
    if (!formData.event_date) newErrors.event_date = 'Date is required';
    if (!formData.start_time) newErrors.start_time = 'Start time is required';
    if (!formData.address.trim()) newErrors.address = 'Address is required';
    if (!formData.city.trim()) newErrors.city = 'City is required';
    if (!formData.state.trim()) newErrors.state = 'State is required';
    if (formData.max_players < 2 || formData.max_players > 20) {
      newErrors.max_players = 'Must be between 2 and 20';
    }
    setErrors(newErrors);
    return Object.keys(newErrors || {}).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    onSubmit?.({
      ...formData,
      group_id: groupId,
      buy_in_min: formData.buy_in_min ? parseFloat(formData.buy_in_min) : null,
      buy_in_max: formData.buy_in_max ? parseFloat(formData.buy_in_max) : null,
      max_players: parseInt(formData.max_players)
    });
  };

  const renderField = (label, field, type = 'text', props = {}) => (
    <div>
      <label className="block text-sm font-medium mb-1.5 text-[#94A3B8]">
        {label} {props.required && <span className="text-[#EF4444]">*</span>}
      </label>
      {type === 'textarea' ? (
        <textarea
          value={formData[field]}
          onChange={(e) => updateField(field, e.target.value)}
          className={`w-full cmd-input min-h-[80px] resize-none ${errors[field] ? 'border-[#EF4444]' : ''}`}
          {...props}
        />
      ) : type === 'select' ? (
        <select
          value={formData[field]}
          onChange={(e) => updateField(field, e.target.value)}
          className={`w-full cmd-input ${errors[field] ? 'border-[#EF4444]' : ''}`}
        >
          {props.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          value={formData[field]}
          onChange={(e) => updateField(field, e.target.value)}
          className={`w-full cmd-input ${errors[field] ? 'border-[#EF4444]' : ''}`}
          {...props}
        />
      )}
      {errors[field] && (
        <p className="text-xs text-[#EF4444] mt-1">{errors[field]}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="cmd-panel p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4A5E78] mb-4">
          Game Details
        </h3>
        <div className="space-y-4">
          {renderField('Title', 'title', 'text', { placeholder: 'Friday Night Poker', required: true })}
          {renderField('Description', 'description', 'textarea', { placeholder: 'Casual Cash Game, All Levels Welcome...' })}
          <div className="grid grid-cols-2 gap-4">
            {renderField('Game Type', 'game_type', 'select', { options: GAME_TYPES, required: true })}
            {renderField('Stakes', 'stakes', 'text', { placeholder: '1/2 NL', required: true })}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {renderField('Min Buy-in ($)', 'buy_in_min', 'number', { placeholder: '100', min: 0 })}
            {renderField('Max Buy-in ($)', 'buy_in_max', 'number', { placeholder: '500', min: 0 })}
            {renderField('Max Players', 'max_players', 'number', { min: 2, max: 20, required: true })}
          </div>
        </div>
      </div>

      {/* Schedule */}
      <div className="cmd-panel p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4A5E78] mb-4">
          Schedule
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {renderField('Date', 'event_date', 'date', { required: true })}
          {renderField('Start Time', 'start_time', 'time', { required: true })}
          {renderField('End Time (est.)', 'end_time', 'time')}
        </div>
      </div>

      {/* Location */}
      <div className="cmd-panel p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4A5E78] mb-4">
          Location
        </h3>
        <div className="space-y-4">
          {renderField('Address', 'address', 'text', { placeholder: '123 Main St', required: true })}
          <div className="grid grid-cols-3 gap-4">
            {renderField('City', 'city', 'text', { placeholder: 'Austin', required: true })}
            {renderField('State', 'state', 'text', { placeholder: 'TX', required: true })}
            {renderField('ZIP', 'zip', 'text', { placeholder: '78701' })}
          </div>
          <p className="text-xs text-[#4A5E78]">
            Address is only shown to approved players
          </p>
        </div>
      </div>

      {/* Visibility */}
      <div className="cmd-panel p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4A5E78] mb-4">
          Visibility
        </h3>
        <div className="space-y-2">
          {VISIBILITY_OPTIONS.map(opt => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => updateField('visibility', opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                  formData.visibility === opt.value
                    ? 'border-[#22D3EE] bg-[#22D3EE]/10'
                    : 'border-[#4A5E78] hover:border-[#64748B]'
                }`}
              >
                <Icon
                  size={20}
                  className={formData.visibility === opt.value ? 'text-[#22D3EE]' : 'text-[#64748B]'}
                />
                <div>
                  <span className={`font-medium ${formData.visibility === opt.value ? 'text-[#22D3EE]' : 'text-white'}`}>
                    {opt.label}
                  </span>
                  <p className="text-xs text-[#64748B]">{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.requires_approval}
              onChange={(e) => updateField('requires_approval', e.target.checked)}
              className="w-5 h-5 rounded border-[#4A5E78]"
            />
            <span className="text-sm text-[#94A3B8]">Require Host Approval For RSVPs</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.allow_guests}
              onChange={(e) => updateField('allow_guests', e.target.checked)}
              className="w-5 h-5 rounded border-[#4A5E78]"
            />
            <span className="text-sm text-[#94A3B8]">Allow Players To Bring Guests</span>
          </label>
        </div>
      </div>

      {/* Notes */}
      <div className="cmd-panel p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-[#4A5E78] mb-4">
          Additional Notes
        </h3>
        {renderField('House Rules / Notes', 'notes', 'textarea', {
          placeholder: 'BYOB, no Smoking Inside, etc.'
        })}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 h-12 border rounded-xl font-medium flex items-center justify-center gap-2"
          style={{ borderColor: '#4A5E78', color: '#64748B' }}
        >
          <X size={18} />
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className="flex-1 cmd-btn cmd-btn-primary h-12 rounded-xl font-medium flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save size={18} />
          {isLoading ? 'Saving...' : isEditing ? 'Update Game' : 'Create Game'}
        </button>
      </div>
    </div>
  );
}
