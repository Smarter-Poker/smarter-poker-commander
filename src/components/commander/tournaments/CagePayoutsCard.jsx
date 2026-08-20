/**
 * Cage Payouts Card
 *
 * "Who has actually been handed their money." Recording a payout
 * (payout_amount on the entry) and PAYING it are two different events, and
 * until this existed only the first one was ever written: 337 production entry
 * rows carried a payout with payout_status, paid_at and paid_by all NULL, no
 * cash_out row was ever created, and the drawer reconciliation report therefore
 * showed ACTUAL OUT of zero on every event ever run.
 *
 * This card is the cage window. It lists every place that is owed money, shows
 * the running paid / still owed totals, pays one finisher through
 * PayoutPaySheet, and pays the whole remaining field in one confirmed action.
 *
 * Rendered by BOTH the TD Results screen and the TD Payouts screen. One
 * implementation on purpose: two copies of a money screen drift, and a drifted
 * money screen is how a room pays somebody twice.
 *
 * UI: dark theme, Inter, 44px+ targets, mobile first at 375px.
 */
import { useState, useMemo } from 'react';
import { DollarSign, CheckCircle2, Loader2 } from 'lucide-react';
import PayoutPaySheet from './PayoutPaySheet';
import {
  summarisePayouts, isPayable, payAllRemaining,
  DEFAULT_PAYOUT_PAYMENT_METHOD, payoutMoney
} from '../../../lib/commander/payoutPayments';

function formatMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '$0';
  return '$' + Math.round(num).toLocaleString();
}

function ordinal(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '--';
  const rem100 = num % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${num}th`;
  const rem10 = num % 10;
  if (rem10 === 1) return `${num}st`;
  if (rem10 === 2) return `${num}nd`;
  if (rem10 === 3) return `${num}rd`;
  return `${num}th`;
}

function formatWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * @param {object} props
 * @param {string} props.tournamentId
 * @param {Array} props.rows        [{ entry_id, player_name, position, amount,
 *                                     paid, paid_at, payout_status, projected, is_seat }]
 * @param {Function} props.onRefresh  awaited after any successful pay or void
 * @param {Function} props.setToast   parent toast strip
 * @param {string} [props.title]      defaults to "Cage Payouts"
 */
export default function CagePayoutsCard({ tournamentId, rows, onRefresh, setToast, title = 'Cage Payouts' }) {
  const [paySheetRow, setPaySheetRow] = useState(null);
  const [confirmPayAll, setConfirmPayAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);

  const owedRows = useMemo(
    () => (rows || []).filter(r => payoutMoney(r?.amount) > 0),
    [rows]
  );
  const summary = useMemo(() => summarisePayouts(owedRows), [owedRows]);
  const remaining = useMemo(() => owedRows.filter(isPayable), [owedRows]);
  const remainingTotal = useMemo(
    () => payoutMoney(remaining.reduce((s, r) => s + payoutMoney(r.amount), 0)),
    [remaining]
  );

  if (owedRows.length === 0) return null;

  /**
   * Pay everyone still owed, one at a time.
   *
   * Sequential by design (see payAllRemaining): the cage counts money out one
   * player at a time, and a mid-run failure has to leave a state a human can
   * read. Defaults to cash; anyone being paid another way is paid through the
   * sheet first and is then simply not in this list.
   */
  const runPayAll = async () => {
    if (!tournamentId || remaining.length === 0) return;
    setBusy(true);
    try {
      const { paid, failed, paidTotal } = await payAllRemaining(remaining, {
        tournamentId,
        paymentMethod: DEFAULT_PAYOUT_PAYMENT_METHOD,
        onProgress: setProgress
      });

      if (setToast) {
        if (failed.length === 0) {
          setToast({
            type: 'success',
            text: `${paid.length} Payout${paid.length === 1 ? '' : 's'} Paid, ${formatMoney(paidTotal)} Out Of The Drawer.`
          });
        } else {
          setToast({
            type: 'error',
            text: `${paid.length} Paid, ${failed.length} Failed. Not Paid: ${failed.map(f => f.player_name).join(', ')}.`
          });
        }
      }
      if (onRefresh) await onRefresh();
    } catch (err) {
      console.warn('[CagePayoutsCard] Pay all failed:', err?.message || err);
      if (setToast) setToast({ type: 'error', text: 'Pay All Failed. Check The Connection And Try Again.' });
    } finally {
      setBusy(false);
      setProgress(null);
      setConfirmPayAll(false);
    }
  };

  return (
    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
      <div className="px-4 py-2 border-b border-[#3A3B3C] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-[#31A24C]" />
          <h3 className="text-xs font-bold text-[#B0B3B8] uppercase tracking-wider">{title}</h3>
        </div>
        <span className="text-[10px] text-[#B0B3B8]">
          {summary.paidCount} Of {summary.paidCount + summary.unpaidCount} Paid
        </span>
      </div>

      {/* Running totals */}
      <div className="grid grid-cols-2 divide-x divide-[#3A3B3C] border-b border-[#3A3B3C]">
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Paid Out</p>
          <p className="text-lg font-bold text-[#31A24C]">{formatMoney(summary.paidTotal)}</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-[10px] text-[#B0B3B8] uppercase tracking-wider">Still Owed</p>
          <p className={`text-lg font-bold ${summary.unpaidTotal > 0 ? 'text-[#F59E0B]' : 'text-[#B0B3B8]'}`}>
            {formatMoney(summary.unpaidTotal)}
          </p>
        </div>
      </div>

      <div className="divide-y divide-[#3A3B3C]">
        {owedRows.map(r => (
          <div key={`pay-${r.position || 'x'}-${r.entry_id || r.player_name}`} className="px-4 py-3 flex items-center gap-3">
            <span className="w-9 text-xs font-bold text-[#B0B3B8] flex-shrink-0">
              {r.position ? ordinal(r.position) : '--'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#E4E6EB] truncate">{r.player_name || 'Player'}</p>
              <p className="text-[10px] text-[#B0B3B8]">
                {r.is_seat ? 'Seat, ' : ''}{formatMoney(r.amount)}
                {r.paid && r.paid_at ? `, Paid ${formatWhen(r.paid_at)}` : ''}
                {!r.paid && r.payout_status === 'voided' ? ', Previous Payment Voided' : ''}
                {r.projected ? ', Provisional' : ''}
              </p>
            </div>
            {r.paid ? (
              <button
                onClick={() => setPaySheetRow(r)}
                disabled={busy}
                className="h-11 px-3 rounded-xl bg-[#31A24C]/15 border border-[#31A24C]/40 text-[#31A24C] text-xs font-bold flex items-center gap-1.5 flex-shrink-0 active:bg-[#31A24C]/25 disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" /> Paid
              </button>
            ) : (r.projected || !r.entry_id) ? (
              <span className="h-11 px-3 rounded-xl bg-[#3A3B3C] text-[#B0B3B8] text-xs font-medium flex items-center flex-shrink-0">
                Not Final
              </span>
            ) : (
              <button
                onClick={() => setPaySheetRow(r)}
                disabled={busy}
                className="h-11 px-4 rounded-xl bg-[#1877F2] text-white text-xs font-bold flex items-center gap-1.5 flex-shrink-0 active:opacity-90 disabled:opacity-50"
              >
                <DollarSign className="w-4 h-4" /> Pay
              </button>
            )}
          </div>
        ))}
      </div>

      {remaining.length > 0 && (
        <div className="px-4 py-3 border-t border-[#3A3B3C] bg-[#1C1D1E] space-y-2">
          {!confirmPayAll ? (
            <button
              onClick={() => setConfirmPayAll(true)}
              disabled={busy}
              className="w-full h-12 rounded-xl bg-[#31A24C] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
            >
              <DollarSign className="w-5 h-5" />
              Pay All Remaining, {formatMoney(remainingTotal)}
            </button>
          ) : (
            <>
              <p className="text-xs text-[#E4E6EB]">
                Pay {remaining.length} Finisher{remaining.length === 1 ? '' : 's'} A Total Of {formatMoney(remainingTotal)} In Cash?
                Each One Gets Its Own Cash Out Row. Pay Anyone Being Paid Another Way Individually First.
              </p>
              {progress && (
                <p className="text-[11px] text-[#1877F2]">
                  Paying {progress.player_name} ({progress.index + 1} Of {progress.total})
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmPayAll(false)}
                  disabled={busy}
                  className="flex-1 h-12 rounded-xl bg-[#3A3B3C] text-[#E4E6EB] text-sm font-bold active:bg-[#4A4B4C] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={runPayAll}
                  disabled={busy}
                  className="flex-1 h-12 rounded-xl bg-[#31A24C] text-white text-sm font-bold flex items-center justify-center gap-2 active:opacity-90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Yes, Pay All
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {summary.unpaidCount === 0 && summary.paidCount > 0 && (
        <div className="px-4 py-3 border-t border-[#3A3B3C] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#31A24C] flex-shrink-0" />
          <p className="text-xs text-[#31A24C] font-medium">
            Every Finisher Has Been Paid. The Drawer Reconciliation Will Balance On Payouts.
          </p>
        </div>
      )}

      {paySheetRow && (
        <PayoutPaySheet
          tournamentId={tournamentId}
          row={paySheetRow}
          setToast={setToast}
          onClose={() => setPaySheetRow(null)}
          onDone={async () => { if (onRefresh) await onRefresh(); }}
        />
      )}
    </div>
  );
}
