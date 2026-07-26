/**
 * Notification & Announcement Center
 * /commander/notifications
 * View all notifications, manage announcements (CRUD)
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Bell, BellOff, CheckCheck, Loader2, RefreshCw, Trash2, Trophy, Users, DollarSign, AlertTriangle, MessageSquare, Star, Plus, Edit3, X, Megaphone, Send, ChevronDown } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { getVenueId } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../src/components/commander/shared/ConfirmModal";

const TYPE_CONFIG = {
  seat_available: { icon: Users, color: '#31A24C', label: 'Seat Available' },
  tournament_starting: { icon: Trophy, color: '#F59E0B', label: 'Tournament' },
  called_for_seat: { icon: Bell, color: '#1877F2', label: 'Called' },
  promotion: { icon: Star, color: '#A855F7', label: 'Promotion' },
  comp_earned: { icon: DollarSign, color: '#31A24C', label: 'Comp Earned' },
  announcement: { icon: MessageSquare, color: '#1877F2', label: 'Announcement' },
  alert: { icon: AlertTriangle, color: '#EF4444', label: 'Alert' },
  custom: { icon: Bell, color: '#B0B3B8', label: 'Notification' }
};

const PRIORITY_CONFIG = {
  urgent: { color: '#EF4444', label: 'Urgent', bg: 'rgba(239,68,68,0.15)' },
  high: { color: '#F59E0B', label: 'Important', bg: 'rgba(245,158,11,0.12)' },
  normal: { color: '#1877F2', label: 'Normal', bg: 'rgba(24,119,242,0.08)' },
  low: { color: '#6A6B6D', label: 'Low', bg: 'rgba(255,255,255,0.04)' } };

const ANNOUNCEMENT_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'event', label: 'Event' },
  { value: 'update', label: 'Update' },
  { value: 'urgent', label: 'Urgent Alert' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'maintenance', label: 'Maintenance' },
];

const ANNOUNCEMENT_TEMPLATES = [
  { emoji: '', name: 'Happy Hour', title: 'Happy Hour', message: 'Happy hour is now in effect! Enjoy drink specials at the bar.', priority: 'high', type: 'promotion' },
  { emoji: '', name: 'High Hand Bonus', title: 'High Hand Bonus', message: 'High hand bonus is active! Check the board for the current qualifying hand and prize amount.', priority: 'high', type: 'promotion' },
  { emoji: '', name: 'Dealer Push', title: 'Dealer Push', message: 'Dealer push in progress. Please have your dealer locks and tips ready.', priority: 'normal', type: 'update' },
  { emoji: '', name: 'Tournament Starting', title: 'Tournament Starting Soon', message: 'Tournament registration is closing soon! Head to the front desk to register.', priority: 'urgent', type: 'event' },
  { emoji: '', name: 'Food Service', title: 'Food Service Available', message: 'Kitchen is now open! Menus available at your table. Flag down your dealer to place an order.', priority: 'normal', type: 'general' },
  { emoji: '', name: 'New Game Opening', title: 'New Game Opening', message: 'A new game is opening! Check with the floor for available seats.', priority: 'high', type: 'announcement' },
  { emoji: '', name: 'Last Call', title: 'Last Call', message: 'Last call for drinks and food. Kitchen closes in 30 minutes.', priority: 'normal', type: 'general' },
  { emoji: '', name: 'Table Maintenance', title: 'Table Maintenance', message: 'A table is temporarily closed for maintenance. Players will be moved to available seats.', priority: 'low', type: 'maintenance' },
  { emoji: '', name: 'Special Promotion', title: 'Special Promotion', message: 'Special promotion running today! Ask the front desk for details.', priority: 'high', type: 'promotion' },
  { emoji: '', name: 'Waitlist Update', title: 'Waitlist Update', message: 'Seats are opening up! If you are on the waitlist, please check in with the front desk.', priority: 'normal', type: 'announcement' },
];

export default function NotificationCenter() {

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-notifications'); }, []);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('notifications');
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [markingAll, setMarkingAll] = useState(false);

  // Announcements state
  const [announcements, setAnnouncements] = useState([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [savingAnnouncement, setSavingAnnouncement] = useState(false);
  const [formData, setFormData] = useState({
    title: '', message: '', priority: 'normal', type: 'general', expires_at: '', starts_at: '' });
  const [showTemplates, setShowTemplates] = useState(false);

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Notifications ───
  const fetchNotifications = useCallback(async (signal) => {
    setLoading(true);
    try {
      const params = filter === 'unread' ? '&unread_only=true' : '';
      const res = await commanderFetch(`/api/commander/notifications/my?limit=100${params}`, { ...(signal ? { signal } : {}) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (json.success) {
        setNotifications(json.data?.notifications || []);
        setUnreadCount(json.data?.unread_count || 0);
      }
    } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => {
    if (activeTab === 'notifications') { const c = new AbortController(); fetchNotifications(c.signal); return () => c.abort(); }
  }, [fetchNotifications, activeTab]);

  const markAsRead = async (id) => {
    try {
      const res = await commanderFetch(`/api/commander/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ read_at: new Date().toISOString() })
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
        broadcastChange('notifications');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const res = await commanderFetch('/api/commander/notifications/mark-all-read', {
        method: 'POST'});
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
        setUnreadCount(0);
        broadcastChange('notifications');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
    finally { setMarkingAll(false); }
  };

  const deleteNotification = async (id) => {
    try {
      const res = await commanderFetch(`/api/commander/notifications/${id}`, {
        method: 'DELETE'});
      if (res.ok) {
        setNotifications(prev => prev.filter(n => n.id !== id));
        broadcastChange('notifications');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  // ─── Announcements ───
  const fetchAnnouncements = useCallback(async () => {
    setAnnouncementsLoading(true);
    try {
      const venueId = getVenueId();
      if (!venueId) return;
      const json = await commanderFetchJSON(`/api/commander/announcements?venue_id=${venueId}&include_scheduled=1`, {});
      if (json.success) setAnnouncements(json.data || []);
    } catch (err) { console.warn(err); }
    finally { setAnnouncementsLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'announcements') fetchAnnouncements();
  }, [activeTab, fetchAnnouncements]);

  // Commander Data Bus — both BroadcastChannel (instant) + Supabase Realtime (cross-device)
  const refreshAll = useCallback(() => {
    fetchNotifications();
    fetchAnnouncements();
  }, [fetchNotifications, fetchAnnouncements]);
  useCommanderSync(getVenueId() || '', refreshAll, { entities: ['notifications', 'announcements'] });

  const openCreateForm = () => {
    setFormData({ title: '', message: '', priority: 'normal', type: 'general', expires_at: '', starts_at: '' });
    setEditingAnnouncement(null);
    setShowTemplates(false);
    setShowCreateForm(true);
  };

  const openEditForm = (a) => {
    setFormData({
      title: a.title || '',
      message: a.message || '',
      priority: a.priority || 'normal',
      type: a.type || a.message_type || 'general',
      expires_at: a.expires_at ? new Date(a.expires_at).toISOString().slice(0, 16) : '',
      starts_at: a.starts_at ? new Date(a.starts_at).toISOString().slice(0, 16) : '' });
    setEditingAnnouncement(a);
    setShowTemplates(false);
    setShowCreateForm(true);
  };

  const applyTemplate = (tpl) => {
    setFormData(prev => ({
      ...prev,
      title: tpl.title,
      message: tpl.message,
      priority: tpl.priority,
      type: tpl.type }));
    setShowTemplates(false);
  };

  const saveAnnouncement = async () => {
    if (!formData.message.trim()) return setToast({ type: 'error', text: 'Message is required' });
    setSavingAnnouncement(true);
    // 2026-07-25 audit fix: datetime-local values are local wall-clock strings;
    // convert to ISO (UTC) before sending
    const startsAtIso = formData.starts_at ? new Date(formData.starts_at).toISOString() : null;
    const expiresAtIso = formData.expires_at ? new Date(formData.expires_at).toISOString() : null;
    try {
      const venueId = getVenueId();
      if (editingAnnouncement) {
        // PATCH
        const res = await commanderFetch('/api/commander/announcements', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingAnnouncement.id,
            title: formData.title,
            message: formData.message,
            priority: formData.priority,
            type: formData.type,
            expires_at: expiresAtIso,
            starts_at: startsAtIso })
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
      } else {
        // POST
        const res = await commanderFetch('/api/commander/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_id: venueId,
            title: formData.title,
            message: formData.message,
            priority: formData.priority,
            type: formData.type,
            expires_at: expiresAtIso,
            starts_at: startsAtIso })
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error);
      }
      setShowCreateForm(false);
      setEditingAnnouncement(null);
      fetchAnnouncements();
      broadcastChange('announcements');
    } catch (err) {
      console.warn(err);
      setToast({ type: 'error', text: err.message || 'Failed to save' });
    }
    finally { setSavingAnnouncement(false); }
  };

  const deleteAnnouncement = async (id) => {
    if (!confirm('Delete this announcement? This cannot be undone.')) return;
    try {
      const json = await commanderFetchJSON(`/api/commander/announcements?id=${id}`, {
        method: 'DELETE'});
      if (json.success) {
        setAnnouncements(prev => prev.filter(a => a.id !== id));
        broadcastChange('announcements');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <CommanderLayout title="Notifications & Announcements" backHref="/commander/dashboard?card=displays">
      <SEOHead
        title="Commander — Notifications & Announcements"
        description="Club Commander Poker Room Management Tool."
        noindex={true}
      />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Tab Header */}
        <div style={{
          display: 'flex', borderBottom: '2px solid #3A3B3C', background: '#242526' }}>
          {[
            { id: 'notifications', label: 'Notifications', icon: Bell, count: unreadCount },
            { id: 'announcements', label: 'Announcements', icon: Megaphone },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: activeTab === tab.id ? '#18191A' : 'transparent',
                borderBottom: activeTab === tab.id ? '3px solid #1877F2' : '3px solid transparent',
                color: activeTab === tab.id ? '#E4E6EB' : '#6A6B6D',
                fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                transition: 'all 0.2s' }}>
              <tab.icon size={16} />
              {tab.label}
              {tab.count > 0 && (
                <span style={{
                  background: '#EF4444', color: '#fff', fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 10, minWidth: 18, textAlign: 'center' }}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ─── NOTIFICATIONS TAB ─── */}
        {activeTab === 'notifications' && (
          <>
            <div className="bg-[#242526] border-b border-[#3A3B3C] px-4 py-3 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-xs text-[#B0B3B8]">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
              </div>
              {unreadCount > 0 && (
                <button onClick={markAllRead} disabled={markingAll}
                  className="px-3 py-2 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-xs font-medium flex items-center gap-1.5 active:bg-[#4A4B4C] disabled:opacity-50">
                  {markingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3 h-3" />}
                  Mark all read
                </button>
              )}
              {/* 2026-07-25 audit fix: do not pass the click event as an AbortSignal */}
              <button onClick={() => fetchNotifications()} className="p-2 rounded-lg active:bg-[#3A3B3C]"><RefreshCw className="w-5 h-5 text-[#B0B3B8]" /></button>
            </div>

            <div className="px-4 py-3 flex gap-2">
              {['all', 'unread'].map(f => (
                <button key={f} onClick={() => setFilter(f)}
                  className={`flex-1 py-2.5 rounded-xl text-xs font-semibold capitalize ${filter === f ? 'bg-[#1877F2] text-white' : 'bg-[#3A3B3C] text-[#B0B3B8] active:bg-[#4A4B4C]'
                    }`}>{f}{f === 'unread' && unreadCount > 0 ? ` (${unreadCount})` : ''}</button>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" /></div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <BellOff className="w-12 h-12 text-[#3A3B3C] mb-3" />
                <p className="text-[#6A6B6D] text-sm">{filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}</p>
              </div>
            ) : (
              <div className="px-4 pb-6">
                <div className="bg-[#242526] border border-[#3A3B3C] rounded-2xl overflow-hidden divide-y divide-[#3A3B3C]">
                  {notifications.map(n => {
                    const cfg = TYPE_CONFIG[n.type] || TYPE_CONFIG.custom;
                    const Icon = cfg.icon;
                    const isUnread = !n.read_at;
                    return (
                      <div key={n.id}
                        onClick={() => isUnread && markAsRead(n.id)}
                        className={`px-4 py-3 flex items-start gap-3 ${isUnread ? 'bg-[#1877F2]/5 cursor-pointer' : ''}`}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: cfg.color + '15' }}>
                          <Icon className="w-5 h-5" style={{ color: cfg.color }} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold uppercase" style={{ color: cfg.color }}>{cfg.label}</span>
                            {isUnread && <span className="w-2 h-2 rounded-full bg-[#1877F2]" />}
                            <span className="text-[10px] text-[#6A6B6D] ml-auto">{formatTime(n.created_at)}</span>
                          </div>
                          {n.title && <p className="text-sm font-medium text-white mt-0.5">{n.title}</p>}
                          <p className="text-sm text-[#B0B3B8] mt-0.5">{n.message || n.body}</p>
                          {n.poker_venues?.name && (
                            <p className="text-[10px] text-[#6A6B6D] mt-1">{n.poker_venues.name}</p>
                          )}
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center active:bg-[#3A3B3C] shrink-0 opacity-40 hover:opacity-100">
                          <Trash2 className="w-3.5 h-3.5 text-[#B0B3B8]" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── ANNOUNCEMENTS TAB ─── */}
        {activeTab === 'announcements' && (
          <>
            <div style={{
              background: '#242526', borderBottom: '1px solid #3A3B3C', padding: '12px 16px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>
                {announcements.length} Active Announcement{announcements.length !== 1 ? 's' : ''}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fetchAnnouncements}
                  style={{
                    padding: '8px', borderRadius: 8, background: '#3A3B3C', border: 'none',
                    color: '#B0B3B8', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <RefreshCw size={16} />
                </button>
                <button onClick={openCreateForm}
                  style={{
                    padding: '8px 14px', borderRadius: 8, background: '#1877F2', border: 'none',
                    color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                    fontSize: 13, fontWeight: 600 }}>
                  <Plus size={15} /> New Announcement
                </button>
              </div>
            </div>

            {announcementsLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Loader2 size={32} style={{ color: '#1877F2' }} className="animate-spin" />
              </div>
            ) : announcements.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 20px' }}>
                <Megaphone size={48} style={{ color: '#3A3B3C', marginBottom: 12 }} />
                <p style={{ fontSize: 16, fontWeight: 600, color: '#6A6B6D', margin: '0 0 4px' }}>No Announcements</p>
                <p style={{ fontSize: 13, color: '#4A4B4C', margin: '0 0 20px' }}>Create an announcement to display on room TVs</p>
                <button onClick={openCreateForm}
                  style={{
                    padding: '10px 20px', borderRadius: 10, background: '#1877F2', border: 'none',
                    color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Plus size={16} /> Create First Announcement
                </button>
              </div>
            ) : (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {announcements.map(a => {
                  const pcfg = PRIORITY_CONFIG[a.priority] || PRIORITY_CONFIG.normal;
                  return (
                    <div key={a.id} style={{
                      background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
                      padding: 16, borderLeft: `4px solid ${pcfg.color}` }}>
                      {/* Header row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: pcfg.color, textTransform: 'uppercase',
                          letterSpacing: 1, padding: '2px 8px', borderRadius: 6, background: pcfg.bg }}>
                          {pcfg.label}
                        </span>
                        <span style={{
                          fontSize: 10, fontWeight: 600, color: '#6A6B6D', textTransform: 'uppercase',
                          letterSpacing: 0.5, padding: '2px 8px', borderRadius: 6, background: 'rgba(255,255,255,0.05)' }}>
                          {a.type || a.message_type || 'general'}
                        </span>
                        {/* Scheduled badge */}
                        {a.starts_at && new Date(a.starts_at) > new Date() && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: '#A855F7', textTransform: 'uppercase',
                            letterSpacing: 0.5, padding: '2px 8px', borderRadius: 6, background: 'rgba(168,85,247,0.15)' }}>
                            Scheduled
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: '#6A6B6D', marginLeft: 'auto' }}>
                          {a.starts_at && new Date(a.starts_at) > new Date()
                            ? `Starts ${new Date(a.starts_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                            : formatTime(a.created_at)
                          }
                        </span>
                      </div>

                      {/* Title */}
                      {a.title && (
                        <p style={{ fontSize: 15, fontWeight: 700, color: '#E4E6EB', margin: '0 0 4px' }}>{a.title}</p>
                      )}

                      {/* Message */}
                      <p style={{ fontSize: 13, color: '#B0B3B8', margin: '0 0 10px', lineHeight: 1.5 }}>
                        {a.message}
                      </p>

                      {/* Expires */}
                      {a.expires_at && (
                        <p style={{ fontSize: 11, color: '#6A6B6D', margin: '0 0 10px' }}>
                          Expires: {new Date(a.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}

                      {/* Actions */}
                      <div style={{ display: 'flex', gap: 8, paddingTop: 8, borderTop: '1px solid #3A3B3C' }}>
                        <button onClick={() => openEditForm(a)}
                          style={{
                            flex: 1, padding: '8px', borderRadius: 8, background: '#3A3B3C', border: 'none',
                            color: '#B0B3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            fontSize: 12, fontWeight: 600 }}>
                          <Edit3 size={13} /> Edit
                        </button>
                        <button onClick={() => deleteAnnouncement(a.id)}
                          style={{
                            flex: 1, padding: '8px', borderRadius: 8, background: 'rgba(239,68,68,0.1)', border: 'none',
                            color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                            fontSize: 12, fontWeight: 600 }}>
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ─── CREATE / EDIT MODAL ─── */}
        {showCreateForm && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
          }}>
            <div style={{
              background: '#242526', borderRadius: 16, width: '100%', maxWidth: 480,
              border: '1px solid #3A3B3C', maxHeight: '90vh', overflow: 'auto' }}>
              {/* Modal Header */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '16px 20px', borderBottom: '1px solid #3A3B3C' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#E4E6EB', margin: 0 }}>
                  {editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
                </h2>
                <button onClick={() => { setShowCreateForm(false); setEditingAnnouncement(null); }}
                  style={{ background: 'none', border: 'none', color: '#B0B3B8', cursor: 'pointer', padding: 4 }}>
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

                {/* Template Picker */}
                {!editingAnnouncement && (
                  <div>
                    <button
                      onClick={() => setShowTemplates(!showTemplates)}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10,
                        background: showTemplates ? '#1877F2' : '#3A3B3C',
                        border: 'none', color: showTemplates ? '#fff' : '#B0B3B8',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        transition: 'all 0.2s' }}>
                      {showTemplates ? 'Hide Templates' : 'Use a Template'}
                      <ChevronDown size={14} style={{ transform: showTemplates ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                    </button>
                    {showTemplates && (
                      <div style={{
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                        marginTop: 10, maxHeight: 200, overflow: 'auto',
                        padding: 2 }}>
                        {ANNOUNCEMENT_TEMPLATES.map((tpl, i) => (
                          <button key={i} onClick={() => applyTemplate(tpl)}
                            style={{
                              padding: '10px 12px', borderRadius: 10,
                              background: '#18191A', border: '1px solid #3A3B3C',
                              color: '#E4E6EB', cursor: 'pointer', textAlign: 'left',
                              display: 'flex', alignItems: 'center', gap: 8,
                              fontSize: 12, fontWeight: 500,
                              transition: 'border-color 0.2s' }}
                            onMouseEnter={e => e.target.style.borderColor = '#1877F2'}
                            onMouseLeave={e => e.target.style.borderColor = '#3A3B3C'}>
                            <span style={{ fontSize: 18 }}>{tpl.emoji}</span>
                            <span>{tpl.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {/* Title */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Title (Optional)
                  </label>
                  <input
                    type="text" placeholder="e.g. Happy Hour Starting Now"
                    value={formData.title}
                    onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                      background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                      boxSizing: 'border-box' }}
                  />
                </div>

                {/* Message */}
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Message *
                  </label>
                  <textarea
                    placeholder="Type your announcement message..."
                    value={formData.message}
                    onChange={e => setFormData(p => ({ ...p, message: e.target.value }))}
                    rows={3}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                      background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                      resize: 'vertical', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Priority + Type side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Priority
                    </label>
                    <select
                      value={formData.priority}
                      onChange={e => setFormData(p => ({ ...p, priority: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                        background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                        cursor: 'pointer' }}>
                      {Object.entries(PRIORITY_CONFIG || {}).map(([val, cfg]) => (
                        <option key={val} value={val}>{cfg.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Type
                    </label>
                    <select
                      value={formData.type}
                      onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                        background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                        cursor: 'pointer' }}>
                      {ANNOUNCEMENT_TYPES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Scheduling: Starts At + Expires At side by side */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Starts At (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.starts_at}
                      onChange={e => setFormData(p => ({ ...p, starts_at: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                        background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                        boxSizing: 'border-box' }}
                    />
                    <p style={{ fontSize: 11, color: '#6A6B6D', marginTop: 4 }}>
                      Leave blank to publish immediately
                    </p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Expires At (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={formData.expires_at}
                      onChange={e => setFormData(p => ({ ...p, expires_at: e.target.value }))}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                        background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                        boxSizing: 'border-box' }}
                    />
                    <p style={{ fontSize: 11, color: '#6A6B6D', marginTop: 4 }}>
                      Leave blank for no expiration
                    </p>
                  </div>
                </div>

                {/* Preview */}
                {formData.message && (
                  <div style={{
                    background: (PRIORITY_CONFIG[formData.priority] || PRIORITY_CONFIG.normal).bg,
                    border: `1px solid ${(PRIORITY_CONFIG[formData.priority] || PRIORITY_CONFIG.normal).color}30`,
                    borderRadius: 10, padding: 12 }}>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#6A6B6D', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                      Preview
                    </p>
                    {formData.title && (
                      <p style={{ fontSize: 13, fontWeight: 700, color: '#E4E6EB', margin: '0 0 2px' }}>{formData.title}</p>
                    )}
                    <p style={{ fontSize: 13, color: '#B0B3B8', margin: 0 }}>{formData.message}</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div style={{
                display: 'flex', gap: 10, padding: '16px 20px', borderTop: '1px solid #3A3B3C' }}>
                <button onClick={() => { setShowCreateForm(false); setEditingAnnouncement(null); }}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, background: '#3A3B3C', border: 'none',
                    color: '#B0B3B8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={saveAnnouncement} disabled={savingAnnouncement}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, background: '#1877F2', border: 'none',
                    color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    opacity: savingAnnouncement ? 0.6 : 1 }}>
                  {savingAnnouncement ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                  {editingAnnouncement ? 'Save Changes' : (formData.starts_at ? 'Schedule' : 'Publish')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
