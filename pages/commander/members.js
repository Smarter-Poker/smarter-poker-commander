import dynamic from 'next/dynamic';
/**
 * Club Commander — Members Page
 * Full member management: list, search, add, scan, detail view
 * NO EMOJIS (per /no-emoji-commander)
 */
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import Image from 'next/image';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Users, UserPlus, ScanLine, Search, Filter, ChevronDown, User, Clock, Loader2, DollarSign, CreditCard } from 'lucide-react';
import AddMemberModal from '../../src/components/commander/members/AddMemberModal';
import ScanMemberModal from '../../src/components/commander/members/ScanMemberModal';
import useDebounce from '../../src/hooks/useDebounce';
import Pagination from '../../src/components/commander/shared/Pagination';
const MemberDetailPanel = dynamic(() => import('../../src/components/commander/members/MemberDetailPanel'), { ssr: false });
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getToken, getStaffSession } from '../../src/lib/commander/clientAuth';

const TIER_COLORS = { daily: '#3B82F6', weekly: '#F59E0B', monthly: '#10B981', yearly: '#A855F7' };
const TIER_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const STATUS_COLORS = { active: '#31A24C', suspended: '#EF4444', expired: '#8A8D91', banned: '#DC2626' };

export default function MembersPage() {
    const router = useRouter();
    const [staff, setStaff] = useState(null);
    const [venueId, setVenueId] = useState(null);
    const [venueName, setVenueName] = useState('');

    // Data
    const [members, setMembers] = useState([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);

    // Filters
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [tierFilter, setTierFilter] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    useEffect(() => { setPage(1); }, [statusFilter, tierFilter]);

    // Modals
    const [showAddModal, setShowAddModal] = useState(false);
    const [showScanModal, setShowScanModal] = useState(false);
    const [selectedMember, setSelectedMember] = useState(null);

    useEffect(() => { busEmit.sessionStart('commander-members'); }, []);

    // Auth
    useEffect(() => {
        const stored = getStaffSession();
        if (!stored) { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); return; }
        try {
            const data = JSON.parse(stored);
            setStaff(data);
            setVenueId(data.venue_id);
            setVenueName(data.venue_name || '');
        } catch { router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e)); }
    }, [router]);

    // SWR-backed members list — auto-revalidates on focus/interval
    const membersKey = venueId ? (() => {
        const params = new URLSearchParams({ venue_id: venueId, page, limit: 50 });
        if (search) params.set('search', search);
        if (statusFilter) params.set('status', statusFilter);
        if (tierFilter) params.set('tier', tierFilter);
        return `/api/commander/members?${params}`;
    })() : null;

    const { data: membersData, isLoading: loading, mutate: fetchMembers } = useSWR(
        membersKey,
        (url) => {
            const token = getToken();
            const staffSession = getStaffSession() || '';
            return fetch(url, { headers: { Authorization: `Bearer ${token}`, 'x-staff-session': staffSession } }).then(r => r.json()).catch(() => null);
        },
        { revalidateOnFocus: true, dedupingInterval: 5000 }
    );

    useEffect(() => {
        if (membersData?.success) {
            setMembers(membersData.data.members || []);
            const fetchedTotal = membersData.data.total || 0;
            setTotal(fetchedTotal);
            // ═══ CRITICAL: Refresh selectedMember with fresh data from API ═══
            setSelectedMember(prev => {
                if (!prev) return null;
                const fresh = (membersData.data.members || []).find(m => m.id === prev.id);
                return fresh || prev;
            });

            const newTotalPages = Math.ceil(fetchedTotal / 50);
            if (page > newTotalPages && newTotalPages > 0) {
                setPage(newTotalPages);
            }
        }
    }, [membersData, page]);

    // Commander Data Bus — sync members across tabs
    useCommanderSync(venueId, fetchMembers, { entities: ['members'] });

    // Search debounce
    const [searchInput, setSearchInput] = useState('');
    const debouncedSearchInput = useDebounce(searchInput, 300);

    useEffect(() => {
        setSearch(debouncedSearchInput);
        setPage(1);
    }, [debouncedSearchInput]);

    const handleMemberCreated = (newMember) => {
        setMembers(prev => [newMember, ...prev]);
        setTotal(prev => prev + 1);
        setSelectedMember(newMember);
        broadcastChange('members');
        busEmit.celebration('confetti');
    };

    const handleMemberUpdated = (updatedMember) => {
        setMembers(prev => prev.map(m => m.id === updatedMember.id ? updatedMember : m));
        setSelectedMember(updatedMember);
        broadcastChange('members');
    };

    return (
        <CommanderLayout title="Members" backHref="/commander/dashboard?card=waitlist">
            <>
                <SEOHead
                    title="Commander — Member Management"
                    description="Club Commander Poker Room Management Tool."
                    noindex={true}
                />

                {!staff ? (
                    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#18191A' }}>
                        <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                    </div>
                ) : (
                    <div className="min-h-screen bg-[#18191A]">
                        {/* Header */}
                        <header className="bg-[#242526] border-b border-[#3A3B3C] sticky top-0 z-30">
                            <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div>
                                        <h1 className="font-bold text-white flex items-center gap-2">
                                            <Users className="w-5 h-5 text-[#1877F2]" /> Members
                                        </h1>
                                        <p className="text-xs text-[#B0B3B8]">{total} total members</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2">
                                    <button onClick={() => setShowScanModal(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-[#3A3B3C] hover:bg-[#4E4F50] text-[#E4E6EB] rounded-lg text-sm font-medium transition-colors">
                                        <ScanLine className="w-4 h-4" /> Scan
                                    </button>
                                    <button onClick={() => setShowAddModal(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-[#1877F2] hover:bg-[#1664d9] text-white rounded-lg text-sm font-medium transition-colors">
                                        <UserPlus className="w-4 h-4" /> Add Member
                                    </button>
                                </div>
                            </div>
                        </header>

                        {/* Search & Filters */}
                        <div className="max-w-6xl mx-auto px-4 py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8D91]" />
                                    <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                                        placeholder="Search By Name, Number, Phone, Or Email..."
                                        className="w-full pl-10 pr-4 py-2.5 bg-[#242526] border border-[#3A3B3C] rounded-lg text-[#E4E6EB] text-sm focus:border-[#1877F2] focus:outline-none placeholder-[#8A8D91]" />
                                </div>
                                <button onClick={() => setShowFilters(!showFilters)}
                                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${showFilters ? 'bg-[#1877F2] text-white' : 'bg-[#242526] border border-[#3A3B3C] text-[#B0B3B8] hover:bg-[#3A3B3C]'}`}>
                                    <Filter className="w-4 h-4" /> Filters
                                </button>
                            </div>

                            {/* Filter Dropdowns */}
                            {showFilters && (
                                <div className="flex gap-3 mt-3">
                                    <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                                        className="px-3 py-2 bg-[#242526] border border-[#3A3B3C] rounded-lg text-[#E4E6EB] text-sm">
                                        <option value="">All Statuses</option>
                                        <option value="active">Active</option>
                                        <option value="suspended">Suspended</option>
                                        <option value="expired">Expired</option>
                                        <option value="banned">Banned</option>
                                    </select>
                                    <select value={tierFilter} onChange={e => { setTierFilter(e.target.value); setPage(1); }}
                                        className="px-3 py-2 bg-[#242526] border border-[#3A3B3C] rounded-lg text-[#E4E6EB] text-sm">
                                        <option value="">All Tiers</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="yearly">Yearly</option>
                                    </select>
                                    {(statusFilter || tierFilter) && (
                                        <button onClick={() => { setStatusFilter(''); setTierFilter(''); setPage(1); }}
                                            className="px-3 py-2 text-[#1877F2] text-sm font-medium">Clear</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Members List */}
                        <div className="max-w-6xl mx-auto px-4 pb-8">
                            {loading ? (
                                <div className="text-center py-16"><Loader2 className="w-8 h-8 text-[#1877F2] animate-spin mx-auto mb-2" /><p className="text-sm text-[#B0B3B8]">Loading Members...</p></div>
                            ) : members.length === 0 ? (
                                <div className="text-center py-16 bg-[#242526] rounded-xl border border-[#3A3B3C]">
                                    <Users className="w-12 h-12 text-[#3A3B3C] mx-auto mb-3" />
                                    <h3 className="text-lg font-medium text-[#E4E6EB] mb-1">{search ? 'No members found' : 'No members yet'}</h3>
                                    <p className="text-sm text-[#B0B3B8] mb-4">{search ? 'Try a different search term' : 'Add your first club member to get started'}</p>
                                    {!search && (
                                        <button onClick={() => setShowAddModal(true)} className="px-6 py-2.5 bg-[#1877F2] text-white rounded-lg text-sm font-medium">
                                            Add First Member
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Desktop Table */}
                                    <div className="hidden md:block bg-[#242526] rounded-xl border border-[#3A3B3C] overflow-hidden">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-[#3A3B3C]">
                                                    <th className="text-left px-4 py-3 text-xs text-[#8A8D91] font-medium uppercase tracking-wider">Member</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#8A8D91] font-medium uppercase tracking-wider">Membership</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#8A8D91] font-medium uppercase tracking-wider">Expires</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#8A8D91] font-medium uppercase tracking-wider">Time Balance</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#8A8D91] font-medium uppercase tracking-wider">Comps</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {members.map(m => {
                                                    const timeMin = m.time_balance_minutes || 0;
                                                    const timeH = Math.floor(timeMin / 60);
                                                    const timeM = timeMin % 60;
                                                    const timeStr = timeMin > 0 ? `${timeH}h ${timeM > 0 ? timeM + 'm' : ''}`.trim() : '0h';
                                                    const compBal = m.comp_balance || 0;
                                                    const memberName = `${m.first_name || ''} ${m.last_name || ''}`.trim();
                                                    const expiresDate = m.membership_expires ? new Date(m.membership_expires) : null;
                                                    const isExpired = expiresDate && expiresDate < new Date();
                                                    const expiresStr = expiresDate
                                                        ? expiresDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                                        : '--';

                                                    return (
                                                        <tr key={m.id} className="border-b border-[#3A3B3C] last:border-0 hover:bg-[#3A3B3C]/30 transition-colors">
                                                            <td className="px-4 py-3 cursor-pointer" onClick={() => setSelectedMember(m)}>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-9 h-9 bg-[#3A3B3C] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                        {m.photo_url ? <Image src={m.photo_url} alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover" /> : <User className="w-4 h-4 text-[#B0B3B8]" />}
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-medium text-[#E4E6EB]">{m.first_name} {m.last_name}</div>
                                                                        <div className="text-xs font-mono text-[#1877F2]">{m.member_number}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            {/* Membership tier — click to go to cashier membership */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="group flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                                                                    title="Click to update membership"
                                                                >
                                                                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (TIER_COLORS[m.membership_tier] || '#B0B3B8') + '20', color: TIER_COLORS[m.membership_tier] || '#B0B3B8' }}>
                                                                        {TIER_LABELS[m.membership_tier] || m.membership_tier || '--'}
                                                                    </span>
                                                                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (STATUS_COLORS[m.membership_status] || '#8A8D91') + '20', color: STATUS_COLORS[m.membership_status] }}>
                                                                        {m.membership_status || '--'}
                                                                    </span>
                                                                    <CreditCard className="w-3 h-3 text-[#8A8D91] opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                </button>
                                                            </td>
                                                            {/* Expires */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="text-sm hover:underline transition-colors"
                                                                    style={{ color: isExpired ? '#EF4444' : '#B0B3B8' }}
                                                                    title="Click to renew membership"
                                                                >
                                                                    {expiresStr}
                                                                </button>
                                                            </td>
                                                            {/* Time Balance — click to add time */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=addtime&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="flex items-center gap-1.5 group hover:opacity-80 transition-opacity"
                                                                    title="Click to add time"
                                                                >
                                                                    <Clock className="w-3.5 h-3.5 text-[#3B82F6]" />
                                                                    <span className={`text-sm font-semibold ${timeMin > 0 ? 'text-[#3B82F6]' : 'text-[#8A8D91]'}`}>{timeStr}</span>
                                                                    <span className="text-[10px] text-[#8A8D91] opacity-0 group-hover:opacity-100 transition-opacity">+ Add</span>
                                                                </button>
                                                            </td>
                                                            {/* Comp Balance */}
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <DollarSign className="w-3.5 h-3.5 text-[#10B981]" />
                                                                    <span className={`text-sm font-semibold ${compBal > 0 ? 'text-[#10B981]' : 'text-[#8A8D91]'}`}>
                                                                        ${Number(compBal).toFixed(2)}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile Cards */}
                                    <div className="md:hidden space-y-2">
                                        {members.map(m => {
                                            const timeMin = m.time_balance_minutes || 0;
                                            const timeH = Math.floor(timeMin / 60);
                                            const timeM = timeMin % 60;
                                            const timeStr = timeMin > 0 ? `${timeH}h ${timeM > 0 ? timeM + 'm' : ''}`.trim() : '0h';
                                            const compBal = m.comp_balance || 0;
                                            const memberName = `${m.first_name || ''} ${m.last_name || ''}`.trim();
                                            const expiresDate = m.membership_expires ? new Date(m.membership_expires) : null;
                                            const isExpired = expiresDate && expiresDate < new Date();
                                            const expiresStr = expiresDate
                                                ? expiresDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                                : '--';

                                            return (
                                                <div key={m.id} className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4 hover:bg-[#3A3B3C]/30 transition-colors">
                                                    {/* Top row — name + member detail */}
                                                    <button onClick={() => setSelectedMember(m)} className="w-full text-left">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <div className="w-10 h-10 bg-[#3A3B3C] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                {m.photo_url ? <Image src={m.photo_url} alt="" width={40} height={40} className="w-10 h-10 rounded-full object-cover" /> : <User className="w-5 h-5 text-[#B0B3B8]" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold text-[#E4E6EB]">{m.first_name} {m.last_name}</div>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (TIER_COLORS[m.membership_tier] || '#B0B3B8') + '20', color: TIER_COLORS[m.membership_tier] || '#B0B3B8' }}>
                                                                        {TIER_LABELS[m.membership_tier] || m.membership_tier || '--'}
                                                                    </span>
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (STATUS_COLORS[m.membership_status] || '#8A8D91') + '20', color: STATUS_COLORS[m.membership_status] }}>
                                                                        {m.membership_status}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <ChevronDown className="w-4 h-4 text-[#8A8D91] -rotate-90" />
                                                        </div>
                                                    </button>
                                                    {/* Bottom row — account data shortcuts */}
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <button
                                                            onClick={() => router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`)}
                                                            className="bg-[#18191A] rounded-lg p-2 text-center hover:bg-[#3A3B3C]/50 transition-colors"
                                                        >
                                                            <div className="text-[10px] text-[#8A8D91] mb-0.5">Expires</div>
                                                            <div className={`text-xs font-bold ${isExpired ? 'text-[#EF4444]' : 'text-[#B0B3B8]'}`}>{expiresStr}</div>
                                                        </button>
                                                        <button
                                                            onClick={() => router.push(`/commander/cashier?action=addtime&member=${encodeURIComponent(memberName)}&member_id=${m.id}`)}
                                                            className="bg-[#18191A] rounded-lg p-2 text-center hover:bg-[#3A3B3C]/50 transition-colors"
                                                        >
                                                            <div className="text-[10px] text-[#8A8D91] mb-0.5">Time</div>
                                                            <div className={`text-xs font-bold flex items-center justify-center gap-1 ${timeMin > 0 ? 'text-[#3B82F6]' : 'text-[#8A8D91]'}`}>
                                                                <Clock className="w-3 h-3" />{timeStr}
                                                            </div>
                                                        </button>
                                                        <div className="bg-[#18191A] rounded-lg p-2 text-center">
                                                            <div className="text-[10px] text-[#8A8D91] mb-0.5">Comps</div>
                                                            <div className={`text-xs font-bold flex items-center justify-center gap-0.5 ${compBal > 0 ? 'text-[#10B981]' : 'text-[#8A8D91]'}`}>
                                                                <DollarSign className="w-3 h-3" />{Number(compBal).toFixed(2)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Pagination */}
                                    <Pagination
                                        className="mt-6"
                                        currentPage={page}
                                        totalPages={Math.ceil(total / 50)}
                                        onPageChange={setPage}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* Modals */}
                <AddMemberModal isOpen={showAddModal} onClose={() => setShowAddModal(false)} onSubmit={handleMemberCreated} venueId={venueId} />
                <ScanMemberModal isOpen={showScanModal} onClose={() => setShowScanModal(false)} venueId={venueId} onMemberFound={(m) => { setShowScanModal(false); setSelectedMember(m); }} />
                {selectedMember && <MemberDetailPanel member={selectedMember} venueName={venueName} onClose={() => setSelectedMember(null)} onUpdate={handleMemberUpdated} />}
                <style>{`
`}</style>
            </>
        </CommanderLayout>
    );
}
