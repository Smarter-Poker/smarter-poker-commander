/**
 * Activity Feed
 * /commander/activity
 * 
 * Real-time log of everything happening in the poker room.
 * Floor managers use this to track:
 * - Player check-ins / check-outs
 * - Table opens / closes
 * - Waitlist movements
 * - Incidents and floor calls
 * - Time purchases / expirations
 * - Announcements sent
 * 
 * Auto-refreshes, filterable by category.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { RefreshCw, Loader2, UserCheck, LogIn, LogOut, Clock, AlertTriangle, Users, DollarSign, Bell, Play, Pause, Timer, XCircle } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession, getVenueId } from '../../src/lib/commander/clientAuth';

const EVENT_TYPES = {
  check_in: { icon: UserCheck, color: '#31A24C', label: 'Check In' },
  check_out: { icon: LogOut, color: '#B0B3B8', label: 'Check Out' },
  seated: { icon: Users, color: '#1877F2', label: 'Seated' },
  removed: { icon: XCircle, color: '#EF4444', label: 'Removed' },
  time_purchased: { icon: DollarSign, color: '#F59E0B', label: 'Time Purchase' },
  time_expired: { icon: Timer, color: '#EF4444', label: 'Time Expired' },
  time_low: { icon: Clock, color: '#F59E0B', label: 'Low Time' },
  table_opened: { icon: Play, color: '#31A24C', label: 'Table Opened' },
  table_closed: { icon: Pause, color: '#B0B3B8', label: 'Table Closed' },
  waitlist_added: { icon: Clock, color: '#1877F2', label: 'Waitlist' },
  waitlist_called: { icon: Bell, color: '#31A24C', label: 'Called' },
  incident: { icon: AlertTriangle, color: '#EF4444', label: 'Incident' },
  floor_call: { icon: AlertTriangle, color: '#F59E0B', label: 'Floor Call' },
  announcement: { icon: Bell, color: '#1877F2', label: 'Announcement' },
  clock_in: { icon: LogIn, color: '#31A24C', label: 'Staff In' },
  clock_out: { icon: LogOut, color: '#B0B3B8', label: 'Staff Out' }
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Math.floor((new Date() - new Date(dateStr)) / 1000);
  if (diff < 60) return 'Just Now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m Ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h Ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function ActivityFeed() {
  useEffect(() => { busEmit.sessionStart('commander-activity'); }, []);
  const router = useRouter();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [now, setNow] = useState(new Date());

  const fetchEvents = useCallback(async () => {
    try {
      const staffSession = getStaffSession();
      if (!staffSession) return;
      let venueId = '';
      try { venueId = JSON.parse(staffSession).venue_id || ''; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
      const headers = { 'x-staff-session': staffSession };

      // Aggregate from multiple sources for the activity feed
      const [incidents, checkins, sessions, waitlist] = await Promise.all([
        fetch(`/api/commander/incidents?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/commander/members?venue_id=${venueId}&limit=20&sort=last_visit`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/commander/time-billing/sessions?venue_id=${venueId}&limit=20`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
        fetch(`/api/commander/waitlist?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({ data: [] }))
      ]);

      const allEvents = [];

      // Incidents → events
      (Array.isArray(incidents.data) ? incidents.data : []).slice(0, 20).forEach(i => {
        allEvents.push({
          id: `inc-${i.id}`,
          type: i.priority === 'high' ? 'incident' : 'floor_call',
          message: i.description || i.type || 'Incident Reported',
          detail: i.table_number ? `Table ${i.table_number}` : '',
          timestamp: i.created_at,
          actor: i.reported_by
        });
      });

      // Recent check-ins
      (Array.isArray(checkins.data) ? checkins.data : []).filter(m => m.last_visit).slice(0, 15).forEach(m => {
        allEvents.push({
          id: `ci-${m.id}`,
          type: 'check_in',
          message: `${m.first_name} ${m.last_name} Checked In`,
          detail: m.membership_tier ? `${m.membership_tier} Member` : '',
          timestamp: m.last_visit
        });
      });

      // Time billing sessions
      (Array.isArray(sessions.data) ? sessions.data : []).slice(0, 15).forEach(s => {
        if (s.status === 'active') {
          allEvents.push({
            id: `sess-${s.id}`,
            type: 'seated',
            message: `${s.player_name || 'Player'} Seated`,
            detail: s.table_number ? `Table ${s.table_number} Seat ${s.seat_number}` : '',
            timestamp: s.started_at || s.created_at
          });
        }
      });

      // Waitlist
      (Array.isArray(waitlist.data) ? waitlist.data : []).slice(0, 15).forEach(w => {
        allEvents.push({
          id: `wl-${w.id}`,
          type: w.status === 'called' ? 'waitlist_called' : 'waitlist_added',
          message: `${w.player_name || w.name || 'Player'} ${w.status === 'called' ? 'Called From' : 'Joined'} Waitlist`,
          detail: w.game_type || '',
          timestamp: w.updated_at || w.created_at
        });
      });

      // Sort by timestamp descending
      allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      setEvents(allEvents.slice(0, 50));
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, []);

  // Commander Data Bus - sync activity feed across tabs
  useCommanderSync(getVenueId(), fetchEvents, { entities: ['members', 'tables', 'waitlist', 'incidents'] });

  // Initial fetch + clock for relative timestamps
  useEffect(() => {
    fetchEvents();
    const clock = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearInterval(clock);
    };
  }, [fetchEvents]);

  const filteredEvents = events.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'players') return ['check_in', 'check_out', 'seated', 'removed'].includes(e.type);
    if (filter === 'time') return ['time_purchased', 'time_expired', 'time_low'].includes(e.type);
    if (filter === 'tables') return ['table_opened', 'table_closed', 'seated', 'removed'].includes(e.type);
    if (filter === 'alerts') return ['incident', 'floor_call', 'time_expired'].includes(e.type);
    return true;
  });

  return (
    <CommanderLayout title="Activity" backHref="/commander/dashboard?card=reports">
      <SEOHead
        title="Commander - Activity Log"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Header */}
        <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg font-bold text-white">Activity Feed</h1>
              <p className="text-xs text-[#B0B3B8]">Real-Time Room Events</p>
            </div>
          </div>
          <button onClick={fetchEvents} className="p-2 rounded-lg active:bg-[#3A3B3C]">
            <RefreshCw className="w-5 h-5 text-[#B0B3B8]" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-4 py-3 flex gap-2 overflow-x-auto">
          {[
            { key: 'all', label: 'All' },
            { key: 'players', label: 'Players' },
            { key: 'tables', label: 'Tables' },
            { key: 'alerts', label: 'Alerts' },
            { key: 'time', label: 'Time' }
          ].map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${filter === f.key ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8]'
                }`}>{f.label}</button>
          ))}
        </div>

        {/* Events */}
        {loading ? (
          <div className="py-20 flex justify-center">
            <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-[#B0B3B8]">No Activity Yet</p>
          </div>
        ) : (
          <div className="px-4 pb-6 space-y-1">
            {filteredEvents.map(event => {
              const config = EVENT_TYPES[event.type] || EVENT_TYPES.check_in;
              const Icon = config.icon;
              return (
                <div key={event.id} className="flex items-start gap-3 py-2.5 border-b border-[#3A3B3C]/50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${config.color}15` }}>
                    <Icon className="w-4 h-4" style={{ color: config.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white">{event.message}</p>
                    {event.detail && <p className="text-xs text-[#B0B3B8]">{event.detail}</p>}
                  </div>
                  <span className="text-[10px] text-[#B0B3B8] flex-shrink-0 pt-0.5">{timeAgo(event.timestamp)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CommanderLayout>
  );
}