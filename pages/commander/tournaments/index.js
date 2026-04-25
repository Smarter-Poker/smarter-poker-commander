/**
 * Commander Tournament Management Page
 * List, create, and manage tournaments
 * SmarterPoker Dark theme • Club Commander standard
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../src/components/seo/SEOHead';
import { Plus, Trophy, Clock, Users, DollarSign, Calendar, Play, ChevronRight, Filter, Loader2, RefreshCw, Sliders } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import CreateTournamentModal from '../../../src/components/commander/modals/CreateTournamentModal';
import Pagination from '../../../src/components/commander/shared/Pagination';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import { getStaffSession } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

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

  useEffect(() => { setPage(1); }, [filter]);

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
      <SEOHead title="Commander — Tournaments" description="Club Commander Tournament Management" noindex={true} />
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
                {filter === 'all' || filter === 'current_future' ? 'No Tournaments Yet' : `No ${filter} tournaments`}
              </h2>
              <p style={{ fontSize: 13, color: '#8A8D91', margin: '0 0 20px' }}>
                {filter === 'all' || filter === 'current_future'
                  ? 'Create your first tournament to get started'
                  : 'Try a different filter or create a new tournament'}
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
                const prize = t.actual_prizepool || (t.entries_count || 0) * (t.buyin_amount || 0);

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
                      <ChevronRight size={18} style={{ color: '#3A3B3C', flexShrink: 0, marginTop: 2 }} />
                    </div>

                    {/* Stats grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                      {[
                        { icon: Calendar, label: isToday(t.scheduled_start) ? 'Today' : formatDate(t.scheduled_start), sub: formatTime(t.scheduled_start), color: '#B0B3B8' },
                        { icon: Users, label: `${t.entries_count || 0}${t.max_entries ? `/${t.max_entries}` : ''}`, sub: 'Entries', color: '#1877F2' },
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
                          <span style={{ fontSize: 12, color: '#8A8D91' }}>Level {t.current_level || 1}</span>
                          <span style={{ fontSize: 12, color: '#8A8D91' }}>{t.players_remaining || t.entries_count || 0} remaining</span>
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
        onSubmit={() => fetchTournaments(true)}
        venueId={venueId}
      />
    </CommanderLayout>
  );
}
