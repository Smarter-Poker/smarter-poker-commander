/**
 * CompIssueModal Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React, { useState } from 'react';
import { X, DollarSign, Plus, Minus, User, AlertTriangle } from 'lucide-react';

export default function CompIssueModal({
  player,
  currentBalance = 0,
  onIssue,
  onClose,
  isLoading = false
}) {
  const [mode, setMode] = useState('add'); // 'add' or 'adjust'
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0) return;

    const finalAmount = mode === 'adjust' ? -parseFloat(amount) : parseFloat(amount);
    onIssue({
      amount: finalAmount,
      description: description || (mode === 'add' ? 'Manual comp issued' : 'Manual adjustment')
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div className="w-full max-w-md cmd-panel cmd-corner-lights">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <h2 className="text-lg font-semibold text-white">
            {mode === 'add' ? 'Issue Comps' : 'Adjust Comps'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-[#132240] transition-colors"
          >
            <X size={20} className="text-[#64748B]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Player Info */}
          {player && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1426]">
              {player.avatar_url ? (
                <img
                  src={player.avatar_url}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[#0D192E]">
                  <User size={20} className="text-[#64748B]" />
                </div>
              )}
              <div>
                <div className="font-medium text-white">
                  {player.display_name || player.email || 'Player'}
                </div>
                <div className="text-sm text-[#64748B]">
                  Current balance: ${currentBalance.toFixed(2)}
                </div>
              </div>
            </div>
          )}

          {/* Mode Toggle */}
          <div className="flex rounded-lg overflow-hidden bg-[#0B1426]">
            <button
              type="button"
              onClick={() => setMode('add')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                mode === 'add' ? 'text-white' : 'text-[#64748B]'
              }`}
              style={{ backgroundColor: mode === 'add' ? '#22C55E' : 'transparent' }}
            >
              <Plus size={16} />
              Issue Comps
            </button>
            <button
              type="button"
              onClick={() => setMode('adjust')}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
                mode === 'adjust' ? 'text-white' : 'text-[#64748B]'
              }`}
              style={{ backgroundColor: mode === 'adjust' ? '#EF4444' : 'transparent' }}
            >
              <Minus size={16} />
              Adjustment
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm text-[#64748B] mb-1">
              {mode === 'add' ? 'Amount to Issue' : 'Amount to Deduct'}
            </label>
            <div className="relative">
              <DollarSign
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#4A5E78]"
              />
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="cmd-input w-full pl-10 pr-4 py-3 text-lg"
                placeholder="0.00"
                required
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-[#64748B] mb-1">Reason / Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="cmd-input w-full px-3 py-2"
              rows={2}
              placeholder={mode === 'add' ? 'e.g., Birthday bonus, Service recovery' : 'e.g., Correction, Error fix'}
            />
          </div>

          {/* Warning for adjustments */}
          {mode === 'adjust' && parseFloat(amount) > currentBalance && (
            <div className="flex items-start gap-2 p-3 rounded-lg text-sm bg-[#F59E0B]/10">
              <AlertTriangle size={16} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <span className="text-yellow-200">
                This will result in a negative balance of ${(currentBalance - parseFloat(amount || 0)).toFixed(2)}
              </span>
            </div>
          )}

          {/* Preview */}
          <div className="p-3 rounded-lg text-center bg-[#0B1426]">
            <div className="text-sm text-[#64748B] mb-1">New Balance</div>
            <div className={`text-2xl font-bold ${
              mode === 'adjust'
                ? 'text-red-400'
                : 'text-green-400'
            }`}>
              ${(currentBalance + (mode === 'add' ? parseFloat(amount || 0) : -parseFloat(amount || 0))).toFixed(2)}
            </div>
          </div>

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
              disabled={isLoading || !amount || parseFloat(amount) <= 0}
              className="flex-1 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: mode === 'add' ? '#22C55E' : '#EF4444',
                color: '#FFFFFF'
              }}
            >
              {isLoading ? 'Processing...' : mode === 'add' ? 'Issue Comps' : 'Apply Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
