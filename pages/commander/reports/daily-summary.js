/**
 * Daily Summary / Shift Report
 * /commander/reports/daily-summary
 * Revenue breakdown, cashier shift totals, time/membership sales, cash vs card
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { BarChart3, Users, DollarSign, Clock, TrendingUp, Loader2, Printer, CreditCard, Banknote, AlertTriangle } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../src/lib/commander/commanderFetch';

export default function DailySummaryReport() {
  useEffect(() => { busEmit.sessionStart('commander-reports-daily-summary'); }, []);
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [cashierData, setCashierData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
const venueId = getVenueId();
const headers = { };

        // General summary — commanderFetch attaches the Authorization and
        // x-staff-session headers these APIs require (bare fetch 401'd)
        const [summaryRes, cashierRes] = await Promise.all([
          commanderFetch(`/api/commander/reports/summary?range=today&date=${date}`, { headers }).catch(() => ({ ok: false })),
          commanderFetch(`/api/commander/cashier?venue_id=${venueId}&date=${date}&limit=100`, { headers }).catch(() => ({ ok: false })),
        ]);

        if (!summaryRes.ok) throw new Error(`Request failed (${summaryRes.status})`);
        const summaryJson = await summaryRes.json();
        if (summaryJson.success) setData(summaryJson.data);

        if (!cashierRes.ok) throw new Error(`Request failed (${cashierRes.status})`);
        const cashierJson = await cashierRes.json();
        if (cashierJson.success) {
          const txns = cashierJson.data || [];

          // Parse cashier breakdown
          const timeTxns = txns.filter(t => (t.notes || '').includes('Time Purchase'));
          const memberTxns = txns.filter(t => (t.notes || '').includes('Membership'));
          const buyInTxns = txns.filter(t => !t.notes?.includes('Time') && !t.notes?.includes('Membership') && !t.notes?.includes('VOID') && !t.notes?.includes('REFUND') && t.type === 'buy_in');
          const voidTxns = txns.filter(t => (t.notes || '').includes('VOID') || (t.notes || '').includes('REFUND'));

          const sumAmount = (arr) => arr.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
          const cashCount = (arr) => arr.filter(t => t.payment_method === 'cash').length;
          const cardCount = (arr) => arr.filter(t => t.payment_method === 'card').length;

          setCashierData({
            transactions: txns,
            totalRevenue: sumAmount(txns.filter(t => t.type === 'buy_in' || t.type === 'add_on')),
            totalRefunds: sumAmount(voidTxns),
            netRevenue: sumAmount(txns.filter(t => t.type === 'buy_in' || t.type === 'add_on')) - sumAmount(voidTxns),
            time: { count: timeTxns.length, total: sumAmount(timeTxns), cash: cashCount(timeTxns), card: cardCount(timeTxns) },
            membership: { count: memberTxns.length, total: sumAmount(memberTxns), cash: cashCount(memberTxns), card: cardCount(memberTxns) },
            buyIn: { count: buyInTxns.length, total: sumAmount(buyInTxns), cash: cashCount(buyInTxns), card: cardCount(buyInTxns) },
            voids: { count: voidTxns.length, total: sumAmount(voidTxns) },
            cashTotal: sumAmount(txns.filter(t => t.payment_method === 'cash' && (t.type === 'buy_in' || t.type === 'add_on'))),
            cardTotal: sumAmount(txns.filter(t => t.payment_method === 'card' && (t.type === 'buy_in' || t.type === 'add_on'))) });
        }
      } catch (err) { console.warn(err); }
      finally { setLoading(false); }
    };
    fetchAll();
  }, [date]);

  const printReport = () => {
    const printW = window.open('', '_blank', 'width=600,height=800');
    if (!printW || !cashierData) return;
    const html = `<!DOCTYPE html><html><head><title>Shift Report - ${date}</title>
<style>body{font-family:sans-serif;padding:20px;max-width:500px;margin:0 auto}
h1{font-size:18px;border-bottom:2px solid #000;padding-bottom:8px}
h2{font-size:14px;margin-top:16px;color:#333}
table{width:100%;border-collapse:collapse;margin:8px 0}
td{padding:4px 8px;border-bottom:1px solid #eee;font-size:12px}
td:last-child{text-align:right;font-weight:bold}
.total{border-top:2px solid #000;font-weight:bold;font-size:13px}
.void{color:#e00}
@media print{body{padding:0}}</style></head><body>
<h1>Shift Report — ${new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h1>
<h2>Revenue Summary</h2>
<table>
<tr><td>Gross Revenue</td><td>$${cashierData.totalRevenue.toLocaleString()}</td></tr>
<tr class="void"><td>Voids/Refunds (${cashierData.voids.count})</td><td>-$${cashierData.totalRefunds.toLocaleString()}</td></tr>
<tr class="total"><td>Net Revenue</td><td>$${cashierData.netRevenue.toLocaleString()}</td></tr>
</table>
<h2>Payment Breakdown</h2>
<table>
<tr><td>💵 Cash Collected</td><td>$${cashierData.cashTotal.toLocaleString()}</td></tr>
<tr><td>💳 Card Collected</td><td>$${cashierData.cardTotal.toLocaleString()}</td></tr>
</table>
<h2>Category Breakdown</h2>
<table>
<tr><td>⏱️ Time Sales (${cashierData.time.count})</td><td>$${cashierData.time.total.toLocaleString()}</td></tr>
<tr><td>🎫 Membership Sales (${cashierData.membership.count})</td><td>$${cashierData.membership.total.toLocaleString()}</td></tr>
<tr><td>🎲 Buy-In Receipts (${cashierData.buyIn.count})</td><td>$${cashierData.buyIn.total.toLocaleString()}</td></tr>
</table>
<h2>Transactions (${cashierData.transactions.length} total)</h2>
<table>${cashierData.transactions.slice(0, 50).map(tx => `<tr${(tx.notes || '').includes('VOID') || (tx.notes || '').includes('REFUND') ? ' class="void"' : ''}><td>${tx.player_name} — ${tx.notes || 'Buy-In'}</td><td>$${parseFloat(tx.amount).toLocaleString()}</td></tr>`).join('')}</table>
<p style="text-align:center;margin-top:20px;font-size:10px;color:#999">Printed ${new Date().toLocaleString()}</p>
</body></html>`;
    printW.document.write(html);
    printW.document.close();
    printW.onload = () => { printW.print(); };
  };

  return (
    <CommanderLayout title="Daily Summary" backHref="/commander/dashboard?card=reports">
      <SEOHead title="Commander — Daily Summary" description="Shift and daily summary report with cashier breakdown." noindex={true} />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <h1 className="text-lg font-bold text-white">Shift / Daily Summary</h1>
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-[#3A3B3C] border border-[#4A4B4C] rounded-lg px-3 py-2 text-sm text-[#E4E6EB]" />
          {cashierData && (
            <button onClick={printReport}
              className="bg-[#1877F2] text-white px-3 py-2 rounded-lg text-sm font-bold flex items-center gap-1.5">
              <Printer className="w-4 h-4" /> Print
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
        ) : (
          <div className="p-4 space-y-4">
            {/* Top Stats */}
            <div className="grid grid-cols-2 gap-3">
              <StatCard icon={DollarSign} label="Net Revenue" value={`$${(cashierData?.netRevenue || 0).toLocaleString()}`} color="#31A24C" />
              <StatCard icon={BarChart3} label="Transactions" value={cashierData?.transactions?.length || 0} color="#1877F2" />
              <StatCard icon={Users} label="Total Players" value={data?.total_players || 0} color="#F59E0B" />
              <StatCard icon={TrendingUp} label="Tournaments" value={data?.tournaments_run || 0} color="#8B5CF6" />
            </div>

            {/* Payment Breakdown */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
              <h3 className="text-sm font-semibold text-[#B0B3B8] uppercase mb-3">Payment Breakdown</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#31A24C]/10 border border-[#31A24C]/20 rounded-lg p-3 text-center">
                  <Banknote className="w-5 h-5 mx-auto mb-1 text-[#31A24C]" />
                  <p className="text-xl font-black text-[#31A24C]">${(cashierData?.cashTotal || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-[#B0B3B8] uppercase font-semibold">Cash</p>
                </div>
                <div className="bg-[#1877F2]/10 border border-[#1877F2]/20 rounded-lg p-3 text-center">
                  <CreditCard className="w-5 h-5 mx-auto mb-1 text-[#1877F2]" />
                  <p className="text-xl font-black text-[#1877F2]">${(cashierData?.cardTotal || 0).toLocaleString()}</p>
                  <p className="text-[10px] text-[#B0B3B8] uppercase font-semibold">Card</p>
                </div>
              </div>
            </div>

            {/* Category Breakdown */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
              <h3 className="text-sm font-semibold text-[#B0B3B8] uppercase mb-3">Category Breakdown</h3>
              <div className="space-y-2">
                <CategoryRow icon={Clock} label="Time Sales" amount={cashierData?.time?.total || 0} count={cashierData?.time?.count || 0}
                  cash={cashierData?.time?.cash || 0} card={cashierData?.time?.card || 0} color="#F59E0B" />
                <CategoryRow icon={CreditCard} label="Memberships" amount={cashierData?.membership?.total || 0} count={cashierData?.membership?.count || 0}
                  cash={cashierData?.membership?.cash || 0} card={cashierData?.membership?.card || 0} color="#8B5CF6" />
                <CategoryRow icon={DollarSign} label="Buy-Ins" amount={cashierData?.buyIn?.total || 0} count={cashierData?.buyIn?.count || 0}
                  cash={cashierData?.buyIn?.cash || 0} card={cashierData?.buyIn?.card || 0} color="#31A24C" />
                {(cashierData?.voids?.count || 0) > 0 && (
                  <CategoryRow icon={AlertTriangle} label="Voids/Refunds" amount={cashierData?.voids?.total || 0} count={cashierData?.voids?.count || 0}
                    cash={0} card={0} color="#EF4444" isNegative />
                )}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
              <h3 className="text-sm font-semibold text-[#B0B3B8] uppercase mb-3">Transactions</h3>
              {(cashierData?.transactions?.length || 0) > 0 ? (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {cashierData.transactions.map(tx => {
                    const isVoidTx = (tx.notes || '').includes('VOID') || (tx.notes || '').includes('REFUND');
                    return (
                      <div key={tx.id} className="flex items-center justify-between py-1.5 border-b border-[#3A3B3C] last:border-0">
                        <div>
                          <p className="text-xs font-medium text-white">{tx.player_name}</p>
                          <p className="text-[10px] text-[#B0B3B8]">{tx.notes || 'Buy-In'} • {tx.payment_method} • {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <span className={`text-sm font-bold ${isVoidTx ? 'text-[#EF4444]' : 'text-[#31A24C]'}`}>
                          {isVoidTx ? '-' : ''}${parseFloat(tx.amount).toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-[#B0B3B8] text-center py-4">No transactions for this date</p>
              )}
            </div>
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  return (
    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 text-center">
      <Icon className="w-5 h-5 mx-auto mb-2" style={{ color }} />
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-[#B0B3B8] uppercase mt-1">{label}</p>
    </div>
  );
}

function CategoryRow({ icon: Icon, label, amount, count, cash, card, color, isNegative }) {
  return (
    <div className="bg-[#18191A] rounded-lg p-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color }} />
        <div>
          <p className="text-xs font-semibold text-white">{label}</p>
          {cash + card > 0 && <p className="text-[9px] text-[#B0B3B8]">{cash} cash / {card} card</p>}
        </div>
      </div>
      <div className="text-right">
        <p className={`text-sm font-bold ${isNegative ? 'text-[#EF4444]' : ''}`} style={!isNegative ? { color } : {}}>
          {isNegative ? '-' : ''}${amount.toLocaleString()}
        </p>
        <p className="text-[9px] text-[#B0B3B8]">{count} transactions</p>
      </div>
    </div>
  );
}
