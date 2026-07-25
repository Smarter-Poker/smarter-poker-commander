import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import SEOHead from '../../src/components/seo/SEOHead';
import { Send, Users, Clock, CheckCircle, Loader2 } from 'lucide-react';
import CommanderLayout from '../../src/components/commander/shared/CommanderLayout';
import { broadcastChange } from '../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../src/engine/EventBus';
import { getStaffSession } from '../../src/lib/commander/clientAuth';
import { commanderFetch } from '../../src/lib/commander/commanderFetch';

const QUICK_MESSAGES = [
  { label: 'Game Starting', message: 'New Game Starting! Check In At The Desk.' },
  { label: 'Seat Available', message: 'Seats Are Now Available. Join The Waitlist!' },
  { label: 'Tournament Starting', message: 'Tournament Registration Closing Soon.' },
  { label: 'Food Service', message: 'Food Service Now Available. See Staff To Order.' },
  { label: 'Last Call', message: 'Last Call For Waitlist Signups.' },
  { label: 'High Hand', message: 'New High Hand Promotion Starting Now!' }
];

export default function CommanderAnnouncementsPage() {
  const router = useRouter();
  useEffect(() => { busEmit.sessionStart('commander-announcements'); }, []);

  const [staff, setStaff] = useState(null);
  const [venueId, setVenueId] = useState(null);
  const [venue, setVenue] = useState(null);
  const [message, setMessage] = useState('');
  const [sendTo, setSendTo] = useState('all'); // 'all', 'waitlist', 'seated'
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState(null);
  const [recentAnnouncements, setRecentAnnouncements] = useState([]);

  // Check staff session
  useEffect(() => {
    const storedStaff = getStaffSession();
    if (!storedStaff) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
      return;
    }

    try {
      const staffData = JSON.parse(storedStaff);
      if (!staffData.venue_id) {
        router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
        return;
      }
      setStaff(staffData);
      setVenueId(staffData.venue_id);
      if (staffData.venue_name) {
        setVenue({ id: staffData.venue_id, name: staffData.venue_name });
      }
    } catch (err) {
      router.push('/commander/login').catch(e => console.warn('[App] Handled promise rejection:', e?.message || e));
    }
  }, [router]);

  async function handleSend() {
    if (!message.trim()) return;

    setSending(true);
    setError(null);
    setSuccess(null);

    try {
const res = await commanderFetch('/api/commander/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venue_id: venueId,
          message: message.trim(),
          target: sendTo,
          type: 'announcement'
        })
      });
      // 2026-07-25 audit fix: surface the server's error message on non-OK
      // responses instead of a generic connection error
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message || body?.error || `Failed to send announcement (${res.status})`);
        return;
      }

      const data = await res.json();

      if (data.success) {
        setSuccess(`Sent to ${data.data?.sent_count || 0} players`);
        setRecentAnnouncements(prev => [
          {
            id: Date.now(),
            message: message.trim(),
            target: sendTo,
            sent_at: new Date().toISOString(),
            sent_count: data.data?.sent_count || 0
          },
          ...prev
        ].slice(0, 10));
        setMessage('');
        broadcastChange('settings');
        busEmit.celebration('confetti');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error?.message || 'Failed to send announcement');
      }
    } catch (err) {
      setError('Connection error. Please try again.');
    } finally {
      setSending(false);
    }
  }

  function handleQuickMessage(msg) {
    setMessage(msg);
  }

  if (!staff) {
    return (
      <div className="cmd-page flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#1877F2]" />
      </div>
    );
  }

  return (
    <CommanderLayout title="Announcements | {venue?.name || 'Commander'}" backHref="/commander/dashboard?card=displays">
      <>
        <SEOHead
          title="Commander — Announcements"
          description="Club Commander Poker Room Management Tool."
          noindex={true}
        />

        <div className="cmd-page">
          {/* Main Content */}
          <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
            {/* Alerts */}
            {success && (
              <div className="p-4 bg-[#31A24C]/10 rounded-xl flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-[#31A24C]" />
                <p className="text-sm text-[#31A24C] font-medium">{success}</p>
              </div>
            )}
            {error && (
              <div className="p-4 bg-[#EF4444]/10 rounded-xl">
                <p className="text-sm text-[#EF4444]">{error}</p>
              </div>
            )}

            {/* Compose */}
            <section className="cmd-panel p-4 space-y-4">
              <h2 className="font-semibold text-white">Send Announcement</h2>

              {/* Target Selection */}
              <div>
                <label className="block text-sm font-medium text-[#B0B3B8] mb-2">
                  Send to
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'all', label: 'All Players', icon: Users },
                    { value: 'waitlist', label: 'Waitlist Only', icon: Clock },
                    { value: 'seated', label: 'Seated Only', icon: Users }
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSendTo(value)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${sendTo === value
                        ? 'bg-[#1877F2] text-white'
                        : 'bg-[#3A3B3C] text-white hover:bg-[#3A3B3C]'
                        }`}
                    >
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Messages */}
              <div>
                <label className="block text-sm font-medium text-[#B0B3B8] mb-2">
                  Quick Messages
                </label>
                <div className="flex flex-wrap gap-2">
                  {QUICK_MESSAGES.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleQuickMessage(item.message)}
                      className="px-3 py-1.5 bg-[#3A3B3C] text-white text-sm rounded-full hover:bg-[#3A3B3C] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Message Input */}
              <div>
                <label className="block text-sm font-medium text-[#B0B3B8] mb-2">
                  Message
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type Your Announcement..."
                  rows={3}
                  className="w-full px-3 py-2 cmd-input resize-none"
                />
                <p className="text-xs text-[#3A3B3C] mt-1">
                  {message.length}/160 characters
                </p>
              </div>

              {/* Send Button */}
              <button
                onClick={handleSend}
                disabled={!message.trim() || sending}
                className="w-full h-12 cmd-btn cmd-btn-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {sending ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Send Announcement
                  </>
                )}
              </button>
            </section>

            {/* Recent Announcements */}
            {recentAnnouncements.length > 0 && (
              <section>
                <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wide mb-3">
                  Recent Announcements
                </h2>
                <div className="cmd-panel divide-y divide-[#3A3B3C]">
                  {recentAnnouncements.map((ann) => (
                    <div key={ann.id} className="p-4">
                      <p className="text-white">{ann.message}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-[#B0B3B8]">
                        <span>Sent to {ann.sent_count} players</span>
                        <span>{new Date(ann.sent_at).toLocaleTimeString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </main>
        </div>
        <style>{`
`}</style>
      </>
    </CommanderLayout>
  );
}
