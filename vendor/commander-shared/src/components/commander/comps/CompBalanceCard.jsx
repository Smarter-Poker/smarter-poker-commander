/**
 * CompBalanceCard Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React from 'react';
import { Wallet, TrendingUp, Gift, History, Lock } from 'lucide-react';

export default function CompBalanceCard({
  balance,
  venueName,
  onViewHistory,
  onRedeem,
  compact = false
}) {
  if (!balance) {
    return (
      <div className="cmd-panel p-4 text-center">
        <Wallet size={24} className="mx-auto text-[#4A5E78] mb-2" />
        <p className="text-[#64748B] text-sm">No Comp Balance</p>
      </div>
    );
  }

  const currentBalance = parseFloat(balance.current_balance) || 0;
  const lifetimeEarned = parseFloat(balance.lifetime_earned) || 0;
  const lifetimeRedeemed = parseFloat(balance.lifetime_redeemed) || 0;

  if (compact) {
    return (
      <div className="cmd-panel p-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: '#22C55E20' }}
          >
            <Wallet size={20} className="text-green-400" />
          </div>
          <div>
            <div className="text-xs text-[#64748B]">Comp Balance</div>
            <div className="text-lg font-bold text-white">
              ${currentBalance.toFixed(2)}
            </div>
          </div>
        </div>
        {onRedeem && currentBalance > 0 && (
          <button
            onClick={onRedeem}
            className="cmd-btn cmd-btn-primary px-3 py-1.5 text-sm"
          >
            Redeem
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="cmd-panel overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#4A5E78]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: '#22C55E20' }}
            >
              <Wallet size={24} className="text-green-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white">Comp Balance</h3>
              {venueName && (
                <p className="text-sm text-[#64748B]">{venueName}</p>
              )}
            </div>
          </div>
          {balance.is_frozen && (
            <div className="flex items-center gap-1 text-red-400 text-sm">
              <Lock size={14} />
              Frozen
            </div>
          )}
        </div>
      </div>

      {/* Balance */}
      <div className="p-6 text-center">
        <div className="text-4xl font-bold text-green-400">
          ${currentBalance.toFixed(2)}
        </div>
        <div className="text-sm text-[#4A5E78] mt-1">Available Balance</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-px bg-[#4A5E78]">
        <div className="p-4 text-center bg-[#132240]">
          <div className="flex items-center justify-center gap-1 text-[#64748B] mb-1">
            <TrendingUp size={14} />
            <span className="text-xs">Lifetime Earned</span>
          </div>
          <div className="text-lg font-semibold text-white">
            ${lifetimeEarned.toFixed(2)}
          </div>
        </div>
        <div className="p-4 text-center bg-[#132240]">
          <div className="flex items-center justify-center gap-1 text-[#64748B] mb-1">
            <Gift size={14} />
            <span className="text-xs">Total Redeemed</span>
          </div>
          <div className="text-lg font-semibold text-white">
            ${lifetimeRedeemed.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Last Activity */}
      {(balance.last_earned_at || balance.last_redeemed_at) && (
        <div className="px-4 py-3 border-t border-[#4A5E78] text-xs text-[#4A5E78]">
          {balance.last_earned_at && (
            <div>Last earned: {new Date(balance.last_earned_at).toLocaleDateString()}</div>
          )}
        </div>
      )}

      {/* Actions */}
      {(onViewHistory || onRedeem) && (
        <div className="p-4 flex gap-2 border-t border-[#4A5E78] bg-[#0B1426]">
          {onViewHistory && (
            <button
              onClick={onViewHistory}
              className="cmd-btn cmd-btn-secondary flex-1 flex items-center justify-center gap-2 py-2 text-sm"
            >
              <History size={16} />
              History
            </button>
          )}
          {onRedeem && (
            <button
              onClick={onRedeem}
              disabled={currentBalance <= 0 || balance.is_frozen}
              className="cmd-btn cmd-btn-primary flex-1 flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-50"
            >
              <Gift size={16} />
              Redeem
            </button>
          )}
        </div>
      )}
    </div>
  );
}
