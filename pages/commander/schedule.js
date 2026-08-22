/**
 * Staff Schedule - Weekly Shift Planner
 * /commander/schedule
 * SmarterPoker Dark Theme
 * 
 * Full weekly scheduling system for all staff roles:
 * - Week grid view with day columns and staff rows
 * - Add/edit/delete shifts
 * - Role filter tabs (All, Dealers, Floor, Cashiers, Security, Managers)
 * - Send schedule to all staff via SMS/Email
 * - 6 months of demo data for Dealers, Floor, Cashier, Security
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Calendar, Users, Plus, X, Clock, Send, ChevronLeft, ChevronRight, Loader2, RefreshCw, MessageSquare, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';
import { titleCase } from '../../src/lib/commander/formatters';

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day); // rewind to Sunday
  return d.toISOString().split('T')[0];
}

function getWeekDays(weekStart) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + i);
    days.push({
      date: d.toISOString().split('T')[0],
      label: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dayNum: d.getDate(),
      month: d.toLocaleDateString('en-US', { month: 'short' }),
      isToday: d.toISOString().split('T')[0] === new Date().toISOString().split('T')[0]
    });
  }
  return days;
}

function formatTime12(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}

function shiftHours(start, end) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60; // overnight shift
  return Math.round(mins / 60 * 10) / 10;
}

const ROLE_FILTERS = [
  { value: 'all', label: 'All Staff', color: '#1877F2' },
  { value: 'dealer', label: 'Dealers', color: '#6B7280' },
  { value: 'floor', label: 'Floor', color: '#059669' },
  { value: 'cashier', label: 'Cashiers', color: '#D97706' },
  { value: 'security', label: 'Security', color: '#EF4444' },
  { value: 'manager', label: 'Managers', color: '#2563EB' },
  { value: 'brush', label: 'Brush', color: '#8B5CF6' },
  { value: 'owner', label: 'Owner', color: '#7C3AED' },
  { value: 'dualrate', label: 'Dual Rate', color: '#0EA5E9' },
];

// titleCase imported from '@/lib/commander/formatters'

const ROLE_COLORS = {
  owner: '#7C3AED', manager: '#2563EB', floor: '#059669',
  cashier: '#D97706', brush: '#8B5CF6', dealer: '#6B7280',
  security: '#EF4444', dualrate: '#0EA5E9', staff: '#6B7280'
};

// ═══════════════════════════════════════════════════════════════
// MOCK DATA - 6 MONTHS OF SCHEDULES
// ═══════════════════════════════════════════════════════════════

const MOCK_STAFF = [
  // Dealers - Club JAQK Demo Staff
  { id: 'demo-d1', display_name: 'Marcus Chen', role: 'dealer', is_active: true },
  { id: 'demo-d2', display_name: 'Sarah Williams', role: 'dealer', is_active: true },
  { id: 'demo-d3', display_name: 'Jake Morrison', role: 'dealer', is_active: true },
  { id: 'demo-d4', display_name: 'Lisa Park', role: 'dealer', is_active: true },
  { id: 'demo-d5', display_name: 'Tommy Nguyen', role: 'dealer', is_active: true },
  { id: 'demo-d6', display_name: 'Rachel Adams', role: 'dealer', is_active: true },
  // Floor - Club JAQK Demo Staff
  { id: 'demo-f1', display_name: 'Mike Torres', role: 'floor', is_active: true },
  { id: 'demo-f2', display_name: 'Diana Reyes', role: 'floor', is_active: true },
  { id: 'demo-f3', display_name: 'Chris Banks', role: 'floor', is_active: true },
  // Cashier - Club JAQK Demo Staff
  { id: 'demo-c1', display_name: 'Amy Rodriguez', role: 'cashier', is_active: true },
  { id: 'demo-c2', display_name: 'Kevin Patel', role: 'cashier', is_active: true },
  { id: 'demo-c3', display_name: 'Nina Foster', role: 'cashier', is_active: true },
  // Security - Club JAQK Demo Staff
  { id: 'demo-s1', display_name: 'Ray Johnson', role: 'security', is_active: true },
  { id: 'demo-s2', display_name: 'Victor Cruz', role: 'security', is_active: true },
  { id: 'demo-s3', display_name: 'Tony Martinez', role: 'security', is_active: true },
  // Manager - Club JAQK Demo Staff
  { id: 'demo-m1', display_name: 'Daniel Bekavac', role: 'manager', is_active: true },
];

// Shift patterns by role - realistic poker room schedules
const SHIFT_PATTERNS = {
  dealer: [
    { start: '10:00', end: '18:00' },  // Day
    { start: '14:00', end: '22:00' },  // Swing
    { start: '18:00', end: '02:00' },  // Night
    { start: '08:00', end: '16:00' },  // Morning
    { start: '12:00', end: '20:00' },  // Mid
  ],
  floor: [
    { start: '10:00', end: '20:00' },  // Day (long)
    { start: '14:00', end: '00:00' },  // Swing (long)
    { start: '18:00', end: '04:00' },  // Night (long)
  ],
  cashier: [
    { start: '09:00', end: '17:00' },  // Morning
    { start: '13:00', end: '21:00' },  // Afternoon
    { start: '17:00', end: '01:00' },  // Evening
  ],
  security: [
    { start: '10:00', end: '22:00' },  // Day (12hr)
    { start: '22:00', end: '10:00' },  // Night (12hr)
    { start: '14:00', end: '02:00' },  // Swing (12hr)
  ],
  manager: [
    { start: '10:00', end: '20:00' },
    { start: '14:00', end: '00:00' },
  ] };

// Staff weekly schedule patterns (which days each person works)
const STAFF_SCHEDULES = {
  'demo-d1': [1, 2, 3, 4, 5],       // Mon-Fri
  'demo-d2': [0, 1, 2, 3, 4],       // Sun-Thu
  'demo-d3': [2, 3, 4, 5, 6],       // Tue-Sat
  'demo-d4': [0, 3, 4, 5, 6],       // Sun, Wed-Sat
  'demo-d5': [1, 2, 5, 6, 0],       // Mon, Tue, Fri-Sun
  'demo-d6': [0, 1, 4, 5, 6],       // Sun, Mon, Thu-Sat
  'demo-f1': [1, 2, 3, 4, 5],       // Mon-Fri
  'demo-f2': [0, 2, 3, 5, 6],       // Sun, Tue, Wed, Fri, Sat
  'demo-f3': [0, 1, 4, 5, 6],       // Sun, Mon, Thu-Sat
  'demo-c1': [1, 2, 3, 4, 5],       // Mon-Fri
  'demo-c2': [0, 2, 4, 5, 6],       // Sun, Tue, Thu-Sat
  'demo-c3': [0, 1, 3, 5, 6],       // Sun, Mon, Wed, Fri, Sat
  'demo-s1': [0, 1, 2, 3],          // Sun-Wed (security 12hr shifts, fewer days)
  'demo-s2': [3, 4, 5, 6],          // Wed-Sat
  'demo-s3': [0, 1, 5, 6],          // Sun, Mon, Fri, Sat
  'demo-m1': [1, 2, 3, 4, 5],       // Mon-Fri
};

// Preferred shift index per staff member (which shift pattern they usually work)
const STAFF_SHIFT_IDX = {
  'demo-d1': 0, 'demo-d2': 1, 'demo-d3': 2, 'demo-d4': 0,
  'demo-d5': 1, 'demo-d6': 2,
  'demo-f1': 0, 'demo-f2': 1, 'demo-f3': 2,
  'demo-c1': 0, 'demo-c2': 1, 'demo-c3': 2,
  'demo-s1': 0, 'demo-s2': 1, 'demo-s3': 2,
  'demo-m1': 0 };

function generateMockShifts() {
  const shifts = [];
  const today = new Date();
  // Generate 6 months: 3 months back + 3 months forward (26 weeks)
  const startDate = new Date(today);
  startDate.setMonth(startDate.getMonth() - 3);
  startDate.setDate(startDate.getDate() - startDate.getDay()); // align to Sunday

  for (let week = 0; week < 26; week++) {
    for (const person of MOCK_STAFF) {
      const workDays = STAFF_SCHEDULES[person.id] || [1, 2, 3, 4, 5];
      const shiftIdx = STAFF_SHIFT_IDX[person.id] || 0;
      const patterns = SHIFT_PATTERNS[person.role] || SHIFT_PATTERNS.dealer;
      const shift = patterns[shiftIdx % patterns.length];

      for (const dayOfWeek of workDays) {
        const shiftDate = new Date(startDate);
        shiftDate.setDate(shiftDate.getDate() + (week * 7) + dayOfWeek);
        const dateStr = shiftDate.toISOString().split('T')[0];

        shifts.push({
          id: `mock-${person.id}-${dateStr}`,
          staff_id: person.id,
          staff_name: person.display_name,
          staff_role: person.role,
          shift_date: dateStr,
          start_time: shift.start,
          end_time: shift.end,
          notes: null });
      }
    }
  }
  return shifts;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function StaffSchedule() {
  const router = useRouter();
  useEffect(() => { busEmit.sessionStart('commander-schedule'); }, []);
  const [weekStart, setWeekStart] = useState(getWeekStart(new Date()));
  const [shifts, setShifts] = useState([]);
  const [allStaff, setAllStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addDate, setAddDate] = useState(null);
  const [addStaffId, setAddStaffId] = useState(null);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastResult, setBroadcastResult] = useState(null);
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  const [usingMockData, setUsingMockData] = useState(false);

  // Post-write cooldown - suppress Supabase Realtime echo after local writes
  // When we create/delete a shift, the DB change fires a Realtime event
  // back to this same tab. Without this guard, we get a double-fetch.
  const lastWriteRef = useRef(0);
  const WRITE_COOLDOWN_MS = 2000;
  const getHeaders = () => {
return { 'Content-Type': 'application/json' };
  };

  // Fetch shifts + staff
  const fetchData = useCallback(async () => {
    const venueId = getVenueId();
    if (!venueId) {
      // No venue - use mock data
      setAllStaff(MOCK_STAFF);
      setShifts(generateMockShifts());
      setUsingMockData(true);
      setLoading(false);
      return;
    }
    try {
      const headers = getHeaders();
      const [shiftsRes, staffRes] = await Promise.all([
        commanderFetch(`/api/commander/schedule/shifts?venue_id=${venueId}&week_start=${weekStart}`, { headers }).then(r => r.json()).catch(() => ({ success: false })),
        commanderFetch(`/api/commander/staff?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ success: false }))
      ]);
      const realShifts = shiftsRes.success ? (shiftsRes.data || []) : [];
      const rawStaff = staffRes.success
        ? (Array.isArray(staffRes.data) ? staffRes.data : staffRes.data?.staff || [])
        : [];
      const activeStaff = rawStaff.filter(s => s.is_active !== false);

      // Only fall back to mock data if NO real staff exist at all
      // This ensures linked venues (e.g. Club JAQK) always show real staff
      // even when they have zero shifts for the selected week
      if (activeStaff.length === 0) {
        setAllStaff(MOCK_STAFF);
        setShifts(generateMockShifts());
        setUsingMockData(true);
      } else {
        setAllStaff(activeStaff);
        setShifts(realShifts);
        setUsingMockData(false);
      }
    } catch (err) {
      console.warn('[Schedule] fetch error:', err);
      // Fallback to mock data on error
      setAllStaff(MOCK_STAFF);
      setShifts(generateMockShifts());
      setUsingMockData(true);
    }
    finally { setLoading(false); }
  }, [weekStart]);

  useEffect(() => { const _c = new AbortController(); fetchData(_c.signal); return () => _c.abort(); }, [fetchData]);

  // Commander Data Bus - sync staff/schedule across tabs
  // Listen for both 'staff' changes (new employees) and 'settings' changes (schedule shifts)
  // Use a guarded callback to skip Supabase echo refetches within WRITE_COOLDOWN_MS of a local write
  const guardedFetch = useCallback(() => {
    const elapsed = Date.now() - lastWriteRef.current;
    if (elapsed < WRITE_COOLDOWN_MS) {
      // Skip - this is a Supabase echo from our own write
      return;
    }
    fetchData();
  }, [fetchData]);
  useCommanderSync(getVenueId(), guardedFetch, { entities: ['staff', 'settings'] });

  // Navigation
  const changeWeek = (delta) => {
    const d = new Date(weekStart + 'T12:00:00');
    d.setDate(d.getDate() + (delta * 7));
    setWeekStart(d.toISOString().split('T')[0]);
  };

  const goToday = () => {
    setWeekStart(getWeekStart(new Date()));
  };

  // Create shift
  const createShift = async (data) => {
    if (usingMockData) {
      // Add to mock shifts locally
      const newShift = {
        id: `mock-new-${Date.now()}`,
        ...data };
      setShifts(prev => [...prev, newShift]);
      setShowAddModal(false);
      showToast('Shift added', 'success');
      return;
    }
    try {
      const venueId = getVenueId();
      const res = await commanderFetch('/api/commander/schedule/shifts', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ venue_id: venueId, ...data })
      });
      if (!res.ok) throw new Error('Request failed');
      const result = await res.json();
      if (result.success) {
        lastWriteRef.current = Date.now();
        broadcastChange('staff');
        fetchData();
        setShowAddModal(false);
        showToast('Shift Added', 'success');
      } else {
        showToast(result.error?.message || 'Failed to add shift', 'error');
      }
    } catch (err) {
      showToast('Network error', 'error');
    }
  };

  // Delete shift
  const deleteShift = async (shiftId) => {
    if (usingMockData) {
      setShifts(prev => prev.filter(s => s.id !== shiftId));
      showToast('Shift deleted', 'success');
      return;
    }
    try {
      const venueId = getVenueId();
      const res = await commanderFetch(`/api/commander/schedule/shifts?id=${shiftId}&venue_id=${venueId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      if (!res.ok) throw new Error('Request failed');
      const result = await res.json();
      if (result.success) {
        lastWriteRef.current = Date.now();
        broadcastChange('staff');
        fetchData();
        showToast('Shift Deleted', 'success');
      }
    } catch (err) {
      showToast('Failed to delete', 'error');
    }
  };

  // Broadcast
  const broadcastSchedule = async (channel) => {
    setBroadcasting(true);
    setBroadcastResult(null);
    try {
      const venueId = getVenueId();
      const res = await commanderFetch('/api/commander/schedule/broadcast', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ venue_id: venueId, week_start: weekStart, channel })
      });
      if (!res.ok) throw new Error('Request failed');
      const result = await res.json();
      if (result.success) {
        setBroadcastResult(result.data);
        showToast(`Schedule sent to ${result.data.sent} staff`, 'success');
      } else {
        showToast(result.error?.message || 'Broadcast failed', 'error');
      }
    } catch (err) {
      showToast('Network error', 'error');
    }
    setBroadcasting(false);
  };

  const showToast = (msg, type) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Computed - filter shifts for current week
  const weekDays = getWeekDays(weekStart);
  const weekLabel = `${weekDays[0].month} ${weekDays[0].dayNum} – ${weekDays[6].month} ${weekDays[6].dayNum}`;
  const weekDates = new Set(weekDays.map(d => d.date));
  const weekShifts = shifts.filter(s => weekDates.has(s.shift_date));

  const filteredStaff = roleFilter === 'all'
    ? allStaff
    : allStaff.filter(s => s.role === roleFilter);

  // Stats (for current week only)
  const totalShifts = weekShifts.length;
  const totalHours = weekShifts.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0);
  const staffWithShifts = new Set(weekShifts.map(s => s.staff_id)).size;

  // Get shifts for a specific staff member on a specific date
  const getShiftsFor = (staffId, date) => weekShifts.filter(s => s.staff_id === staffId && s.shift_date === date);

  return (
    <CommanderLayout title="Staff Schedule" backHref="/commander/dashboard?card=staff">
      <SEOHead title="Commander - Staff Schedule" description="Weekly Staff Scheduling For Club Commander." noindex={true} />

      {/* ══ EXTERIOR FRAME - 2px border matching other Commander pages ══ */}
      <div style={{ minHeight: '100vh', background: '#18191A', color: '#E4E6EB', fontFamily: "var(--font-inter), -apple-system, sans-serif", border: '2px solid #3A3B3C' }}>

        {/* Demo Banner */}
        {usingMockData && (
          <div style={{ background: '#1877F215', borderBottom: '2px solid #1877F230', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={14} color="#1877F2" />
            <span style={{ fontSize: 12, color: '#1877F2', fontWeight: 600 }}>Demo Mode - Showing Sample Schedule Data (6 Months)</span>
          </div>
        )}

        {/* Header Bar */}
        <div style={{ background: '#242526', borderBottom: '2px solid #3A3B3C', padding: '12px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Calendar size={20} color="#1877F2" />
              <h1 style={{ fontSize: 18, fontWeight: 800, color: 'white', margin: 0 }}>Staff Schedule</h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={fetchData} style={{ padding: 8, borderRadius: 8, background: 'transparent', border: '1px solid #3A3B3C', cursor: 'pointer' }} title="Refresh">
                <RefreshCw size={16} color="#B0B3B8" />
              </button>
              <button
                onClick={() => setShowBroadcastModal(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 8, background: '#1877F2', color: 'white', border: '1px solid #1877F280', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
              >
                <Send size={14} />
                <span>Send Schedule</span>
              </button>
            </div>
          </div>
        </div>

        {/* Week Navigator */}
        <div style={{ background: '#242526', borderBottom: '2px solid #3A3B3C', padding: '8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', maxWidth: 1200, margin: '0 auto' }}>
            <button onClick={() => changeWeek(-1)} style={{ padding: 8, borderRadius: 8, background: 'transparent', border: '1px solid #3A3B3C', cursor: 'pointer' }}>
              <ChevronLeft size={20} color="#B0B3B8" />
            </button>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: 'white', margin: 0 }}>{weekLabel}</p>
              <button onClick={goToday} style={{ fontSize: 12, color: '#1877F2', fontWeight: 600, background: 'none', border: '1px solid #1877F240', borderRadius: 4, cursor: 'pointer', padding: '2px 8px' }}>Today</button>
            </div>
            <button onClick={() => changeWeek(1)} style={{ padding: 8, borderRadius: 8, background: 'transparent', border: '1px solid #3A3B3C', cursor: 'pointer' }}>
              <ChevronRight size={20} color="#B0B3B8" />
            </button>
          </div>
        </div>

        {/* Stats Bar */}
        <div style={{ padding: '12px 16px', maxWidth: 1200, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { value: totalShifts, label: 'Shifts', color: '#1877F2' },
              { value: `${totalHours.toFixed(0)}h`, label: 'Hours', color: '#31A24C' },
              { value: staffWithShifts, label: 'Scheduled', color: '#F59E0B' },
              { value: allStaff.length, label: 'Total Staff', color: '#E4E6EB' },
            ].map((stat, i) => (
              <div key={i} style={{
                flex: 1, background: `${stat.color}10`, border: `1px solid ${stat.color}40`,
                borderRadius: 12, padding: '8px 12px', textAlign: 'center'
              }}>
                <p style={{ fontSize: 18, fontWeight: 800, color: stat.color, margin: 0 }}>{stat.value}</p>
                <p style={{ fontSize: 10, color: '#B0B3B8', margin: 0, textTransform: 'capitalize' }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Role Filter */}
        <div style={{ padding: '0 16px 12px', maxWidth: 1200, margin: '0 auto', overflowX: 'auto' }}>
          <div style={{ display: 'flex', gap: 6, minWidth: 'max-content' }}>
            {ROLE_FILTERS.map(f => {
              const count = f.value === 'all' ? allStaff.length : allStaff.filter(s => s.role === f.value).length;
              if (f.value !== 'all' && count === 0) return null;
              return (
                <button
                  key={f.value}
                  onClick={() => setRoleFilter(f.value)}
                  style={{
                    padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: roleFilter === f.value ? `1px solid ${f.color}60` : '1px solid #4A4B4C',
                    background: roleFilter === f.value ? `${f.color}25` : '#3A3B3C',
                    color: roleFilter === f.value ? f.color : '#B0B3B8' }}
                >
                  {titleCase(f.label)} ({count})
                </button>
              );
            })}
          </div>
        </div>

        {/* Week Grid */}
        {loading ? (
          <div style={{ padding: '80px 0', display: 'flex', justifyContent: 'center' }}>
            <Loader2 size={32} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        ) : filteredStaff.length === 0 ? (
          <div style={{ padding: '64px 16px', textAlign: 'center' }}>
            <Users size={48} color="#3A3B3C" style={{ margin: '0 auto 12px' }} />
            <p style={{ fontSize: 18, fontWeight: 700, color: 'white', margin: '0 0 4px' }}>No Staff Found</p>
            <p style={{ fontSize: 14, color: '#B0B3B8' }}>
              {roleFilter !== 'all' ? 'Try A Different Role Filter Or ' : ''}
              Add Staff On The <button onClick={() => router.push('/commander/staff')} style={{ color: '#1877F2', background: 'none', border: '1px solid #1877F240', borderRadius: 4, padding: '2px 6px', cursor: 'pointer' }}>Staff Management</button> Page.
            </p>
          </div>
        ) : (
          <div style={{ padding: '0 8px 96px', maxWidth: 1200, margin: '0 auto' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700, border: '1px solid #3A3B3C' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #3A3B3C' }}>
                    <th style={{
                      position: 'sticky', left: 0, background: '#242526', zIndex: 10,
                      width: 150, padding: '8px', textAlign: 'left', fontSize: 11,
                      fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: 1,
                      borderRight: '1px solid #3A3B3C'
                    }}>
                      Employee
                    </th>
                    {weekDays.map(day => (
                      <th key={day.date} style={{
                        padding: '8px 4px', textAlign: 'center', minWidth: 100,
                        background: day.isToday ? '#1877F210' : '#242526',
                        borderRight: '1px solid #3A3B3C'
                      }}>
                        <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', margin: 0 }}>{titleCase(day.label)}</p>
                        <p style={{ fontSize: 14, fontWeight: 800, color: day.isToday ? '#1877F2' : 'white', margin: 0 }}>{day.dayNum}</p>
                      </th>
                    ))}
                    <th style={{ padding: '8px', textAlign: 'center', width: 64, background: '#242526' }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', margin: 0 }}>Hours</p>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStaff.map(person => {
                    const personWeekShifts = weekShifts.filter(s => s.staff_id === person.id);
                    const personHours = personWeekShifts.reduce((sum, s) => sum + shiftHours(s.start_time, s.end_time), 0);
                    const roleColor = ROLE_COLORS[person.role] || '#6B7280';
                    return (
                      <tr key={person.id} style={{ borderTop: '1px solid #3A3B3C' }}>
                        {/* Staff Name */}
                        <td style={{ position: 'sticky', left: 0, background: '#18191A', zIndex: 10, padding: '8px', borderRight: '1px solid #3A3B3C' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 28, height: 28, borderRadius: '50%', display: 'flex',
                              alignItems: 'center', justifyContent: 'center', fontSize: 10,
                              fontWeight: 800, color: 'white', background: roleColor + '40',
                              flexShrink: 0
                            }}>
                              {(person.display_name || person.name || '?')[0]?.toUpperCase()}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <p style={{ fontSize: 13, fontWeight: 600, color: 'white', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 110 }}>
                                {titleCase(person.display_name || person.name || 'Staff')}
                              </p>
                              <p style={{ fontSize: 10, color: roleColor, margin: 0, textTransform: 'capitalize', fontWeight: 600 }}>
                                {titleCase(person.role || 'staff')}
                              </p>
                            </div>
                          </div>
                        </td>
                        {/* Day cells */}
                        {weekDays.map(day => {
                          const dayShifts = getShiftsFor(person.id, day.date);
                          return (
                            <td key={day.date} style={{
                              padding: '4px', verticalAlign: 'top',
                              background: day.isToday ? '#1877F210' : 'transparent',
                              borderRight: '1px solid #3A3B3C30'
                            }}>
                              {dayShifts.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {dayShifts.map(s => (
                                    <div
                                      key={s.id}
                                      style={{
                                        position: 'relative', borderRadius: 8, padding: '4px 6px',
                                        fontSize: 10, fontWeight: 600, cursor: 'pointer',
                                        background: roleColor + '15', border: `1px solid ${roleColor}40`,
                                        color: roleColor, transition: 'all 0.15s'
                                      }}
                                    >
                                      <p style={{ margin: 0, lineHeight: 1.3 }}>{formatTime12(s.start_time)}</p>
                                      <p style={{ margin: 0, lineHeight: 1.3 }}>{formatTime12(s.end_time)}</p>
                                      {/* Delete on hover - using CSS class isn't available, show always on mobile */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); deleteShift(s.id); }}
                                        style={{
                                          position: 'absolute', top: -6, right: -6, width: 16, height: 16,
                                          borderRadius: '50%', background: '#EF4444', color: 'white',
                                          border: 'none', cursor: 'pointer', display: 'flex',
                                          alignItems: 'center', justifyContent: 'center', opacity: 0.7,
                                          fontSize: 8
                                        }}
                                        title="Delete shift"
                                      >
                                        <X size={10} />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setAddDate(day.date); setAddStaffId(person.id); setShowAddModal(true); }}
                                  style={{
                                    width: '100%', height: 40, borderRadius: 8,
                                    border: '1px dashed #3A3B3C50', background: 'transparent',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    justifyContent: 'center', transition: 'all 0.15s'
                                  }}
                                >
                                  <Plus size={12} color="#3A3B3C" />
                                </button>
                              )}
                            </td>
                          );
                        })}
                        {/* Weekly hours */}
                        <td style={{ padding: '8px', textAlign: 'center' }}>
                          <p style={{
                            fontSize: 14, fontWeight: 800, margin: 0,
                            color: personHours >= 40 ? '#EF4444' : personHours > 0 ? 'white' : '#3A3B3C'
                          }}>
                            {personHours > 0 ? `${personHours}h` : '-'}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Add Shift FAB */}
            <button
              onClick={() => { setAddDate(null); setAddStaffId(null); setShowAddModal(true); }}
              style={{
                position: 'fixed', bottom: 24, right: 24, width: 56, height: 56,
                borderRadius: '50%', background: '#1877F2', color: 'white', border: '2px solid #1877F280',
                boxShadow: '0 4px 20px #1877F230', display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', zIndex: 20
              }}
            >
              <Plus size={28} />
            </button>
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div style={{
            position: 'fixed', top: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 50, padding: '10px 16px', borderRadius: 12, fontSize: 13, fontWeight: 600,
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            background: toast.type === 'success' ? '#31A24C' : '#EF4444', color: 'white'
          }}>
            {toast.msg}
          </div>
        )}

        {/* Add Shift Modal */}
        {showAddModal && (
          <AddShiftModal
            allStaff={allStaff}
            defaultDate={addDate}
            defaultStaffId={addStaffId}
            weekDays={weekDays}
            onClose={() => setShowAddModal(false)}
            onSubmit={createShift}
          />
        )}

        {/* Broadcast Modal */}
        {showBroadcastModal && (
          <BroadcastModal
            weekLabel={weekLabel}
            totalShifts={totalShifts}
            staffCount={staffWithShifts}
            broadcasting={broadcasting}
            result={broadcastResult}
            onSend={broadcastSchedule}
            onClose={() => { setShowBroadcastModal(false); setBroadcastResult(null); }}
          />
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </CommanderLayout>
  );
}

// ═══════════════════════════════════════════════════════════════
// ADD SHIFT MODAL
// ═══════════════════════════════════════════════════════════════

function AddShiftModal({ allStaff, defaultDate, defaultStaffId, weekDays, onClose, onSubmit }) {
  const [staffId, setStaffId] = useState(defaultStaffId || '');
  const [date, setDate] = useState(defaultDate || weekDays[0]?.date || '');
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('22:00');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedStaff = allStaff.find(s => s.id === staffId);
  const hours = shiftHours(startTime, endTime);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!staffId || !date || !startTime || !endTime) return;
    setSaving(true);
    await onSubmit({
      staff_id: staffId,
      staff_name: selectedStaff?.display_name || selectedStaff?.name || '',
      staff_role: selectedStaff?.role || 'staff',
      shift_date: date,
      start_time: startTime,
      end_time: endTime,
      notes: notes.trim() || null
    });
    setSaving(false);
  };

  const presets = [
    { label: 'Morning', start: '08:00', end: '16:00' },
    { label: 'Day', start: '10:00', end: '18:00' },
    { label: 'Swing', start: '14:00', end: '22:00' },
    { label: 'Night', start: '18:00', end: '02:00' },
    { label: 'Graveyard', start: '22:00', end: '06:00' },
  ];

  const inputStyle = {
    width: '100%', height: 48, padding: '0 12px', background: '#3A3B3C',
    color: 'white', borderRadius: 8, border: '1px solid #4A4B4C', fontSize: 14,
    outline: 'none', boxSizing: 'border-box'
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: '#242526', borderRadius: 16, width: '100%', maxWidth: 420, border: '2px solid #3A3B3C', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #3A3B3C' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Plus size={20} color="#1877F2" /> Add Shift
          </h2>
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={20} color="#B0B3B8" />
          </button>
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Employee picker */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'white', marginBottom: 4 }}>Employee</label>
            <select value={staffId} onChange={e => setStaffId(e.target.value)} style={{ ...inputStyle, border: '1px solid #4A4B4C' }} required>
              <option value="">Select Employee...</option>
              {allStaff.map(s => (
                <option key={s.id} value={s.id}>
                  {titleCase(s.display_name || s.name || 'Staff')} - {titleCase(s.role || 'staff')}
                </option>
              ))}
            </select>
          </div>

          {/* Date picker */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'white', marginBottom: 4 }}>Date</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
              {weekDays.map(day => (
                <button key={day.date} type="button" onClick={() => setDate(day.date)}
                  style={{
                    padding: '8px 0', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    border: 'none', textAlign: 'center',
                    background: date === day.date ? '#1877F2' : day.isToday ? '#1877F210' : '#3A3B3C',
                    color: date === day.date ? 'white' : day.isToday ? '#1877F2' : '#B0B3B8',
                    outline: day.isToday && date !== day.date ? '1px solid #1877F230' : 'none' }}>
                  <p style={{ margin: 0 }}>{day.label}</p>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>{day.dayNum}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Quick presets */}
          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'white', marginBottom: 4 }}>Quick Presets</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              {presets.map(p => (
                <button key={p.label} type="button"
                  onClick={() => { setStartTime(p.start); setEndTime(p.end); }}
                  style={{
                    padding: '4px 10px', borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    border: startTime === p.start && endTime === p.end ? '1px solid #1877F260' : '1px solid #4A4B4C',
                    background: startTime === p.start && endTime === p.end ? '#1877F2' : '#3A3B3C',
                    color: startTime === p.start && endTime === p.end ? 'white' : '#B0B3B8' }}>
                  {titleCase(p.label)}
                </button>
              ))}
            </div>
          </div>

          {/* Time pickers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#B0B3B8', marginBottom: 4 }}>Start Time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} required />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#B0B3B8', marginBottom: 4 }}>End Time</label>
              <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={inputStyle} required />
            </div>
          </div>

          {hours > 0 && (
            <p style={{ fontSize: 12, color: '#B0B3B8', textAlign: 'center', margin: 0 }}>
              <Clock size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />{hours} hours
            </p>
          )}

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#B0B3B8', marginBottom: 4 }}>Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="e.g., Training shift, Cover for John..."
              style={{ ...inputStyle, height: 40 }} />
          </div>

          {/* Submit */}
          <div style={{ display: 'flex', gap: 12, paddingTop: 4 }}>
            <button type="button" onClick={onClose}
              style={{ flex: 1, height: 48, background: '#3A3B3C', color: 'white', borderRadius: 12, fontWeight: 600, fontSize: 14, border: '1px solid #4A4B4C', cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving || !staffId || !date}
              style={{ flex: 1, height: 48, background: '#1877F2', color: 'white', borderRadius: 12, fontWeight: 600, fontSize: 14, border: '1px solid #1877F280', cursor: 'pointer', opacity: (saving || !staffId || !date) ? 0.5 : 1 }}>
              {saving ? 'Adding...' : 'Add Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// BROADCAST MODAL
// ═══════════════════════════════════════════════════════════════

function BroadcastModal({ weekLabel, totalShifts, staffCount, broadcasting, result, onSend, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }} onClick={onClose}>
      <div style={{ background: '#242526', borderRadius: 16, width: '100%', maxWidth: 380, border: '2px solid #3A3B3C', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid #3A3B3C' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: 'white', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Send size={20} color="#1877F2" /> Send Schedule
          </h2>
          <button onClick={onClose} style={{ padding: 8, borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer' }}>
            <X size={20} color="#B0B3B8" />
          </button>
        </div>

        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ background: '#18191A', borderRadius: 12, padding: 12, textAlign: 'center', border: '1px solid #3A3B3C' }}>
            <p style={{ fontSize: 13, color: '#B0B3B8', margin: '0 0 4px' }}>{weekLabel}</p>
            <p style={{ fontSize: 24, fontWeight: 800, color: 'white', margin: '0 0 4px' }}>{totalShifts} Shifts</p>
            <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>For {staffCount} Employees</p>
          </div>

          <p style={{ fontSize: 13, color: '#B0B3B8', textAlign: 'center', margin: 0 }}>
            Each Employee Will Receive Their Personal Schedule.
          </p>

          {result ? (
            <div style={{ background: '#31A24C15', border: '1px solid #31A24C30', borderRadius: 12, padding: 16, textAlign: 'center' }}>
              <CheckCircle2 size={32} color="#31A24C" style={{ margin: '0 auto 8px' }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: '#31A24C', margin: '0 0 4px' }}>Schedule Sent!</p>
              <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>
                ✓ {result.sent} sent | - {result.skipped} skipped | ✗ {result.failed} failed
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={() => onSend('sms')} disabled={broadcasting}
                style={{ height: 48, background: '#31A24C', color: 'white', borderRadius: 12, fontWeight: 600, fontSize: 14, border: '1px solid #31A24C80', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: broadcasting ? 0.5 : 1 }}>
                {broadcasting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <MessageSquare size={16} />}
                {broadcasting ? 'Sending...' : 'Send Via Text (SMS)'}
              </button>
              <button onClick={() => onSend('email')} disabled={broadcasting}
                style={{ height: 48, background: '#3A3B3C', color: 'white', borderRadius: 12, fontWeight: 600, fontSize: 14, border: '1px solid #4A4B4C', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: broadcasting ? 0.5 : 1 }}>
                <Mail size={16} /> Send Via Email
              </button>
              <button onClick={() => onSend('both')} disabled={broadcasting}
                style={{ height: 40, background: 'transparent', color: '#B0B3B8', borderRadius: 12, fontWeight: 600, fontSize: 12, border: '1px solid #3A3B3C', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                Send Both (SMS + Email)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
