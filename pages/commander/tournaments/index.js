/**
 * Commander Tournament Management Page
 * List, create, and manage tournaments
 * SmarterPoker Dark theme • Club Commander standard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Plus, Trophy, Clock, Users, DollarSign, Calendar, Play, ChevronRight, Filter, Loader2, RefreshCw, Sliders, Copy, X } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import CreateTournamentModal from '../../../src/components/commander/modals/CreateTournamentModal';
import Pagination from '../../../src/components/commander/shared/Pagination';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

/* ─── Status Config ─────────────────────────────────────────── */
const STATUS_CONFIG = {
  scheduled: { color: '#B0B3B8', bg: 'rgba(176,179,184,0.12)', label: 'Scheduled' },
  registration: { color: '#1877F2', bg: 'rgba(24,119,242,0.12)', label: 'Registration' },
  registering: { color: '#1877F2', bg: 'rgba(24,119,242,0.12)', label: 'Registration' },
  running: { color: '#31A24C', bg: 'rgba(49,162,76,0.12)', label: 'Running' },
  paused: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'Paused' },
  break: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', label: 'On Break' },
  final_table: { color: '#1877F2', bg: 'rgba(24,119,242,0.12)', label: 'Final Table' },
  completed: { color: '#B0B3B8', bg: 'rgba(176,179,184,0.10)', label: 'Completed' },
  cancelled: { color: '#EF4444', bg: 'rgba(239,68,68,0.10)', label: 'Cancelled' } };

const FILTER_OPTIONS = [
  { value: 'current_future', label: 'Current & Future' },
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/* ─── Helpers ───────────────────────────────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function isToday(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr).toDateString() === new Date().toDateString();
}
// Break-aware level label: current_level is an ARRAY INDEX into blind_structure,
// which interleaves break rows. Count only non-break rows for the display number.
function levelLabel(t) {
  let bs = t?.blind_structure;
  if (typeof bs === 'string') { try { bs = JSON.parse(bs); } catch { bs = []; } }
  if (!Array.isArray(bs)) bs = [];
  const idx = t?.current_level || 0;
  if (!bs.length) return `Level ${idx + 1}`;
  const row = bs[idx];
  if (row?.is_break) return row.label || 'Break';
  return `Level ${bs.slice(0, idx + 1).filter(l => !l.is_break).length}`;
}

/* ─── Inline styles ─────────────────────────────────────────── */
const S = {
  page: { minHeight: '100vh', background: '#18191A', color: '#E4E6EB', fontFamily: "var(--font-inter), sans-serif" },
  panel: {
    background: '#242526', border: '1px solid #3A3B3C', borderRadius: 14,
    transition: 'border-color 0.18s' },
  label: { fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: 1 } };

/* ─── Page ──────────────────────────────────────────────────── */
export default function CommanderTournamentsPage() {
  useEffect(() => { busEmit.sessionStart('commander-tournaments-index'); }, []);
  const router = useRouter();

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('current_future');
  const [showCreateModal, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);

  // Clone modal state
  const [cloneModal, setCloneModal] = useState(null); // source tournament or null
  const [cloneStart, setCloneStart] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [cloneCount, setCloneCount] = useState(1);
  const [cloning, setCloning] = useState(false);

  // Toast state + auto-dismiss
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { setPage(1); }, [filter]);

  // Format a Date as a datetime-local input value (local time, minute precision)
  const toDatetimeLocal = (d) => {
    const pad = (num) => (num < 10 ? '0' + num : String(num));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const openCloneModal = (t) => {
    // Default: same weekday next week at the same time
    const base = t?.scheduled_start ? new Date(t.scheduled_start) : new Date();
    const next = new Date((isNaN(base.getTime()) ? new Date() : base).getTime() + 7 * 24 * 60 * 60 * 1000);
    setCloneStart(toDatetimeLocal(next));
    setCloneName('');
    setCloneCount(1);
    setCloneModal(t);
  };

  const submitClone = async () => {
    if (!cloneModal || !cloneStart || cloning) return;
    const start = new Date(cloneStart);
    if (isNaN(start.getTime())) {
      setToast({ type: 'error', text: 'Enter A Valid Start Date And Time.' });
      return;
    }
    setCloning(true);
    try {
      const body = {
        scheduled_start: start.toISOString(),
        count: cloneCount,
        interval_days: 7
      };
      if (cloneName.trim()) body.name = cloneName.trim();
      const res = await commanderFetch(`/api/commander/tournaments/${cloneModal.id}/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const json = await res.json().catch(() => null);
      if (json?.success) {
        const made = json.data?.tournaments?.length || cloneCount;
        setToast({ type: 'success', text: json.data?.message || `${made} Tournament${made === 1 ? '' : 's'} Created.` });
        setCloneModal(null);
        fetchTournaments(true);
      } else {
        setToast({ type: 'error', text: json?.error?.message || 'Clone Failed.' });
      }
    } catch (err) {
      console.warn('Clone error:', err);
      setToast({ type: 'error', text: 'Clone Failed. Check Console.' });
    } finally {
      setCloning(false);
    }
  };

  /* ─── Init staff session ─── */
  useEffect(() => {
    const raw = getStaffSession();
    if (!raw) { router.push('/commander/login'); return; }
    try {
      const s = JSON.parse(raw);
      if (!s.venue_id) { router.push('/commander/login'); return; }
      setStaff(s);
      setVenueId(s.venue_id);
      if (s.venue_name) setVenue({ id: s.venue_id, name: s.venue_name });
    } catch { router.push('/commander/login'); }
  }, [router]);

  /* ─── Fetch tournaments ─── */
  const fetchTournaments = useCallback(async (showRefreshing = false) => {
    if (!venueId) return;
    if (showRefreshing) setRefreshing(true);
    const controller = new AbortController();
    const { signal } = controller;
    try {
      const params = new URLSearchParams({ venue_id: venueId, limit: '200' });
      if (filter !== 'all') params.set('status', filter);
      const data = await commanderFetchJSON(`/api/commander/tournaments?${params}`);
      if (data.success) setTournaments(data.data.tournaments || []);
    } catch (err) { console.warn('Fetch tournaments:', err); }
    finally { setLoading(false); setRefreshing(false); }
  }, [venueId, filter]);

  useEffect(() => { if (venueId) fetchTournaments(); }, [venueId, fetchTournaments]);

  /* ─── Real-time sync ─── */
  useCommanderSync(venueId, fetchTournaments, { entities: ['tournaments'] });

  /* ─── Computed groups ─── */
  const activeTournaments = useMemo(() => tournaments.filter(t => ['running', 'paused', 'break', 'final_table'].includes(t.status)), [tournaments]);
  const upcomingTournaments = useMemo(() => tournaments.filter(t => ['scheduled', 'registration', 'registering'].includes(t.status)), [tournaments]);
  const completedTournaments = useMemo(() => tournaments.filter(t => ['completed', 'cancelled'].includes(t.status)), [tournaments]);

  const ITEMS_PER_PAGE = 25;
  const filteredTournaments = useMemo(() => {
    switch (filter) {
      case 'active': return activeTournaments;
      case 'upcoming': return upcomingTournaments;
      case 'completed': return completedTournaments;
      case 'current_future': return [...activeTournaments, ...upcomingTournaments];
      case 'all': default: return tournaments;
    }
  }, [tournaments, activeTournaments, upcomingTournaments, completedTournaments, filter]);

  const totalPages = Math.ceil(filteredTournaments.length / ITEMS_PER_PAGE);
  const paginated = useMemo(() => filteredTournaments.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE), [filteredTournaments, page]);

  useEffect(() => {
    if (page > totalPages && totalPages > 0) setPage(totalPages);
  }, [totalPages, page]);

  /* ─── Loading state ─── */
  if (!staff || loading) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={36} style={{ color: '#1877F2', animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  return (
    <CommanderLayout title={`Tournaments | ${venue?.name || 'Commander'}`} backHref="/commander/dashboard?card=tournaments">
      <SEOHead title="Commander - Tournaments" description="Club Commander Tournament Management" noindex={true} />
      <div style={S.page}>

        {/* ── Top Action Bar ── */}
        <div style={{ background: '#242526', borderBottom: '1px solid #3A3B3C', padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(245,158,11,0.12)', border: '1.5px solid rgba(245,158,11,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trophy size={18} style={{ color: '#F59E0B' }} />
            </div>
            <div>
              <h1 style={{ fontSize: 17, fontWeight: 800, color: '#E4E6EB', margin: 0 }}>Tournaments</h1>
              <p style={{ fontSize: 11, color: '#6A6B6D', margin: 0 }}>{venue?.name || 'Club Commander'}</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => fetchTournaments(true)}
              disabled={refreshing}
              style={{ width: 36, height: 36, borderRadius: 10, background: '#3A3B3C', border: 'none', color: '#B0B3B8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              title="Refresh"
            >
              <RefreshCw size={16} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              style={{ padding: '8px 18px', borderRadius: 10, background: '#1877F2', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Plus size={15} /> Create
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 860, margin: '0 auto', padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Tournament Director Shortcut ── */}
          <button
            onClick={() => router.push('/commander/tournament-controls')}
            style={{
              ...S.panel,
              width: '100%', padding: '14px 18px', cursor: 'pointer', textAlign: 'left',
              display: 'flex', alignItems: 'center', gap: 14,
              borderColor: 'rgba(245,158,11,0.3)',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.07) 0%, #242526 60%)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.55)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'; }}
          >
            {/* Icon */}
            <div style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: 'rgba(245,158,11,0.12)', border: '1.5px solid rgba(245,158,11,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <img
                src="/images/commander/icons/tn-controls.png"
                alt="TD"
                style={{ width: 34, height: 34, objectFit: 'contain' }}
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
              />
              <div style={{ display: 'none', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
                <Sliders size={24} style={{ color: '#F59E0B' }} />
              </div>
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 800, color: '#E4E6EB', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>Tournament Director</p>
              <p style={{ fontSize: 12, color: '#8A8D91', margin: 0 }}>Clock · Structure · Payouts · Players · Tables</p>
            </div>

            {/* CTA chip */}
            <div style={{
              padding: '7px 14px', borderRadius: 10, background: '#F59E0B',
              color: '#000', fontSize: 12, fontWeight: 800, flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 5, letterSpacing: 0.3 }}>
              <Sliders size={13} /> Launch TD
            </div>
          </button>

          {/* ── Stats Row ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {[
              { label: 'Active', count: activeTournaments.length, color: '#31A24C', icon: Play, filterKey: 'active' },
              { label: 'Upcoming', count: upcomingTournaments.length, color: '#1877F2', icon: Calendar, filterKey: 'upcoming' },
              { label: 'Completed', count: completedTournaments.length, color: '#F59E0B', icon: Trophy, filterKey: 'completed' },
            ].map(({ label, count, color, icon: Icon, filterKey }) => (
              <button
                key={filterKey}
                onClick={() => { setFilter(filter === filterKey ? 'current_future' : filterKey); setPage(1); }}
                style={{
                  ...S.panel,
                  padding: '14px 10px', textAlign: 'center', cursor: 'pointer', border: 'none',
                  borderLeft: filter === filterKey ? `3px solid ${color}` : '1px solid #3A3B3C',
                  background: filter === filterKey ? `rgba(${color === '#31A24C' ? '49,162,76' : color === '#1877F2' ? '24,119,242' : '245,158,11'},0.08)` : '#242526' }}
              >
                <Icon size={20} style={{ color, marginBottom: 4, display: 'block', margin: '0 auto 6px' }} />
                <p style={{ fontSize: 24, fontWeight: 800, color: '#E4E6EB', margin: '0 0 2px' }}>{count}</p>
                <p style={{ fontSize: 11, color: '#8A8D91', margin: 0 }}>{label}</p>
              </button>
            ))}
          </div>

          {/* ── Filter Pills ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto', paddingBottom: 2 }}>
            <Filter size={14} style={{ color: '#6A6B6D', flexShrink: 0 }} />
            {FILTER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => { setFilter(opt.value); setPage(1); }}
                style={{
                  padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                  fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                  background: filter === opt.value ? '#1877F2' : '#3A3B3C',
                  color: filter === opt.value ? '#fff' : '#B0B3B8',
                  transition: 'background 0.15s' }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* ── Tournament List ── */}
          {tournaments.length === 0 ? (
            <div style={{ ...S.panel, padding: '48px 24px', textAlign: 'center' }}>
              <Trophy size={48} style={{ color: '#3A3B3C', margin: '0 auto 16px', display: 'block' }} />
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#E4E6EB', margin: '0 0 8px' }}>
                {filter === 'all' || filter === 'current_future' ? 'No Tournaments Yet' : `No ${filter.charAt(0).toUpperCase() + filter.slice(1)} Tournaments`}
              </h2>
              <p style={{ fontSize: 13, color: '#8A8D91', margin: '0 0 20px' }}>
                {filter === 'all' || filter === 'current_future'
                  ? 'Create Your First Tournament To Get Started'
                  : 'Try A Different Filter Or Create A New Tournament'}
              </p>
              <button
                onClick={() => setShowCreate(true)}
                style={{ padding: '10px 24px', borderRadius: 10, background: '#1877F2', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Plus size={15} /> Create Tournament
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {paginated.map(t => {
                const st = STATUS_CONFIG[t.status] || STATUS_CONFIG.scheduled;
                const isActive = ['running', 'paused', 'break', 'final_table'].includes(t.status);
                // 2026-07-25 audit fix: rows expose current_entries, not entries_count
                const prize = t.actual_prizepool || (t.current_entries || 0) * (t.buyin_amount || 0);

                return (
                  <button
                    key={t.id}
                    onClick={() => router.push(`/commander/tournaments/${t.id}`)}
                    style={{
                      ...S.panel,
                      width: '100%', padding: '16px 18px', textAlign: 'left', cursor: 'pointer',
                      borderLeft: isActive ? '3px solid #31A24C' : '1px solid #3A3B3C' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = '#1877F2'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = isActive ? '#31A24C' : '#3A3B3C'; }}
                  >
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: '#E4E6EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {t.name}
                          </span>
                          <span style={{ flexShrink: 0, padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, background: st.bg, color: st.color }}>
                            {st.label}
                          </span>
                        </div>
                        <p style={{ fontSize: 12, color: '#8A8D91', margin: 0 }}>
                          {t.tournament_type ? t.tournament_type.charAt(0).toUpperCase() + t.tournament_type.slice(1) : 'NLH'}
                          {t.buyin_amount ? ` · $${t.buyin_amount}` : ''}
                          {t.buyin_fee ? `+$${t.buyin_fee}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                        {/* Card root is a <button>, so the inner action is a span.
                            This page had no route into the TD console at all -
                            the only way in was the detail page or the separate
                            tournament-controls selector. */}
                        <span
                          role="button"
                          tabIndex={0}
                          title="Tournament Director"
                          aria-label="Open Tournament Director"
                          onClick={e => { e.stopPropagation(); router.push(`/commander/td/${t.id}`); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); router.push(`/commander/td/${t.id}`); } }}
                          style={{
                            width: 34, height: 34, borderRadius: 9, background: 'rgba(245,158,11,0.14)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', flexShrink: 0 }}
                        >
                          <Sliders size={15} style={{ color: '#F59E0B' }} />
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          title="Clone Tournament"
                          aria-label="Clone Tournament"
                          onClick={e => { e.stopPropagation(); openCloneModal(t); }}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openCloneModal(t); } }}
                          style={{
                            width: 34, height: 34, borderRadius: 9, background: '#3A3B3C',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', flexShrink: 0 }}
                        >
                          <Copy size={15} style={{ color: '#B0B3B8' }} />
                        </span>
                        <ChevronRight size={18} style={{ color: '#3A3B3C', flexShrink: 0 }} />
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                      {[
                        { icon: Calendar, label: isToday(t.scheduled_start) ? 'Today' : formatDate(t.scheduled_start), sub: formatTime(t.scheduled_start), color: '#B0B3B8' },
                        { icon: Users, label: `${t.current_entries || 0}${t.max_entries ? `/${t.max_entries}` : ''}`, sub: 'Entries', color: '#1877F2' }, // 2026-07-25 audit fix: current_entries
                        { icon: DollarSign, label: `$${(prize || 0).toLocaleString()}`, sub: 'Prize Pool', color: '#31A24C' },
                        { icon: Clock, label: t.starting_chips ? `${(t.starting_chips / 1000).toFixed(0)}K` : '--', sub: 'Chips', color: '#B0B3B8' },
                      ].map(({ icon: Icon, label, sub, color }, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon size={14} style={{ color: '#6A6B6D', flexShrink: 0 }} />
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 700, color, margin: 0 }}>{label}</p>
                            <p style={{ fontSize: 10, color: '#6A6B6D', margin: 0 }}>{sub}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Active live bar */}
                    {isActive && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #3A3B3C', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          <span style={{ fontSize: 12, color: '#8A8D91' }}>{levelLabel(t)}</span>
                          <span style={{ fontSize: 12, color: '#8A8D91' }}>{t.players_remaining || t.current_entries || 0} Remaining</span>{/* 2026-07-25 audit fix: current_entries */}
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#31A24C', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#31A24C', display: 'inline-block', boxShadow: '0 0 6px #31A24C', animation: 'pulse 1.5s infinite' }} />
                          LIVE
                        </span>
                      </div>
                    )}

                    {/* Guaranteed overlay */}
                    {(t.guaranteed_pool > 0 && prize < t.guaranteed_pool) && (
                      <div style={{ marginTop: 8, padding: '4px 10px', background: 'rgba(245,158,11,0.1)', borderRadius: 6, display: 'inline-block' }}>
                        <span style={{ fontSize: 11, color: '#F59E0B', fontWeight: 700 }}>${t.guaranteed_pool.toLocaleString()} GTD</span>
                      </div>
                    )}
                  </button>
                );
              })}

              <Pagination
                className="mt-4"
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.45; } }
      `}</style>

      <CreateTournamentModal
        isOpen={showCreateModal}
        onClose={() => setShowCreate(false)}
        onSubmit={(created, meta) => {
          // Creating a tournament used to discard the row it just made and sit
          // on the list. Go straight to the Tournament Director console, which
          // is where every next action (seat draw, clock, register) lives.
          if (meta?.tableWarning) {
            setToast({ type: 'error', text: meta.tableWarning });
            fetchTournaments(true);
            return;
          }
          if (created?.id) {
            router.push(`/commander/td/${created.id}`);
            return;
          }
          fetchTournaments(true);
        }}
        venueId={venueId}
      />

      {/* ── Clone Tournament Modal ── */}
      {cloneModal && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => !cloning && setCloneModal(null)}
        >
          <div style={{ ...S.panel, width: '100%', maxWidth: 420, padding: 20 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(24,119,242,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Copy size={17} style={{ color: '#1877F2' }} />
                </div>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#E4E6EB', margin: 0 }}>Clone Tournament</h2>
              </div>
              <button onClick={() => !cloning && setCloneModal(null)}
                style={{ width: 34, height: 34, borderRadius: 9, background: '#3A3B3C', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} style={{ color: '#B0B3B8' }} />
              </button>
            </div>
            <p style={{ fontSize: 12, color: '#8A8D91', margin: '0 0 16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Copies The Full Setup Of {cloneModal.name || 'This Tournament'}
            </p>

            <label style={{ ...S.label, display: 'block', marginBottom: 6 }}>New Start Date And Time</label>
            <input
              type="datetime-local"
              value={cloneStart}
              onChange={e => setCloneStart(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', background: '#3A3B3C', border: '1px solid #4A4B4C',
                borderRadius: 10, padding: '12px 14px', color: '#E4E6EB', fontSize: 14,
                fontFamily: 'inherit', marginBottom: 14, colorScheme: 'dark' }}
            />

            <label style={{ ...S.label, display: 'block', marginBottom: 6 }}>Name (Optional)</label>
            <input
              type="text"
              value={cloneName}
              onChange={e => setCloneName(e.target.value)}
              placeholder={cloneModal.name || 'Same As Original'}
              style={{
                width: '100%', boxSizing: 'border-box', background: '#3A3B3C', border: '1px solid #4A4B4C',
                borderRadius: 10, padding: '12px 14px', color: '#E4E6EB', fontSize: 14,
                fontFamily: 'inherit', marginBottom: 14 }}
            />

            <label style={{ ...S.label, display: 'block', marginBottom: 6 }}>Repeat Weekly</label>
            <select
              value={cloneCount}
              onChange={e => setCloneCount(Number(e.target.value) || 1)}
              style={{
                width: '100%', boxSizing: 'border-box', background: '#3A3B3C', border: '1px solid #4A4B4C',
                borderRadius: 10, padding: '12px 14px', color: '#E4E6EB', fontSize: 14,
                fontFamily: 'inherit', marginBottom: 18 }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map(c => (
                <option key={c} value={c}>{c === 1 ? '1 Time (Single Event)' : `${c} Weekly Events`}</option>
              ))}
            </select>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setCloneModal(null)} disabled={cloning}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: '#3A3B3C', border: 'none', color: '#E4E6EB', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={submitClone} disabled={cloning || !cloneStart}
                style={{ flex: 1, padding: '12px 0', borderRadius: 10, background: '#1877F2', border: 'none', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: cloning || !cloneStart ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                {cloning ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Copy size={15} />}
                {cloning ? 'Cloning...' : cloneCount > 1 ? `Create ${cloneCount} Events` : 'Clone'}
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
