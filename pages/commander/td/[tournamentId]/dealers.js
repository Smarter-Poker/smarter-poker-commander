/**
 * Tournament Director - Dealer Rotation
 * /commander/td/[tournamentId]/dealers
 *
 * Who is down on each of this tournament's tables, how long they have been
 * there, and who pushes in next. The room-wide screen at
 * /commander/dealer-rotation shows the whole floor including cash; this one is
 * scoped to the event the TD is actually running.
 *
 * Reached from the Control Center (a card, not a seventh bottom-nav item: the
 * nav already carries six and a seventh drops every target under 44px at
 * 375px).
 *
 * UI: Dark theme, SmarterPoker colors, Inter font, 44px+ touch targets.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../../src/engine/EventBus';
import {
  Trophy, Users, DollarSign, LayoutGrid, Monitor, FileText,
  Loader2, RefreshCw, AlertTriangle, Coffee, ArrowRightLeft, UserPlus, Clock, X
} from 'lucide-react';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';

const NAV_ITEMS = [
  { key: 'control', icon: Trophy, label: 'Control', path: '' },
  { key: 'tables', icon: LayoutGrid, label: 'Tables', path: '/tables' },
  { key: 'players', icon: Users, label: 'Players', path: '/players' },
  { key: 'payouts', icon: DollarSign, label: 'Payouts', path: '/payouts' },
  { key: 'reports', icon: FileText, label: 'Reports', path: '/reports' },
  { key: 'clock', icon: Monitor, label: 'Clock', path: '/clock' },
];

export default function TDDealers() {

  useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-dealers'); }, []);
  const router = useRouter();
  const { tournamentId } = router.query;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  // { action, tableNumber, dealerId, message } - shown when the clock is on
  // break and the API refused the push.
  const [breakConfirm, setBreakConfirm] = useState(null);
  // Table number whose "bring a dealer in" picker is open.
  const [assignTable, setAssignTable] = useState(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const fetchDealers = useCallback(async (signal) => {
    if (!tournamentId) return;
    try {
      const res = await commanderFetch(
        `/api/commander/tournaments/${tournamentId}/dealers`,
        { ...(signal ? { signal } : {}) }
      );
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setData(json.data);
        setError(null);
      } else {
        setError(json.error?.message || 'Failed To Load Dealer Rotation');
      }
    } catch (err) {
      if (err.name !== 'AbortError') setError('Failed To Load Dealer Rotation');
    } finally {
      setLoading(false);
    }
  }, [tournamentId]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDealers(controller.signal);
    // Down time is the whole point of this screen, so it refreshes on its own.
    const poll = setInterval(() => fetchDealers(controller.signal), 30000);
    return () => { controller.abort(); clearInterval(poll); };
  }, [fetchDealers]);

  const push = async ({ action, tableNumber, dealerId, force = false }) => {
    setBusy(action === 'push_all' ? 'push_all' : `table-${tableNumber}`);
    try {
      const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/dealers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(tableNumber != null ? { table_number: tableNumber } : {}),
          ...(dealerId ? { dealer_id: dealerId } : {}),
          ...(force ? { force: true } : {})
        })
      });
      const json = await res.json().catch(() => null);

      if (res.status === 409 && json?.error?.code === 'ON_BREAK') {
        setBreakConfirm({ action, tableNumber, dealerId, message: json.error.message });
        return;
      }
      if (!res.ok || !json?.success) {
        setToast({ type: 'error', text: json?.error?.message || 'Push Failed.' });
        return;
      }

      setToast({ type: 'success', text: json.data?.message || 'Rotation Pushed.' });
      setAssignTable(null);
      setBreakConfirm(null);
      await fetchDealers();
      broadcastChange('dealers');
    } catch (err) {
      console.warn('[td/dealers] push failed:', err?.message || err);
      setToast({ type: 'error', text: 'Push Failed. Check Your Connection.' });
    } finally {
      setBusy(null);
    }
  };

  const navigateTo = (path) => {
    const base = `/commander/td/${tournamentId}`;
    router.push(path ? `${base}${path}` : base);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#18191A] flex items-center justify-center p-4">
        <div className="bg-[#242526] rounded-xl p-6 text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-[#F59E0B] mx-auto mb-3" />
          <p className="text-[#E4E6EB] text-lg mb-4">{error || 'Tournament Not Found'}</p>
          <button onClick={() => navigateTo('')}
            className="px-6 py-3 bg-[#1877F2] text-white rounded-lg text-base font-medium">
            Back To Control Center
          </button>
        </div>
      </div>
    );
  }

  const tables = data.tables || [];
  const limit = data.down_time_limit_minutes || 30;
  const manned = tables.filter(t => t.current_dealer).length;
  const overLimit = data.alerts?.over_limit || [];

  return (
    <CommanderLayout title="Commander - Dealer Rotation" backHref={`/commander/td/${tournamentId}`}>
      <SEOHead
        title="Commander - Dealer Rotation"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] pb-24 font-['Inter']">

        {/* ===== HEADER ===== */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Dealer Rotation</h1>
            <p className="text-xs text-[#B0B3B8]">
              {manned.toLocaleString()} Of {tables.length.toLocaleString()} Table{tables.length === 1 ? '' : 's'} Manned, Push Every {limit.toLocaleString()} Minutes
            </p>
          </div>
          <button onClick={() => fetchDealers()} className="p-2 rounded-lg active:bg-[#3A3B3C]" title="Refresh">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* ===== BREAK BANNER ===== */}
        {data.alerts?.on_break && (
          <div className="mx-4 mt-3 rounded-xl border border-[#F59E0B]/40 bg-[#F59E0B]/10 px-3 py-2 flex items-center gap-2">
            <Coffee className="w-4 h-4 text-[#F59E0B] flex-shrink-0" />
            <p className="text-xs text-[#F59E0B] font-medium">
              The Clock Is On Break. Pushing Is Held Back Until You Confirm.
            </p>
          </div>
        )}

        {/* ===== OVER LIMIT ALERT ===== */}
        {overLimit.length > 0 && (
          <div className="mx-4 mt-3 rounded-xl border border-[#EF4444]/40 bg-[#EF4444]/10 p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-[#EF4444]" />
              <p className="text-sm font-semibold text-[#EF4444]">
                {overLimit.length.toLocaleString()} Dealer{overLimit.length === 1 ? '' : 's'} Over {limit.toLocaleString()} Minutes
              </p>
            </div>
            {overLimit.map(o => (
              <p key={`over-${o.table_number}`} className="text-xs text-[#E4E6EB]">
                Table {o.table_number}: {o.dealer_name}, {Number(o.minutes_down || 0).toLocaleString()} Minutes Down
              </p>
            ))}
          </div>
        )}

        {/* ===== PUSH ALL ===== */}
        <div className="px-4 pt-3">
          <button
            onClick={() => push({ action: 'push_all' })}
            disabled={busy === 'push_all' || manned === 0}
            className="w-full min-h-[52px] rounded-xl bg-[#1877F2] text-white text-base font-semibold flex items-center justify-center gap-2 active:bg-[#1565D8] disabled:opacity-50">
            {busy === 'push_all'
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <ArrowRightLeft className="w-5 h-5" />}
            {busy === 'push_all' ? 'Pushing...' : 'Push Every Dealer Up One Table'}
          </button>
          {manned === 0 && (
            <p className="text-xs text-[#B0B3B8] mt-2">
              No Dealers Are Down On This Tournament Yet. Bring One In From A Table Below.
            </p>
          )}
        </div>

        {/* ===== TABLES ===== */}
        <div className="px-4 pt-3 space-y-2">
          {tables.length === 0 && (
            <div className="bg-[#242526] border border-[#3A3B3C] rounded-xl p-4">
              <p className="text-sm text-[#B0B3B8]">
                No Tables Are Assigned To This Tournament. Assign Tables From The Control Center First.
              </p>
            </div>
          )}

          {tables.map(t => {
            const d = t.current_dealer;
            const over = !!d?.over_limit;
            const isBusy = busy === `table-${t.table_number}`;
            return (
              <div key={t.table_id}
                className={`bg-[#242526] rounded-xl border p-3 ${over ? 'border-[#EF4444]/50' : 'border-[#3A3B3C]'}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">
                      Table {t.table_number}
                    </p>
                    {d ? (
                      <>
                        <p className="text-sm text-[#E4E6EB] truncate">{d.dealer_name}</p>
                        <p className={`text-xs font-medium ${over ? 'text-[#EF4444]' : 'text-[#B0B3B8]'}`}>
                          {Number(d.minutes_down || 0).toLocaleString()} Minute{d.minutes_down === 1 ? '' : 's'} Down
                          {over ? ', Push Overdue' : ''}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-[#F59E0B] font-medium">No Dealer Down</p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {t.next_dealer ? (
                      <span className="text-[11px] text-[#B0B3B8] text-right">
                        Next: {t.next_dealer.dealer_name}
                        <br />
                        From Table {t.next_dealer.from_table_number}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#B0B3B8]">Next: Nobody</span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => push({ action: 'push_table', tableNumber: t.table_number })}
                    disabled={isBusy || !t.next_dealer}
                    className="flex-1 min-h-[44px] rounded-lg bg-[#3A3B3C] text-[#E4E6EB] text-sm font-medium flex items-center justify-center gap-2 active:bg-[#4A4B4C] disabled:opacity-40">
                    {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRightLeft className="w-4 h-4" />}
                    Push This Table
                  </button>
                  <button
                    onClick={() => setAssignTable(assignTable === t.table_number ? null : t.table_number)}
                    className="flex-1 min-h-[44px] rounded-lg bg-[#1877F2]/10 border border-[#1877F2]/30 text-[#1877F2] text-sm font-medium flex items-center justify-center gap-2 active:bg-[#1877F2]/20">
                    <UserPlus className="w-4 h-4" />
                    Bring A Dealer In
                  </button>
                </div>

                {assignTable === t.table_number && (
                  <div className="mt-2 border-t border-[#3A3B3C] pt-2 space-y-1 max-h-56 overflow-y-auto">
                    {[...(data.available_dealers || []), ...(data.on_break_dealers || [])].length === 0 ? (
                      <p className="text-xs text-[#B0B3B8]">Every Active Dealer Is Already Down On A Table.</p>
                    ) : (
                      <>
                        {(data.available_dealers || []).map(dealer => (
                          <button key={dealer.id}
                            onClick={() => push({ action: 'push_table', tableNumber: t.table_number, dealerId: dealer.id })}
                            className="w-full min-h-[44px] px-3 rounded-lg bg-[#3A3B3C] text-left text-sm text-[#E4E6EB] flex items-center justify-between active:bg-[#4A4B4C]">
                            <span className="truncate">{dealer.name}</span>
                            <span className="text-[11px] text-[#31A24C] flex-shrink-0">Available</span>
                          </button>
                        ))}
                        {(data.on_break_dealers || []).map(dealer => (
                          <button key={dealer.id}
                            onClick={() => push({ action: 'push_table', tableNumber: t.table_number, dealerId: dealer.id })}
                            className="w-full min-h-[44px] px-3 rounded-lg bg-[#3A3B3C] text-left text-sm text-[#E4E6EB] flex items-center justify-between active:bg-[#4A4B4C]">
                            <span className="truncate">{dealer.name}</span>
                            <span className="text-[11px] text-[#F59E0B] flex-shrink-0">
                              On Break {dealer.minutes_on_break != null ? `${Number(dealer.minutes_on_break).toLocaleString()}m` : ''}
                            </span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ===== BREAK CONFIRM ===== */}
        {breakConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center z-50 p-4">
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 w-full max-w-md">
              <div className="flex items-center gap-2 mb-2">
                <Coffee className="w-5 h-5 text-[#F59E0B]" />
                <p className="text-base font-bold text-white">The Clock Is On Break</p>
              </div>
              <p className="text-sm text-[#B0B3B8] mb-4">{breakConfirm.message}</p>
              <div className="flex gap-2">
                <button onClick={() => setBreakConfirm(null)}
                  className="flex-1 min-h-[44px] rounded-lg bg-[#3A3B3C] text-[#E4E6EB] text-sm font-semibold">
                  Wait
                </button>
                <button
                  onClick={() => push({ ...breakConfirm, force: true })}
                  className="flex-1 min-h-[44px] rounded-lg bg-[#F59E0B] text-[#18191A] text-sm font-semibold">
                  Push Anyway
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ===== TOAST ===== */}
        {toast && (
          <div className="fixed left-4 right-4 bottom-20 z-50">
            <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center gap-2 max-w-lg mx-auto ${toast.type === 'success'
              ? 'bg-[#31A24C] text-white'
              : 'bg-[#EF4444] text-white'}`}>
              <span className="flex-1">{toast.text}</span>
              <button onClick={() => setToast(null)} aria-label="Dismiss" className="p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ===== BOTTOM NAV BAR ===== */}
        <nav className="fixed bottom-0 left-0 right-0 bg-[#242526] border-t border-[#3A3B3C] z-40">
          <div className="flex items-center justify-around h-16 max-w-2xl mx-auto">
            {NAV_ITEMS.map(item => {
              const Icon = item.icon;
              return (
                <button key={item.key} onClick={() => navigateTo(item.path)}
                  className="flex flex-col items-center justify-center gap-0.5 w-16 h-14 rounded-lg text-[#B0B3B8] active:text-[#E4E6EB]">
                  <Icon className="w-5 h-5" />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </CommanderLayout>
  );
}
