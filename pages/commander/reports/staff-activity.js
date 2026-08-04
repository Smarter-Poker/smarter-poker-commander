/**
 * Staff Activity Log
 * /commander/reports/staff-activity
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Activity, Loader2, Shield } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import AuditLogViewer from '../../../src/components/commander/admin/AuditLogViewer';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

export default function StaffActivity() {
  useEffect(() => { busEmit.sessionStart('commander-reports-staff-activity'); }, []);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('incidents');
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activities, setActivities] = useState([]);

  useEffect(() => {
    const fetchActivity = async () => {
      const controller = new AbortController();
      const { signal } = controller;
      try {
const json = await commanderFetchJSON('/api/commander/incidents?status=all&limit=50', {});
        // Incidents API nests under data.incidents — data itself is an object
        if (json.success) setActivities(json.data?.incidents || (Array.isArray(json.data) ? json.data : []));
      } catch (err) { console.warn(err); }
      finally { setLoading(false); }
    };
    fetchActivity();
  }, []);

  const fetchAuditLogs = async (filters = {}) => {
    setAuditLoading(true);
    try {
const params = new URLSearchParams();
      // The audit-logs API requires venue_id and nests its payload under data
      let venueId = null;
      try { venueId = JSON.parse(getStaffSession() || '{}').venue_id; } catch { /* ignore */ }
      if (!venueId) { setAuditLoading(false); return; }
      params.set('venue_id', venueId);
      if (filters.action) params.set('action', filters.action);

      const data = await commanderFetchJSON(`/api/commander/admin/audit-logs?${params}`, {});
      if (data.success && data.data) {
        setAuditLogs(data.data.logs || []);
      }
    } catch (err) {
      console.warn('Audit logs fetch error:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'audit' && auditLogs.length === 0) {
      fetchAuditLogs();
    }
  }, [activeTab]);

  const typeColors = {
    floor_call: '#F59E0B',
    dispute: '#EF4444',
    incident: '#EF4444',
    maintenance: '#B0B3B8',
    general: '#1877F2'
  };

  return (
    <CommanderLayout title="Staff Activity" backHref="/commander/dashboard?card=reports">
      <>
        <SEOHead
          title="Commander — Staff Activity"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />
        <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">
          <div className="bg-[#242526] border-b border-[#3A3B3C]">
            <div className="px-4 py-3 flex items-center justify-between">
              <h1 className="text-lg font-bold text-white">Staff Operations</h1>
            </div>
            <div className="flex px-4 gap-4 pb-0">
              <button
                onClick={() => setActiveTab('incidents')}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'incidents' ? 'border-[#1877F2] text-[#1877F2]' : 'border-transparent text-[#B0B3B8] hover:text-white'
                  }`}
              >
                Incidents & Floor Calls
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'audit' ? 'border-[#1877F2] text-[#1877F2]' : 'border-transparent text-[#B0B3B8] hover:text-white'
                  }`}
              >
                <Shield size={16} /> Audit Trail
              </button>
            </div>
          </div>
          <div className="p-4">
            {activeTab === 'incidents' ? (
              loading ? (
                <div className="py-12 text-center"><Loader2 className="w-6 h-6 text-[#1877F2] animate-spin mx-auto" /></div>
              ) : activities.length === 0 ? (
                <div className="text-center py-16">
                  <Activity className="w-10 h-10 text-[#3A3B3C] mx-auto mb-3" />
                  <p className="text-[#B0B3B8]">No Activity Logged Yet</p>
                  <p className="text-xs text-[#B0B3B8]/60 mt-1">Floor Calls, Incidents, And Actions Will Appear Here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activities.map(a => (
                    <div key={a.id} className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 flex items-start gap-3">
                      <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0"
                        style={{ backgroundColor: typeColors[a.incident_type] || '#B0B3B8' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium text-[#B0B3B8] uppercase">{a.incident_type?.replace('_', ' ')}</span>
                          {a.table_number && <span className="text-xs text-[#B0B3B8]">• Table {a.table_number}</span>}
                          <span className="text-xs text-[#B0B3B8]/50">
                            {a.created_at ? new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                        <p className="text-sm text-[#E4E6EB]">{a.description}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${a.incident_status === 'open' ? 'bg-[#F59E0B]/20 text-[#F59E0B]' :
                        a.incident_status === 'resolved' ? 'bg-[#31A24C]/20 text-[#31A24C]' :
                          'bg-[#3A3B3C] text-[#B0B3B8]'
                        }`}>{a.incident_status}</span>
                    </div>
                  ))}
                </div>
              )) : (
              <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                <AuditLogViewer
                  logs={auditLogs}
                  total={auditLogs.length}
                  isLoading={auditLoading}
                  onFilterChange={fetchAuditLogs}
                />
              </div>
            )}
          </div>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
