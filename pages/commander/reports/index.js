/**
 * Reports Suite
 * /commander/reports (enhanced from existing placeholder)
 * Central hub for all reporting: waitlist, players, tournaments, activity, custom
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';

import { BarChart3, Users, Trophy, Clock, DollarSign, FileText, Activity, ChevronRight, TrendingUp } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

const REPORTS = [
  {
    id: 'daily-summary',
    icon: BarChart3,
    title: 'Daily Summary',
    description: 'Revenue, Players, Table Hours, Peak Times',
    color: '#1981EC'
  },
  {
    id: 'tournament-results',
    icon: Trophy,
    title: 'Tournament Results',
    description: 'Entries, Prize Pools, Payouts, Player Stats',
    color: '#31A24C'
  },
  {
    id: 'waitlist-metrics',
    icon: Clock,
    title: 'Waitlist Metrics',
    description: 'Wait Times, Call Rates, No-Show Rates, Demand',
    color: '#22D3EE'
  },
  {
    id: 'player-activity',
    icon: Users,
    title: 'Player Activity',
    description: 'Visit Frequency, Session Duration, Game Preferences',
    color: '#BDD0E2'
  },
  {
    id: 'revenue',
    icon: DollarSign,
    title: 'Revenue Report',
    description: 'Rake, Time Charges, Tournament Fees, Promotions',
    color: '#31A24C'
  },
  {
    id: 'table-utilization',
    icon: TrendingUp,
    title: 'Table Utilization',
    description: 'Occupancy Rates, Game Type Popularity, Peak Hours',
    color: '#1981EC'
  },
  {
    id: 'staff-activity',
    icon: Activity,
    title: 'Staff Activity Log',
    description: 'Actions, Incidents, Session Management',
    color: '#BDD0E2'
  },
  {
    id: 'analytics-daily',
    icon: TrendingUp,
    title: 'Analytics Daily',
    description: 'Aggregated Daily Metrics, Trends, Session And Revenue Charts',
    color: '#3B82F6'
  },
  {
    id: 'tax-compliance',
    icon: FileText,
    title: 'Tax Compliance / W-2G',
    description: 'Tournament Wins Reporting, W-2G Generation, Withholding',
    color: '#EF4444'
  },
];

export default function ReportsPage() {
  useEffect(() => { busEmit.sessionStart('commander-reports-index'); }, []);
  const router = useRouter();
  const [dateRange, setDateRange] = useState('today');
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSummary = async () => {
        const controller = new AbortController();
        const { signal } = controller;
      try {
const json = await commanderFetchJSON(`/api/commander/reports/summary?range=${dateRange}`, {});
        if (json.success) setSummary(json.data);
      } catch (err) { console.warn(err); }
      finally { setLoading(false); }
    };
    fetchSummary();
  }, [dateRange]);

  return (
    <CommanderLayout title="Reports" backHref="/commander/dashboard">
      <SEOHead
              title="Commander - Reports"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <div className="min-h-screen bg-[#040D18] text-[#F2F7FF] font-['Inter']">

        {/* Date Range Filter */}
        <div className="px-4 py-3 flex gap-2">
          {['today', 'week', 'month', 'quarter'].map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-4 py-2 rounded-full text-sm font-medium capitalize ${dateRange === r ? 'bg-[#0C55C0] text-white' : 'bg-[#132A42] text-[#BDD0E2] active:bg-[#1B3753]'
                }`}>
              {r}
            </button>
          ))}
        </div>

        {/* Quick Stats */}
        {summary && (
          <div className="px-4 py-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <QuickStat label="Total Players" value={summary.total_players || 0} icon={Users} />
              <QuickStat label="Table Hours" value={summary.table_hours || 0} icon={Clock} />
              <QuickStat label="Tournaments" value={summary.tournaments_run || 0} icon={Trophy} />
              <QuickStat label="Revenue" value={`$${(summary.revenue || 0).toLocaleString()}`} icon={DollarSign} />
            </div>
          </div>
        )}

        {/* Report Cards */}
        <div className="px-4 py-3 space-y-2">
          {REPORTS.map(report => {
            const Icon = report.icon;
            return (
              <button key={report.id}
                onClick={() => router.push(`/commander/reports/${report.id}`)}
                className="w-full bg-[#0A1829] rounded-xl border border-[#445E77] p-4 flex items-center gap-4 active:bg-[#132A42] text-left">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${report.color}15` }}>
                  <Icon className="w-6 h-6" style={{ color: report.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-base font-semibold text-white">{report.title}</p>
                  <p className="text-xs text-[#BDD0E2]">{report.description}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#BDD0E2]" />
              </button>
            );
          })}
        </div>
      </div>
    </CommanderLayout>
  );
}

function QuickStat({ label, value, icon: Icon }) {
  return (
    <div className="bg-[#0A1829] rounded-xl border border-[#445E77] p-3 text-center">
      <Icon className="w-4 h-4 text-[#BDD0E2] mx-auto mb-1" />
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-[10px] text-[#BDD0E2] uppercase">{label}</p>
    </div>
  );
}
