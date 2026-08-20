/**
 * Display Management
 * /commander/displays (enhanced from existing placeholder)
 * Configure and launch TV displays for wireless HDMI transmitters
 * Each display gets a URL that runs fullscreen on the HDMI source device
 * 
 * Display types:
 * - Tournament Clock: /commander/tournaments/[id]/clock-display
 * - Waitlist Board: /commander/displays/waitlist
 * - Promotions: /commander/displays/promotions (future)
 * - Combined: /commander/displays/combined (future)
 */
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';

import { Monitor, Tv, ExternalLink, Copy, CheckCircle2, Clock, Users, Trophy, Megaphone, Loader2, Wifi, Timer } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';

export default function DisplayManagement() {
  useEffect(() => { busEmit.sessionStart('commander-displays-index'); }, []);
  const router = useRouter();
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(null);

  const fetchData = useCallback(async(signal) => {
    try {
const json = await commanderFetchJSON('/api/commander/tournaments', {
        
      });
      if (json.success) {
        const list = json.data?.tournaments || (Array.isArray(json.data) ? json.data : []);
        setTournaments(list);
      }
    } catch (err) { console.warn(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {    const _c = new AbortController();

    fetchData();
    return () => _c.abort();
  }, [fetchData]);

  // Extract venueId for cross-device Supabase sync
  const [venueId] = useState(() => {
    return getVenueId();
  });

  // Commander Data Bus - sync tournament list
  useCommanderSync(venueId, fetchData, { entities: ['tournaments'] });

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return '';
  };

  const copyUrl = (url) => {
    navigator.clipboard?.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied(null), 2000);
  };

  const openDisplay = (path) => {
    window.open(path, '_blank', 'noopener');
  };

  const activeTournaments = tournaments.filter(t =>
    ['running', 'paused', 'break', 'final_table', 'registration', 'registering'].includes(t.status)
  );

  return (
    <CommanderLayout title="Display Management" backHref="/commander/dashboard?card=displays">
      <SEOHead
              title="Commander - Displays Hub"
              description="Club Commander Poker Room Management Tool."
              noindex={true}
            />
      <div className="min-h-screen bg-[#18191A] text-[#E4E6EB] font-['Inter']">

        {/* Subtitle */}
        <div className="px-4 py-2">
          <p className="text-xs text-[#B0B3B8]">Configure TV Displays For Wireless HDMI</p>
        </div>

        {/* Setup Instructions */}
        <div className="px-4 py-4">
          <div className="bg-[#1877F2]/10 border border-[#1877F2]/30 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <Wifi className="w-5 h-5 text-[#1877F2] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-[#1877F2] mb-1">Wireless HDMI Setup</h3>
                <ol className="text-xs text-[#B0B3B8] space-y-1">
                  <li>1. Connect HDMI Transmitter To A Laptop/tablet/Chromecast</li>
                  <li>2. Connect HDMI Receiver To The TV</li>
                  <li>3. Open The Display URL In Chrome On The Source Device</li>
                  <li>4. Click Anywhere To Go Fullscreen</li>
                  <li>5. Display Auto-refreshes - No Interaction Needed</li>
                </ol>
              </div>
            </div>
          </div>
        </div>

        {/* Waitlist Display */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Waitlist Display
          </h2>
          <DisplayCard
            icon={Users}
            title="Waitlist Board"
            description="Shows Active Games, Open Seats, Waiting Players With Positions"
            url={`${getBaseUrl()}/commander/displays/waitlist`}
            path="/commander/displays/waitlist"
            copied={copied}
            onCopy={copyUrl}
            onOpen={openDisplay}
            color="#1877F2"
          />
        </div>

        {/* Tournament Clock Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Tournament Clocks
          </h2>

          {loading ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-[#1877F2] animate-spin mx-auto" /></div>
          ) : activeTournaments.length > 0 ? (
            <div className="space-y-2">
              {activeTournaments.map(t => (
                <DisplayCard
                  key={t.id}
                  icon={Clock}
                  title={t.name}
                  description={`${t.status === 'running' ? 'Running' : t.status === 'paused' ? 'Paused' : t.status} - Level ${(t.current_level || 0) + 1}`}
                  url={`${getBaseUrl()}/commander/tournaments/${t.id}/clock-display`}
                  path={`/commander/tournaments/${t.id}/clock-display`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#31A24C"
                />
              ))}
            </div>
          ) : (
            <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-6 text-center">
              <Clock className="w-8 h-8 text-[#3A3B3C] mx-auto mb-2" />
              <p className="text-sm text-[#B0B3B8]">No Active Tournaments</p>
              <p className="text-xs text-[#B0B3B8]/60 mt-1">Start A Tournament To Enable Clock Display</p>
            </div>
          )}
        </div>

        {/* Room Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Room Displays
          </h2>
          <div className="space-y-2">
            <DisplayCard
              icon={Megaphone}
              title="Promotions Board"
              description="Active Promotions, High Hand Leaderboard, Jackpot Amounts - Auto-rotates"
              url={`${getBaseUrl()}/commander/displays/promotions`}
              path="/commander/displays/promotions"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#F59E0B"
            />
            <DisplayCard
              icon={Monitor}
              title="Announcements"
              description="Room-wide Messages, Priority Alerts, Room Open/closed Status"
              url={`${getBaseUrl()}/commander/displays/announcements`}
              path="/commander/displays/announcements"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#31A24C"
            />

          </div>
        </div>

        {/* Player / Table Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Player Table Displays
          </h2>
          <p className="text-xs text-[#B0B3B8] mb-2">
            Mount at each table - players see their time counting down. URL per table.
          </p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => (
              <DisplayCard
                key={t}
                icon={Timer}
                title={`Table ${t} - Player View`}
                description={`Live countdown timers for all seated players at Table ${t}`}
                url={`${getBaseUrl()}/commander/player/${t}`}
                path={`/commander/player/${t}`}
                copied={copied}
                onCopy={copyUrl}
                onOpen={openDisplay}
                color="#31A24C"
              />
            ))}
          </div>
        </div>

        {/* Staff Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Staff Displays
          </h2>
          <div className="space-y-2">
            <DisplayCard
              icon={Users}
              title="Dealer Rotation"
              description="Current Table Assignments, Break Schedule, Next Rotation Time"
              url={`${getBaseUrl()}/commander/displays/dealers`}
              path="/commander/displays/dealers"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#F59E0B"
            />
          </div>
        </div>

        {/* Lobby & Leaderboard */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Lobby & Leaderboard
          </h2>
          <div className="space-y-2">
            <DisplayCard
              icon={Monitor}
              title="Lobby Display"
              description="Walk-in Player View: Running Games, Open Seats, Waitlist Counts, Upcoming Tournaments"
              url={`${getBaseUrl()}/commander/lobby`}
              path="/commander/lobby"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#1877F2"
            />
            <DisplayCard
              icon={Trophy}
              title="Leaderboard"
              description="Player Rankings, Points Leaders, Tournament Wins - Auto-rotates Between Boards"
              url={`${getBaseUrl()}/commander/displays/leaderboard`}
              path="/commander/displays/leaderboard"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#F59E0B"
            />
          </div>
        </div>

        {/* Tournament Displays */}
        {activeTournaments.length > 0 && (
          <div className="px-4 pb-3">
            <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
              Tournament Displays
            </h2>
            <div className="space-y-2">
              {activeTournaments.map(t => (
                <div key={`td-${t.id}`}>
                  <DisplayCard
                    icon={Tv}
                    title={`${t.name} - Structure`}
                    description="Full Blind Schedule With Current Level Highlighted And Auto-scroll"
                    url={`${getBaseUrl()}/commander/tournaments/${t.id}/structure-display`}
                    path={`/commander/tournaments/${t.id}/structure-display`}
                    copied={copied}
                    onCopy={copyUrl}
                    onOpen={openDisplay}
                    color="#A855F7"
                  />
                  <div className="h-2" />
                  <DisplayCard
                    icon={Users}
                    title={`${t.name} - Seating Chart`}
                    description="All Tables With Player Seat Assignments, Chip Counts"
                    url={`${getBaseUrl()}/commander/tournaments/${t.id}/seating-display`}
                    path={`/commander/tournaments/${t.id}/seating-display`}
                    copied={copied}
                    onCopy={copyUrl}
                    onOpen={openDisplay}
                    color="#EF4444"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Combined Displays */}
        <div className="px-4 pb-4">
          <h2 className="text-sm font-semibold text-[#B0B3B8] uppercase tracking-wider mb-2">
            Combined Displays
          </h2>
          <div className="space-y-2">
            {activeTournaments.length > 0 && (
              <>
                <DisplayCard
                  icon={Tv}
                  title="Clock + Waitlist"
                  description="Split-screen: Tournament Clock Left, Waitlist Right"
                  url={`${getBaseUrl()}/commander/displays/combined?layout=clock+waitlist&tournament=${activeTournaments[0]?.id}`}
                  path={`/commander/displays/combined?layout=clock+waitlist&tournament=${activeTournaments[0]?.id}`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#1877F2"
                />
                <DisplayCard
                  icon={Tv}
                  title="Clock + Promotions"
                  description="Split-screen: Tournament Clock Left, Promotions Right"
                  url={`${getBaseUrl()}/commander/displays/combined?layout=clock+promotions&tournament=${activeTournaments[0]?.id}`}
                  path={`/commander/displays/combined?layout=clock+promotions&tournament=${activeTournaments[0]?.id}`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#F59E0B"
                />
                <DisplayCard
                  icon={Tv}
                  title="3-Panel: Everything"
                  description="Clock + Waitlist + Promotions On One Screen"
                  url={`${getBaseUrl()}/commander/displays/combined?layout=clock+waitlist+promotions&tournament=${activeTournaments[0]?.id}`}
                  path={`/commander/displays/combined?layout=clock+waitlist+promotions&tournament=${activeTournaments[0]?.id}`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#31A24C"
                />
              </>
            )}
            <DisplayCard
              icon={Tv}
              title="Waitlist + Promotions"
              description="Split-screen: Waitlist Board Left, Promotions Right"
              url={`${getBaseUrl()}/commander/displays/combined?layout=waitlist+promotions`}
              path="/commander/displays/combined?layout=waitlist+promotions"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#B0B3B8"
            />
          </div>
        </div>
      </div>
    </CommanderLayout>
  );
}

function DisplayCard({ icon: Icon, title, description, url, path, copied, onCopy, onOpen, color }) {
  return (
    <div className="bg-[#242526] rounded-xl border border-[#3A3B3C] p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white">{title}</p>
          <p className="text-xs text-[#B0B3B8]">{description}</p>
        </div>
      </div>

      {/* URL display */}
      <div className="bg-[#3A3B3C]/50 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <code className="text-xs text-[#B0B3B8] flex-1 truncate">{url}</code>
        <button onClick={() => onCopy(url)}
          className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#3A3B3C] flex items-center justify-center active:bg-[#4A4B4C]">
          {copied === url
            ? <CheckCircle2 className="w-4 h-4 text-[#31A24C]" />
            : <Copy className="w-4 h-4 text-[#B0B3B8]" />
          }
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => onOpen(path)}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 active:bg-[#1565D8]"
          style={{ backgroundColor: color, color: 'white' }}>
          <ExternalLink className="w-4 h-4" /> Open Display
        </button>
        <button onClick={() => onOpen(`${path}?preview=1`)}
          className="px-4 py-2.5 rounded-lg bg-[#3A3B3C] text-[#B0B3B8] text-sm font-medium active:bg-[#4A4B4C]">
          Preview
        </button>
      </div>
    </div>
  );
}
