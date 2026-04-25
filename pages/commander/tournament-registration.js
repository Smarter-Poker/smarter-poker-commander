/**
 * Tournament Registration — Cashier Backup
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

    // Commander Data Bus — sync tournaments + members across tabs
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

    // Build a professional casino-grade receipt HTML (Potawatomi-style, 80mm thermal)
    const buildReceiptHtml = ({
        copyLabel, playerName, tournamentName, buyinAmount, buyinFee,
        staffName, venueName, venueCity, venueState, scheduledStart,
        startingChips, tableNumber, seatNumber, playerId, receiptNum
    }) => {
        const total = (buyinAmount || 0) + (buyinFee || 0);
        const fmtMoney = (v) => `$ ${parseFloat(v || 0).toFixed(2)}`;

        // Tournament date formatted like "02/17/2026    4:00 pm"
        const tournDate = scheduledStart
            ? new Date(scheduledStart).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
            : '';
        const tournTime = scheduledStart
            ? new Date(scheduledStart).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
            : '';

        // "Received By" timestamp — written-out format like "February 17, 2026  7:53 pm"
        const now = new Date();
        const receivedDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const receivedTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();

        // Map copy labels to receipt-style labels
        const copyMap = { 'PLAYER COPY': 'CUSTOMER COPY', 'DEALER COPY': 'DEALER COPY', 'CASHIER COPY': 'CAGE COPY' };
        const displayCopy = copyMap[copyLabel] || copyLabel;

        return `<!DOCTYPE html><html><head><title>${displayCopy}</title>
<style>
@page { margin: 0; size: 80mm auto; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Times New Roman', Georgia, serif; margin: 0; padding: 0; color: #000; -webkit-print-color-adjust: exact; }
.receipt { width: 72mm; padding: 5mm 4mm; margin: 0 auto; }
.center { text-align: center; }

/* Venue Header */
.venue-name {
  font-size: 28px; font-weight: bold; text-transform: uppercase;
  letter-spacing: 1.5px; margin-bottom: 1mm; line-height: 1.2;
}
.venue-sub { font-size: 15px; letter-spacing: 3px; text-transform: uppercase; color: #333; }

/* Title */
.receipt-title {
  font-size: 20px; font-weight: bold; margin: 3mm 0 1mm; text-transform: uppercase;
}

/* Event */
.event-name { font-size: 17px; margin: 1mm 0; }
.event-date { font-size: 17px; margin: 2mm 0; }
.event-date-label { font-weight: bold; }

/* Player */
.player-name { font-size: 17px; font-weight: bold; margin: 2mm 0 0; }
.player-name-label { font-weight: bold; }
.player-id { font-size: 16px; margin: 0 0 2mm; padding-left: 2mm; }

/* Financial */
.fin-row { display: flex; justify-content: flex-end; align-items: baseline; font-size: 16px; line-height: 1.8; }
.fin-label { font-weight: bold; text-align: right; margin-right: 2mm; }
.fin-value { min-width: 24mm; text-align: right; font-weight: bold; }
.fin-total-row { display: flex; justify-content: flex-end; align-items: baseline; font-size: 18px; line-height: 2; font-weight: bold; }
.fin-total-label { font-weight: bold; text-align: right; margin-right: 2mm; }
.fin-total-value { min-width: 24mm; text-align: right; font-weight: bold; }

/* Divider */
.divider { border-top: 1px solid #000; margin: 2.5mm 0; }

/* Table / Seat Boxes */
.seat-grid { display: flex; justify-content: center; gap: 8mm; margin: 3mm 0; }
.seat-box { text-align: center; }
.seat-box-label { font-size: 17px; font-weight: bold; margin-bottom: 1mm; }
.seat-box-value {
  border: 2.5px solid #000; font-size: 42px; font-weight: bold;
  min-width: 24mm; min-height: 18mm; display: flex; align-items: center;
  justify-content: center; padding: 2mm 5mm;
}

/* Footer */
.received { font-size: 16px; margin: 2mm 0; }
.received-label { font-weight: bold; }
.receipt-num { font-size: 22px; font-weight: bold; margin: 2mm 0; }
.legal { font-size: 11px; color: #333; line-height: 1.3; margin: 2mm 2mm; text-align: center; }
.copy-label { font-size: 15px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; margin-top: 2mm; }
</style></head><body>
<div class="receipt">

<!-- Venue Header -->
<div class="center venue-name">${venueName || 'POKER ROOM'}</div>
${venueCity || venueState ? `<div class="center venue-sub">${[venueCity, venueState].filter(Boolean).join(', ')}</div>` : ''}

<!-- Title -->
<div class="center receipt-title">TOURNAMENT BUY-IN RECEIPT</div>

<!-- Event Name -->
<div class="event-name">${tournamentName || ''}</div>

<!-- Tournament Date -->
${scheduledStart ? `<div class="event-date"><span class="event-date-label">Tournament Date:</span>  ${tournDate}    ${tournTime}</div>` : ''}

<!-- Player Name -->
<div class="player-name"><span class="player-name-label">Name:</span>  ${(playerName || '').toUpperCase()}</div>
${playerId ? `<div class="player-id">${String(playerId).slice(-7)}</div>` : ''}

<!-- Financial Breakdown -->
<div class="divider"></div>
${buyinAmount > 0 ? `<div class="fin-row"><span class="fin-label">Buy In:</span><span class="fin-value">${fmtMoney(buyinAmount)}</span></div>` : ''}
${buyinFee > 0 ? `<div class="fin-row"><span class="fin-label">Entry Fee:</span><span class="fin-value">${fmtMoney(buyinFee)}</span></div>` : ''}
${total > 0 ? `<div class="fin-total-row"><span class="fin-total-label">Total Buy In Amount:</span><span class="fin-total-value">${fmtMoney(total)}</span></div>` : ''}

<!-- Table & Seat Boxes -->
<div class="divider"></div>
<div class="seat-grid">
  <div class="seat-box">
    <div class="seat-box-label">Table</div>
    <div class="seat-box-value">${tableNumber || '--'}</div>
  </div>
  <div class="seat-box">
    <div class="seat-box-label">Seat</div>
    <div class="seat-box-value">${seatNumber || '--'}</div>
  </div>
</div>

<!-- Received By -->
<div class="received"><span class="received-label">Received By:</span>  ${staffName || ''}</div>
<div class="received">${receivedDate}   ${receivedTime}</div>

<!-- Receipt Number -->
<div class="divider"></div>
<div class="center receipt-num">${receiptNum || ''}</div>

<!-- Legal Disclaimer -->
<div class="legal">Management reserves the right to modify, suspend, or cancel this promotion at its sole discretion and without prior notice.</div>

<!-- Copy Label -->
<div class="center copy-label">${displayCopy}</div>

</div></body></html>`;
    };

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

        // Print each copy with a staggered delay to avoid popup blocking
        copies.forEach((copyLabel, index) => {
            setTimeout(() => {
                const printWindow = window.open('', '_blank', 'width=400,height=600');
                if (!printWindow) return;
                const html = buildReceiptHtml({
                    copyLabel, playerName, tournamentName, buyinAmount, buyinFee,
                    staffName, venueName, venueCity, venueState,
                    scheduledStart, startingChips, tableNumber, seatNumber, playerId, receiptNum
                });
                printWindow.document.write(html);
                printWindow.document.close();
                setTimeout(() => { printWindow.print(); printWindow.close(); }, 500);
            }, index * 800);
        });
    };

    const registerPlayer = async () => {
        if (!selectedPlayer || !selectedTournament) {
            setMessage({ type: 'error', text: 'Select a player and tournament' });
            return;
        }
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
                const errMsg = regJson.error?.message || regJson.error || 'Registration failed';
                setMessage({ type: 'error', text: errMsg });
                return;
            }

            // NOTE: The registration cash transaction is now logged ATOMICALLY
            // inside the /api/commander/tournaments/[id]/register API endpoint.
            // This prevents a split-brain vulnerability where the UI crashes before the money is logged.

            // 3. Auto-print registration receipts — use REAL data from API response + tournament record
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

            setMessage({ type: 'success', text: `${selectedPlayer.player_name} registered for ${selectedTournament.name || 'Tournament'}${buyinAmount > 0 ? ` — $${buyinAmount} buy-in` : ''}` });
            broadcastChange('tournaments');
            busEmit.celebration('confetti');
            setSelectedPlayer(null);
            setSelectedTournament(null);
        } catch (err) {
            console.warn('Registration error:', err);
            setMessage({ type: 'error', text: 'Network error — try again' });
        } finally {
            setRegistering(false);
        }
    };

    useEffect(() => {
        if (message) { const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }
    }, [message]);

    return (
        <CommanderLayout title="Tournament Registration" backHref="/commander/cashier">
            <SEOHead title="Commander — Tournament Registration" description="Register players for tournaments." noindex={true} />
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
                        Step 1 — Select Player
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
                                <p style={{ textAlign: 'center', fontSize: 13, color: '#B0B3B8', padding: '12px 0' }}>No players found</p>
                            )}
                        </>
                    )}
                </div>

                {/* Step 2: Select Tournament */}
                <div style={{ background: '#242526', borderRadius: 12, padding: 16, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: '#B0B3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                        Step 2 — Select Tournament
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
                            <p style={{ fontSize: 13, color: '#B0B3B8' }}>No upcoming tournaments</p>
                            <p style={{ fontSize: 11, color: '#666', marginTop: 4 }}>Create a tournament in Tournament Director first</p>
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
