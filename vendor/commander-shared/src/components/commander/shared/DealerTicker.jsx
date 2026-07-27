/**
 * DealerTicker — Shared scrolling ticker for dealer push/break + club promos
 * 
 * Drop into any display page (waitlist desk, tournament clock, etc.)
 * Fetches dealer rotation data AND club promos/announcements, rendering
 * a scrolling marquee showing:
 *   - Dealers at tables with time elapsed and push status
 *   - Dealers on break with time elapsed
 *   - Next push due (countdown)
 *   - Active club promotions & announcements
 *   - Custom ticker messages from venue settings
 * 
 * Props:
 *   accentColor: string (hex) — ticker text color (default: #D4AF37 gold)
 *   bgColor: string (hex) — background color (default: transparent)
 *   fontSize: number — font size in px (default: 18)
 *   borderColor: string — top border color (default: #333)
 *   speed: number — scroll speed in seconds (default: 25)
 *   showBorder: boolean — show top border (default: true)
 */
import { useState, useEffect, useCallback } from 'react';
import { useCommanderSync } from '../../../lib/commander/useCommanderSync';

const PUSH_THRESHOLD = 30; // minutes

function minutesSince(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

export default function DealerTicker({
    accentColor = '#D4AF37',
    bgColor = 'transparent',
    fontSize = 18,
    borderColor = '#333',
    speed = 25,
    showBorder = true,
}) {
    const [dealers, setDealers] = useState([]);
    const [rotations, setRotations] = useState([]);
    const [promotions, setPromotions] = useState([]);
    const [announcements, setAnnouncements] = useState([]);
    const [tickerMessage, setTickerMessage] = useState('');

    const fetchAllData = useCallback(async () => {
        try {
            const staff = JSON.parse(localStorage.getItem('commander_staff') || '{}');
            const venueId = staff.venue_id || '';
            if (!venueId) return;
            const headers = {
                Authorization: `Bearer ${staff.token || ''}`,
                'x-staff-session': localStorage.getItem('commander_staff') || ''
            };

            const [dRes, rRes, pRes, aRes, sRes] = await Promise.all([
                fetch(`/api/commander/dealers?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
                fetch(`/api/commander/dealers/rotations?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
                fetch(`/api/commander/promotions?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
                fetch(`/api/commander/announcements?venue_id=${venueId}`, { headers }).then(r => r.json()).catch(() => ({})),
                fetch('/api/commander/settings', { headers }).then(r => r.json()).catch(() => ({})),
            ]);

            // Dealers
            const dealersArr = dRes.data?.dealers || (Array.isArray(dRes.data) ? dRes.data : []);
            setDealers(dealersArr.filter(d => d.is_active !== false));
            const rotationsArr = rRes.data?.rotations || (Array.isArray(rRes.data) ? rRes.data : []);
            setRotations(rotationsArr.filter(r => !r.ended_at));

            // Promotions — only active ones
            // API returns { data: { promotions: [...] } }
            const promosArr = pRes.data?.promotions || (Array.isArray(pRes.data) ? pRes.data : []);
            const promos = promosArr.filter(p => p.is_active !== false && p.status !== 'ended');
            setPromotions(promos);

            // Announcements — only non-expired
            // API returns { data: { announcements: [...] } }
            const now = new Date();
            const annsArr = aRes.data?.announcements || (Array.isArray(aRes.data) ? aRes.data : []);
            const anns = annsArr.filter(a => {
                if (!a.expires_at) return true;
                return new Date(a.expires_at) > now;
            });
            setAnnouncements(anns);

            // Custom ticker message from settings
            const customMsg = sRes.data?.desk_customization?.tickerMessage || '';
            setTickerMessage(customMsg);
        } catch (err) { console.warn('[App] Handled exception:', err?.message || err); }
    }, []);

    useEffect(() => {
        fetchAllData();
        const poll = setInterval(fetchAllData, 60000); // fallback — real-time sync handles instant updates
        return () => clearInterval(poll);
    }, [fetchAllData]);

    // Real-time sync — instant updates for dealer rotations, promotions, announcements
    const [venueId] = useState(() => {
        try { return JSON.parse(localStorage.getItem('commander_staff') || '{}').venue_id || null; } catch { return null; }
    });
    useCommanderSync(venueId, fetchAllData, { entities: ['dealers', 'settings'] });

    // Build ticker message parts
    const parts = [];

    // ── DEALER ROTATION INFO ──────────────────────────────────────
    // Dealers at tables
    const dealingParts = [];
    rotations.forEach(r => {
        const dealer = r.commander_dealers || dealers.find(d => d.id === r.dealer_id);
        const name = dealer?.display_name || dealer?.name || r.dealer_name || 'Dealer';
        const tableNum = r.commander_tables?.table_number || r.table_number || '?';
        const mins = minutesSince(r.started_at);
        const pushFlag = mins >= PUSH_THRESHOLD ? ' ⚠ PUSH' : mins >= 25 ? ' ⏱' : '';
        dealingParts.push(`${name} → T${tableNum} (${mins}m${pushFlag})`);
    });
    if (dealingParts.length > 0) {
        parts.push(`🃏 DEALING: ${dealingParts.join('  •  ')}`);
    }

    // Dealers on break
    const breakDealers = dealers.filter(d => d.current_status === 'on_break');
    if (breakDealers.length > 0) {
        const breakParts = breakDealers.map(d => {
            const name = d.display_name || d.name;
            const mins = d.break_started_at ? minutesSince(d.break_started_at) : 0;
            return `${name} (${mins}m)`;
        });
        parts.push(`☕ BREAK: ${breakParts.join('  •  ')}`);
    }

    // Next push due
    if (rotations.length > 0) {
        const oldest = rotations.reduce((max, r) => {
            const mins = minutesSince(r.started_at);
            return mins > max.mins ? { mins, r } : max;
        }, { mins: 0, r: null });
        if (oldest.r && oldest.mins < PUSH_THRESHOLD) {
            const remaining = PUSH_THRESHOLD - oldest.mins;
            parts.push(`⏱ Next push in ${remaining}m`);
        } else if (oldest.r) {
            parts.push(`⚠ PUSH OVERDUE`);
        }
    }

    // ── CLUB PROMOTIONS ───────────────────────────────────────────
    promotions.forEach(p => {
        const name = p.name || p.title || '';
        const amount = p.prize_value || p.prize_amount || p.jackpot_amount || 0;
        const type = p.promotion_type || p.type || 'promotion';
        const typeLabels = {
            high_hand: '🏆 HIGH HAND',
            bad_beat: '💥 BAD BEAT JACKPOT',
            bad_beat_jackpot: '💥 BAD BEAT JACKPOT',
            splash_pot: '💦 SPLASH POT',
            bonus: '🎁 BONUS',
            freeroll: '♠️ FREEROLL',
            progressive: '📈 PROGRESSIVE',
            mystery_bounty: '🎭 MYSTERY BOUNTY',
        };
        const label = typeLabels[type] || '🎯 PROMO';
        if (amount > 0) {
            parts.push(`${label}: ${name} — $${Number(amount).toLocaleString()}`);
        } else if (name) {
            parts.push(`${label}: ${name}`);
        }
    });

    // ── CLUB ANNOUNCEMENTS ────────────────────────────────────────
    announcements.forEach(a => {
        const msg = a.message || a.title || a.content || '';
        if (!msg) return;
        const priority = a.priority || 'normal';
        const prefix = priority === 'urgent' ? '🚨' : priority === 'high' ? '📢' : '📣';
        parts.push(`${prefix} ${msg}`);
    });

    // ── CUSTOM TICKER MESSAGE ─────────────────────────────────────
    if (tickerMessage) {
        parts.push(tickerMessage);
    }

    // If no data at all, don't render
    if (parts.length === 0) return null;

    const message = parts.join('   \u00A0\u00A0\u00A0•\u00A0\u00A0\u00A0   ');

    return (
        <>
            <div style={{
                padding: '16px 0',
                borderTop: showBorder ? `2px solid ${borderColor}55` : 'none',
                background: bgColor,
                overflow: 'hidden',
                position: 'relative',
                height: `${fontSize + 64}px`, // Increased fixed height to accommodate double lines
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    animation: `dealerTickerScroll ${speed}s linear infinite`,
                    position: 'absolute',
                    top: 0,
                }}>
                    <span style={{
                        fontSize: `${fontSize}px`,
                        color: accentColor,
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        paddingBottom: '120px',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        textAlign: 'center',
                        width: '100%',
                        padding: '0 16px 120px 16px', // Replace paddingBottom
                    }}>{message}</span>
                    <span style={{
                        fontSize: `${fontSize}px`,
                        color: accentColor,
                        fontWeight: 700,
                        letterSpacing: '0.5px',
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        textAlign: 'center',
                        width: '100%',
                        padding: '0 16px 120px 16px',
                    }}>{message}</span>
                </div>
            </div>
            <style>{`
        @keyframes dealerTickerScroll {
          0% { transform: translateY(-50%); }
          100% { transform: translateY(0); }
        }
      `}</style>
        </>
    );
}
