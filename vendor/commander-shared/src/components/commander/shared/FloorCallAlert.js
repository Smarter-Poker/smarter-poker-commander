/**
 * FloorCallAlert - Real-time fullscreen popup when a table calls the floor
 * 
 * Uses Supabase Realtime (postgres_changes) as the primary path, with a 20s
 * safety poll so a dropped channel cannot silently stop floor-call alerts.
 * Shows a fullscreen red alert on ALL Commander screens except cashier.
 * Auto-dismisses after 30 seconds.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import { X } from 'lucide-react';
import { useCommanderSync } from '../../../lib/commander/useCommanderSync';

export default function FloorCallAlert({ venueId }) {
    const [activeCall, setActiveCall] = useState(null);
    const dismissTimer = useRef(null);
    const pollInterval = useRef(null);
    const lastSeenId = useRef(null);

    // Cashier and tournament registration pages don't see floor calls
    const isExcluded = typeof window !== 'undefined' && (
        window.location.pathname.includes('/cashier') ||
        window.location.pathname.includes('/tournament-registration')
    );

    const dismissCall = useCallback(() => {
        setActiveCall(null);
        if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
    }, []);

    const handleNewCall = useCallback((call) => {
        if (!call || call.status !== 'active') return;
        if (lastSeenId.current === call.id) return; // Already showing this call
        lastSeenId.current = call.id;
        setActiveCall({
            id: call.id,
            table_number: call.table_number,
            description: call.description || `Table ${call.table_number} needs floor`,
            created_at: call.created_at,
        });
        // Auto-dismiss after 30 seconds
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => {
            setActiveCall(null);
            dismissTimer.current = null;
        }, 30000);
    }, []);

    const poll = useCallback(async () => {
        if (!venueId || isExcluded) return;
        const client = supabase;
        if (!client) return;

        try {
            const { data } = await client
                .from('commander_floor_calls')
                .select('*')
                .eq('venue_id', venueId)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1);
            if (data && data.length > 0) {
                const call = data[0];
                // Only show if created within the last 60 seconds
                const age = (Date.now() - new Date(call.created_at).getTime()) / 1000;
                if (age < 60) {
                    handleNewCall(call);
                }
            } else {
                // No active calls - if we're showing an alert, the call was cancelled/resolved
                setActiveCall(prev => {
                    if (prev) {
                        lastSeenId.current = null;
                        if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
                    }
                    return null;
                });
            }
        } catch { /* ignore polling errors */ }
    }, [venueId, isExcluded, handleNewCall]);

    useEffect(() => {
        poll();

        // 2026-07-27 audit fix: the header has always advertised a polling
        // fallback, but `pollInterval` was declared and never used - the only
        // live path was the realtime channel. If that channel dropped, a floor
        // tablet stopped announcing floor calls silently and indefinitely.
        // A safety poll now runs alongside realtime. It is deliberately slower
        // than the documented 5s: realtime already delivers in ~1s, so this
        // exists purely to catch a dead channel without putting every
        // Commander screen on a 5-second query loop.
        if (venueId && !isExcluded) {
            pollInterval.current = setInterval(poll, 20000);
        }

        return () => {
            if (dismissTimer.current) { clearTimeout(dismissTimer.current); dismissTimer.current = null; }
            if (pollInterval.current) { clearInterval(pollInterval.current); pollInterval.current = null; }
        };
    }, [poll, venueId, isExcluded]);

    // Unified Real-Time Sync via Singleton WebSocket
    useCommanderSync(venueId, poll, { entities: ['floor_calls'] });

    if (!activeCall || isExcluded) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(220, 38, 38, 0.95)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            animation: 'floorCallIn 0.3s ease-out',
            cursor: 'pointer',
        }} onClick={dismissCall}>
            {/* Alert text */}
            <div style={{ fontSize: 72, fontWeight: 900, color: '#fff', textAlign: 'center', letterSpacing: -1, lineHeight: 1.1 }}>
                TABLE {activeCall.table_number}
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, color: 'rgba(255,255,255,0.9)', marginTop: 12, textTransform: 'uppercase', letterSpacing: 4 }}>
                NEEDS FLOOR
            </div>

            {/* Dismiss button */}
            <button
                onClick={(e) => { e.stopPropagation(); dismissCall(); }}
                style={{
                    marginTop: 48, padding: '16px 48px', borderRadius: 16,
                    background: 'rgba(255,255,255,0.2)', border: '2px solid rgba(255,255,255,0.4)',
                    color: '#fff', fontSize: 18, fontWeight: 800, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}
            >
                <X size={20} /> Dismiss
            </button>

            <div style={{ position: 'absolute', bottom: 24, fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                Auto-dismisses in 30 seconds · Tap anywhere to dismiss
            </div>

            <style>{`
                @keyframes floorCallIn {
                    from { opacity: 0; transform: scale(1.05); }
                    to { opacity: 1; transform: scale(1); }
                }
            `}</style>
        </div>
    );
}
