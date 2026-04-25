/**
 * Announcements Display & Management
 * /commander/displays/announcements
 * Dual-purpose: TV display mode + staff management panel
 * SmarterPoker Dark theme • Supabase Realtime • Templates • Scheduling
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../src/lib/supabase';
import { Plus, Edit3, Trash2, X, Send, Loader2, ChevronDown, Settings, Megaphone, RefreshCw } from 'lucide-react';

import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../../src/lib/commander/useCommanderSync';
import DealerTicker from '../../../src/components/commander/shared/DealerTicker';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import { useConfirmAction } from "../../../src/components/commander/shared/ConfirmModal";



const PRIORITY_CONFIG = {
  urgent: { color: '#EF4444', label: 'Urgent', bg: 'rgba(239,68,68,0.15)', bgAlpha: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)', text: '#EF4444', pulse: true },
  high: { color: '#F59E0B', label: 'Important', bg: 'rgba(245,158,11,0.12)', bgAlpha: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', text: '#F59E0B', pulse: false },
  normal: { color: '#1877F2', label: 'Normal', bg: 'rgba(24,119,242,0.08)', bgAlpha: 'rgba(24,119,242,0.08)', border: 'rgba(24,119,242,0.25)', text: '#1877F2', pulse: false },
  low: { color: '#6A6B6D', label: 'Low', bg: 'rgba(255,255,255,0.04)', bgAlpha: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#6A6B6D', pulse: false } };

const ANNOUNCEMENT_TYPES = [
  { value: 'general', label: 'General' },
  { value: 'announcement', label: 'Announcement' },
  { value: 'event', label: 'Event' },
  { value: 'update', label: 'Update' },
  { value: 'urgent', label: 'Urgent Alert' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'maintenance', label: 'Maintenance' },
];

const TEMPLATES = [
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

const TYPE_ICONS = {
  general: '', announcement: '', game_reminder: '', event: '',
  update: '', urgent: '', promotion: '', maintenance: '' };

export default function AnnouncementsDisplay() {

  // ── Toast auto-dismiss ──
  const { requestConfirm, ConfirmDialog } = useConfirmAction();

  useEffect(() => { busEmit.sessionStart('commander-displays-announcements'); }, []);
  // ─── Display state ───
  const [announcements, setAnnouncements] = useState([]);
  const [allAnnouncements, setAllAnnouncements] = useState([]);
  const [roomOpen, setRoomOpen] = useState(true);
  const [now, setNow] = useState(new Date());
  const [currentPage, setCurrentPage] = useState(0);
  const wakeLockRef = useRef(null);

  // ─── Management state ───
  const [showPanel, setShowPanel] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [formData, setFormData] = useState({
    title: '', message: '', priority: 'normal', type: 'general', expires_at: '', starts_at: '' });

  const [venueId] = useState(() => {
    return getVenueId();
  });

  // ── Toast notification state ──
  const [toast, setToast] = useState(null);

  // ── Toast auto-dismiss ──
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // ─── Fetch active announcements (for display) ───
  const fetchData = useCallback(async () => {
    if (!venueId) return;
    try {
      const json = await commanderFetchJSON(`/api/commander/announcements?venue_id=${venueId}`, { });
      if (json.success) setAnnouncements(json.data || []);
    } catch (err) { console.warn(err); }

    try {
      const settingsRes = await commanderFetch(`/api/commander/settings?venue_id=${venueId}`, { });
      if (!settingsRes.ok) throw new Error(`Request failed (${settingsRes.status})`);
      const sj = await settingsRes.json();
      if (sj.success) setRoomOpen(sj.data?.room_open ?? true);
    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }

    setNow(new Date());
  }, [venueId]);

  // ─── Fetch ALL announcements (for management panel, includes scheduled) ───
  const fetchAllAnnouncements = useCallback(async () => {
    if (!venueId) return;
    try {
      const json = await commanderFetchJSON(`/api/commander/announcements?venue_id=${venueId}&include_scheduled=1`, { });
      if (json.success) setAllAnnouncements(json.data || []);
    } catch (err) { console.warn(err); }
  }, [venueId]);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 60000);
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(clock); };
  }, [fetchData]);

  useEffect(() => {
    if (showPanel) fetchAllAnnouncements();
  }, [showPanel, fetchAllAnnouncements]);

  // ─── Supabase Realtime ───
  useEffect(() => {
    if (!venueId) return;
    if (!supabase) return;
    let reconnects = 0;
    const MAX_RECONNECT = 3;
    let currentChannel = null;

    function connectChannel() {
      if (currentChannel) {
        try { supabase.removeChannel(currentChannel); } catch { /* ignore */ }
      }
      const channel = supabase.channel(`announcements-display-${venueId}-${Date.now()}`)
        .on('postgres_changes', {
          event: '*', schema: 'public', table: 'commander_club_announcements',
          filter: `venue_id=eq.${venueId}` }, () => { fetchData(); if (showPanel) fetchAllAnnouncements(); })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            reconnects = 0;
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.warn(`[Announcements] Realtime channel error: ${status}`);
            if (reconnects < MAX_RECONNECT) {
              reconnects++;
              setTimeout(connectChannel, 3000 * reconnects);
            }
          }
        });
      currentChannel = channel;
    }

    connectChannel();
    return () => { if (currentChannel) supabase.removeChannel(currentChannel); };
  }, [venueId, fetchData, showPanel, fetchAllAnnouncements]);

  useCommanderSync(venueId, fetchData, { entities: ['settings'] });

  // ─── Auto-rotate display ───
  const perPage = 4;
  const totalPages = Math.max(1, Math.ceil(announcements.length / perPage));
  useEffect(() => {
    if (totalPages <= 1) return;
    const t = setInterval(() => setCurrentPage(p => (p + 1) % totalPages), 10000);
    return () => clearInterval(t);
  }, [totalPages]);

  // ─── Wake lock ───
  useEffect(() => {
    const req = async () => {
      try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    };
    req();
    const handleVis = () => { if (document.visibilityState === 'visible') req(); };
    document.addEventListener('visibilitychange', handleVis);
    return () => { wakeLockRef.current?.release(); document.removeEventListener('visibilitychange', handleVis); };
  }, []);

  // ─── CRUD operations ───
  const openCreate = () => {
    setFormData({ title: '', message: '', priority: 'normal', type: 'general', expires_at: '', starts_at: '' });
    setEditingAnnouncement(null);
    setShowTemplates(false);
    setShowForm(true);
  };

  const openEdit = (a) => {
    setFormData({
      title: a.title || '', message: a.message || '', priority: a.priority || 'normal',
      type: a.type || a.message_type || 'general',
      expires_at: a.expires_at ? new Date(a.expires_at).toISOString().slice(0, 16) : '',
      starts_at: a.starts_at ? new Date(a.starts_at).toISOString().slice(0, 16) : '' });
    setEditingAnnouncement(a);
    setShowTemplates(false);
    setShowForm(true);
  };

  const applyTemplate = (tpl) => {
    setFormData(p => ({ ...p, title: tpl.title, message: tpl.message, priority: tpl.priority, type: tpl.type }));
    setShowTemplates(false);
  };

  const saveAnnouncement = async () => {
    if (!formData.message.trim()) return setToast({ type: 'error', text: 'Message is required' });
    setSaving(true);
    try {
      const hdrs = { 'Content-Type': 'application/json' };
      const body = {
        ...(editingAnnouncement ? { id: editingAnnouncement.id } : { venue_id: venueId }),
        title: formData.title, message: formData.message, priority: formData.priority, type: formData.type,
        expires_at: formData.expires_at || null, starts_at: formData.starts_at || null };
      const res = await commanderFetch('/api/commander/announcements', {
        method: editingAnnouncement ? 'PATCH' : 'POST', headers: hdrs, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);
      setShowForm(false);
      setEditingAnnouncement(null);
      fetchData(); fetchAllAnnouncements();
      broadcastChange('settings');
    } catch (err) { console.warn(err); setToast({ type: 'error', text: err.message || 'Failed to save' }); }
    finally { setSaving(false); }
  };

  const deleteAnnouncement = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      const res = await commanderFetch(`/api/commander/announcements?id=${id}`, {
        method: 'DELETE' });
      if (res.ok) {
        fetchData(); fetchAllAnnouncements();
        broadcastChange('settings');
      }
    } catch (err) { console.warn(err); setToast({ type: 'error', text: 'Action failed. Please check your connection and try again.' }); }
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = Math.floor((new Date() - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const goFullscreen = () => { if (!showPanel && !showForm) document.documentElement.requestFullscreen?.(); };

  const pageAnnouncements = announcements.slice(currentPage * perPage, (currentPage + 1) * perPage);

  return (
    <CommanderLayout title="Announcements Display" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander — Announcement Display"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <style>{`
        @keyframes pulse-urgent { 0%, 100% { opacity: 1; box-shadow: 0 0 20px rgba(239,68,68,0.3); } 50% { opacity: 0.85; box-shadow: 0 0 40px rgba(239,68,68,0.5); } }
        .urgent-pulse { animation: pulse-urgent 2s ease-in-out infinite; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .announcement-card { animation: fadeIn 0.4s ease-out forwards; }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .mgmt-panel { animation: slideIn 0.3s ease-out; }
      `}</style>

      <div onClick={goFullscreen}
        style={{
          height: '100vh', background: '#18191A', color: '#E4E6EB',
          fontFamily: "var(--font-inter), sans-serif", userSelect: 'none',
          overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* ─── HEADER BAR ─── SmarterPoker Dark */}
        <div style={{
          padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#242526', borderBottom: '1px solid #3A3B3C' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Megaphone size={24} style={{ color: '#1877F2' }} />
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 2, textTransform: 'uppercase', margin: 0, color: '#E4E6EB' }}>
              Announcements
            </h1>
            <span style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, letterSpacing: 1,
              background: roomOpen ? 'rgba(49,162,76,0.2)' : 'rgba(239,68,68,0.2)',
              color: roomOpen ? '#31A24C' : '#EF4444',
              border: `1px solid ${roomOpen ? 'rgba(49,162,76,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
              {roomOpen ? 'ROOM OPEN' : 'ROOM CLOSED'}
            </span>
            {announcements.length > 0 && (
              <span style={{ padding: '4px 12px', borderRadius: 20, background: '#3A3B3C', fontSize: 12, fontWeight: 600, color: '#B0B3B8' }}>
                {announcements.length} Active
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', margin: 0, fontVariantNumeric: 'tabular-nums', color: '#E4E6EB' }}>
                {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
              </p>
              <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>
                {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            {/* ─── MANAGE BUTTON ─── */}
            <button onClick={(e) => { e.stopPropagation(); setShowPanel(!showPanel); }}
              style={{
                padding: '10px 18px', borderRadius: 10, border: '1px solid #3A3B3C', cursor: 'pointer',
                background: showPanel ? '#1877F2' : '#3A3B3C', color: showPanel ? '#fff' : '#B0B3B8',
                display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
                transition: 'all 0.2s' }}>
              <Settings size={16} /> Manage
            </button>
          </div>
        </div>

        {/* ─── MAIN CONTENT ─── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* ─── DISPLAY AREA ─── */}
          <div style={{ flex: 1, padding: 32, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {announcements.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <Megaphone size={64} style={{ color: '#3A3B3C', marginBottom: 16 }} />
                  <p style={{ fontSize: 28, fontWeight: 800, color: '#3A3B3C', margin: '0 0 8px' }}>
                    No Announcements
                  </p>
                  <p style={{ fontSize: 16, color: '#4A4B4C', margin: '0 0 24px' }}>
                    Click Manage to create your first announcement
                  </p>
                  <button onClick={(e) => { e.stopPropagation(); setShowPanel(true); }}
                    style={{
                      padding: '12px 24px', borderRadius: 10, background: '#1877F2', border: 'none',
                      color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                      display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Plus size={16} /> Create Announcement
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {pageAnnouncements.map((a, i) => {
                    const pr = a.priority || 'normal';
                    const cfg = PRIORITY_CONFIG[pr] || PRIORITY_CONFIG.normal;
                    const icon = TYPE_ICONS[a.type || a.message_type] || '';
                    return (
                      <div key={a.id || i}
                        className={`announcement-card ${cfg.pulse ? 'urgent-pulse' : ''}`}
                        style={{
                          background: '#242526', border: `1px solid #3A3B3C`,
                          borderLeft: `4px solid ${cfg.color}`,
                          borderRadius: 14, padding: '24px 28px',
                          animationDelay: `${i * 0.1}s`,
                          flex: 1, display: 'flex', alignItems: 'center', gap: 20 }}>
                        <span style={{ fontSize: 36, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                            {cfg.label && cfg.label !== 'Normal' && cfg.label !== 'Low' && (
                              <span style={{
                                color: cfg.text, fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
                                textTransform: 'uppercase', padding: '3px 10px', borderRadius: 8,
                                background: cfg.bg }}>
                                {cfg.label}
                              </span>
                            )}
                            {a.title && (
                              <span style={{ fontSize: 16, fontWeight: 700, color: '#E4E6EB', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                {a.title}
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 20, fontWeight: 500, margin: 0, lineHeight: 1.4, color: '#B0B3B8' }}>
                            {a.message || a.content}
                          </p>
                        </div>
                        <span style={{ fontSize: 12, color: '#6A6B6D', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {a.created_at ? new Date(a.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
                {totalPages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingTop: 8 }}>
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <div key={i} style={{
                        width: currentPage === i ? 24 : 8, height: 8, borderRadius: 4, transition: 'all 0.3s',
                        background: currentPage === i ? '#1877F2' : '#3A3B3C' }} />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* ─── MANAGEMENT PANEL (Slide-in sidebar) ─── */}
          {showPanel && (
            <div className="mgmt-panel" onClick={(e) => e.stopPropagation()}
              style={{
                width: 400, background: '#242526', borderLeft: '1px solid #3A3B3C',
                display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Panel Header */}
              <div style={{
                padding: '16px 20px', borderBottom: '1px solid #3A3B3C',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#E4E6EB', margin: 0 }}>
                  Manage Announcements
                </h3>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => { fetchAllAnnouncements(); fetchData(); }}
                    style={{ padding: 6, borderRadius: 8, background: '#3A3B3C', border: 'none', color: '#B0B3B8', cursor: 'pointer' }}>
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={openCreate}
                    style={{
                      padding: '6px 14px', borderRadius: 8, background: '#1877F2', border: 'none',
                      color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
                      fontSize: 12, fontWeight: 600 }}>
                    <Plus size={13} /> New
                  </button>
                  <button onClick={() => setShowPanel(false)}
                    style={{ padding: 6, borderRadius: 8, background: '#3A3B3C', border: 'none', color: '#B0B3B8', cursor: 'pointer' }}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* ─── QUICK TEMPLATES ─── */}
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #3A3B3C' }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#6A6B6D', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 8px' }}>
                  Quick Templates
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {TEMPLATES.map((tpl, i) => (
                    <button key={i} onClick={() => { applyTemplate(tpl); setShowForm(true); setEditingAnnouncement(null); }}
                      style={{
                        padding: '8px 10px', borderRadius: 8, background: '#18191A', border: '1px solid #3A3B3C',
                        color: '#E4E6EB', cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500,
                        transition: 'border-color 0.2s' }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = '#1877F2'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = '#3A3B3C'}>
                      <span style={{ fontSize: 16 }}>{tpl.emoji}</span>
                      <span>{tpl.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Panel Content — List of all announcements */}
              <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {allAnnouncements.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
                    <Megaphone size={36} style={{ color: '#3A3B3C' }} />
                    <p style={{ fontSize: 13, color: '#6A6B6D', margin: 0 }}>No announcements yet</p>
                    <button onClick={openCreate}
                      style={{
                        padding: '10px 20px', borderRadius: 10, background: '#1877F2', border: 'none',
                        color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Plus size={14} /> Create First Announcement
                    </button>
                  </div>
                ) : (
                  allAnnouncements.map(a => {
                    const pcfg = PRIORITY_CONFIG[a.priority] || PRIORITY_CONFIG.normal;
                    const isScheduled = a.starts_at && new Date(a.starts_at) > new Date();
                    return (
                      <div key={a.id} style={{
                        background: '#18191A', border: '1px solid #3A3B3C', borderRadius: 12,
                        padding: 12, borderLeft: `3px solid ${pcfg.color}` }}>
                        {/* Badge row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{
                            fontSize: 9, fontWeight: 700, color: pcfg.color, textTransform: 'uppercase',
                            letterSpacing: 0.8, padding: '2px 6px', borderRadius: 4, background: pcfg.bg }}>{pcfg.label}</span>
                          <span style={{
                            fontSize: 9, fontWeight: 600, color: '#6A6B6D', textTransform: 'uppercase',
                            letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.05)' }}>{a.type || 'general'}</span>
                          {isScheduled && (
                            <span style={{
                              fontSize: 9, fontWeight: 700, color: '#A855F7', textTransform: 'uppercase',
                              letterSpacing: 0.5, padding: '2px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.15)' }}>Scheduled</span>
                          )}
                          <span style={{ fontSize: 9, color: '#6A6B6D', marginLeft: 'auto' }}>
                            {isScheduled
                              ? `Starts ${new Date(a.starts_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
                              : formatTime(a.created_at)}
                          </span>
                        </div>
                        {/* Title */}
                        {a.title && <p style={{ fontSize: 13, fontWeight: 700, color: '#E4E6EB', margin: '0 0 2px' }}>{a.title}</p>}
                        {/* Message */}
                        <p style={{ fontSize: 12, color: '#B0B3B8', margin: '0 0 8px', lineHeight: 1.4 }}>
                          {a.message?.length > 100 ? a.message.slice(0, 100) + '...' : a.message}
                        </p>
                        {/* Expires */}
                        {a.expires_at && (
                          <p style={{ fontSize: 10, color: '#6A6B6D', margin: '0 0 8px' }}>
                            Expires: {new Date(a.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </p>
                        )}
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => openEdit(a)}
                            style={{
                              flex: 1, padding: '6px', borderRadius: 6, background: '#3A3B3C', border: 'none',
                              color: '#B0B3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                              fontSize: 11, fontWeight: 600 }}>
                            <Edit3 size={11} /> Edit
                          </button>
                          <button onClick={() => deleteAnnouncement(a.id)}
                            style={{
                              flex: 1, padding: '6px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: 'none',
                              color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                              fontSize: 11, fontWeight: 600 }}>
                            <Trash2 size={11} /> Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Dealer Ticker */}
        <DealerTicker accentColor="#1877F2" bgColor="#242526" fontSize={16} borderColor="#3A3B3C" speed={60} showBorder={true} />

        {/* Bottom bar */}
        <div style={{
          borderTop: '1px solid #3A3B3C', padding: '10px 32px', background: '#242526',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: 13, color: '#6A6B6D', margin: 0 }}>See The Front Desk For Assistance</p>
          <p style={{ fontSize: 11, color: '#4A4B4C', letterSpacing: 1.5, margin: 0 }}>Powered By Smarter.Poker</p>
        </div>
      </div>

      {/* ─── CREATE / EDIT MODAL ─── */}
      {showForm && (
        <div onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
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
              <button onClick={() => { setShowForm(false); setEditingAnnouncement(null); }}
                style={{ background: 'none', border: 'none', color: '#B0B3B8', cursor: 'pointer', padding: 4 }}>
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Template Picker */}
              {!editingAnnouncement && (
                <div>
                  <button onClick={() => setShowTemplates(!showTemplates)}
                    style={{
                      width: '100%', padding: '10px 14px', borderRadius: 10,
                      background: showTemplates ? '#1877F2' : '#3A3B3C',
                      border: 'none', color: showTemplates ? '#fff' : '#B0B3B8',
                      fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    {showTemplates ? 'Hide Templates' : 'Use a Template'}
                    <ChevronDown size={14} style={{ transform: showTemplates ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                  {showTemplates && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10, maxHeight: 200, overflow: 'auto', padding: 2 }}>
                      {TEMPLATES.map((tpl, i) => (
                        <button key={i} onClick={() => applyTemplate(tpl)}
                          style={{
                            padding: '10px 12px', borderRadius: 10, background: '#18191A', border: '1px solid #3A3B3C',
                            color: '#E4E6EB', cursor: 'pointer', textAlign: 'left',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 500 }}>
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
                <input type="text" placeholder="e.g. Happy Hour Starting Now" value={formData.title}
                  onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                    background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                />
              </div>

              {/* Message */}
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Message *
                </label>
                <textarea placeholder="Type your announcement message..." value={formData.message}
                  onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} rows={3}
                  style={{
                    width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C',
                    background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none',
                    resize: 'vertical', fontFamily: 'Inter, sans-serif', boxSizing: 'border-box' }}
                />
              </div>

              {/* Priority + Type */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Priority</label>
                  <select value={formData.priority} onChange={e => setFormData(p => ({ ...p, priority: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C', background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none', cursor: 'pointer' }}>
                    {Object.entries(PRIORITY_CONFIG || {}).map(([val, cfg]) => (
                      <option key={val} value={val}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Type</label>
                  <select value={formData.type} onChange={e => setFormData(p => ({ ...p, type: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C', background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none', cursor: 'pointer' }}>
                    {ANNOUNCEMENT_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Scheduling */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Starts At</label>
                  <input type="datetime-local" value={formData.starts_at}
                    onChange={e => setFormData(p => ({ ...p, starts_at: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C', background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  />
                  <p style={{ fontSize: 10, color: '#6A6B6D', marginTop: 4 }}>Blank = publish now</p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#B0B3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Expires At</label>
                  <input type="datetime-local" value={formData.expires_at}
                    onChange={e => setFormData(p => ({ ...p, expires_at: e.target.value }))}
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid #3A3B3C', background: '#18191A', color: '#E4E6EB', fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  />
                  <p style={{ fontSize: 10, color: '#6A6B6D', marginTop: 4 }}>Blank = no expiration</p>
                </div>
              </div>

              {/* Preview */}
              {formData.message && (
                <div style={{
                  background: (PRIORITY_CONFIG[formData.priority] || PRIORITY_CONFIG.normal).bg,
                  border: `1px solid ${(PRIORITY_CONFIG[formData.priority] || PRIORITY_CONFIG.normal).color}30`,
                  borderRadius: 10, padding: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#6A6B6D', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Preview</p>
                  {formData.title && <p style={{ fontSize: 13, fontWeight: 700, color: '#E4E6EB', margin: '0 0 2px' }}>{formData.title}</p>}
                  <p style={{ fontSize: 13, color: '#B0B3B8', margin: 0 }}>{formData.message}</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', gap: 10, padding: '16px 20px', borderTop: '1px solid #3A3B3C' }}>
              <button onClick={() => { setShowForm(false); setEditingAnnouncement(null); }}
                style={{ flex: 1, padding: '12px', borderRadius: 10, background: '#3A3B3C', border: 'none', color: '#B0B3B8', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveAnnouncement} disabled={saving}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10, background: '#1877F2', border: 'none',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: saving ? 0.6 : 1 }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                {editingAnnouncement ? 'Save Changes' : (formData.starts_at ? 'Schedule' : 'Publish')}
              </button>
            </div>
          </div>
        </div>
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
    
      <ConfirmDialog />
    </CommanderLayout>
  );
}
