/**
 * Tournament Director - Add Player / Re-Entry
 * /commander/td/[tournamentId]/register
 * Lets the TD register a new entrant or process a re-entry for the
 * tournament directly from the floor. Posts to the shared register
 * endpoint used by the cashier flow.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../../../src/components/seo/SEOHead';
import CommanderLayout from '../../../../src/components/commander/shared/CommanderLayout';
import { Trophy, Search, Users, Loader2, CheckCircle2, AlertTriangle, DollarSign, UserPlus, RotateCcw, X, Printer, ListChecks } from 'lucide-react';
import { busEmit } from '../../../../src/engine/EventBus';
import useDebounce from '../../../../src/hooks/useDebounce';
import { getStaffData } from '../../../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../../../src/lib/commander/commanderFetch';
import { broadcastChange } from '../../../../src/lib/commander/useCommanderSync';

export default function TDRegisterPlayer() {
    const router = useRouter();
    const { tournamentId, reentry } = router.query;
    useEffect(() => { busEmit.sessionStart('commander-td-tournamentId-register'); }, []);

    const [venueId, setVenueId] = useState(null);
    const [tournament, setTournament] = useState(null);
    const [loading, setLoading] = useState(true);
    const [registering, setRegistering] = useState(false);
    const [message, setMessage] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [reentryName, setReentryName] = useState(null);
    // The busted entry this re-entry replaces. Sent to the register API as
    // reentry_of so the NEW entry row is linked to it. Without this the API
    // cannot tell a re-entry from a first-time registration, and the two rows
    // for the same player were never connected.
    const [reentryOf, setReentryOf] = useState(null);
    // The register endpoint returns seat_assignment / is_alternate and this
    // screen threw both away, so the TD registered a player and was never told
    // where they were sitting. The cashier screen has always shown it.
    const [lastResult, setLastResult] = useState(null);
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    // ── Cash waitlist conversion ──
    // "The 2/5 is not going to run, put them all in the 7 o'clock" used to mean
    // typing every name into the search above. These are the room's waiting
    // cash players; ticking them registers them into this tournament through
    // the same registration path (buy-in, cash drawer, seat draw, receipts).
    const [waitlist, setWaitlist] = useState([]);
    const [waitlistLoading, setWaitlistLoading] = useState(false);
    const [waitlistOpen, setWaitlistOpen] = useState(false);
    const [selectedWaitlist, setSelectedWaitlist] = useState([]);
    const [converting, setConverting] = useState(false);
    const [convertResult, setConvertResult] = useState(null);

    useEffect(() => {
        try {
            const s = getStaffData();
            if (s?.venue_id) setVenueId(s.venue_id);
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }, []);

    // Load tournament header info + resolve the re-entry player name (if any)
    const fetchTournament = useCallback(async (signal) => {
        if (!router.isReady || !tournamentId) return;
        try {
            // Payload split: the registration screen renders the tournament
            // header, and reads the entry list only to resolve the name behind
            // a ?reentry=<entry_id> deep link.
            const res = await commanderFetch(
                `/api/commander/tournaments/${tournamentId}/floor-view?include=tournament${reentry ? ',entries' : ''}`,
                { ...(signal ? { signal } : {}) }
            );
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            if (json.success) {
                setTournament(json.data.tournament);
                if (reentry && json.data.entries) {
                    const prior = json.data.entries.find(e => e.entry_id === reentry);
                    if (prior) {
                        setReentryName(prior.player_name);
                        setReentryOf(prior.entry_id);
                        setSearchQuery(prior.player_name || '');
                    }
                }
            }
        } catch (err) { if (err.name !== 'AbortError') console.warn(err); }
        finally { setLoading(false); }
    }, [router.isReady, tournamentId, reentry]);

    useEffect(() => { const _c = new AbortController(); fetchTournament(_c.signal); return () => _c.abort(); }, [fetchTournament]);

    // Player search - mirrors the cashier registration flow
    const executeSearch = useCallback(async (query) => {
        const vid = venueId || tournament?.venue_id;
        if (!query || query.length < 2 || !vid) { setSearchResults([]); return; }
        setSearchLoading(true);
        try {
            const res = await commanderFetch(`/api/commander/members/search?q=${encodeURIComponent(query)}&venue_id=${vid}&limit=8`);
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            setSearchResults(json.data || []);
        } catch { setSearchResults([]); }
        finally { setSearchLoading(false); }
    }, [venueId, tournament]);

    useEffect(() => {
        if (debouncedSearchQuery && debouncedSearchQuery.length >= 2) {
            executeSearch(debouncedSearchQuery);
        } else {
            setSearchResults([]);
        }
    }, [debouncedSearchQuery, executeSearch]);

    const selectPlayer = (m) => {
        const name = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
        setSelectedPlayer({ id: m.id, player_name: name, phone: m.phone || '' });
        setSearchQuery('');
        setSearchResults([]);
    };

    /**
     * Queue the 3-copy buy-in receipt on the floor print station.
     *
     * The cashier screen (tournament-registration.js) opens print popups
     * itself. This screen runs on a TD tablet, which usually has no printer
     * and blocks popups, so the job goes to the queue instead and the station
     * renders a byte-identical receipt from the same template.
     */
    const queueBuyinReceipt = async ({ playerName, playerId, tableNumber, seatNumber }) => {
        const cfg = tournament?.settings?.receipts || { player: true, dealer: true, cage: true };
        const copies = [];
        if (cfg.player !== false) copies.push('PLAYER COPY');
        if (cfg.dealer !== false) copies.push('DEALER COPY');
        if (cfg.cage !== false) copies.push('CASHIER COPY');
        if (copies.length === 0) return;

        let staff = {};
        try { staff = getStaffData() || {}; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
        // PIN terminal sessions carry no venue_name; the venue blob does.
        let venue = {};
        try { venue = JSON.parse(localStorage.getItem('commander_venue') || '{}') || {}; }
        catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
        const receiptNum = String(Date.now()).slice(-4);
        const timestamp = new Date().toISOString();

        // snake_case keys - buildBuyinReceiptHtml accepts either shape, and the
        // print station renders the queued payload directly.
        const receipts = copies.map(copyLabel => ({
            copyLabel,
            venue_name: staff.venue_name || venue.name || '',
            venue_city: staff.venue_city || venue.city || '',
            venue_state: staff.venue_state || venue.state || '',
            tournament_name: tournament?.name || 'Tournament',
            scheduled_start: tournament?.scheduled_start || null,
            player_name: playerName,
            player_id: playerId || '',
            buyin_amount: tournament?.buyin_amount || 0,
            buyin_fee: tournament?.buyin_fee || 0,
            table_number: tableNumber || '',
            seat_number: seatNumber || '',
            staff_name: staff.name || staff.display_name || '',
            receipt_num: receiptNum,
            timestamp
        }));

        try {
            const res = await commanderFetch('/api/commander/print-jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_type: 'buyin',
                    tournament_id: tournamentId,
                    receipts,
                    title: `Buy-In Receipt, ${playerName}`,
                    source: 'td_register'
                })
            });
            const json = await res.json().catch(() => null);
            if (!res.ok || !json?.success) {
                console.warn('[td/register] print job failed:', json?.error?.message);
                return false;
            }
            return true;
        } catch (err) {
            console.warn('[td/register] print job failed:', err?.message || err);
            return false;
        }
    };

    const registerPlayer = async () => {
        if (!selectedPlayer) { setMessage({ type: 'error', text: 'Select A Player First' }); return; }
        setRegistering(true);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player_id: selectedPlayer.id,
                    player_name: selectedPlayer.player_name,
                    // Only sent on a real re-entry. The API validates that the
                    // original entry belongs to this player and is eliminated,
                    // then creates a NEW entry and leaves the busted one (and
                    // its finish position and payout) untouched.
                    ...(reentryOf ? { reentry_of: reentryOf } : {})
                })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                const errMsg = json.error?.message || json.error || 'Registration Failed';
                setMessage({ type: 'error', text: errMsg });
                return;
            }

            const playerName = selectedPlayer.player_name;
            const playerId = selectedPlayer.id;
            const entry = json.data?.entry || {};
            const seat = json.data?.seat_assignment || null;
            const isAlternate = !!json.data?.is_alternate;
            const tableNumber = seat?.table_number ?? entry.table_number ?? '';
            const seatNumber = seat?.seat_number ?? entry.seat_number ?? '';
            const buyin = tournament?.buyin_amount || 0;

            setLastResult({
                playerName, isAlternate, tableNumber, seatNumber,
                reentry: !!reentryName,
                printed: false
            });
            setMessage({
                type: 'success',
                text: isAlternate
                    ? `${playerName} Added To The Alternates List. Field Is Full.`
                    : tableNumber && seatNumber
                        ? `${playerName} ${reentryName ? 'Re-Entered' : 'Registered'}, Table ${tableNumber} Seat ${seatNumber}`
                        : `${playerName} ${reentryName ? 'Re-Entered' : 'Registered'}${buyin > 0 ? `, $${buyin.toLocaleString()} Buy-In` : ''}`
            });

            const printed = await queueBuyinReceipt({ playerName, playerId, tableNumber, seatNumber });
            setLastResult(prev => (prev ? { ...prev, printed: !!printed } : prev));

            broadcastChange('tournaments');
            setSelectedPlayer(null);
            setReentryName(null);
            setReentryOf(null);
        } catch (err) {
            console.warn('Registration error:', err);
            setMessage({ type: 'error', text: 'Network Error. Try Again.' });
        } finally {
            setRegistering(false);
        }
    };

    // ── Waitlist: load, select, convert ──
    const fetchWaitlist = useCallback(async () => {
        const vid = venueId || tournament?.venue_id;
        if (!vid) return;
        setWaitlistLoading(true);
        try {
            const res = await commanderFetch(`/api/commander/waitlist?venue_id=${vid}`);
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            setWaitlist(Array.isArray(json?.data) ? json.data : []);
        } catch (err) {
            console.warn('[td/register] waitlist load failed:', err?.message || err);
            setWaitlist([]);
        } finally { setWaitlistLoading(false); }
    }, [venueId, tournament]);

    const toggleWaitlistOpen = () => {
        const next = !waitlistOpen;
        setWaitlistOpen(next);
        if (next && waitlist.length === 0) fetchWaitlist();
    };

    const toggleWaitlistRow = (id) => {
        setSelectedWaitlist(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]));
    };

    const convertWaitlist = async () => {
        if (selectedWaitlist.length === 0) return;
        setConverting(true);
        setConvertResult(null);
        try {
            const res = await commanderFetch(`/api/commander/tournaments/${tournamentId}/convert-waitlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ waitlist_ids: selectedWaitlist })
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json.success) {
                setMessage({ type: 'error', text: json.error?.message || 'Waitlist Conversion Failed' });
                return;
            }
            setConvertResult(json.data);
            setMessage({ type: 'success', text: json.data?.message || 'Waitlist Converted.' });
            setSelectedWaitlist([]);
            broadcastChange('tournaments');
            await fetchWaitlist();
        } catch (err) {
            console.warn('[td/register] conversion failed:', err?.message || err);
            setMessage({ type: 'error', text: 'Network Error. Try Again.' });
        } finally { setConverting(false); }
    };

    useEffect(() => {
        if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }
    }, [message]);

    if (loading) return <div style={{ minHeight: '100vh', background: '#18191A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Loader2 size={32} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} /></div>;

    return (
        <CommanderLayout title="Commander - Register Player" backHref={`/commander/td/${tournamentId}`}>
            <SEOHead title="Commander - Register Player" description="Club Commander Poker Room Management Tool." noindex={true} />
            <div style={{ minHeight: '100vh', background: '#18191A', color: '#E4E6EB', fontFamily: "var(--font-inter), -apple-system, sans-serif", padding: '16px' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(24,119,242,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {reentryName ? <RotateCcw size={20} color="#1877F2" /> : <UserPlus size={20} color="#1877F2" />}
                    </div>
                    <div>
                        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{reentryName ? 'Re-Entry' : 'Add Player'}</h1>
                        <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>{tournament?.name || 'Tournament'}</p>
                    </div>
                </div>

                {/* Re-Entry banner */}
                {reentryName && (
                    <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(49,162,76,0.15)', color: '#31A24C', fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <RotateCcw size={16} />
                        Re-Entering {reentryName}. Confirm The Player Below.
                    </div>
                )}

                {/* Message Toast */}
                {message && (
                    <div style={{
                        padding: '12px 16px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, fontWeight: 600, marginBottom: 12,
                        background: message.type === 'success' ? 'rgba(49,162,76,0.15)' : 'rgba(240,40,73,0.15)',
                        color: message.type === 'success' ? '#31A24C' : '#F02849' }}>
                        {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                        {message.text}
                    </div>
                )}

                {/* Seat assignment receipt - what the register endpoint actually returned */}
                {lastResult && (
                    <div style={{
                        background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12,
                        border: `1px solid ${lastResult.isAlternate ? 'rgba(245,158,11,0.4)' : 'rgba(49,162,76,0.4)'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>
                                {lastResult.playerName}
                            </p>
                            <button
                                onClick={() => setLastResult(null)}
                                aria-label="Dismiss"
                                style={{ width: 32, height: 32, borderRadius: 8, background: '#3A3B3C', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <X size={14} color="#B0B3B8" />
                            </button>
                        </div>

                        {lastResult.isAlternate ? (
                            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.12)' }}>
                                <p style={{ fontSize: 13, fontWeight: 700, color: '#F59E0B', margin: 0 }}>On The Alternates List</p>
                                <p style={{ fontSize: 11, color: '#B0B3B8', margin: '4px 0 0' }}>
                                    The Field Is Full. This Player Is Seated As Soon As A Seat Opens.
                                </p>
                            </div>
                        ) : lastResult.tableNumber && lastResult.seatNumber ? (
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', padding: '4px 0 2px' }}>
                                {[{ label: 'Table', value: lastResult.tableNumber }, { label: 'Seat', value: lastResult.seatNumber }].map(b => (
                                    <div key={b.label} style={{ textAlign: 'center' }}>
                                        <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px' }}>{b.label}</p>
                                        <div style={{
                                            minWidth: 72, minHeight: 60, border: '2px solid #31A24C', borderRadius: 10,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 30, fontWeight: 800, color: '#fff' }}>
                                            {b.value}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>
                                Registered. Seat Is Assigned By The Seat Draw.
                            </p>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12 }}>
                            <Printer size={13} color={lastResult.printed ? '#31A24C' : '#F59E0B'} />
                            <span style={{ fontSize: 11, color: lastResult.printed ? '#31A24C' : '#F59E0B' }}>
                                {lastResult.printed
                                    ? 'Buy-In Receipt Queued At The Print Station'
                                    : 'Receipt Could Not Be Queued. Reprint From The Print Station.'}
                            </span>
                        </div>
                    </div>
                )}

                {/* Tournament summary */}
                {tournament && (
                    <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C', display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Trophy size={20} color="#1877F2" />
                        <div style={{ flex: 1 }}>
                            <p style={{ fontSize: 13, fontWeight: 700, color: '#fff', margin: 0 }}>{tournament.name || 'Tournament'}</p>
                            <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                                {tournament.buyin_amount > 0 && <span style={{ fontSize: 11, color: '#31A24C' }}><DollarSign size={11} style={{ display: 'inline' }} /> ${tournament.buyin_amount}{tournament.buyin_fee > 0 ? ` + $${tournament.buyin_fee}` : ''}</span>}
                                {tournament.starting_chips > 0 && <span style={{ fontSize: 11, color: '#B0B3B8' }}>{Number(tournament.starting_chips).toLocaleString()} Chips</span>}
                            </div>
                        </div>
                    </div>
                )}

                {/* Step 1: Select Player */}
                <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Select Player
                    </p>
                    {selectedPlayer ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#1877F2', borderRadius: 10, padding: '10px 14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Users size={18} color="#fff" />
                                <span style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>{selectedPlayer.player_name}</span>
                            </div>
                            <button onClick={() => setSelectedPlayer(null)} style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', background: 'none', border: 'none', cursor: 'pointer' }}>
                                Change
                            </button>
                        </div>
                    ) : (
                        <>
                            <div style={{ position: 'relative', marginBottom: 8 }}>
                                <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#B0B3B8' }} />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search by Name or Phone..."
                                    style={{
                                        width: '100%', background: '#3A3B3C', border: '1px solid #4A4B4C', borderRadius: 10,
                                        padding: '10px 12px 10px 38px', color: '#E4E6EB', fontSize: 14, fontWeight: 500,
                                        outline: 'none', boxSizing: 'border-box' }}
                                />
                                {searchQuery && (
                                    <button onClick={() => { setSearchQuery(''); setSearchResults([]); }} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                                        <X size={16} color="#B0B3B8" />
                                    </button>
                                )}
                                {searchLoading && <Loader2 size={16} style={{ position: 'absolute', right: 36, top: '50%', transform: 'translateY(-50%)', color: '#1877F2', animation: 'spin 1s linear infinite' }} />}
                            </div>
                            {searchResults.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {searchResults.map(m => {
                                        const name = m.name || `${m.first_name || ''} ${m.last_name || ''}`.trim();
                                        return (
                                            <button key={m.id} onClick={() => selectPlayer(m)}
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(58,59,60,0.5)', border: '1px solid #4A4B4C', cursor: 'pointer', textAlign: 'left', color: '#E4E6EB' }}>
                                                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(24,119,242,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <span style={{ fontSize: 12, fontWeight: 700, color: '#1877F2' }}>{(name[0] || '?').toUpperCase()}</span>
                                                </div>
                                                <div>
                                                    <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>{name}</p>
                                                    <p style={{ fontSize: 10, color: '#B0B3B8', margin: 0 }}>{m.phone || 'No Phone'}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {searchQuery.length >= 2 && searchResults.length === 0 && !searchLoading && (
                                <p style={{ textAlign: 'center', fontSize: 13, color: '#B0B3B8', padding: '12px 0' }}>No Players Found</p>
                            )}
                        </>
                    )}
                </div>

                {/* ===== CASH WAITLIST CONVERSION ===== */}
                <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                    <button
                        onClick={toggleWaitlistOpen}
                        style={{
                            width: '100%', minHeight: 44, background: 'none', border: 'none', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, color: '#E4E6EB' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ListChecks size={16} color="#F59E0B" />
                            <span style={{ fontSize: 13, fontWeight: 700 }}>Convert From Cash Waitlist</span>
                        </span>
                        <span style={{ fontSize: 11, color: '#B0B3B8' }}>
                            {waitlistOpen ? 'Hide' : (waitlist.length > 0 ? `${waitlist.length.toLocaleString()} Waiting` : 'Show')}
                        </span>
                    </button>

                    {waitlistOpen && (
                        <div style={{ marginTop: 12 }}>
                            {waitlistLoading ? (
                                <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>Loading Waitlist...</p>
                            ) : waitlist.length === 0 ? (
                                <p style={{ fontSize: 12, color: '#B0B3B8', margin: 0 }}>Nobody Is On The Cash Waitlist Right Now.</p>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                                        {waitlist.map(w => {
                                            const checked = selectedWaitlist.includes(w.id);
                                            const linked = !!w.player_id;
                                            return (
                                                <button
                                                    key={w.id}
                                                    onClick={() => linked && toggleWaitlistRow(w.id)}
                                                    disabled={!linked}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 10, minHeight: 44,
                                                        padding: '8px 12px', borderRadius: 10, textAlign: 'left',
                                                        background: checked ? 'rgba(24,119,242,0.18)' : 'rgba(58,59,60,0.5)',
                                                        border: `1px solid ${checked ? '#1877F2' : '#4A4B4C'}`,
                                                        cursor: linked ? 'pointer' : 'not-allowed',
                                                        opacity: linked ? 1 : 0.5, color: '#E4E6EB' }}>
                                                    <div style={{
                                                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                                                        border: `1px solid ${checked ? '#1877F2' : '#6A6B6D'}`,
                                                        background: checked ? '#1877F2' : 'transparent',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                        {checked && <CheckCircle2 size={14} color="#fff" />}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>
                                                            {w.player_name || 'Walk-In'}
                                                        </p>
                                                        <p style={{ fontSize: 10, color: '#B0B3B8', margin: 0 }}>
                                                            {[w.game_type, w.stakes].filter(Boolean).join(' ')}
                                                            {w.position != null ? `, Position ${Number(w.position).toLocaleString()}` : ''}
                                                            {linked ? '' : ', No Player Account'}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <button
                                        onClick={convertWaitlist}
                                        disabled={selectedWaitlist.length === 0 || converting}
                                        style={{
                                            width: '100%', minHeight: 44, marginTop: 10, borderRadius: 10, border: 'none',
                                            background: selectedWaitlist.length > 0 ? '#F59E0B' : '#3A3B3C',
                                            color: selectedWaitlist.length > 0 ? '#18191A' : '#B0B3B8',
                                            fontSize: 14, fontWeight: 700,
                                            cursor: selectedWaitlist.length > 0 && !converting ? 'pointer' : 'not-allowed',
                                            opacity: selectedWaitlist.length > 0 && !converting ? 1 : 0.6,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                                        {converting
                                            ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                                            : <ListChecks size={16} />}
                                        {converting
                                            ? 'Converting...'
                                            : `Register ${selectedWaitlist.length.toLocaleString()} Selected Into This Tournament`}
                                    </button>
                                    <p style={{ fontSize: 10, color: '#B0B3B8', margin: '6px 0 0' }}>
                                        Each Conversion Charges The Buy-In And Runs The Normal Registration, Including The Seat Draw.
                                    </p>
                                </>
                            )}

                            {convertResult && (
                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #3A3B3C' }}>
                                    {convertResult.converted?.map(c => (
                                        <p key={c.waitlist_id} style={{ fontSize: 11, color: '#31A24C', margin: '0 0 2px' }}>
                                            {c.player_name} Registered
                                            {c.is_alternate
                                                ? ', On The Alternates List'
                                                : (c.table_number && c.seat_number ? `, Table ${c.table_number} Seat ${c.seat_number}` : '')}
                                        </p>
                                    ))}
                                    {convertResult.skipped?.map(s => (
                                        <p key={s.waitlist_id} style={{ fontSize: 11, color: '#F59E0B', margin: '0 0 2px' }}>
                                            {s.player_name} Skipped: {s.message}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Register button */}
                <button
                    onClick={registerPlayer}
                    disabled={!selectedPlayer || registering}
                    style={{
                        width: '100%', padding: '14px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: selectedPlayer ? '#31A24C' : '#3A3B3C',
                        color: '#fff', fontSize: 15, fontWeight: 700,
                        opacity: selectedPlayer && !registering ? 1 : 0.5,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                    {registering ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : (reentryName ? <RotateCcw size={18} /> : <UserPlus size={18} />)}
                    {registering ? 'Processing...' : (reentryName ? 'Confirm Re-Entry' : 'Register Player')}
                </button>
            </div>

            <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: #666; }
        input:focus { border-color: #1877F2 !important; }
      `}</style>
        </CommanderLayout>
    );
}
