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

import { Monitor, Tv, ExternalLink, Copy, CheckCircle2, Clock, Users, Trophy, Megaphone, Loader2, Timer } from 'lucide-react';
import CommanderLayout from '../../../src/components/commander/shared/CommanderLayout';
import { useCommanderSync } from '../../../src/lib/commander/useCommanderSync';
import { busEmit } from '../../../src/engine/EventBus';
import SEOHead from '../../../src/components/seo/SEOHead';
import { getVenueId } from '../../../src/lib/commander/clientAuth';
import { commanderFetchJSON } from '../../../src/lib/commander/commanderFetch';
import PageBar from '../../../src/components/commander/shared/PageBar';

/* Page Help tour (Dan, 2026-10-17): the setup instructions that used to sit
   at the top of the page, one step each. */
const DISPLAY_STEPS = [
  {
    title: 'Pick A Display',
    body: 'Each Card Is A Screen: Waitlist, Tournament Clocks, Room Boards, Leaderboards And More. Copy Its URL, Or Use Open Display And Preview.',
    target: '[data-tour="dsp-first"]',
  },
  {
    title: 'Wireless HDMI Setup',
    body: 'Connect The HDMI Transmitter To A Laptop, Tablet Or Chromecast, And The HDMI Receiver To The TV.',
  },
  {
    title: 'Open The Display',
    body: 'Open The Display URL In Chrome On The Source Device, Then Click Anywhere To Go Fullscreen.',
  },
  {
    title: 'Hands Free',
    body: 'Displays Refresh On Their Own. No Interaction Is Needed Once They Are Up.',
  },
];

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
      <div className="min-h-screen bg-[#040D18] text-[#F2F7FF] font-['Inter']">

        {/* The subtitle and the Wireless HDMI setup list moved behind the "?"
            (Dan, 2026-10-17). */}
        <PageBar
          title="Display Management"
          summary="Configure TV Displays For Wireless HDMI. Every Card Below Is A Screen You Can Put On A TV."
          steps={DISPLAY_STEPS}
          className="px-4 pt-2 pb-1"
        />

        {/* Waitlist Display */}
        <div className="px-4 pb-3" data-tour="dsp-first">
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
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
            color="#1981EC"
          />
        </div>

        {/* Tournament Clock Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
            Tournament Clocks
          </h2>

          {loading ? (
            <div className="py-8 text-center"><Loader2 className="w-6 h-6 text-[#86DAFF] animate-spin mx-auto" /></div>
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
            <div className="bg-[#0A1829] rounded-xl border border-[#445E77] p-6 text-center">
              <Clock className="w-8 h-8 text-[#7F97B0] mx-auto mb-2" />
              <p className="text-sm text-[#BDD0E2]">No Active Tournaments</p>
              <p className="text-xs text-[#BDD0E2]/60 mt-1">Start A Tournament To Enable Clock Display</p>
            </div>
          )}
        </div>

        {/* Room Displays */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
            Room Displays
          </h2>
          <div className="space-y-2">
            <DisplayCard
              icon={Megaphone}
              title="Promotions Board"
              description="Active Promotions, High Hand Leaderboard, Jackpot Amounts - Auto-Rotates"
              url={`${getBaseUrl()}/commander/displays/promotions`}
              path="/commander/displays/promotions"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#22D3EE"
            />
            <DisplayCard
              icon={Monitor}
              title="Announcements"
              description="Room-Wide Messages, Priority Alerts, Room Open/Closed Status"
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
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
            Player Table Displays
          </h2>
          <p className="text-xs text-[#BDD0E2] mb-2">
            Mount at each table - players see their time counting down. URL per table.
          </p>
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(t => (
              <DisplayCard
                key={t}
                icon={Timer}
                title={`Table ${t} - Player View`}
                description={`Live Countdown Timers For All Seated Players At Table ${t}`}
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
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
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
              color="#22D3EE"
            />
          </div>
        </div>

        {/* Lobby & Leaderboard */}
        <div className="px-4 pb-3">
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
            Lobby & Leaderboard
          </h2>
          <div className="space-y-2">
            <DisplayCard
              icon={Monitor}
              title="Lobby Display"
              description="Walk-In Player View: Running Games, Open Seats, Waitlist Counts, Upcoming Tournaments"
              url={`${getBaseUrl()}/commander/lobby`}
              path="/commander/lobby"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#1981EC"
            />
            <DisplayCard
              icon={Trophy}
              title="Leaderboard"
              description="Player Rankings, Points Leaders, Tournament Wins - Auto-Rotates Between Boards"
              url={`${getBaseUrl()}/commander/displays/leaderboard`}
              path="/commander/displays/leaderboard"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#22D3EE"
            />
          </div>
        </div>

        {/* Tournament Displays */}
        {activeTournaments.length > 0 && (
          <div className="px-4 pb-3">
            <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
              Tournament Displays
            </h2>
            <div className="space-y-2">
              {activeTournaments.map(t => (
                <div key={`td-${t.id}`}>
                  <DisplayCard
                    icon={Tv}
                    title={`${t.name} - Structure`}
                    description="Full Blind Schedule With Current Level Highlighted And Auto-Scroll"
                    url={`${getBaseUrl()}/commander/tournaments/${t.id}/structure-display`}
                    path={`/commander/tournaments/${t.id}/structure-display`}
                    copied={copied}
                    onCopy={copyUrl}
                    onOpen={openDisplay}
                    color="#5AA9FF"
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
          <h2 className="text-sm font-semibold text-[#BDD0E2] uppercase tracking-wider mb-2">
            Combined Displays
          </h2>
          <div className="space-y-2">
            {activeTournaments.length > 0 && (
              <>
                <DisplayCard
                  icon={Tv}
                  title="Clock + Waitlist"
                  description="Split-Screen: Tournament Clock Left, Waitlist Right"
                  url={`${getBaseUrl()}/commander/displays/combined?layout=clock+waitlist&tournament=${activeTournaments[0]?.id}`}
                  path={`/commander/displays/combined?layout=clock+waitlist&tournament=${activeTournaments[0]?.id}`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#1981EC"
                />
                <DisplayCard
                  icon={Tv}
                  title="Clock + Promotions"
                  description="Split-Screen: Tournament Clock Left, Promotions Right"
                  url={`${getBaseUrl()}/commander/displays/combined?layout=clock+promotions&tournament=${activeTournaments[0]?.id}`}
                  path={`/commander/displays/combined?layout=clock+promotions&tournament=${activeTournaments[0]?.id}`}
                  copied={copied}
                  onCopy={copyUrl}
                  onOpen={openDisplay}
                  color="#22D3EE"
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
              description="Split-Screen: Waitlist Board Left, Promotions Right"
              url={`${getBaseUrl()}/commander/displays/combined?layout=waitlist+promotions`}
              path="/commander/displays/combined?layout=waitlist+promotions"
              copied={copied}
              onCopy={copyUrl}
              onOpen={openDisplay}
              color="#BDD0E2"
            />
          </div>
        </div>
      </div>
    </CommanderLayout>
  );
}

function DisplayCard({ icon: Icon, title, description, url, path, copied, onCopy, onOpen, color }) {
  return (
    <div className="bg-[#0A1829] rounded-xl border border-[#445E77] p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${color}15` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-white">{title}</p>
          <p className="text-xs text-[#BDD0E2]">{description}</p>
        </div>
      </div>

      {/* URL display */}
      <div className="bg-[#132A42]/50 rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
        <code className="text-xs text-[#BDD0E2] flex-1 truncate">{url}</code>
        <button onClick={() => onCopy(url)}
          className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#132A42] flex items-center justify-center active:bg-[#1B3753]">
          {copied === url
            ? <CheckCircle2 className="w-4 h-4 text-[#31A24C]" />
            : <Copy className="w-4 h-4 text-[#BDD0E2]" />
          }
        </button>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button onClick={() => onOpen(path)}
          className="flex-1 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 active:bg-[#0A4AA8]"
          style={{ backgroundColor: color, color: 'white' }}>
          <ExternalLink className="w-4 h-4" /> Open Display
        </button>
        <button onClick={() => onOpen(`${path}?preview=1`)}
          className="px-4 py-2.5 rounded-lg bg-[#132A42] text-[#BDD0E2] text-sm font-medium active:bg-[#1B3753]">
          Preview
        </button>
      </div>
    </div>
  );
}
