/**
 * Scan Member QR Code Modal
 * Camera scanner + manual QR entry
 * NO EMOJIS (per /no-emoji-commander)
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { X, ScanLine, Camera, AlertCircle, User, Clock, Star, Loader2 } from 'lucide-react';
import { broadcastChange } from '../../../lib/commander/useCommanderSync';

const TIER_COLORS = { standard: '#BDD0E2', gold: '#22D3EE', platinum: '#A9BDD1', vip: '#5AA9FF' };

export default function ScanMemberModal({ isOpen, onClose, venueId, onMemberFound }) {
    const [scanning, setScanning] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [member, setMember] = useState(null);
    const [manualCode, setManualCode] = useState('');
    const videoRef = useRef(null);
    const streamRef = useRef(null);
    const animFrameRef = useRef(null);

    const startScanning = useCallback(async () => {
        setError(''); setMember(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            });
            streamRef.current = stream;
            if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
            setScanning(true);
            detectQR();
        } catch { setError('Camera access denied. Use manual entry below.'); }
    }, []);

    const stopScanning = useCallback(() => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
        setScanning(false);
    }, []);

    const detectQR = useCallback(async () => {
        if (!videoRef.current || videoRef.current.readyState !== 4) { animFrameRef.current = requestAnimationFrame(detectQR); return; }
        try {
            if ('BarcodeDetector' in window) {
                const barcodes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(videoRef.current);
                if (barcodes.length > 0 && barcodes[0].rawValue.startsWith('CMD-')) {
                    stopScanning(); await lookupMember(barcodes[0].rawValue); return;
                }
            }
        } catch (e) { console.warn('[App] Handled exception:', e); }
        animFrameRef.current = requestAnimationFrame(detectQR);
    }, []);

    const lookupMember = async (qrCode) => {
        setLoading(true); setError('');
        try {
            const res = await fetch('/api/commander/members/scan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ qr_code: qrCode, venue_id: venueId }),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Member not found');
            setMember(data.data.member);
            broadcastChange('members'); // Push check-in event dynamically
            if (onMemberFound) onMemberFound(data.data.member);
        } catch (err) { setError(err.message); }
        finally { setLoading(false); }
    };

    useEffect(() => () => stopScanning(), [stopScanning]);

    const handleClose = () => { stopScanning(); setMember(null); setError(''); setManualCode(''); onClose(); };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={handleClose} />
            <div className="relative bg-[#0A1829] rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-[#445E77] shadow-2xl">
                <div className="sticky top-0 bg-[#0A1829] border-b border-[#445E77] p-4 flex items-center justify-between z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#0C55C0]/10 rounded-full flex items-center justify-center">
                            <ScanLine className="w-5 h-5 text-[#86DAFF]" />
                        </div>
                        <h2 className="text-lg font-bold text-[#F2F7FF]">Scan Member Card</h2>
                    </div>
                    <button onClick={handleClose} className="p-2 hover:bg-[#132A42] rounded-lg"><X className="w-5 h-5 text-[#BDD0E2]" /></button>
                </div>
                <div className="p-4 space-y-4">
                    {error && <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0" /><p className="text-sm text-[#EF4444]">{error}</p></div>}
                    {loading && <div className="text-center py-8"><Loader2 className="w-8 h-8 text-[#86DAFF] animate-spin mx-auto mb-2" /><p className="text-sm text-[#BDD0E2]">Looking Up Member...</p></div>}

                    {member && !loading && (
                        <div className="bg-[#040D18] rounded-xl p-4 space-y-3">
                            <div className="flex items-center gap-3">
                                <div className="w-14 h-14 bg-[#132A42] rounded-full flex items-center justify-center overflow-hidden">
                                    {member.photo_url ? <img src={member.photo_url} alt="" className="w-14 h-14 rounded-full object-cover" /> : <User className="w-7 h-7 text-[#BDD0E2]" />}
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-lg font-bold text-[#F2F7FF]">{member.first_name} {member.last_name}</h3>
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-[#86DAFF]">{member.member_number}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: (TIER_COLORS[member.membership_tier] || '#BDD0E2') + '20', color: TIER_COLORS[member.membership_tier] }}>{member.membership_tier?.toUpperCase()}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm">
                                <div className="flex items-center gap-1.5 text-[#BDD0E2]"><Clock className="w-3.5 h-3.5" /><span>{member.total_visits || 0} visits</span></div>
                                <div className="flex items-center gap-1.5 text-[#BDD0E2]"><Star className="w-3.5 h-3.5" /><span>{member.membership_status}</span></div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pt-2">
                                <button className="py-2.5 bg-[#0C55C0] text-white rounded-lg text-sm font-medium">Seat At Table</button>
                                <button className="py-2.5 bg-[#132A42] text-[#F2F7FF] rounded-lg text-sm font-medium">Tournament Entry</button>
                                <button className="py-2.5 bg-[#132A42] text-[#F2F7FF] rounded-lg text-sm font-medium">Add Time</button>
                                <button className="py-2.5 bg-[#132A42] text-[#F2F7FF] rounded-lg text-sm font-medium">Update Status</button>
                            </div>
                            <button onClick={() => { setMember(null); startScanning(); }} className="w-full py-2 text-[#86DAFF] text-sm font-medium">Scan Another Card</button>
                        </div>
                    )}

                    {!member && !loading && (
                        <>
                            {scanning ? (
                                <div className="space-y-3">
                                    <div className="relative rounded-xl overflow-hidden bg-black">
                                        <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-[4/3]" />
                                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="w-48 h-48 border-2 border-[#1981EC] rounded-xl animate-pulse" /></div>
                                    </div>
                                    <p className="text-center text-sm text-[#BDD0E2]">Hold The Member Card QR Code In View</p>
                                    <button onClick={stopScanning} className="w-full py-2.5 bg-[#132A42] text-[#BDD0E2] rounded-lg text-sm font-medium">Stop Camera</button>
                                </div>
                            ) : (
                                <button onClick={startScanning} className="w-full py-8 border-2 border-dashed border-[#445E77] rounded-xl flex flex-col items-center gap-3 hover:border-[#1981EC] transition-colors">
                                    <Camera className="w-10 h-10 text-[#BDD0E2]" />
                                    <span className="text-sm font-medium text-[#F2F7FF]">Open Camera To Scan</span>
                                    <span className="text-xs text-[#9FB3C8]">Scan A Member QR Code Card</span>
                                </button>
                            )}
                            <div className="border-t border-[#445E77] pt-4">
                                <p className="text-xs text-[#BDD0E2] mb-2">Or Enter QR Code Manually:</p>
                                <div className="flex gap-2">
                                    <input type="text" value={manualCode} onChange={e => setManualCode(e.target.value)} className="flex-1 px-3 py-2.5 bg-[#132A42] border border-[#5A7590] rounded-lg text-[#F2F7FF] text-sm focus:border-[#1981EC] focus:outline-none" placeholder="CMD-1996-abc12345" onKeyDown={e => e.key === 'Enter' && lookupMember(manualCode.trim())} />
                                    <button onClick={() => lookupMember(manualCode.trim())} className="px-4 py-2.5 bg-[#0C55C0] text-white rounded-lg text-sm font-medium">Look Up</button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
