/**
 * Venue QR Code Display Page
 * Staff can display QR code for player check-in
 * Dark industrial sci-fi gaming theme
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { QrCode, Download, Maximize2 } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';

export default function VenueQRCodePage() {
  useEffect(() => { busEmit.sessionStart('commander-qr-code'); }, []);
  const router = useRouter();

  const [staff, setStaff] = useState(null);
  const [venue, setVenue] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      setStaff(staffData);
      setVenueId(staffData.venue_id);
      if (staffData.venue_name) {
        setVenue({ id: staffData.venue_id, name: staffData.venue_name });
      }

      // Generate check-in URL.
      // 2026-07-25 audit fix: always use the canonical player origin - QR
      // codes generated on commander.smarter.poker previously encoded
      // commander.smarter.poker/hub/... which 404s (no /hub pages there),
      // killing check-in for every printed code.
      const checkInUrl = `https://smarter.poker/hub/commander/check-in/${staffData.venue_id}`;
      setQrUrl(checkInUrl);
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  // Generate QR code using Google Charts API (simple, no dependencies)
  function getQRCodeUrl(size = 300) {
    if (!qrUrl) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(qrUrl)}&bgcolor=ffffff&color=1877F2`;
  }

  function handleDownload() {
    const link = document.createElement('a');
    link.href = getQRCodeUrl(500);
    link.download = `${venue?.name || 'venue'}-checkin-qr.png`;
    link.click();
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  }

  useEffect(() => {
    function handleFullscreenChange() {
      setFullscreen(!!document.fullscreenElement);
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <div className="animate-pulse text-[#B0B3B8]">Loading...</div>
      </div>
    );
  }

  if (fullscreen) {
    return (
      <div
        className="min-h-screen bg-white flex flex-col items-center justify-center p-8 cursor-pointer"
        onClick={toggleFullscreen}
      >
        <h1 className="text-4xl font-bold text-[#1877F2] mb-2">{venue?.name}</h1>
        <p className="text-xl text-[#B0B3B8] mb-8">Scan To Check In</p>
        <img
          src={getQRCodeUrl(400)}
          alt="Check-In QR Code"
          className="w-96 h-96"
         loading="lazy" />
        <p className="text-sm text-[#3A3B3C] mt-8">Tap Anywhere To Exit Fullscreen</p>
      </div>
    );
  }

  return (
    <CommanderLayout title={`Check-In QR Code | ${venue?.name || 'Commander'}`} backHref="/commander/dashboard?card=waitlist">
      <>
        <SEOHead
                title="Commander - QR Code"
                description="Club Commander Poker Room Management Tool."
                noindex={true}
            />

        <div className="cmd-page">
          {/* Header */}
          <header className="cmd-header-bar">
            <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div>
                  <h1 className="font-bold text-white">Check-In QR Code</h1>
                  <p className="text-sm text-[#B0B3B8]">{venue?.name}</p>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-2xl mx-auto px-4 py-8">
            {/* QR Code Display */}
            <div className="cmd-panel p-8 text-center">
              <div className="w-20 h-20 bg-[#1877F2]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <QrCode className="w-10 h-10 text-[#1877F2]" />
              </div>

              <h2 className="text-xl font-bold text-white mb-2">
                Player Check-In
              </h2>
              <p className="text-[#B0B3B8] mb-6">
                Display this QR code for players to scan and check in
              </p>

              {/* QR Code Image - keep white background for QR readability */}
              <div className="bg-white rounded-xl p-6 mb-6 inline-block">
                {qrUrl ? (
                  <img
                    src={getQRCodeUrl(250)}
                    alt="Check-In QR Code"
                    className="w-64 h-64 mx-auto"
                   loading="lazy" />
                ) : (
                  <div className="w-64 h-64 bg-[#E5E7EB] animate-pulse rounded-lg" />
                )}
              </div>

              {/* URL Display */}
              <div className="bg-[#3A3B3C] rounded-lg p-3 mb-6">
                <p className="text-xs text-[#B0B3B8] mb-1">Check-In URL</p>
                <p className="text-sm text-white font-mono break-all">{qrUrl}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-center">
                <button
                  onClick={handleDownload}
                  className="cmd-btn cmd-btn-secondary flex items-center gap-2 px-6 py-3"
                >
                  <Download className="w-5 h-5" />
                  Download
                </button>
                <button
                  onClick={toggleFullscreen}
                  className="cmd-btn cmd-btn-primary flex items-center gap-2 px-6 py-3"
                >
                  <Maximize2 className="w-5 h-5" />
                  Fullscreen
                </button>
              </div>
            </div>

            {/* Tips */}
            <div className="mt-6 bg-[#1877F2]/5 rounded-xl p-4">
              <h3 className="font-medium text-[#1877F2] mb-2">Tips</h3>
              <ul className="text-sm text-[#B0B3B8] space-y-1">
                <li>Display On A Tablet Near The Entrance</li>
                <li>Print And Post At The Check-In Desk</li>
                <li>Use Fullscreen Mode For TV Displays</li>
                <li>Players Need To Be Logged In To Check In</li>
              </ul>
            </div>
          </main>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
