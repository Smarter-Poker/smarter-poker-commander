import dynamic from 'next/dynamic';
/**
 * Club Commander - Members Page
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
import PageBar from '../../src/components/commander/shared/PageBar';
import InlineStyle from '../../src/components/commander/shared/InlineStyle';

const TIER_COLORS = { daily: '#3B82F6', weekly: '#22D3EE', monthly: '#10B981', yearly: '#5AA9FF' };
const TIER_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const STATUS_COLORS = { active: '#31A24C', suspended: '#EF4444', expired: '#9FB3C8', banned: '#DC2626' };

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

    // SWR-backed members list - auto-revalidates on focus/interval
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

    // Commander Data Bus - sync members across tabs
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
                    title="Commander - Member Management"
                    description="Club Commander Poker Room Management Tool."
                    noindex={true}
                />

                {!staff ? (
                    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#040D18' }}>
                        <Loader2 className="w-8 h-8 text-[#86DAFF] animate-spin" />
                    </div>
                ) : (
                    <div className="min-h-screen bg-[#040D18]">
                        {/* Header */}
                        <PageBar
                            title="Members"
                            summary="Your Club's Member Directory. Search By Name, Number, Phone Or Email, Filter By Tier Or Status, And Tap A Member For Their Profile, Balances And History. Scan Reads An ID To Find Or Add A Member."
                            status={`${total} Total Members`}
                            className="bg-[#0A1829] border-b border-[#445E77] sticky top-0 z-30 px-4 py-1.5"
                            innerClassName="max-w-6xl mx-auto"
                        >
                                <div className="flex items-center gap-2">
                                    <button onClick={() => setShowScanModal(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-[#132A42] hover:bg-[#1B3753] text-[#F2F7FF] rounded-lg text-sm font-medium transition-colors">
                                        <ScanLine className="w-4 h-4" /> Scan
                                    </button>
                                    <button onClick={() => setShowAddModal(true)}
                                        className="flex items-center gap-2 px-4 py-2 bg-[#0C55C0] hover:bg-[#0A4AA8] text-white rounded-lg text-sm font-medium transition-colors">
                                        <UserPlus className="w-4 h-4" /> Add Member
                                    </button>
                                </div>
                        </PageBar>

                        {/* Search & Filters */}
                        <div className="max-w-6xl mx-auto px-4 py-4">
                            <div className="flex items-center gap-3">
                                <div className="flex-1 relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9FB3C8]" />
                                    <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                                        placeholder="Search By Name, Number, Phone, Or Email..."
                                        className="w-full pl-10 pr-4 py-2.5 bg-[#0A1829] border border-[#445E77] rounded-lg text-[#F2F7FF] text-sm focus:border-[#1981EC] focus:outline-none placeholder-[#9FB3C8]" />
                                </div>
                                <button onClick={() => setShowFilters(!showFilters)}
                                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${showFilters ? 'bg-[#0C55C0] text-white' : 'bg-[#0A1829] border border-[#445E77] text-[#BDD0E2] hover:bg-[#132A42]'}`}>
                                    <Filter className="w-4 h-4" /> Filters
                                </button>
                            </div>

                            {/* Filter Dropdowns */}
                            {showFilters && (
                                <div className="flex gap-3 mt-3">
                                    <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                                        className="px-3 py-2 bg-[#0A1829] border border-[#445E77] rounded-lg text-[#F2F7FF] text-sm">
                                        <option value="">All Statuses</option>
                                        <option value="active">Active</option>
                                        <option value="suspended">Suspended</option>
                                        <option value="expired">Expired</option>
                                        <option value="banned">Banned</option>
                                    </select>
                                    <select value={tierFilter} onChange={e => { setTierFilter(e.target.value); setPage(1); }}
                                        className="px-3 py-2 bg-[#0A1829] border border-[#445E77] rounded-lg text-[#F2F7FF] text-sm">
                                        <option value="">All Tiers</option>
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                        <option value="yearly">Yearly</option>
                                    </select>
                                    {(statusFilter || tierFilter) && (
                                        <button onClick={() => { setStatusFilter(''); setTierFilter(''); setPage(1); }}
                                            className="px-3 py-2 text-[#86DAFF] text-sm font-medium">Clear</button>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Members List */}
                        <div className="max-w-6xl mx-auto px-4 pb-8">
                            {loading ? (
                                <div className="text-center py-16"><Loader2 className="w-8 h-8 text-[#86DAFF] animate-spin mx-auto mb-2" /><p className="text-sm text-[#BDD0E2]">Loading Members...</p></div>
                            ) : members.length === 0 ? (
                                <div className="text-center py-16 bg-[#0A1829] rounded-xl border border-[#445E77]">
                                    <Users className="w-12 h-12 text-[#7F97B0] mx-auto mb-3" />
                                    <h3 className="text-lg font-medium text-[#F2F7FF] mb-1">{search ? 'No Members Found' : 'No Members Yet'}</h3>
                                    <p className="text-sm text-[#BDD0E2] mb-4">{search ? 'Try A Different Search Term' : 'Add Your First Club Member To Get Started'}</p>
                                    {!search && (
                                        <button onClick={() => setShowAddModal(true)} className="px-6 py-2.5 bg-[#0C55C0] text-white rounded-lg text-sm font-medium">
                                            Add First Member
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <>
                                    {/* Desktop Table */}
                                    <div className="hidden md:block bg-[#0A1829] rounded-xl border border-[#445E77] overflow-hidden">
                                        <table className="w-full">
                                            <thead>
                                                <tr className="border-b border-[#445E77]">
                                                    <th className="text-left px-4 py-3 text-xs text-[#9FB3C8] font-medium uppercase tracking-wider">Member</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#9FB3C8] font-medium uppercase tracking-wider">Membership</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#9FB3C8] font-medium uppercase tracking-wider">Expires</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#9FB3C8] font-medium uppercase tracking-wider">Time Balance</th>
                                                    <th className="text-left px-4 py-3 text-xs text-[#9FB3C8] font-medium uppercase tracking-wider">Comps</th>
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
                                                        <tr key={m.id} className="border-b border-[#445E77] last:border-0 hover:bg-[#132A42]/30 transition-colors">
                                                            <td className="px-4 py-3 cursor-pointer" onClick={() => setSelectedMember(m)}>
                                                                <div className="flex items-center gap-3">
                                                                    <div className="w-9 h-9 bg-[#132A42] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                        {m.photo_url ? <Image src={m.photo_url} alt="" width={36} height={36} className="w-9 h-9 rounded-full object-cover" /> : <User className="w-4 h-4 text-[#BDD0E2]" />}
                                                                    </div>
                                                                    <div>
                                                                        <div className="text-sm font-medium text-[#F2F7FF]">{m.first_name} {m.last_name}</div>
                                                                        <div className="text-xs font-mono text-[#86DAFF]">{m.member_number}</div>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            {/* Membership tier - click to go to cashier membership */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="group flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                                                                    title="Click To Update Membership"
                                                                >
                                                                    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (TIER_COLORS[m.membership_tier] || '#BDD0E2') + '20', color: TIER_COLORS[m.membership_tier] || '#BDD0E2' }}>
                                                                        {TIER_LABELS[m.membership_tier] || m.membership_tier || '--'}
                                                                    </span>
                                                                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (STATUS_COLORS[m.membership_status] || '#9FB3C8') + '20', color: STATUS_COLORS[m.membership_status] }}>
                                                                        {m.membership_status || '--'}
                                                                    </span>
                                                                    <CreditCard className="w-3 h-3 text-[#9FB3C8] opacity-0 group-hover:opacity-100 transition-opacity" />
                                                                </button>
                                                            </td>
                                                            {/* Expires */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="text-sm hover:underline transition-colors"
                                                                    style={{ color: isExpired ? '#EF4444' : '#BDD0E2' }}
                                                                    title="Click To Renew Membership"
                                                                >
                                                                    {expiresStr}
                                                                </button>
                                                            </td>
                                                            {/* Time Balance - click to add time */}
                                                            <td className="px-4 py-3">
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); router.push(`/commander/cashier?action=addtime&member=${encodeURIComponent(memberName)}&member_id=${m.id}`); }}
                                                                    className="flex items-center gap-1.5 group hover:opacity-80 transition-opacity"
                                                                    title="Click To Add Time"
                                                                >
                                                                    <Clock className="w-3.5 h-3.5 text-[#3B82F6]" />
                                                                    <span className={`text-sm font-semibold ${timeMin > 0 ? 'text-[#3B82F6]' : 'text-[#9FB3C8]'}`}>{timeStr}</span>
                                                                    <span className="text-[10px] text-[#9FB3C8] opacity-0 group-hover:opacity-100 transition-opacity">+ Add</span>
                                                                </button>
                                                            </td>
                                                            {/* Comp Balance */}
                                                            <td className="px-4 py-3">
                                                                <div className="flex items-center gap-1.5">
                                                                    <DollarSign className="w-3.5 h-3.5 text-[#10B981]" />
                                                                    <span className={`text-sm font-semibold ${compBal > 0 ? 'text-[#10B981]' : 'text-[#9FB3C8]'}`}>
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
                                                <div key={m.id} className="bg-[#0A1829] rounded-xl border border-[#445E77] p-4 hover:bg-[#132A42]/30 transition-colors">
                                                    {/* Top row - name + member detail */}
                                                    <button onClick={() => setSelectedMember(m)} className="w-full text-left">
                                                        <div className="flex items-center gap-3 mb-3">
                                                            <div className="w-10 h-10 bg-[#132A42] rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                                {m.photo_url ? <Image src={m.photo_url} alt="" width={40} height={40} className="w-10 h-10 rounded-full object-cover" /> : <User className="w-5 h-5 text-[#BDD0E2]" />}
                                                            </div>
                                                            <div className="flex-1 min-w-0">
                                                                <div className="text-sm font-semibold text-[#F2F7FF]">{m.first_name} {m.last_name}</div>
                                                                <div className="flex items-center gap-2 mt-0.5">
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (TIER_COLORS[m.membership_tier] || '#BDD0E2') + '20', color: TIER_COLORS[m.membership_tier] || '#BDD0E2' }}>
                                                                        {TIER_LABELS[m.membership_tier] || m.membership_tier || '--'}
                                                                    </span>
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                                                        style={{ backgroundColor: (STATUS_COLORS[m.membership_status] || '#9FB3C8') + '20', color: STATUS_COLORS[m.membership_status] }}>
                                                                        {m.membership_status}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <ChevronDown className="w-4 h-4 text-[#9FB3C8] -rotate-90" />
                                                        </div>
                                                    </button>
                                                    {/* Bottom row - account data shortcuts */}
                                                    <div className="grid grid-cols-3 gap-2">
                                                        <button
                                                            onClick={() => router.push(`/commander/cashier?action=membership&member=${encodeURIComponent(memberName)}&member_id=${m.id}`)}
                                                            className="bg-[#040D18] rounded-lg p-2 text-center hover:bg-[#132A42]/50 transition-colors"
                                                        >
                                                            <div className="text-[10px] text-[#9FB3C8] mb-0.5">Expires</div>
                                                            <div className={`text-xs font-bold ${isExpired ? 'text-[#EF4444]' : 'text-[#BDD0E2]'}`}>{expiresStr}</div>
                                                        </button>
                                                        <button
                                                            onClick={() => router.push(`/commander/cashier?action=addtime&member=${encodeURIComponent(memberName)}&member_id=${m.id}`)}
                                                            className="bg-[#040D18] rounded-lg p-2 text-center hover:bg-[#132A42]/50 transition-colors"
                                                        >
                                                            <div className="text-[10px] text-[#9FB3C8] mb-0.5">Time</div>
                                                            <div className={`text-xs font-bold flex items-center justify-center gap-1 ${timeMin > 0 ? 'text-[#3B82F6]' : 'text-[#9FB3C8]'}`}>
                                                                <Clock className="w-3 h-3" />{timeStr}
                                                            </div>
                                                        </button>
                                                        <div className="bg-[#040D18] rounded-lg p-2 text-center">
                                                            <div className="text-[10px] text-[#9FB3C8] mb-0.5">Comps</div>
                                                            <div className={`text-xs font-bold flex items-center justify-center gap-0.5 ${compBal > 0 ? 'text-[#10B981]' : 'text-[#9FB3C8]'}`}>
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
                <InlineStyle css={`
`} />
            </>
        </CommanderLayout>
    );
}
