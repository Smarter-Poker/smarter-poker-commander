/**
 * Staff Incident Management Page
 * Log and track disputes, rule violations, and safety issues
 * Dark Commander theme with severity stats dashboard
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { AlertTriangle, Plus, Clock, User, Check, X, Search, Loader2, MapPin, Shield, Flame, Zap } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import useDebounce from '../../src/hooks/useDebounce';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';

const INCIDENT_TYPES = [
  { value: 'dispute', label: 'Player Dispute', emoji: '' },
  { value: 'rules_violation', label: 'Rules Violation', emoji: '' },
  { value: 'behavior', label: 'Behavior Issue', emoji: '' },
  { value: 'safety', label: 'Safety Concern', emoji: '' },
  { value: 'equipment', label: 'Equipment Issue', emoji: '' },
  { value: 'other', label: 'Other', emoji: '' }
];

const SEVERITY_LEVELS = [
  { value: 'low', label: 'Low', color: '#31A24C', icon: Shield },
  { value: 'medium', label: 'Medium', color: '#F59E0B', icon: AlertTriangle },
  { value: 'high', label: 'High', color: '#EF4444', icon: Flame },
  { value: 'critical', label: 'Critical', color: '#7C3AED', icon: Zap }
];

function IncidentCard({ incident, onClick }) {
  const sev = SEVERITY_LEVELS.find(s => s.value === incident.severity) || SEVERITY_LEVELS[1];
  const typeInfo = INCIDENT_TYPES.find(t => t.value === incident.incident_type) || INCIDENT_TYPES[5];

  // Time elapsed
  const elapsed = (() => {
    const mins = Math.floor((Date.now() - new Date(incident.created_at).getTime()) / 60000);
    if (mins < 60) return `${mins}m Ago`;
    if (mins < 1440) return `${Math.floor(mins / 60)}h Ago`;
    return `${Math.floor(mins / 1440)}d Ago`;
  })();

  return (
    <button onClick={onClick}
      className="w-full text-left transition-all active:scale-[0.99]"
      style={{
        background: '#242526',
        border: `2px solid ${incident.resolved ? '#3A3B3C' : `${sev.color}30`}`,
        borderRadius: 12,
        padding: 14,
        borderLeft: `4px solid ${incident.resolved ? '#31A24C' : sev.color}` }}>
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{
            background: `${sev.color}15`,
            color: sev.color,
            border: `1px solid ${sev.color}30`,
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5 }}>
            {incident.severity?.toUpperCase()}
          </span>
          <span style={{
            background: '#3A3B3C',
            color: '#B0B3B8',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600 }}>
            {typeInfo.label}
          </span>
        </div>
        {incident.resolved ? (
          <span style={{
            background: '#31A24C15',
            color: '#31A24C',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 3 }}>
            <Check size={12} /> Resolved
          </span>
        ) : (
          <span style={{
            background: '#EF444415',
            color: '#EF4444',
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            animation: incident.severity === 'critical' ? 'pulse 2s infinite' : 'none' }}>
            ● Open
          </span>
        )}
      </div>

      <p style={{ color: 'white', fontWeight: 600, fontSize: 14, marginBottom: 8, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {incident.description}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#B0B3B8', flexWrap: 'wrap' }}>
        {incident.table_number && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <MapPin size={13} /> T{incident.table_number}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Clock size={13} /> {elapsed}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <User size={13} /> {incident.reported_by_name || 'Staff'}
        </span>
      </div>
    </button>
  );
}

function CreateIncidentModal({ onSubmit, onClose }) {
  const [formData, setFormData] = useState({
    incident_type: 'dispute',
    severity: 'medium',
    table_number: '',
    players_involved: '',
    description: ''
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!formData.description) return;
    setLoading(true);
    await onSubmit({
      ...formData,
      players_involved: formData.players_involved
        ? formData.players_involved.split(',').map(p => p.trim())
        : []
    });
    setLoading(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#242526', borderRadius: 16, border: '2px solid #3A3B3C', padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ color: 'white', fontSize: 18, fontWeight: 800 }}>Report Incident</h2>
          <button onClick={onClose} style={{ background: '#3A3B3C', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
            <X size={18} color="#B0B3B8" />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Incident Type */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6 }}>Type Of Incident</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {INCIDENT_TYPES.map(type => (
                <button key={type.value} type="button"
                  onClick={() => setFormData(prev => ({ ...prev, incident_type: type.value }))}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: `2px solid ${formData.incident_type === type.value ? '#1877F2' : '#3A3B3C'}`,
                    background: formData.incident_type === type.value ? '#1877F215' : '#18191A',
                    color: formData.incident_type === type.value ? '#1877F2' : '#B0B3B8',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 600,
                    textAlign: 'left' }}>
                  {type.label}
                </button>
              ))}
            </div>
          </div>

          {/* Severity */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6 }}>Severity Level</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {SEVERITY_LEVELS.map(level => (
                <button key={level.value} type="button"
                  onClick={() => setFormData(prev => ({ ...prev, severity: level.value }))}
                  style={{
                    padding: '8px 4px',
                    borderRadius: 8,
                    border: `2px solid ${formData.severity === level.value ? level.color : '#3A3B3C'}`,
                    background: formData.severity === level.value ? `${level.color}15` : '#18191A',
                    color: formData.severity === level.value ? level.color : '#65676B',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: 'center' }}>
                  {level.label}
                </button>
              ))}
            </div>
          </div>

          {/* Table + Players row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6 }}>Table #</label>
              <input type="text" value={formData.table_number}
                onChange={(e) => setFormData(prev => ({ ...prev, table_number: e.target.value }))}
                placeholder="E.g. 5"
                style={{ width: '100%', height: 44, padding: '0 12px', background: '#18191A', border: '2px solid #3A3B3C', borderRadius: 8, color: 'white', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6 }}>Players Involved</label>
              <input type="text" value={formData.players_involved}
                onChange={(e) => setFormData(prev => ({ ...prev, players_involved: e.target.value }))}
                placeholder="John D., Mike S."
                style={{ width: '100%', height: 44, padding: '0 12px', background: '#18191A', border: '2px solid #3A3B3C', borderRadius: 8, color: 'white', fontSize: 14, boxSizing: 'border-box' }} />
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6 }}>Description *</label>
            <textarea value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Describe What Happened..."
              rows={4} required
              style={{ width: '100%', padding: '10px 12px', background: '#18191A', border: '2px solid #3A3B3C', borderRadius: 8, color: 'white', fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }} />
          </div>

          <div style={{ display: 'flex', gap: 10, paddingTop: 4 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, height: 44, background: '#3A3B3C', color: '#B0B3B8', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !formData.description}
              style={{ flex: 1, height: 44, background: '#EF4444', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (loading || !formData.description) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <><AlertTriangle size={16} /> Report Incident</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IncidentDetailModal({ incident, onResolve, onClose }) {
  const [resolution, setResolution] = useState('');
  const [loading, setLoading] = useState(false);
  const sev = SEVERITY_LEVELS.find(s => s.value === incident.severity) || SEVERITY_LEVELS[1];
  const typeInfo = INCIDENT_TYPES.find(t => t.value === incident.incident_type) || INCIDENT_TYPES[5];

  async function handleResolve(signal) {
    if (!resolution) return;
    setLoading(true);
    await onResolve(incident.id, resolution);
    setLoading(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 480, background: '#242526', borderRadius: 16, border: `2px solid ${sev.color}30`, padding: 24, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h2 style={{ color: 'white', fontSize: 18, fontWeight: 800 }}>Incident Details</h2>
          <button onClick={onClose} style={{ background: '#3A3B3C', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer' }}>
            <X size={18} color="#B0B3B8" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Header badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ background: `${sev.color}15`, color: sev.color, border: `1px solid ${sev.color}30`, padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
              {incident.severity?.toUpperCase()}
            </span>
            <span style={{ background: '#3A3B3C', color: '#B0B3B8', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600 }}>
              {typeInfo.label}
            </span>
            {incident.resolved && (
              <span style={{ background: '#31A24C15', color: '#31A24C', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
                <Check size={12} /> Resolved
              </span>
            )}
          </div>

          {/* Info grid */}
          <div style={{ background: '#18191A', borderRadius: 10, padding: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: '#65676B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>When</div>
              <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{new Date(incident.created_at).toLocaleString()}</div>
            </div>
            {incident.table_number && (
              <div>
                <div style={{ fontSize: 10, color: '#65676B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Table</div>
                <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>Table {incident.table_number}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: 10, color: '#65676B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Reported By</div>
              <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{incident.reported_by_name || 'Staff Member'}</div>
            </div>
            {incident.players_involved?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: '#65676B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Players</div>
                <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{incident.players_involved.join(', ')}</div>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: 10, color: '#65676B', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Description</div>
            <div style={{ fontSize: 14, color: '#E4E6EB', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{incident.description}</div>
          </div>

          {/* Resolution */}
          {incident.resolved ? (
            <div style={{ background: '#31A24C10', border: '1px solid #31A24C20', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: 10, color: '#31A24C', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Resolution</div>
              <div style={{ fontSize: 14, color: '#E4E6EB', lineHeight: 1.5 }}>{incident.resolution}</div>
              <div style={{ fontSize: 11, color: '#65676B', marginTop: 8 }}>
                Resolved {new Date(incident.resolved_at).toLocaleString()}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#B0B3B8' }}>Resolution</label>
              <textarea value={resolution} onChange={(e) => setResolution(e.target.value)}
                placeholder="Describe How This Incident Was Resolved..."
                rows={3}
                style={{ width: '100%', padding: '10px 12px', background: '#18191A', border: '2px solid #3A3B3C', borderRadius: 8, color: 'white', fontSize: 14, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }} />
              <button onClick={handleResolve} disabled={loading || !resolution}
                style={{ width: '100%', height: 44, background: '#31A24C', color: 'white', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (loading || !resolution) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Mark As Resolved</>}
              </button>
            </div>
          )}

          <button onClick={onClose}
            style={{ width: '100%', height: 44, background: '#3A3B3C', color: '#B0B3B8', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function IncidentsPage() {
  const router = useRouter();

  useEffect(() => { busEmit.sessionStart('commander-incidents'); }, []);
  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState([]);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState(null);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
      setStaff(staffData);
      setVenueId(staffData.venue_id);
    } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
  }, [router]);

  useEffect(() => {
    if (venueId) fetchIncidents();
  }, [venueId]);

  // Commander Data Bus - sync incidents across tabs
  useCommanderSync(venueId, fetchIncidents, { entities: ['incidents'] });

  async function fetchIncidents(signal) {
    setLoading(true);
    try {
const data = await commanderFetchJSON(`/api/commander/incidents?venue_id=${venueId}`, {});
      if (data.success) {
        setIncidents(data.data?.incidents || []);
      } else {
        // 2026-07-25 audit fix: surface API-level failures via toast
        setToast({ type: 'error', text: data.error?.message || data.error || 'Failed To Load Incidents.' });
      }
    } catch (err) {
      console.warn('Fetch incidents failed:', err);
      setIncidents([]);
      // 2026-07-25 audit fix: surface fetch failures via toast
      setToast({ type: 'error', text: 'Failed To Load Incidents.' });
    } finally { setLoading(false); }
  }

  async function handleCreateIncident(data) {
    try {
const res = await commanderFetch('/api/commander/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venue_id: venueId, reported_by: staff.id, ...data })
      });
      if (res.ok) {
        const result = await res.json();
        if (result.success) {
          setShowCreateModal(false);
          fetchIncidents();
          broadcastChange('incidents');
          busEmit.screenShake('medium');
        } else {
          // 2026-07-25 audit fix: surface API-level failures via toast
          setToast({ type: 'error', text: result.error?.message || result.error || 'Create Incident Failed. Please Try Again.' });
        }
      } else {
        // 2026-07-25 audit fix: surface non-OK responses via toast
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', text: body?.error?.message || body?.error || `Create Incident Failed (${res.status}).` });
      }
    } catch (err) { console.warn('Create incident failed:', err); setToast({ type: 'error', text: 'Action Failed: Create Incident Failed. Please Try Again.' }); }
  setLoading(false);
  }

  async function handleResolveIncident(incidentId, resolution) {
    try {
const res = await commanderFetch(`/api/commander/incidents/${incidentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution })
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setSelectedIncident(null);
          fetchIncidents();
          broadcastChange('incidents');
        } else {
          // 2026-07-25 audit fix: surface API-level failures via toast
          setToast({ type: 'error', text: json.error?.message || json.error || 'Resolve Incident Failed. Please Try Again.' });
        }
      } else {
        // 2026-07-25 audit fix: surface non-OK responses via toast
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', text: body?.error?.message || body?.error || `Resolve Incident Failed (${res.status}).` });
      }
    } catch (err) { console.warn('Resolve incident failed:', err); setToast({ type: 'error', text: 'Action Failed: Resolve Incident Failed. Please Try Again.' }); }
  }

  const filteredIncidents = incidents
    .filter(i => {
      if (filter === 'open') return !i.resolved;
      if (filter === 'resolved') return i.resolved;
      return true;
    })
    .filter(i =>
      i.description?.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      i.incident_type?.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
      i.reported_by_name?.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
    );

  const openCount = incidents.filter(i => !i.resolved).length;
  const resolvedCount = incidents.filter(i => i.resolved).length;
  const criticalCount = incidents.filter(i => !i.resolved && (i.severity === 'critical' || i.severity === 'high')).length;

  if (!staff) {
    return (
      <CommanderLayout title="Incidents" backHref="/commander/dashboard?card=staff">
        <div style={{ minHeight: '100vh', background: '#18191A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Loader2 size={28} className="animate-spin" color="#1877F2" />
        </div>
      </CommanderLayout>
    );
  }

  return (
    <CommanderLayout title="Incidents" backHref="/commander/dashboard?card=staff">
      <SEOHead title="Commander - Incidents" description="Incident Management." noindex={true} />
      <div style={{ minHeight: '100vh', background: '#18191A', fontFamily: 'Inter, system-ui, sans-serif' }}>

        {/* Header */}
        <div style={{ background: '#242526', borderBottom: '2px solid #3A3B3C', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: '#EF444415', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={20} color="#EF4444" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 16 }}>Incident Log</div>
            <div style={{ color: '#B0B3B8', fontSize: 12 }}>Track Disputes, Violations, And Safety Issues</div>
          </div>
          <button onClick={() => setShowCreateModal(true)}
            style={{ background: '#EF4444', color: 'white', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <Plus size={16} /> Report
          </button>
        </div>

        <div style={{ padding: 16, maxWidth: 640, margin: '0 auto' }}>

          {/* Stats Dashboard */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 14 }}>
            <div style={{ background: '#242526', borderRadius: 10, padding: 12, textAlign: 'center', border: openCount > 0 ? '1px solid #EF444430' : '1px solid #3A3B3C' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: openCount > 0 ? '#EF4444' : '#65676B' }}>{openCount}</div>
              <div style={{ fontSize: 10, color: '#B0B3B8', fontWeight: 600 }}>Open</div>
            </div>
            <div style={{ background: '#242526', borderRadius: 10, padding: 12, textAlign: 'center', border: criticalCount > 0 ? '1px solid #7C3AED30' : '1px solid #3A3B3C' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: criticalCount > 0 ? '#7C3AED' : '#65676B' }}>{criticalCount}</div>
              <div style={{ fontSize: 10, color: '#B0B3B8', fontWeight: 600 }}>High / Critical</div>
            </div>
            <div style={{ background: '#242526', borderRadius: 10, padding: 12, textAlign: 'center', border: '1px solid #3A3B3C' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: resolvedCount > 0 ? '#31A24C' : '#65676B' }}>{resolvedCount}</div>
              <div style={{ fontSize: 10, color: '#B0B3B8', fontWeight: 600 }}>Resolved</div>
            </div>
          </div>

          {/* Search + Filter */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
              <Search size={16} color="#65676B" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
              <input type="text" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Incidents..."
                style={{ width: '100%', height: 40, paddingLeft: 36, paddingRight: 12, background: '#242526', border: '2px solid #3A3B3C', borderRadius: 10, color: 'white', fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[
                { value: 'all', label: 'All' },
                { value: 'open', label: 'Open' },
                { value: 'resolved', label: 'Done' }
              ].map(f => (
                <button key={f.value} onClick={() => setFilter(f.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 8,
                    border: 'none',
                    background: filter === f.value ? '#1877F2' : '#242526',
                    color: filter === f.value ? 'white' : '#B0B3B8',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer' }}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Incidents List */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 48 }}>
              <Loader2 size={28} className="animate-spin" color="#1877F2" style={{ margin: '0 auto' }} />
            </div>
          ) : filteredIncidents.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredIncidents.map(incident => (
                <IncidentCard key={incident.id} incident={incident} onClick={() => setSelectedIncident(incident)} />
              ))}
            </div>
          ) : (
            <div style={{ background: '#242526', borderRadius: 12, padding: 48, textAlign: 'center', border: '2px solid #3A3B3C' }}>
              <Shield size={36} color="#3A3B3C" style={{ margin: '0 auto 8px' }} />
              <p style={{ color: '#65676B', fontSize: 14 }}>
                {searchQuery ? 'No Incidents Match Your Search' : 'No Incidents Reported. All Clear'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateIncidentModal
          onSubmit={handleCreateIncident}
          onClose={() => setShowCreateModal(false)}
        />
      )}
      {selectedIncident && (
        <IncidentDetailModal
          incident={selectedIncident}
          onResolve={handleResolveIncident}
          onClose={() => setSelectedIncident(null)}
        />
      )}
    
      {/* TOAST */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 20px', borderRadius: 12,
          background: toast.type === 'success' ? '#22C55E' : '#EF4444',
          color: '#fff', fontSize: 13, fontWeight: 600,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', gap: 8,
          animation: 'slideUp 0.3s ease',
          maxWidth: 360,
        }}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} style={{
            background: 'none', border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 8,
          }}>×</button>
        </div>
      )}
    </CommanderLayout>
  );
}
