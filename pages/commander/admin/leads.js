/**
 * Admin Lead Management Page
 * Reference: IMPLEMENTATION_PHASES.md - Phase 6, Step 6.5
 *
 * Manage venue onboarding pipeline
 */
import { useState, useEffect } from 'react';
import SEOHead from '../../../src/components/seo/SEOHead';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useDebounce from '../../../src/hooks/useDebounce';
import { ChevronLeft, Phone, Mail, MapPin, Search, ChevronDown, XCircle, Building2, MoreVertical } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { getToken, getStaffSession } from '../../../src/lib/commander/clientAuth';
import { busEmit } from '../../../src/engine/EventBus';
import { broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

const STATUS_CONFIG = {
  new: { label: 'New', color: 'bg-blue-500', textColor: 'text-blue-400' },
  contacted: { label: 'Contacted', color: 'bg-purple-500', textColor: 'text-purple-400' },
  demo_scheduled: { label: 'Demo Scheduled', color: 'bg-yellow-500', textColor: 'text-yellow-400' },
  demo_completed: { label: 'Demo Completed', color: 'bg-orange-500', textColor: 'text-orange-400' },
  negotiating: { label: 'Negotiating', color: 'bg-pink-500', textColor: 'text-pink-400' },
  signed: { label: 'Signed', color: 'bg-cyan-500', textColor: 'text-cyan-400' },
  setup: { label: 'In Setup', color: 'bg-teal-500', textColor: 'text-teal-400' },
  live: { label: 'Live', color: 'bg-green-500', textColor: 'text-green-400' },
  declined: { label: 'Declined', color: 'bg-red-500', textColor: 'text-red-400' },
  lost: { label: 'Lost', color: 'bg-gray-500', textColor: 'text-gray-400' } };

export default function LeadManagementPage() {
  useEffect(() => { busEmit.sessionStart('commander-admin-leads'); }, []);
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    if (!token) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, []);
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLead, setSelectedLead] = useState(null);
  const [showStatusMenu, setShowStatusMenu] = useState(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    fetchLeads();
  }, [statusFilter]);

  async function fetchLeads(signal) {
    setLoading(true);
    try {
      const token = getToken();
const data = await commanderFetchJSON(`/api/commander/admin/leads?status=${statusFilter}`, {});
      if (data.success) {
        // 2026-07-25 audit fix: the API nests under data ({ data: { leads } });
        // stats are computed client-side from the leads array.
        const fetchedLeads = data.data?.leads || [];
        setLeads(fetchedLeads);
        const computedStats = {};
        for (const lead of fetchedLeads) {
          const s = lead.status || 'new';
          computedStats[s] = (computedStats[s] || 0) + 1;
        }
        setStats(computedStats);
      } else {
        setError(data.error?.message || data.error || 'Failed To Load Leads');
      }
    } catch (err) {
      setError('Failed To Load Leads');
    } finally {
      setLoading(false);
    }
  }

  async function updateLeadStatus(leadId, newStatus) {
    try {
      // 2026-07-25 audit fix: the API updates the table selected by source
      const lead = (leads || []).find((l) => l.id === leadId);
const res = await commanderFetch('/api/commander/admin/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, status: newStatus, source: lead?.source }) });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.success) {
        setLeads((prev) =>
          prev.map((lead) => (lead.id === leadId ? { ...lead, status: newStatus } : lead))
        );
        setShowStatusMenu(null);
        broadcastChange('leads');
      }
    } catch (err) {
      setLoading(false);
      console.warn('Failed to update status:', err);
      setError('Failed To Update Lead Status. Please Try Again.');
    }
  }

  // 2026-07-25 audit fix: guard against undefined leads/fields - landing-page
  // leads may lack venue_name/contact_name/city.
  const safeLeads = Array.isArray(leads) ? leads : [];
  const filteredLeads = debouncedSearchTerm
    ? safeLeads.filter(
      (lead) =>
        (lead.venue_name || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (lead.contact_name || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (lead.email || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase()) ||
        (lead.city || '').toLowerCase().includes(debouncedSearchTerm.toLowerCase())
    )
    : safeLeads;

  const totalLeads = Object.values(stats || {}).reduce((a, b) => a + b, 0);
  const conversionRate =
    totalLeads > 0
      ? (((stats.signed || 0) + (stats.setup || 0) + (stats.live || 0)) / totalLeads) * 100
      : 0;

  return (
    <>
      <SEOHead
        title="Commander - Leads"
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
              <h1 className="text-xl font-bold text-white">Lead Management</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B0B3B8]" />
                <input
                  type="text"
                  placeholder="Search Leads..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="cmd-input w-full pl-10 h-9 text-sm"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-6">
          {/* Stats Overview */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-white">{totalLeads}</div>
              <div className="text-sm text-[#B0B3B8]">Total Leads</div>
            </div>
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-blue-400">{stats.new || 0}</div>
              <div className="text-sm text-[#B0B3B8]">New</div>
            </div>
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-yellow-400">{stats.demo_scheduled || 0}</div>
              <div className="text-sm text-[#B0B3B8]">Demos Scheduled</div>
            </div>
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-cyan-400">{stats.signed || 0}</div>
              <div className="text-sm text-[#B0B3B8]">Signed</div>
            </div>
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-green-400">{stats.live || 0}</div>
              <div className="text-sm text-[#B0B3B8]">Live</div>
            </div>
            <div className="cmd-panel p-4">
              <div className="text-2xl font-bold text-[#1877F2]">{conversionRate.toFixed(1)}%</div>
              <div className="text-sm text-[#B0B3B8]">Conversion</div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-2 overflow-x-auto pb-4 mb-6 scrollbar-hide">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${statusFilter === 'all'
                ? 'bg-[#1877F2] text-[#0F172A]'
                : 'bg-[#1E293B] text-[#94A3B8] hover:text-white'
                }`}
            >
              All ({totalLeads})
            </button>
            {Object.entries(STATUS_CONFIG || {}).map(([key, config]) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors flex items-center gap-2 ${statusFilter === key
                  ? 'bg-[#1877F2] text-[#0F172A]'
                  : 'bg-[#1E293B] text-[#94A3B8] hover:text-white'
                  }`}
              >
                <span className={`w-2 h-2 rounded-full ${config.color}`} />
                {config.label} ({stats[key] || 0})
              </button>
            ))}
          </div>

          {/* Leads Table */}
          <div className="cmd-panel overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-[#B0B3B8]">Loading Leads...</div>
            ) : error ? (
              <div className="p-8 text-center text-red-400">{error}</div>
            ) : filteredLeads.length === 0 ? (
              <div className="p-8 text-center text-[#B0B3B8]">
                {searchTerm ? `No Leads Matching "${searchTerm}"` : 'No Leads Found'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#1E293B] border-b border-[#374151]">
                    <tr>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Venue
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Contact
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Location
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Tables
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Status
                      </th>
                      <th className="text-left px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Created
                      </th>
                      <th className="text-right px-4 py-3 text-sm font-medium text-[#B0B3B8]">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#374151]">
                    {filteredLeads.map((lead) => {
                      const statusConfig = STATUS_CONFIG[lead.status] || STATUS_CONFIG.new;
                      // 2026-07-25 audit fix: removed the per-row CommanderLayout
                      // wrapper - a full layout inside <tbody> is invalid markup
                      return (
                          <tr
                            key={lead.id}
                            className="hover:bg-[#1E293B]/50 transition-colors cursor-pointer"
                            onClick={() => setSelectedLead(lead)}
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-[#374151] rounded-lg flex items-center justify-center">
                                  <Building2 className="w-5 h-5 text-[#B0B3B8]" />
                                </div>
                                <div>
                                  <div className="font-medium text-white">{lead.venue_name}</div>
                                  <div className="text-sm text-[#B0B3B8]">
                                    {lead.current_system || 'No Current System'}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="text-white">{lead.contact_name}</div>
                              <div className="text-sm text-[#B0B3B8]">{lead.email}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 text-[#94A3B8]">
                                <MapPin className="w-4 h-4" />
                                {lead.city}, {lead.state}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#94A3B8]">{lead.table_count || '-'}</td>
                            <td className="px-4 py-3">
                              <div className="relative">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowStatusMenu(showStatusMenu === lead.id ? null : lead.id);
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${statusConfig.color}/20 ${statusConfig.textColor}`}
                                >
                                  <span className={`w-2 h-2 rounded-full ${statusConfig.color}`} />
                                  {statusConfig.label}
                                  <ChevronDown className="w-3 h-3" />
                                </button>
                                {showStatusMenu === lead.id && (
                                  <div className="absolute top-full left-0 mt-1 w-48 bg-[#1E293B] border border-[#374151] rounded-lg shadow-lg z-10">
                                    {Object.entries(STATUS_CONFIG || {}).map(([key, config]) => (
                                      <button
                                        key={key}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          updateLeadStatus(lead.id, key);
                                        }}
                                        className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-[#374151] ${lead.status === key ? 'bg-[#374151]' : ''
                                          }`}
                                      >
                                        <span className={`w-2 h-2 rounded-full ${config.color}`} />
                                        <span className={config.textColor}>{config.label}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-[#B0B3B8] text-sm">
                              {new Date(lead.created_at).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedLead(lead);
                                }}
                                className="text-[#B0B3B8] hover:text-white"
                              >
                                <MoreVertical className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Lead Detail Modal */}
        {selectedLead && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="cmd-panel w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex items-start justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-white">{selectedLead.venue_name}</h2>
                    <p className="text-[#B0B3B8]">
                      {selectedLead.city}, {selectedLead.state}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedLead(null)}
                    className="text-[#B0B3B8] hover:text-white"
                  >
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4">
                  {/* Contact Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-[#B0B3B8] mb-1">Contact</div>
                      <div className="text-white">{selectedLead.contact_name}</div>
                    </div>
                    <div>
                      <div className="text-sm text-[#B0B3B8] mb-1">Tables</div>
                      <div className="text-white">{selectedLead.table_count || 'Not Specified'}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-sm text-[#B0B3B8] mb-1">Email</div>
                    <a
                      href={`mailto:${selectedLead.email}`}
                      className="text-[#1877F2] hover:underline flex items-center gap-2"
                    >
                      <Mail className="w-4 h-4" />
                      {selectedLead.email}
                    </a>
                  </div>

                  <div>
                    <div className="text-sm text-[#B0B3B8] mb-1">Phone</div>
                    <a
                      href={`tel:${selectedLead.phone}`}
                      className="text-[#1877F2] hover:underline flex items-center gap-2"
                    >
                      <Phone className="w-4 h-4" />
                      {selectedLead.phone}
                    </a>
                  </div>

                  {selectedLead.current_system && (
                    <div>
                      <div className="text-sm text-[#B0B3B8] mb-1">Current System</div>
                      <div className="text-white">{selectedLead.current_system}</div>
                    </div>
                  )}

                  {selectedLead.notes && (
                    <div>
                      <div className="text-sm text-[#B0B3B8] mb-1">Notes</div>
                      <div className="text-[#94A3B8] whitespace-pre-wrap">{selectedLead.notes}</div>
                    </div>
                  )}

                  <div>
                    <div className="text-sm text-[#B0B3B8] mb-1">Created</div>
                    <div className="text-white">
                      {new Date(selectedLead.created_at).toLocaleString()}
                    </div>
                  </div>

                  {/* Status Update */}
                  <div className="border-t border-[#374151] pt-4 mt-4">
                    <div className="text-sm text-[#B0B3B8] mb-2">Update Status</div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(STATUS_CONFIG || {})
                        .slice(0, 6)
                        .map(([key, config]) => (
                          <button
                            key={key}
                            onClick={() => {
                              updateLeadStatus(selectedLead.id, key);
                              setSelectedLead((prev) => ({ ...prev, status: key }));
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${selectedLead.status === key
                              ? `${config.color}/20 border-current ${config.textColor}`
                              : 'border-[#374151] text-[#94A3B8] hover:text-white hover:border-[#B0B3B8]'
                              }`}
                          >
                            <span className={`w-2 h-2 rounded-full ${config.color}`} />
                            <span className="text-sm">{config.label}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-6 pt-4 border-t border-[#374151]">
                  <button
                    onClick={() => setSelectedLead(null)}
                    className="flex-1 cmd-btn"
                  >
                    Close
                  </button>
                  <a
                    href={`mailto:${selectedLead.email}?subject=Club Commander Demo - ${selectedLead.venue_name}`}
                    className="flex-1 cmd-btn cmd-btn-primary flex items-center justify-center gap-2"
                  >
                    <Mail className="w-4 h-4" />
                    Send Email
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
