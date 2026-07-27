/**
 * HighHandDisplay Component - Display and track current high hand promotions
 * Reference: SCOPE_LOCK.md - Phase 5 Components
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState } from 'react';
import { Star, Clock, DollarSign, Trophy, User, Table2 } from 'lucide-react';

const HAND_RANKS = [
  'Royal Flush', 'Straight Flush', 'Four of a Kind', 'Full House',
  'Flush', 'Straight', 'Three of a Kind', 'Two Pair', 'One Pair', 'High Card'
];

const SUIT_SYMBOLS = {
  spades: { symbol: 'S', color: '#94A3B8' },
  hearts: { symbol: 'H', color: '#EF4444' },
  diamonds: { symbol: 'D', color: '#3B82F6' },
  clubs: { symbol: 'C', color: '#10B981' }
};

function TimeRemaining({ endTime }) {
  const [now, setNow] = useState(new Date());

  // Simple countdown - parent should handle interval updates
  if (!endTime) return null;
  const end = new Date(endTime);
  const diffMs = end - now;
  if (diffMs <= 0) return <span className="text-[#EF4444]">Ended</span>;

  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);

  return (
    <span className="text-[#22D3EE] font-mono">
      {hours}h {String(minutes).padStart(2, '0')}m
    </span>
  );
}

/**
 * HighHandDisplay - Main display component for high hand promotions
 */
export default function HighHandDisplay({
  promotion,
  currentHighHand,
  recentHighHands = [],
  onSubmitHand,
  isStaff = false,
  isLoading = false
}) {
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitData, setSubmitData] = useState({
    player_name: '',
    hand_description: '',
    hand_rank: '',
    table_number: '',
    game_type: 'nlhe'
  });
  const [submitLoading, setSubmitLoading] = useState(false);

  const handleSubmit = async () => {
    if (!submitData.player_name.trim() || !submitData.hand_description.trim()) return;
    setSubmitLoading(true);
    try {
      await onSubmitHand?.(submitData);
      setSubmitData({
        player_name: '',
        hand_description: '',
        hand_rank: '',
        table_number: '',
        game_type: 'nlhe'
      });
      setShowSubmitForm(false);
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Current High Hand Banner */}
      <div className="cmd-panel cmd-corner-lights p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Star size={20} className="text-[#F59E0B]" />
            Current High Hand
          </h3>
          {promotion?.end_time && (
            <div className="flex items-center gap-2 text-sm">
              <Clock size={14} className="text-[#64748B]" />
              <TimeRemaining endTime={promotion.end_time} />
            </div>
          )}
        </div>

        {currentHighHand ? (
          <div className="bg-[#0B1426] rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {/* Player Avatar */}
                <div className="w-14 h-14 rounded-full bg-[#132240] flex items-center justify-center">
                  {currentHighHand.profiles?.avatar_url ? (
                    <img
                      src={currentHighHand.profiles.avatar_url}
                      alt=""
                      className="w-14 h-14 rounded-full object-cover"
                    />
                  ) : (
                    <User size={24} className="text-[#64748B]" />
                  )}
                </div>
                <div>
                  <p className="text-xl font-bold text-white">
                    {currentHighHand.player_name || currentHighHand.profiles?.display_name || 'Unknown'}
                  </p>
                  <p className="text-lg font-medium text-[#F59E0B]">
                    {currentHighHand.hand_description}
                  </p>
                  {currentHighHand.hand_rank && (
                    <p className="text-sm text-[#64748B]">{currentHighHand.hand_rank}</p>
                  )}
                </div>
              </div>

              {/* Prize */}
              {promotion?.prize_amount && (
                <div className="text-right">
                  <p className="text-sm text-[#64748B]">Prize</p>
                  <p className="text-2xl font-bold text-[#10B981]">
                    ${promotion.prize_amount.toLocaleString()}
                  </p>
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex items-center gap-4 mt-3 text-sm text-[#64748B]">
              {currentHighHand.table_number && (
                <span className="flex items-center gap-1">
                  <Table2 size={14} />
                  Table {currentHighHand.table_number}
                </span>
              )}
              {currentHighHand.game_type && (
                <span>{currentHighHand.game_type.toUpperCase()}</span>
              )}
              {currentHighHand.created_at && (
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {new Date(currentHighHand.created_at).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit'
                  })}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-[#0B1426] rounded-lg p-8 text-center">
            <Trophy size={48} className="mx-auto text-[#4A5E78] mb-2" />
            <p className="text-[#64748B]">No Qualifying Hand Yet This Period</p>
            {promotion?.qualifying_hand && (
              <p className="text-xs text-[#4A5E78] mt-1">
                Minimum: {promotion.qualifying_hand}
              </p>
            )}
          </div>
        )}

        {/* Submit New Hand (Staff) */}
        {isStaff && (
          <div className="mt-3">
            {showSubmitForm ? (
              <div className="bg-[#0B1426] rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-white">Submit New High Hand</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      Player Name *
                    </label>
                    <input
                      type="text"
                      value={submitData.player_name}
                      onChange={(e) => setSubmitData(prev => ({ ...prev, player_name: e.target.value }))}
                      placeholder="Player Name"
                      className="w-full cmd-input text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      Table Number
                    </label>
                    <input
                      type="text"
                      value={submitData.table_number}
                      onChange={(e) => setSubmitData(prev => ({ ...prev, table_number: e.target.value }))}
                      placeholder="e.g., 5"
                      className="w-full cmd-input text-sm"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#64748B] mb-1">
                    Hand *
                  </label>
                  <input
                    type="text"
                    value={submitData.hand_description}
                    onChange={(e) => setSubmitData(prev => ({ ...prev, hand_description: e.target.value }))}
                    placeholder="e.g., Aces Full Of Kings"
                    className="w-full cmd-input text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      Hand Rank
                    </label>
                    <select
                      value={submitData.hand_rank}
                      onChange={(e) => setSubmitData(prev => ({ ...prev, hand_rank: e.target.value }))}
                      className="w-full cmd-input text-sm"
                    >
                      <option value="">Select Rank...</option>
                      {HAND_RANKS.map(rank => (
                        <option key={rank} value={rank}>{rank}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      Game Type
                    </label>
                    <select
                      value={submitData.game_type}
                      onChange={(e) => setSubmitData(prev => ({ ...prev, game_type: e.target.value }))}
                      className="w-full cmd-input text-sm"
                    >
                      <option value="nlhe">NLHE</option>
                      <option value="plo">PLO</option>
                      <option value="limit">Limit</option>
                      <option value="mixed">Mixed</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSubmitForm(false)}
                    className="cmd-btn cmd-btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={!submitData.player_name.trim() || !submitData.hand_description.trim() || submitLoading}
                    className="cmd-btn cmd-btn-primary text-sm disabled:opacity-50"
                  >
                    {submitLoading ? 'Submitting...' : 'Submit Hand'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowSubmitForm(true)}
                className="cmd-btn cmd-btn-primary text-sm w-full"
              >
                Submit New High Hand
              </button>
            )}
          </div>
        )}
      </div>

      {/* Promotion Info */}
      {promotion && (
        <div className="cmd-panel p-4">
          <h4 className="font-medium text-white mb-3">{promotion.name || 'High Hand Promotion'}</h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {promotion.prize_amount && (
              <div className="flex items-center gap-2">
                <DollarSign size={14} className="text-[#10B981]" />
                <span className="text-[#64748B]">Prize:</span>
                <span className="text-white font-medium">${promotion.prize_amount.toLocaleString()}</span>
              </div>
            )}
            {promotion.qualifying_hand && (
              <div className="flex items-center gap-2">
                <Star size={14} className="text-[#F59E0B]" />
                <span className="text-[#64748B]">Min Hand:</span>
                <span className="text-white font-medium">{promotion.qualifying_hand}</span>
              </div>
            )}
            {promotion.min_stakes && (
              <div className="flex items-center gap-2">
                <Table2 size={14} className="text-[#22D3EE]" />
                <span className="text-[#64748B]">Min Stakes:</span>
                <span className="text-white font-medium">{promotion.min_stakes}</span>
              </div>
            )}
            {promotion.description && (
              <div className="col-span-2 text-[#94A3B8]">{promotion.description}</div>
            )}
          </div>
        </div>
      )}

      {/* Recent High Hands */}
      {recentHighHands.length > 0 && (
        <div className="cmd-panel p-4">
          <h4 className="font-medium text-white mb-3">Recent High Hands</h4>
          <div className="space-y-2">
            {recentHighHands.map((hand, index) => (
              <div
                key={hand.id || index}
                className="flex items-center gap-3 p-3 rounded-lg bg-[#0B1426]"
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white"
                  style={{
                    backgroundColor: index === 0 ? '#F59E0B' :
                      index === 1 ? '#9CA3AF' :
                      index === 2 ? '#B45309' : '#4A5E78'
                  }}
                >
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white truncate">
                      {hand.player_name || hand.profiles?.display_name || 'Unknown'}
                    </span>
                  </div>
                  <p className="text-sm text-[#F59E0B]">{hand.hand_description}</p>
                </div>
                <div className="text-right text-sm flex-shrink-0">
                  {hand.table_number && (
                    <p className="text-[#64748B]">Table {hand.table_number}</p>
                  )}
                  {hand.created_at && (
                    <p className="text-[#4A5E78] text-xs">
                      {new Date(hand.created_at).toLocaleTimeString([], {
                        hour: 'numeric',
                        minute: '2-digit'
                      })}
                    </p>
                  )}
                </div>
                {hand.payout_amount > 0 && (
                  <span className="text-[#10B981] font-medium text-sm flex-shrink-0">
                    ${hand.payout_amount.toLocaleString()}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
