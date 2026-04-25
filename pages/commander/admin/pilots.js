/**
 * Pilot Venue Management Page
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.6
 *
 * Track and validate pilot venue deployments
 * Target: 5 pilot venues (2 TX, 1 CA, 1 NV, 1 FL)
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ChevronLeft, Building2, CheckCircle, XCircle, AlertTriangle, RefreshCw, Plus, MapPin, Calendar, Target, Award } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { getToken } from '../../../src/lib/commander/clientAuth';
import { busEmit } from '../../../src/engine/EventBus';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

// Success criteria from IMPLEMENTATION_PHASES.md Step 6.6
const SUCCESS_CRITERIA = {
  uptime: { target: 95, label: 'Uptime', unit: '%' },
  tickets: { target: 5, label: 'Support Tickets/Week', unit: '', comparison: 'less' },
  staffSatisfaction: { target: 4.0, label: 'Staff Satisfaction', unit: '/5' },
  playerAdoption: { target: 50, label: 'Player Adoption', unit: '%' } };

// Target pilot regions
const TARGET_REGIONS = [
  { id: 'tx-1', region: 'Texas', target: 2, description: 'Texas Card Rooms' },
  { id: 'ca-1', region: 'California', target: 1, description: 'California Card Room' },
  { id: 'nv-1', region: 'Nevada', target: 1, description: 'Las Vegas Room' },
  { id: 'fl-1', region: 'Florida', target: 1, description: 'Florida Room' },
];

export default function PilotVenuesPage() {
  useEffect(() => { busEmit.sessionStart('commander-admin-pilots'); }, []);
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    if (!token) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, []);
  const [pilots, setPilots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedPilot, setSelectedPilot] = useState(null);

  useEffect(() => {
    fetchPilots();
  }, []);

  async function fetchPilots(signal) {
    setLoading(true);
    try {
      const data = await commanderFetchJSON('/api/commander/admin/pilots', {
        
      });
      if (data.success) {
        setPilots(data.pilots || []);
      }
    } catch (err) {
      console.warn('Failed to fetch pilots:', err);
      setPilots([]);
    } finally {
      setLoading(false);
    }
  }

  const activePilots = pilots.filter((p) => p.status === 'active');
  const pilotsByRegion = {
    TX: pilots.filter((p) => p.state === 'TX').length,
    CA: pilots.filter((p) => p.state === 'CA').length,
    NV: pilots.filter((p) => p.state === 'NV').length,
    FL: pilots.filter((p) => p.state === 'FL').length };

  // Calculate overall metrics
  const avgUptime =
    activePilots.length > 0
      ? activePilots.reduce((sum, p) => sum + (p.uptime_percentage || 0), 0) / activePilots.length
      : 0;
  const avgTickets =
    activePilots.length > 0
      ? activePilots.reduce((sum, p) => sum + (p.support_tickets_count || 0), 0) /
      activePilots.length
      : 0;
  const avgSatisfaction =
    activePilots.length > 0
      ? activePilots.reduce((sum, p) => sum + (p.staff_satisfaction_score || 0), 0) /
      activePilots.length
      : 0;
  const avgAdoption =
    activePilots.length > 0
      ? activePilots.reduce((sum, p) => sum + (p.player_adoption_percentage || 0), 0) /
      activePilots.length
      : 0;

  function getMetricStatus(metric, value) {
    const criteria = SUCCESS_CRITERIA[metric];
    if (!criteria) return 'unknown';
    if (criteria.comparison === 'less') {
      return value <= criteria.target ? 'pass' : 'fail';
    }
    return value >= criteria.target ? 'pass' : 'fail';
  }

  return (
    <>
      <SEOHead
        title="Commander — Pilots"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />

      <div className="cmd-page min-h-screen">
        {/* Header */}
        <header className="cmd-header-bar sticky top-0 z-20">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/commander/admin" className="text-[#B0B3B8] hover:text-white">
                <ChevronLeft className="w-5 h-5" />
              </Link>
              <div>
                <h1 className="text-xl font-bold text-white">Pilot Venues</h1>
                <p className="text-sm text-[#B0B3B8]">Phase 6 - Pilot Expansion</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={fetchPilots}
                className="cmd-btn flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="cmd-btn cmd-btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Add Pilot
              </button>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          {/* Success Criteria Overview */}
          <div className="cmd-panel p-6">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-[#1877F2]" />
              Success Criteria (All Pilots Average)
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Uptime"
                value={avgUptime.toFixed(1)}
                unit="%"
                target={SUCCESS_CRITERIA.uptime.target}
                status={getMetricStatus('uptime', avgUptime)}
              />
              <MetricCard
                label="Tickets/Week"
                value={avgTickets.toFixed(1)}
                unit=""
                target={`< ${SUCCESS_CRITERIA.tickets.target}`}
                status={getMetricStatus('tickets', avgTickets)}
              />
              <MetricCard
                label="Staff Satisfaction"
                value={avgSatisfaction.toFixed(1)}
                unit="/5"
                target={SUCCESS_CRITERIA.staffSatisfaction.target}
                status={getMetricStatus('staffSatisfaction', avgSatisfaction)}
              />
              <MetricCard
                label="Player Adoption"
                value={avgAdoption.toFixed(0)}
                unit="%"
                target={SUCCESS_CRITERIA.playerAdoption.target}
                status={getMetricStatus('playerAdoption', avgAdoption)}
              />
            </div>
          </div>

          {/* Regional Progress */}
          <div className="cmd-panel p-6">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-[#1877F2]" />
              Regional Deployment Progress
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {TARGET_REGIONS.map((region) => {
                const current = pilotsByRegion[region.region.substring(0, 2).toUpperCase()] || 0;
                const progress = (current / region.target) * 100;
                return (
                  <CommanderLayout title="Pilot Venues" backHref="/commander/dashboard?card=reports">
                    <div key={region.id} className="bg-[#1E293B] rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-white font-medium">{region.region}</span>
                        <span className="text-sm text-[#B0B3B8]">
                          {current}/{region.target}
                        </span>
                      </div>
                      <div className="h-2 bg-[#374151] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${progress >= 100 ? 'bg-green-500' : 'bg-[#1877F2]'
                            }`}
                          style={{ width: `${Math.min(progress, 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-[#B0B3B8] mt-2">{region.description}</p>
                    </div>
                  </CommanderLayout>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-[#374151]">
              <div className="flex items-center justify-between">
                <span className="text-[#B0B3B8]">Total Progress</span>
                <span className="text-white font-medium">
                  {activePilots.length}/5 venues
                </span>
              </div>
              <div className="h-3 bg-[#374151] rounded-full overflow-hidden mt-2">
                <div
                  className={`h-full rounded-full transition-all ${activePilots.length >= 5 ? 'bg-green-500' : 'bg-[#1877F2]'
                    }`}
                  style={{ width: `${(activePilots.length / 5) * 100}%` }}
                />
              </div>
            </div>
          </div>

          {/* Pilot Venues List */}
          <div className="cmd-panel overflow-hidden">
            <div className="px-6 py-4 border-b border-[#374151]">
              <h2 className="font-semibold text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-[#1877F2]" />
                Active Pilot Venues
              </h2>
            </div>
            {loading ? (
              <div className="p-8 text-center text-[#B0B3B8]">Loading Pilots...</div>
            ) : pilots.length === 0 ? (
              <div className="p-8 text-center">
                <Building2 className="w-12 h-12 text-[#3A3B3C] mx-auto mb-4" />
                <p className="text-[#B0B3B8]">No Pilot Venues Yet</p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="cmd-btn cmd-btn-primary mt-4"
                >
                  Add First Pilot
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[#374151]">
                {pilots.map((pilot) => (
                  <div
                    key={pilot.id}
                    className="p-4 hover:bg-[#1E293B]/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedPilot(pilot)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-[#374151] rounded-lg flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-[#B0B3B8]" />
                        </div>
                        <div>
                          <h3 className="font-medium text-white">{pilot.venue_name}</h3>
                          <p className="text-sm text-[#B0B3B8] flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {pilot.city}, {pilot.state}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${pilot.status === 'active'
                            ? 'bg-green-500/20 text-green-400'
                            : pilot.status === 'completed'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-gray-500/20 text-gray-400'
                            }`}
                        >
                          {pilot.status}
                        </span>
                      </div>
                    </div>

                    {/* Metrics Row */}
                    <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-[#374151]">
                      <div>
                        <div className="text-xs text-[#B0B3B8] mb-1">Uptime</div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">
                            {pilot.uptime_percentage?.toFixed(1) || '-'}%
                          </span>
                          {pilot.uptime_percentage >= 95 ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400" />
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#B0B3B8] mb-1">Tickets</div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">
                            {pilot.support_tickets_count || 0}
                          </span>
                          {(pilot.support_tickets_count || 0) <= 5 ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400" />
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#B0B3B8] mb-1">Satisfaction</div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">
                            {pilot.staff_satisfaction_score?.toFixed(1) || '-'}/5
                          </span>
                          {(pilot.staff_satisfaction_score || 0) >= 4 ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400" />
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-[#B0B3B8] mb-1">Adoption</div>
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium">
                            {pilot.player_adoption_percentage?.toFixed(0) || '-'}%
                          </span>
                          {(pilot.player_adoption_percentage || 0) >= 50 ? (
                            <CheckCircle className="w-4 h-4 text-green-400" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 text-yellow-400" />
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Start Date */}
                    <div className="flex items-center gap-2 mt-3 text-sm text-[#B0B3B8]">
                      <Calendar className="w-4 h-4" />
                      Started {new Date(pilot.pilot_start_date).toLocaleDateString()}
                      <span className="text-[#3A3B3C]">|</span>
                      Week {Math.ceil((Date.now() - new Date(pilot.pilot_start_date).getTime()) / (7 * 24 * 60 * 60 * 1000))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Phase 6 Completion Checklist */}
          <div className="cmd-panel p-6">
            <h2 className="font-semibold text-white mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-[#1877F2]" />
              Phase 6 Completion Checklist
            </h2>
            <div className="space-y-3">
              <ChecklistItem
                checked={true}
                label="Load Tests Pass"
                description="K6 Tests Complete With Passing Thresholds"
              />
              <ChecklistItem
                checked={true}
                label="Security Audit Complete"
                description="All Security Checks Passing (90%+ Score)"
              />
              <ChecklistItem
                checked={true}
                label="Error Monitoring Active"
                description="Sentry Integration Configured"
              />
              <ChecklistItem
                checked={true}
                label="Documentation Complete"
                description="Staff Guide, Manager Guide, FAQ, Troubleshooting"
              />
              <ChecklistItem
                checked={true}
                label="Onboarding Flow Tested"
                description="Lead Capture And Pipeline Management Working"
              />
              <ChecklistItem
                checked={activePilots.length >= 5}
                label="5 Pilot Venues Live"
                description={`${activePilots.length}/5 venues currently active`}
              />
              <ChecklistItem
                checked={avgUptime >= 95 && avgTickets <= 5 && avgSatisfaction >= 4 && avgAdoption >= 50}
                label="Success Metrics Met"
                description="95% Uptime, <5 Tickets/week, 4+/5 Satisfaction, 50%+ Adoption"
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function MetricCard({ label, value, unit, target, status }) {
  return (
    <div className="bg-[#1E293B] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-[#B0B3B8]">{label}</span>
        {status === 'pass' ? (
          <CheckCircle className="w-5 h-5 text-green-400" />
        ) : status === 'fail' ? (
          <XCircle className="w-5 h-5 text-red-400" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
        )}
      </div>
      <div className="text-2xl font-bold text-white">
        {value}
        <span className="text-sm font-normal text-[#B0B3B8]">{unit}</span>
      </div>
      <div className="text-xs text-[#B0B3B8] mt-1">Target: {target}{unit}</div>
    </div>
  );
}

function ChecklistItem({ checked, label, description }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${checked ? 'bg-green-500/20' : 'bg-[#374151]'
          }`}
      >
        {checked ? (
          <CheckCircle className="w-4 h-4 text-green-400" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-[#B0B3B8]" />
        )}
      </div>
      <div>
        <div className={`font-medium ${checked ? 'text-white' : 'text-[#B0B3B8]'}`}>{label}</div>
        <div className="text-sm text-[#B0B3B8]">{description}</div>
      </div>
    </div>
  );
}

