/**
 * Tournament Registration - Cashier Backup
 * /commander/tournament-registration
 * Allows cashier staff to register players for tournaments
 * when the cage has a long line.
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Trophy, Search, Users, Loader2, CheckCircle2, AlertTriangle, Clock, DollarSign } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import useDebounce from '../../src/hooks/useDebounce';
import { getStaffData } from '../../src/lib/commander/clientAuth';
import { commanderFetch, commanderFetchJSON } from '../../src/lib/commander/commanderFetch';
import { buildBuyinReceiptHtml, printHtml } from '../../src/lib/commander/receiptTemplates';

export default function TournamentRegistration() {
    const router = useRouter();
    useEffect(() => { busEmit.sessionStart('commander-tournament-registration'); }, []);
    const [loading, setLoading] = useState(true);
    const [registering, setRegistering] = useState(false);
    const [tournaments, setTournaments] = useState([]);
    const [venueId, setVenueId] = useState(null);
    const [message, setMessage] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [selectedTournament, setSelectedTournament] = useState(null);
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    useEffect(() => {
        try {
            const s = getStaffData();
            if (s.venue_id) setVenueId(s.venue_id);
        } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }, []);

    const fetchTournaments = useCallback(async () => {
        if (!venueId) return;
        setLoading(true);
        try {
const headers = { };
            const json = await commanderFetchJSON(`/api/commander/tournaments?venue_id=${venueId}&status=upcoming,active`, { headers });
            const list = json.data?.tournaments || json.tournaments || json.data || [];
            setTournaments(Array.isArray(list) ? list : []);
        } catch (err) { console.warn(err); }
        finally { setLoading(false); }
    }, [venueId]);

    useEffect(() => { const _c = new AbortController(); fetchTournaments(_c.signal); return () => _c.abort(); }, [fetchTournaments]);

    // Commander Data Bus - sync tournaments + members across tabs
    useCommanderSync(venueId || '', fetchTournaments, { entities: ['tournaments', 'members'] });

    // Player search
    const executeSearch = useCallback(async (query) => {
        if (!query || query.length < 2) { setSearchResults([]); return; }
        setSearchLoading(true);
        try {
const headers = { };
            const res = await commanderFetch(`/api/commander/members/search?q=${encodeURIComponent(query)}&venue_id=${venueId}&limit=8`, { headers });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const json = await res.json();
            setSearchResults(json.data || []);
        } catch { setSearchResults([]); }
        finally { setSearchLoading(false); }
    }, [venueId]);

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

    // Generate a sequential receipt number
    const generateReceiptNum = () => {
        const now = new Date();
        // Use last 3 digits of timestamp for a short sequential-like number
        return String(now.getTime()).slice(-4);
    };

    // Casino-grade 80mm buy-in receipt.
    // The template moved to src/lib/commander/receiptTemplates.js so the floor
    // print station can reprint a byte-identical receipt from a queued job.
    const buildReceiptHtml = (opts) => buildBuyinReceiptHtml(opts, opts?.copyLabel);

    // Rapid-fire print multiple receipt copies based on tournament settings
    const printTournamentReceipts = ({
        playerName, tournamentName, buyinAmount, buyinFee, staffName,
        receiptSettings, venueName, venueCity, venueState,
        scheduledStart, startingChips, tableNumber, seatNumber, playerId
    }) => {
        // Default: all 3 copies if no settings defined
        const receipts = receiptSettings || { player: true, dealer: true, cage: true };
        const copies = [];
        if (receipts.player) copies.push('PLAYER COPY');
        if (receipts.dealer) copies.push('DEALER COPY');
        if (receipts.cage) copies.push('CASHIER COPY');

        // If no copies selected, skip printing
        if (copies.length === 0) return;

        const receiptNum = generateReceiptNum();

        // Print each copy with a staggered delay to avoid popup blocking.
        // printHtml returns false when the browser blocked the window, so the
        // cashier is told instead of the receipt vanishing.
        copies.forEach((copyLabel, index) => {
            setTimeout(() => {
                const html = buildReceiptHtml({
                    copyLabel, playerName, tournamentName, buyinAmount, buyinFee,
                    staffName, venueName, venueCity, venueState,
                    scheduledStart, startingChips, tableNumber, seatNumber, playerId, receiptNum
                });
                const printed = printHtml(html, { title: copyLabel });
                if (!printed) {
                    setMessage({ type: 'error', text: 'Popup Blocked. Allow Popups To Print Receipts.' });
                }
            }, index * 800);
        });
    };

    const registerPlayer = async () => {
        if (!selectedPlayer || !selectedTournament) {
            setMessage({ type: 'error', text: 'Select A Player And Tournament' });
            return;
        }
        const buyinAmount = selectedTournament.buyin_amount || 0;
        const buyinFee = selectedTournament.buyin_fee || 0;
        setRegistering(true);
        try {
const headers = { 'Content-Type': 'application/json' };

            // 1. Register player in tournament via API
            const regRes = await commanderFetch(`/api/commander/tournaments/${selectedTournament.id}/register`, {
                method: 'POST', headers,
                body: JSON.stringify({ player_id: selectedPlayer.id })
            });
            if (!regRes.ok) throw new Error('Request failed');
            const regJson = await regRes.json();

            if (!regJson.success) {
                const errMsg = regJson.error?.message || regJson.error || 'Registration Failed';
                setMessage({ type: 'error', text: errMsg });
                return;
            }

            // NOTE: The registration cash transaction is now logged ATOMICALLY
            // inside the /api/commander/tournaments/[id]/register API endpoint.
            // This prevents a split-brain vulnerability where the UI crashes before the money is logged.

            // 3. Auto-print registration receipts - use REAL data from API response + tournament record
            const registeredEntry = regJson.data?.entry || {};
            let staffName = '';
            try { staffName = getStaffData().name || ''; } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
            const venue = selectedTournament.poker_venues || {};
            printTournamentReceipts({
                playerName: selectedPlayer.player_name,
                tournamentName: selectedTournament.name || 'Tournament',
                buyinAmount,
                buyinFee,
                staffName,
                receiptSettings: selectedTournament.settings?.receipts,
                venueName: venue.name || '',
                venueCity: venue.city || '',
                venueState: venue.state || '',
                scheduledStart: selectedTournament.scheduled_start,
                startingChips: selectedTournament.starting_chips,
                playerId: selectedPlayer.id,
                tableNumber: registeredEntry.table_number || '',
                seatNumber: registeredEntry.seat_number || ''
            });

            setMessage({ type: 'success', text: `${selectedPlayer.player_name} Registered For ${selectedTournament.name || 'Tournament'}${buyinAmount > 0 ? `, $${buyinAmount} Buy-In` : ''}` });
            broadcastChange('tournaments');
            busEmit.celebration('confetti');
            setSelectedPlayer(null);
            setSelectedTournament(null);
        } catch (err) {
            console.warn('Registration error:', err);
            setMessage({ type: 'error', text: 'Network Error. Try Again.' });
        } finally {
            setRegistering(false);
        }
    };

    useEffect(() => {
        if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }
    }, [message]);

    return (
        <CommanderLayout title="Tournament Registration" backHref="/commander/cashier">
            <SEOHead title="Commander - Tournament Registration" description="Register players for tournaments." noindex={true} />
            <div style={{ minHeight: '100vh', background: '#18191A', color: '#E4E6EB', fontFamily: "var(--font-inter), -apple-system, sans-serif", padding: '16px' }}>

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

                {/* Step 1: Find Player */}
                <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Step 1 - Select Player
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
                                {searchLoading && <Loader2 size={16} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#1877F2', animation: 'spin 1s linear infinite' }} />}
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
                                                    <p style={{ fontSize: 13, fontWeight: 700 }}>{name}</p>
                                                    <p style={{ fontSize: 10, color: '#B0B3B8' }}>{m.phone || 'No Phone'}</p>
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

                {/* Step 2: Select Tournament */}
                <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Step 2 - Select Tournament
                    </p>
                    {loading ? (
                        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                            <Loader2 size={24} color="#1877F2" style={{ animation: 'spin 1s linear infinite' }} />
                        </div>
                    ) : tournaments.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {tournaments.map(t => (
                                <button key={t.id} onClick={() => setSelectedTournament(t)}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                                        background: selectedTournament?.id === t.id ? 'rgba(24,119,242,0.15)' : 'rgba(58,59,60,0.3)',
                                        border: `2px solid ${selectedTournament?.id === t.id ? '#1877F2' : '#3A3B3C'}`,
                                        color: '#E4E6EB' }}>
                                    <Trophy size={20} color={selectedTournament?.id === t.id ? '#1877F2' : '#B0B3B8'} />
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{t.name || t.tournament_name || 'Tournament'}</p>
                                        <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                                            {(t.buyin_amount || t.buy_in) && <span style={{ fontSize: 10, color: '#31A24C' }}><DollarSign size={10} style={{ display: 'inline' }} /> ${t.buyin_amount || t.buy_in}</span>}
                                            {(t.scheduled_start || t.start_time) && <span style={{ fontSize: 10, color: '#B0B3B8' }}><Clock size={10} style={{ display: 'inline' }} /> {new Date(t.scheduled_start || t.start_time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                                        </div>
                                    </div>
                                    {selectedTournament?.id === t.id && <CheckCircle2 size={18} color="#1877F2" />}
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div style={{ textAlign: 'center', padding: 24 }}>
                            <Trophy size={32} color="#3A3B3C" style={{ display: 'block', margin: '0 auto 8px' }} />
                            <p style={{ fontSize: 13, color: '#B0B3B8' }}>No Upcoming Tournaments</p>
                            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Create A Tournament In Tournament Director First</p>
                        </div>
                    )}
                </div>

                {/* Step 3: Register */}
                <button
                    onClick={registerPlayer}
                    disabled={!selectedPlayer || !selectedTournament || registering}
                    style={{
                        width: '100%', padding: '14px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
                        background: selectedPlayer && selectedTournament ? '#31A24C' : '#3A3B3C',
                        color: '#fff', fontSize: 15, fontWeight: 700,
                        opacity: selectedPlayer && selectedTournament && !registering ? 1 : 0.5,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                    {registering ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Trophy size={18} />}
                    {registering ? 'Registering...' : 'Register Player'}
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
