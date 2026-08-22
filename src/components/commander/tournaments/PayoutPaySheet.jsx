/**
 * Payout Pay Sheet
 *
 * The bottom sheet the cage uses to hand one finisher their money, and to void
 * a mis-click. Shared by the TD Results screen and the TD Payouts screen so the
 * two behave identically at the window.
 *
 * Two modes, driven by whether the row is already paid:
 *   PAY   amount (prefilled from the recorded payout, editable), payment
 *         method, optional note, Confirm Pay.
 *   PAID  what was paid and when, plus Void Payment behind a confirm.
 *
 * A 409 ALREADY_PAID from the server is surfaced in place with a Re-Pay button
 * rather than as a dead-end error: the operator is standing at the window with
 * a player in front of them and needs a way forward.
 *
 * UI: dark theme, Inter, 44px+ targets, mobile first at 375px.
 */
import { useState, useEffect } from 'react';
import { Loader2, X, DollarSign, AlertTriangle, Undo2, CheckCircle2 } from 'lucide-react';
import {
  PAYOUT_PAYMENT_METHODS,
  DEFAULT_PAYOUT_PAYMENT_METHOD,
  payTournamentEntry,
  voidTournamentEntryPayment,
  payoutMoney
} from '../../../lib/commander/payoutPayments';

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '$0';
  return '$' + Math.round(num).toLocaleString();
}

function formatWhen(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {object} props
 * @param {string} props.tournamentId
 * @param {object} props.row          { entry_id, player_name, position, amount, paid, paid_at, payout_status }
 * @param {Function} props.onClose
 * @param {Function} props.onDone     called after a successful pay or void
 * @param {Function} props.setToast   optional, for the parent's toast strip
 */
export default function PayoutPaySheet({ tournamentId, row, onClose, onDone, setToast }) {
  const owed = payoutMoney(row?.amount);
  const [amount, setAmount] = useState(String(Math.round(owed)));
  const [method, setMethod] = useState(DEFAULT_PAYOUT_PAYMENT_METHOD);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsForce, setNeedsForce] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);

  useEffect(() => {
    setAmount(String(Math.round(payoutMoney(row?.amount))));
    setMethod(DEFAULT_PAYOUT_PAYMENT_METHOD);
    setNote('');
    setError(null);
    setNeedsForce(false);
    setConfirmVoid(false);
  }, [row?.entry_id, row?.amount]);

  if (!row) return null;

  const entered = payoutMoney(amount);
  const variance = payoutMoney(entered - owed);
  const isPaid = !!row.paid;

  const runPay = async (force) => {
    setBusy(true);
    setError(null);
    const result = await payTournamentEntry({
      tournamentId,
      entryId: row.entry_id,
      amount: entered,
      paymentMethod: method,
      notes: note.trim() || undefined,
      force
    });
    setBusy(false);

    if (result.ok) {
      if (setToast) {
        setToast({ type: 'success', text: result.data?.message || `${row.player_name} Paid ${formatMoney(entered)}.` });
      }
      if (onDone) await onDone(result.data);
      onClose();
      return;
    }

    if (result.code === 'ALREADY_PAID') setNeedsForce(true);
    setError(result.message);
  };

  const runVoid = async () => {
    setBusy(true);
    setError(null);
    const result = await voidTournamentEntryPayment({
      tournamentId,
      entryId: row.entry_id,
      reason: note.trim() || 'Voided At The Cage Window'
    });
    setBusy(false);

    if (result.ok) {
      if (setToast) {
        setToast({ type: 'success', text: result.data?.message || `Payment To ${row.player_name} Voided.` });
      }
      if (onDone) await onDone(result.data);
      onClose();
      return;
    }
    setError(result.message);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-[#242526] border-t border-[#3A3B3C] rounded-t-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#3A3B3C] sticky top-0 bg-[#242526]">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isPaid ? 'bg-[#31A24C]/20' : 'bg-[#1877F2]/20'}`}>
              {isPaid
                ? <CheckCircle2 className="w-5 h-5 text-[#31A24C]" />
                : <DollarSign className="w-5 h-5 text-[#1877F2]" />}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">{row.player_name || 'Player'}</h3>
              <p className="text-xs text-[#B0B3B8]">
                {row.position ? `Place ${row.position}, ` : ''}{formatMoney(owed)} Recorded
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#B0B3B8] active:bg-[#3A3B3C] flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {isPaid ? (
            <>
              <div className="rounded-xl border border-[#31A24C]/30 bg-[#31A24C]/10 px-4 py-3">
                <p className="text-sm font-semibold text-[#31A24C]">Already Paid</p>
                <p className="text-xs text-[#E4E6EB] mt-1">
                  {formatMoney(owed)} Handed Over On {formatWhen(row.paid_at)}.
                </p>
              </div>

              <div>
                <label htmlFor="payout-void-reason" className="text-xs text-[#B0B3B8] mb-1 block">
                  Reason (Optional)
                </label>
                <input
                  id="payout-void-reason"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Wrong Player, Wrong Amount, Mis-Tap"
                  className="w-full h-12 px-4 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2]"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30">
                  <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
              )}

              {!confirmVoid ? (
                <button
                  onClick={() => setConfirmVoid(true)}
                  disabled={busy}
                  className="w-full h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-50"
                >
                  <Undo2 className="w-5 h-5" /> Void This Payment
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[#E4E6EB]">
                    Void {formatMoney(owed)} To {row.player_name}? The Cash Row Is Reversed And This Place Goes Back On The Unpaid List.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmVoid(false)}
                      disabled={busy}
                      className="flex-1 h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold active:bg-[#4A4B4C] disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={runVoid}
                      disabled={busy}
                      className="flex-1 h-12 rounded-xl bg-[#EF4444] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Undo2 className="w-5 h-5" />}
                      Yes, Void
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label htmlFor="payout-amount" className="text-xs text-[#B0B3B8] mb-1 block">Amount Handed Over</label>
                <input
                  id="payout-amount"
                  type="number"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full h-14 px-4 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-white text-2xl font-bold text-center focus:outline-none focus:border-[#1877F2]"
                />
                {variance !== 0 && (
                  <p className="text-xs text-[#F59E0B] mt-1.5">
                    {variance > 0
                      ? `${formatMoney(variance)} More Than The Recorded Payout. The Drawer Will Read Over By That Much.`
                      : `${formatMoney(Math.abs(variance))} Less Than The Recorded Payout. The Drawer Will Read Short By That Much.`}
                  </p>
                )}
              </div>

              <div>
                <p className="text-xs text-[#B0B3B8] mb-2">Paid By</p>
                <div className="grid grid-cols-4 gap-2">
                  {PAYOUT_PAYMENT_METHODS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setMethod(m.value)}
                      className={`h-11 rounded-xl text-xs font-semibold ${method === m.value
                        ? 'bg-[#1877F2] text-white'
                        : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="payout-note" className="text-xs text-[#B0B3B8] mb-1 block">Note (Optional)</label>
                <input
                  id="payout-note"
                  type="text"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Anything The Drawer Count Should Know"
                  className="w-full h-12 px-4 rounded-xl bg-[#3A3B3C] border border-[#4A4B4C] text-[#E4E6EB] text-sm focus:outline-none focus:border-[#1877F2]"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30">
                  <AlertTriangle className="w-4 h-4 text-[#EF4444] flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-[#EF4444]">{error}</p>
                </div>
              )}

              {needsForce ? (
                <div className="space-y-2">
                  <button
                    onClick={() => runPay(true)}
                    disabled={busy || !(entered > 0)}
                    className="w-full h-12 rounded-xl bg-[#EF4444] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <DollarSign className="w-5 h-5" />}
                    Void The Old Payment And Re-Pay {formatMoney(entered)}
                  </button>
                  <p className="text-[11px] text-[#B0B3B8]">
                    The Previous Cash Row Is Voided First, So The Drawer Never Shows Two Live Payments For One Place.
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => runPay(false)}
                  disabled={busy || !(entered > 0)}
                  className="w-full h-14 rounded-xl bg-[#31A24C] text-white text-base font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <DollarSign className="w-5 h-5" />}
                  Confirm Pay {formatMoney(entered)}
                </button>
              )}

              <p className="text-[11px] text-[#B0B3B8]">
                This Records Money Leaving The Drawer. A Matching Cash Out Row Is Written Against This Tournament And Shows Up On The Reconciliation Report.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
