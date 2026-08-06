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
// 2026-07-25 audit fix: commanderFetch needed for the Add Pilot POST
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

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

// 2026-07-25 audit fix: minimal Add Pilot modal — the button set showAddModal
// but no modal existed.
function AddPilotModal({ isOpen, onClose, onAdded }) {
  const [venues, setVenues] = useState([]);
  const [venueId, setVenueId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await commanderFetchJSON('/api/commander/admin/venues', {});
        if (!cancelled && data.success) setVenues(data.data?.venues || []);
      } catch (err) {
        console.warn('Load venues failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!venueId) { setError('Select a venue'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await commanderFetch('/api/commander/admin/pilots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, notes: notes.trim() || undefined })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setVenueId('');
        setNotes('');
        onAdded?.();
        onClose();
      } else {
        setError(data?.error?.message || data?.error || `Failed to add pilot (${res.status})`);
      }
    } catch (err) {
      console.warn('Add pilot failed:', err);
      setError('Failed to add pilot. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="cmd-panel w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-[#374151]">
          <h3 className="text-lg font-semibold text-white">Add Pilot Venue</h3>
          <button onClick={onClose} className="text-[#B0B3B8] hover:text-white">
            <XCircle className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}
          <div>
            <label className="block text-sm text-[#B0B3B8] mb-2">Venue</label>
            {venues.length > 0 ? (
              <select
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                className="cmd-input w-full"
              >
                <option value="">Select a venue...</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}{v.city ? ` (${v.city}, ${v.state})` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={venueId}
                onChange={(e) => setVenueId(e.target.value)}
                placeholder="Venue ID"
                className="cmd-input w-full"
              />
            )}
          </div>
          <div>
            <label className="block text-sm text-[#B0B3B8] mb-2">Notes (Optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Deployment notes..."
              className="cmd-input w-full"
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="cmd-btn flex-1">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !venueId}
              className="cmd-btn cmd-btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Add Pilot
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

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
                // 2026-07-25 audit fix: removed the per-card CommanderLayout
                // wrapper — a full layout inside the grid is invalid
                return (
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
              {/* 2026-08-06 fix: these items were hardcoded checked={true} with
                  no backing data. commander_pilot_venues does not track them, so
                  show them as pending rather than a fake check. */}
              <ChecklistItem
                pending
                label="Load Tests Pass"
                description="K6 Tests Complete With Passing Thresholds"
              />
              <ChecklistItem
                pending
                label="Security Audit Complete"
                description="All Security Checks Passing (90%+ Score)"
              />
              <ChecklistItem
                pending
                label="Error Monitoring Active"
                description="Sentry Integration Configured"
              />
              <ChecklistItem
                pending
                label="Documentation Complete"
                description="Staff Guide, Manager Guide, FAQ, Troubleshooting"
              />
              <ChecklistItem
                pending
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

        {/* 2026-07-25 audit fix: render the Add Pilot modal */}
        <AddPilotModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdded={() => fetchPilots()}
        />

        {/* 2026-08-06 fix: clicking a pilot set selectedPilot but nothing
            rendered it — the detail click was dead. Show the real metrics. */}
        <PilotDetailModal
          pilot={selectedPilot}
          onClose={() => setSelectedPilot(null)}
        />
      </div>
    </>
  );
}

function PilotDetailModal({ pilot, onClose }) {
  if (!pilot) return null;

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
  const fmtNum = (v, suffix, digits) =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v))
      ? 'pending'
      : `${Number(v).toFixed(digits)}${suffix}`;
  const weeklyReports = Array.isArray(pilot.weekly_reports) ? pilot.weekly_reports.length : 0;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="cmd-panel w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[#374151]">
          <div>
            <h3 className="text-lg font-semibold text-white">{pilot.venue_name}</h3>
            <p className="text-sm text-[#B0B3B8] flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {pilot.city}{pilot.city && pilot.state ? ', ' : ''}{pilot.state}
            </p>
          </div>
          <button onClick={onClose} className="text-[#B0B3B8] hover:text-white">
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${pilot.status === 'active'
                ? 'bg-green-500/20 text-green-400'
                : pilot.status === 'completed'
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'bg-gray-500/20 text-gray-400'
                }`}
            >
              {pilot.status || 'unknown'}
            </span>
            {pilot.converted_to_paid && (
              <span className="px-2 py-1 rounded text-xs font-medium bg-green-500/20 text-green-400">
                Converted To Paid
              </span>
            )}
          </div>

          {/* Real metrics from commander_pilot_venues */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#1E293B] rounded-lg p-3">
              <div className="text-xs text-[#B0B3B8] mb-1">Uptime</div>
              <div className="text-white font-medium">
                {pilot.uptime_percentage ? fmtNum(pilot.uptime_percentage, '%', 1) : 'pending'}
              </div>
            </div>
            <div className="bg-[#1E293B] rounded-lg p-3">
              <div className="text-xs text-[#B0B3B8] mb-1">Support Tickets</div>
              <div className="text-white font-medium">
                {pilot.support_tickets_count === null || pilot.support_tickets_count === undefined
                  ? 'pending'
                  : pilot.support_tickets_count}
              </div>
            </div>
            <div className="bg-[#1E293B] rounded-lg p-3">
              <div className="text-xs text-[#B0B3B8] mb-1">Staff Satisfaction</div>
              <div className="text-white font-medium">
                {pilot.staff_satisfaction_score ? fmtNum(pilot.staff_satisfaction_score, '/5', 1) : 'pending'}
              </div>
            </div>
            <div className="bg-[#1E293B] rounded-lg p-3">
              <div className="text-xs text-[#B0B3B8] mb-1">Player Adoption</div>
              <div className="text-white font-medium">
                {pilot.player_adoption_percentage ? fmtNum(pilot.player_adoption_percentage, '%', 0) : 'pending'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-[#B0B3B8] mb-1">Pilot Start</div>
              <div className="text-white text-sm">{fmtDate(pilot.pilot_start_date)}</div>
            </div>
            <div>
              <div className="text-xs text-[#B0B3B8] mb-1">Pilot End</div>
              <div className="text-white text-sm">{fmtDate(pilot.pilot_end_date)}</div>
            </div>
            <div>
              <div className="text-xs text-[#B0B3B8] mb-1">Weekly Reports</div>
              <div className="text-white text-sm">{weeklyReports}</div>
            </div>
            <div>
              <div className="text-xs text-[#B0B3B8] mb-1">Conversion Date</div>
              <div className="text-white text-sm">{fmtDate(pilot.conversion_date)}</div>
            </div>
          </div>

          <div>
            <div className="text-xs text-[#B0B3B8] mb-1">Final Assessment</div>
            <div className="text-white text-sm bg-[#1E293B] rounded-lg p-3 whitespace-pre-wrap">
              {pilot.final_assessment || 'pending'}
            </div>
          </div>
        </div>
      </div>
    </div>
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

function ChecklistItem({ checked, pending, label, description }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${checked ? 'bg-green-500/20' : 'bg-[#374151]'
          }`}
      >
        {checked ? (
          <CheckCircle className="w-4 h-4 text-green-400" />
        ) : pending ? (
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-[#B0B3B8]" />
        )}
      </div>
      <div>
        <div className={`font-medium ${checked ? 'text-white' : 'text-[#B0B3B8]'}`}>{label}</div>
        <div className="text-sm text-[#B0B3B8]">{description}</div>
        {!checked && pending && (
          <div className="text-xs text-yellow-400 mt-0.5">Pending — not tracked in pilot data</div>
        )}
      </div>
    </div>
  );
}

