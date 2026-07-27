/**
 * CompRedeemModal Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import { X, DollarSign, UtensilsCrossed, ShoppingBag, Trophy, Banknote, Hotel, Gift } from 'lucide-react';

const REDEMPTION_TYPES = [
  { value: 'food', label: 'Food & Beverage', icon: UtensilsCrossed, color: '#F59E0B' },
  { value: 'merchandise', label: 'Merchandise', icon: ShoppingBag, color: '#8B5CF6' },
  { value: 'tournament', label: 'Tournament Entry', icon: Trophy, color: '#3B82F6' },
  { value: 'cash', label: 'Cash Out', icon: Banknote, color: '#22C55E' },
  { value: 'hotel', label: 'Hotel', icon: Hotel, color: '#EC4899' },
  { value: 'other', label: 'Other', icon: Gift, color: '#6B7280' }
];

export default function CompRedeemModal({
  player,
  currentBalance = 0,
  onRedeem,
  onClose,
  isLoading = false
}) {
  const [amount, setAmount] = useState('');
  const [redemptionType, setRedemptionType] = useState('food');
  const [description, setDescription] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;
    if (parseFloat(amount) > currentBalance) return;

    onRedeem({
      amount: parseFloat(amount),
      redemption_type: redemptionType,
      description
    });
  };

  const selectedType = REDEMPTION_TYPES.find(t => t.value === redemptionType);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md cmd-panel cmd-corner-lights">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <h2 className="text-lg font-semibold text-white">Redeem Comps</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#132240] transition-colors"
          >
            <X size={20} className="text-[#64748B]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Balance Display */}
          <div className="p-4 rounded-lg text-center bg-[#0B1426]">
            <div className="text-sm text-[#64748B] mb-1">Available Balance</div>
            <div className="text-3xl font-bold text-green-400">
              ${currentBalance.toFixed(2)}
            </div>
            {player?.display_name && (
              <div className="text-sm text-[#4A5E78] mt-1">{player.display_name}</div>
            )}
          </div>

          {/* Redemption Type */}
          <div>
            <label className="block text-sm text-[#64748B] mb-2">Redemption Type</label>
            <div className="grid grid-cols-3 gap-2">
              {REDEMPTION_TYPES.map(type => {
                const Icon = type.icon;
                const isSelected = redemptionType === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setRedemptionType(type.value)}
                    className={`p-3 rounded-lg flex flex-col items-center gap-1 transition-colors ${isSelected ? 'ring-2' : ''
                      }`}
                    style={{
                      backgroundColor: isSelected ? `${type.color}20` : '#0B1426',
                      ringColor: type.color
                    }}
                  >
                    <Icon size={20} style={{ color: isSelected ? type.color : '#4A5E78' }} />
                    <span className={`text-xs ${isSelected ? 'text-white' : 'text-[#4A5E78]'}`}>
                      {type.label.split(' ')[0]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm text-[#64748B] mb-1">Amount To Redeem</label>
            <div className="relative">
              <DollarSign
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5E78]"
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={currentBalance}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="cmd-input w-full pl-10 pr-4 py-3 text-lg"
                placeholder="0.00"
                required
              />
            </div>
            {/* Quick Amount Buttons */}
            <div className="flex gap-2 mt-2">
              {[5, 10, 25, currentBalance].map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setAmount(preset.toString())}
                  className="flex-1 py-1.5 rounded text-xs font-medium text-[#64748B] hover:text-white transition-colors bg-[#0D192E]"
                >
                  {idx === 3 ? 'All' : `$${preset}`}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-[#64748B] mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="cmd-input w-full px-3 py-2"
              placeholder={`e.g., ${selectedType?.label || 'Redemption'} details`}
            />
          </div>

          {/* Error for insufficient balance */}
          {parseFloat(amount) > currentBalance && (
            <div className="text-red-400 text-sm text-center">
              Insufficient balance. Maximum: ${currentBalance.toFixed(2)}
            </div>
          )}

          {/* Summary */}
          {amount && parseFloat(amount) > 0 && parseFloat(amount) <= currentBalance && (
            <div className="p-3 rounded-lg bg-[#0B1426]">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[#64748B]">Redeeming</span>
                <span className="text-white font-medium">${parseFloat(amount).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[#64748B]">Remaining Balance</span>
                <span className="text-green-400 font-medium">
                  ${(currentBalance - parseFloat(amount)).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="cmd-btn cmd-btn-secondary flex-1 py-2.5"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !amount || parseFloat(amount) <= 0 || parseFloat(amount) > currentBalance}
              className="cmd-btn cmd-btn-primary flex-1 py-2.5 disabled:opacity-50"
            >
              {isLoading ? 'Processing...' : 'Redeem'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
