/**
 * CompTransactionList Component
 * Reference: IMPLEMENTATION_PHASES.md - Phase 5
 * Dark industrial sci-fi gaming theme
 */
import React from 'react';
import { TrendingUp, TrendingDown, RefreshCw, Gift, Clock, User } from 'lucide-react';

const TRANSACTION_STYLES = {
  earn: { icon: TrendingUp, color: '#22C55E', label: 'Earned' },
  bonus: { icon: Gift, color: '#8B5CF6', label: 'Bonus' },
  redeem: { icon: TrendingDown, color: '#EF4444', label: 'Redeemed' },
  adjust: { icon: RefreshCw, color: '#F59E0B', label: 'Adjustment' },
  expire: { icon: Clock, color: '#6B7280', label: 'Expired' },
  transfer: { icon: User, color: '#3B82F6', label: 'Transfer' }
};

function CompTransactionList({
  transactions = [],
  isLoading = false,
  showPlayer = false,
  onLoadMore,
  hasMore = false
}) {
  if (isLoading && transactions.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-16 rounded-lg animate-pulse bg-[#0D192E]"
          />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="cmd-panel p-8 text-center">
        <Clock size={32} className="mx-auto text-[#4A5E78] mb-2" />
        <p className="text-[#64748B]">No Transactions Yet</p>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString('en-US', { weekday: 'short' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Group transactions by date
  const groupedTransactions = transactions.reduce((groups, tx) => {
    const date = new Date(tx.created_at).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(tx);
    return groups;
  }, {});

  return (
    <div className="space-y-4">
      {Object.entries(groupedTransactions || {}).map(([date, txs]) => (
        <div key={date}>
          <div className="text-xs text-[#4A5E78] mb-2 px-1">{date}</div>
          <div className="cmd-panel overflow-hidden divide-y divide-[#4A5E78]">
            {txs.map((tx) => {
              const style = TRANSACTION_STYLES[tx.transaction_type] || TRANSACTION_STYLES.adjust;
              const Icon = style.icon;
              const amount = parseFloat(tx.amount) || 0;
              const isPositive = amount >= 0;

              return (
                <div
                  key={tx.id}
                  className="p-3 flex items-center gap-3"
                >
                  {/* Icon */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${style.color}20` }}
                  >
                    <Icon size={18} style={{ color: style.color }} />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white text-sm">
                        {style.label}
                      </span>
                      {showPlayer && tx.profiles && (
                        <span className="text-xs text-[#4A5E78]">
                          - {tx.profiles.display_name}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#4A5E78] truncate">
                      {tx.description || (tx.source_type === 'session'
                        ? `${tx.hours_played?.toFixed(1)}h played`
                        : style.label
                      )}
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="text-right flex-shrink-0">
                    <div className={`font-semibold ${
                      isPositive ? 'text-green-400' : 'text-red-400'
                    }`}>
                      {isPositive ? '+' : ''}${Math.abs(amount).toFixed(2)}
                    </div>
                    <div className="text-xs text-[#4A5E78]">
                      {formatDate(tx.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Load More */}
      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={isLoading}
          className="w-full py-3 text-center text-sm font-medium text-[#22D3EE] hover:bg-[#132240] rounded-lg transition-colors"
        >
          {isLoading ? 'Loading...' : 'Load more transactions'}
        </button>
      )}
    </div>
  );
}

export default React.memo(CompTransactionList);
