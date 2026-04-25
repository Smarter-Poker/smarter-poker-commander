/**
 * PayoutModal - Configure and display tournament payouts
 * Shows payout structure and records actual payouts
 * UI: Dark industrial sci-fi gaming theme, no emojis, Inter font
 */
import { useState, useEffect, useMemo } from 'react';
import { X, DollarSign, Trophy, Loader2, Check } from 'lucide-react';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

// Standard payout percentages by number of places
const PAYOUT_STRUCTURES = {
  1: [100],
  2: [65, 35],
  3: [50, 30, 20],
  4: [45, 25, 18, 12],
  5: [40, 23, 16, 12, 9],
  6: [38, 22, 15, 11, 8, 6],
  7: [35, 21, 14, 10, 8, 6, 6],
  8: [32, 19, 13, 10, 8, 7, 6, 5],
  9: [30, 18, 12, 9, 8, 7, 6, 5, 5],
  10: [28, 17, 12, 9, 8, 7, 6, 5, 4, 4]
};

function getPayoutPercentages(places) {
  if (places <= 0) return [];
  if (places <= 10) return PAYOUT_STRUCTURES[places] || PAYOUT_STRUCTURES[10];

  // For more than 10 places, scale down top spots
  const base = [...PAYOUT_STRUCTURES[10]];
  const remaining = 100 - base.reduce((a, b) => a + b, 0);
  const extraPlaces = places - 10;
  const perExtra = remaining / extraPlaces;

  for (let i = 0; i < extraPlaces; i++) {
    base.push(Math.round(perExtra * 10) / 10);
  }

  return base;
}

export default function PayoutModal({
  isOpen,
  onClose,
  onSubmit,
  tournament,
  entries = []
}) {
  const [payingPlaces, setPayingPlaces] = useState(3);
  const [customPayouts, setCustomPayouts] = useState({});
  const [paidPlayers, setPaidPlayers] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Calculate prize pool
  const prizePool = useMemo(() => {
    if (tournament?.actual_prizepool) return tournament.actual_prizepool;

    const buyinTotal = entries.length * (tournament?.buyin_amount || 0);
    const guaranteed = tournament?.guaranteed_pool || 0;
    return Math.max(buyinTotal, guaranteed);
  }, [tournament, entries]);

  // Get eliminated entries sorted by finish position
  const finishedEntries = useMemo(() => {
    return entries
      .filter(e => e.status === 'eliminated' || e.finish_position)
      .sort((a, b) => (a.finish_position || 999) - (b.finish_position || 999));
  }, [entries]);

  // Calculate payouts
  const payouts = useMemo(() => {
    const percentages = getPayoutPercentages(payingPlaces);
    return percentages.map((pct, index) => {
      const customPct = customPayouts[index + 1];
      const actualPct = customPct !== undefined ? customPct : pct;
      return {
        position: index + 1,
        percentage: actualPct,
        amount: Math.round(prizePool * actualPct / 100)
      };
    });
  }, [payingPlaces, customPayouts, prizePool]);

  // Total percentage check
  const totalPercentage = payouts.reduce((sum, p) => sum + p.percentage, 0);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen && tournament) {
      // Auto-calculate paying places based on entries
      const totalEntries = entries.length || tournament.current_entries || 0;
      let places = 3;
      if (totalEntries >= 100) places = 10;
      else if (totalEntries >= 50) places = 8;
      else if (totalEntries >= 30) places = 6;
      else if (totalEntries >= 20) places = 5;
      else if (totalEntries >= 10) places = 3;
      else if (totalEntries >= 5) places = 2;
      else places = 1;

      setPayingPlaces(places);
      setCustomPayouts({});
      setPaidPlayers({});
      setError(null);
    }
  }, [isOpen, tournament, entries]);

  function handlePercentageChange(position, value) {
    const numValue = parseFloat(value) || 0;
    setCustomPayouts(prev => ({
      ...prev,
      [position]: numValue
    }));
  }

  function markAsPaid(position) {
    setPaidPlayers(prev => ({
      ...prev,
      [position]: !prev[position]
    }));
  }

  async function handleSaveStructure() {
    if (Math.abs(totalPercentage - 100) > 0.5) {
      setError('Payout percentages must total 100%');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const staffSession = localStorage.getItem('commander_staff') || '';
      const res = await fetch(`/api/commander/tournaments/${tournament.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-staff-session': staffSession },
        body: JSON.stringify({
          payout_structure: payouts,
          actual_prizepool: prizePool,
          paying_places: payingPlaces
        })
      });
      if (!res.ok) throw new Error('Request failed');

      const data = await res.json();

      if (data.success) {
        broadcastChange('tournaments');
        onSubmit?.({ payouts, prizePool, payingPlaces });
        onClose();
      } else {
        setError(data.error?.message || 'Failed to save payout structure');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!isOpen || !tournament) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel cmd-corner-lights w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#4A5E78]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#10B981] rounded-lg flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white uppercase tracking-wider">{tournament.name || 'Tournament Payouts'}</h2>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#132240] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#64748B]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="p-3 bg-[#EF4444]/10 rounded-lg">
              <p className="text-sm text-[#EF4444]">{error}</p>
            </div>
          )}

          {/* Prize Pool Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-[#10B981]/10 rounded-lg">
              <p className="text-sm text-[#64748B]">Prize Pool</p>
              <p className="text-2xl font-bold text-[#10B981]">
                ${prizePool.toLocaleString()}
              </p>
            </div>
            <div className="p-4 bg-[#22D3EE]/10 rounded-lg">
              <p className="text-sm text-[#64748B]">Entries</p>
              <p className="text-2xl font-bold text-[#22D3EE]">
                {entries.length || tournament.current_entries || 0}
              </p>
            </div>
          </div>

          {/* Paying Places */}
          <div>
            <label className="block text-sm font-medium text-white mb-2">
              Paying Places
            </label>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    setPayingPlaces(num);
                    setCustomPayouts({});
                  }}
                  className={`w-10 h-10 rounded-lg font-medium transition-colors ${payingPlaces === num
                    ? 'bg-[#22D3EE] text-white'
                    : 'bg-[#0D192E] text-white hover:bg-[#132240]'
                    }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Payout Structure */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-white">
                Payout Structure
              </label>
              <span className={`text-sm font-medium ${Math.abs(totalPercentage - 100) > 0.5 ? 'text-[#EF4444]' : 'text-[#10B981]'
                }`}>
                Total: {totalPercentage.toFixed(1)}%
              </span>
            </div>

            <div className="space-y-2">
              {payouts.map((payout) => {
                const finisher = finishedEntries.find(e => e.finish_position === payout.position);
                const isPaid = paidPlayers[payout.position];

                return (
                  <div
                    key={payout.position}
                    className={`flex items-center gap-3 p-3 rounded-lg ${isPaid ? 'bg-[#10B981]/10' : 'bg-[#0D192E]'
                      }`}
                  >
                    <div className="w-8 h-8 bg-[#0B1426] rounded-full flex items-center justify-center">
                      <Trophy className={`w-4 h-4 ${payout.position === 1 ? 'text-[#F59E0B]' :
                        payout.position === 2 ? 'text-[#4A5E78]' :
                          payout.position === 3 ? 'text-[#B45309]' :
                            'text-[#64748B]'
                        }`} />
                    </div>

                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#10B981] text-lg">
                          {payout.position}{payout.position === 1 ? 'st' : payout.position === 2 ? 'nd' : payout.position === 3 ? 'rd' : 'th'}
                        </span>
                        {finisher && (
                          <span className="text-sm text-[#64748B]">
                            - {finisher.player_name || finisher.profiles?.display_name}
                          </span>
                        )}
                      </div>
                    </div>

                    <input
                      type="number"
                      value={customPayouts[payout.position] ?? payout.percentage}
                      onChange={(e) => handlePercentageChange(payout.position, e.target.value)}
                      className="cmd-input w-16 h-8 px-2 text-center text-sm"
                      step="0.1"
                      min="0"
                      max="100"
                    />
                    <span className="text-sm text-[#64748B] w-6">%</span>

                    <div className="w-24 text-right">
                      <span className="font-semibold text-[#10B981] text-lg">
                        ${payout.amount.toLocaleString()}
                      </span>
                    </div>

                    {finisher && (
                      <button
                        onClick={() => markAsPaid(payout.position)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isPaid
                          ? 'bg-[#10B981] text-white'
                          : 'border border-[#4A5E78] text-[#64748B] hover:bg-[#132240]'
                          }`}
                      >
                        <Check className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#4A5E78]">
          <button
            onClick={handleSaveStructure}
            disabled={Math.abs(totalPercentage - 100) > 0.5 || submitting}
            className="w-full h-12 bg-[#10B981] text-white font-semibold rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <DollarSign className="w-5 h-5" />
                Save Payout Structure
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
