/**
 * Commander — Staff Time Clock
 * QR scan to clock in/out, shift log, hours summary
 * NO EMOJIS — Lucide icons only
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { Clock, ScanLine, UserCheck, LogIn, LogOut, Camera, X, AlertCircle, CheckCircle, Timer, Users } from 'lucide-react';
import { useCommanderSync, broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

export default function TimeClock() {
    const router = useRouter();
    useEffect(() => { busEmit.sessionStart('commander-time-clock'); }, []);
    const [staff, setStaff] = useState(null);
    const [venueId, setVenueId] = useState(null);
    const [entries, setEntries] = useState([]);
    const [summary, setSummary] = useState({ total_entries: 0, on_shift: 0, total_hours: 0 });
    const [scanning, setScanning] = useState(false);
    const [scanResult, setScanResult] = useState(null); // { action, staff_name, ... }
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [manualQR, setManualQR] = useState('');
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const scanIntervalRef = useRef(null);

    useEffect(() => {
        const stored = getStaffSession();
        if (!stored) { router.push('/commander/login'); return; }
        try {
            const data = JSON.parse(stored);
            setStaff(data);
            setVenueId(data.venue_id);
        } catch { router.push('/commander/login'); }
    }, [router]);

    // Fetch today's entries
    const fetchEntries = useCallback(async (signal) => {
        if (!venueId) return;
        try {
const res = await commanderFetch(`/api/commander/time-clock?venue_id=${venueId}`, { ...(signal ? { signal } : {}) });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = await res.json();
            if (data.success) {
                setEntries(data.data.entries || []);
                setSummary(data.data.summary || {});
            }
        } catch (err) {
            console.warn('Fetch entries error:', err);
        } finally {
            setLoading(false);
        }
    }, [venueId]);

    useEffect(() => { const _c = new AbortController(); fetchEntries(_c.signal); return () => _c.abort(); }, [fetchEntries]);

    // Real-time sync — listen for staff entity changes (clock in/out from other tabs/devices)
    useCommanderSync(venueId, fetchEntries, { entities: ['staff'] });

    // Camera QR scanning
    const startCamera = useCallback(async () => {
        setError('');
        setScanResult(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            streamRef.current = stream;
            if (videoRef.current) videoRef.current.srcObject = stream;
            setScanning(true);

            // Attempt to use BarcodeDetector API if available
            if ('BarcodeDetector' in window) {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                scanIntervalRef.current = setInterval(async () => {
                    if (!videoRef.current || videoRef.current.readyState < 2) return;
                    try {
                        const barcodes = await detector.detect(videoRef.current);
                        if (barcodes.length > 0) {
                            const code = barcodes[0].rawValue;
                            stopCamera();
                            handleScan(code);
                        }
                    } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
                }, 300);
            }
        } catch (err) {
            setError('Camera access denied. Use manual entry below.');
        }
    }, []);

    const stopCamera = useCallback(() => {
        if (scanIntervalRef.current) {
            clearInterval(scanIntervalRef.current);
            scanIntervalRef.current = null;
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setScanning(false);
    }, []);

    const handleScan = async (qrCode) => {
        setError('');
        setScanResult(null);
        try {
             const res = await commanderFetch('/api/commander/time-clock', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' || '' },
                body: JSON.stringify({ venue_id: venueId, qr_code: qrCode }) });
            if (!res.ok) throw new Error('Request failed');
            const data = await res.json();
            if (data.success) {
                setScanResult(data.data);
                broadcastChange('staff');
                busEmit.celebration('confetti');
                fetchEntries();
                // Auto-dismiss after 5 seconds
                setTimeout(() => setScanResult(null), 5000);
            } else {
                setError(data.error || 'Failed to process scan');
            }
        } catch (err) {
            setError('Network error. Please try again.');
        }
    };

    const handleManualSubmit = (e) => {
        e.preventDefault();
        if (manualQR.trim()) {
            handleScan(manualQR.trim());
            setManualQR('');
        }
    };

    const formatTime = (iso) => {
        if (!iso) return '--';
        return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    const formatDuration = (hours) => {
        if (!hours) return '--';
        const h = Math.floor(hours);
        const m = Math.round((hours - h) * 60);
        return h > 0 ? `${h}h ${m}m` : `${m}m`;
    };

    if (!staff) {
        return <div className="cmd-page flex items-center justify-center"><div className="animate-pulse text-[#B0B3B8]">Loading...</div></div>;
    }

    return (
        <CommanderLayout title="Time Clock | Club Commander" backHref="/commander/dashboard?card=staff">
            <>
                <SEOHead title="Commander — Time Clock" description="Staff Clock In/Out" noindex={true} />

                <div className="cmd-page">
                    <header className="cmd-header-bar">
                        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-[#10B981]/10 rounded-full flex items-center justify-center">
                                    <Clock className="w-5 h-5 text-[#10B981]" />
                                </div>
                                <div>
                                    <h1 className="font-bold text-white">Time Clock</h1>
                                    <p className="text-sm text-[#B0B3B8]">{staff.venue_name || 'Venue'}</p>
                                </div>
                            </div>
                        </div>
                    </header>

                    <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
                        {/* Summary Cards */}
                        <div className="grid grid-cols-3 gap-3">
                            <div className="cmd-panel p-3 text-center">
                                <Users className="w-5 h-5 text-[#1877F2] mx-auto mb-1" />
                                <div className="text-xl font-bold text-white">{summary.on_shift}</div>
                                <div className="text-xs text-[#B0B3B8]">On Shift</div>
                            </div>
                            <div className="cmd-panel p-3 text-center">
                                <Timer className="w-5 h-5 text-[#10B981] mx-auto mb-1" />
                                <div className="text-xl font-bold text-white">{summary.total_hours}</div>
                                <div className="text-xs text-[#B0B3B8]">Total Hours</div>
                            </div>
                            <div className="cmd-panel p-3 text-center">
                                <UserCheck className="w-5 h-5 text-[#F59E0B] mx-auto mb-1" />
                                <div className="text-xl font-bold text-white">{summary.total_entries}</div>
                                <div className="text-xs text-[#B0B3B8]">Entries</div>
                            </div>
                        </div>

                        {/* Scan Result Banner */}
                        {scanResult && (
                            <div className={`p-4 rounded-xl border-2 flex items-center gap-3 animate-pulse ${scanResult.action === 'clock_in'
                                ? 'bg-[#10B981]/10 border-[#10B981]/40'
                                : 'bg-[#EF4444]/10 border-[#EF4444]/40'
                                }`}>
                                <CheckCircle className={`w-8 h-8 flex-shrink-0 ${scanResult.action === 'clock_in' ? 'text-[#10B981]' : 'text-[#EF4444]'
                                    }`} />
                                <div>
                                    <div className="font-bold text-white text-lg">
                                        {scanResult.staff_name}
                                    </div>
                                    <div className={`text-sm font-medium ${scanResult.action === 'clock_in' ? 'text-[#10B981]' : 'text-[#EF4444]'
                                        }`}>
                                        {scanResult.action === 'clock_in' ? 'CLOCKED IN' : 'CLOCKED OUT'}
                                        {scanResult.hours_worked ? ` — ${formatDuration(scanResult.hours_worked)}` : ''}
                                        {' at '}{formatTime(scanResult.action === 'clock_in' ? scanResult.clock_in : scanResult.clock_out)}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0" />
                                <p className="text-sm text-[#EF4444]">{error}</p>
                                <button onClick={() => setError('')} className="ml-auto"><X className="w-4 h-4 text-[#EF4444]" /></button>
                            </div>
                        )}

                        {/* QR Scanner */}
                        <div className="cmd-panel p-6 text-center">
                            {scanning ? (
                                <div className="space-y-4">
                                    <div className="relative inline-block">
                                        <video
                                            ref={videoRef}
                                            autoPlay
                                            playsInline
                                            className="w-full max-w-sm rounded-xl bg-black mx-auto"
                                        />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                            <div className="w-48 h-48 border-2 border-[#10B981] rounded-xl" />
                                        </div>
                                    </div>
                                    <p className="text-sm text-[#B0B3B8]">Position QR code within the frame</p>
                                    <button
                                        onClick={stopCamera}
                                        className="cmd-btn cmd-btn-secondary px-6 py-2"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div className="w-16 h-16 bg-[#10B981]/10 rounded-full flex items-center justify-center mx-auto">
                                        <ScanLine className="w-8 h-8 text-[#10B981]" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-white mb-1">Scan Staff QR Code</h2>
                                        <p className="text-sm text-[#B0B3B8]">Scan to clock in or clock out</p>
                                    </div>
                                    <button
                                        onClick={startCamera}
                                        className="cmd-btn cmd-btn-primary px-8 py-3 flex items-center gap-2 mx-auto"
                                    >
                                        <Camera className="w-5 h-5" />
                                        Open Scanner
                                    </button>
                                </div>
                            )}

                            {/* Manual Entry */}
                            <div className="mt-6 pt-4 border-t border-[#3A3B3C]">
                                <p className="text-xs text-[#8A8D91] mb-2">Or enter QR code manually</p>
                                <form onSubmit={handleManualSubmit} className="flex gap-2 max-w-sm mx-auto">
                                    <input
                                        type="text"
                                        value={manualQR}
                                        onChange={(e) => setManualQR(e.target.value)}
                                        placeholder="STAFF-1996-abc123"
                                        className="flex-1 px-3 py-2.5 bg-[#3A3B3C] border border-[#4E4F50] rounded-lg text-[#E4E6EB] text-sm focus:border-[#10B981] focus:outline-none"
                                    />
                                    <button
                                        type="submit"
                                        disabled={!manualQR.trim()}
                                        className="cmd-btn cmd-btn-primary px-4 py-2.5"
                                    >
                                        <LogIn className="w-4 h-4" />
                                    </button>
                                </form>
                            </div>
                        </div>

                        {/* Today's Log */}
                        <div className="cmd-panel">
                            <div className="p-4 border-b border-[#3A3B3C] flex items-center justify-between">
                                <h3 className="font-bold text-white flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-[#10B981]" />
                                    Today&apos;s Time Log
                                </h3>
                                <button onClick={() => fetchEntries()} className="text-xs text-[#1877F2] hover:underline">
                                    Refresh
                                </button>
                            </div>

                            {loading ? (
                                <div className="p-8 text-center text-[#B0B3B8] animate-pulse">Loading...</div>
                            ) : entries.length === 0 ? (
                                <div className="p-8 text-center">
                                    <Clock className="w-10 h-10 text-[#3A3B3C] mx-auto mb-2" />
                                    <p className="text-[#B0B3B8] text-sm">No clock entries today</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-[#3A3B3C]">
                                    {entries.map((entry) => (
                                        <div key={entry.id} className="px-4 py-3 flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${entry.clock_out ? 'bg-[#3A3B3C]' : 'bg-[#10B981]/10'
                                                }`}>
                                                {entry.clock_out ? (
                                                    <LogOut className="w-4 h-4 text-[#B0B3B8]" />
                                                ) : (
                                                    <LogIn className="w-4 h-4 text-[#10B981]" />
                                                )}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-medium text-[#E4E6EB] text-sm truncate">
                                                    {entry.staff_name}
                                                </div>
                                                <div className="text-xs text-[#B0B3B8] capitalize">{entry.staff_role}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-sm text-[#E4E6EB]">
                                                    {formatTime(entry.clock_in)}
                                                    {entry.clock_out ? ` — ${formatTime(entry.clock_out)}` : ''}
                                                </div>
                                                <div className={`text-xs font-medium ${entry.clock_out ? 'text-[#B0B3B8]' : 'text-[#10B981]'
                                                    }`}>
                                                    {entry.clock_out
                                                        ? formatDuration(entry.hours_worked)
                                                        : 'ON SHIFT'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </main>
                </div>
            </>
        </CommanderLayout>
    );
}
