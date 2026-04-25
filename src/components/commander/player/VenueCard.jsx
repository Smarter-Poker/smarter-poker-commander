/**
 * VenueCard Component - Dark industrial sci-fi gaming UI
 * Metallic chrome frames, rivets, glowing accents
 */
import { MapPin, Users, Clock, ChevronRight, Star, Zap, Radio } from 'lucide-react';
import Link from 'next/link';

export default function VenueCard({ venue, games = [], waitlistCounts = {} }) {
  const runningGames = games.filter(g => g.status === 'running');
  const totalWaiting = Object.values(waitlistCounts || {}).reduce((a, b) => a + b, 0);

  return (
    <Link
      href={`/hub/commander/venue/${venue.id}`}
      className="block cmd-panel cmd-corner-lights p-6 hover:shadow-[0_0_30px_rgba(34,211,238,0.3)] transition-all group"
    >
      {/* Corner glow lights */}
      <span className="cmd-light cmd-light-tl" />
      <span className="cmd-light cmd-light-br" />

      {/* Rivets */}
      <div className="absolute top-3 left-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute top-3 right-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute bottom-3 right-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute bottom-3 left-3"><span className="cmd-rivet cmd-rivet-sm" /></div>

      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-4">
            <div className="cmd-icon-box w-14 h-14 group-hover:cmd-icon-box-glow transition-all">
              <Zap className="w-7 h-7" />
            </div>
            <div>
              <h3 className="font-extrabold text-white text-xl tracking-wide group-hover:text-[#22D3EE] transition-colors">
                {venue.name}
              </h3>
              <p className="text-sm text-[#64748B] flex items-center gap-2 mt-1 font-medium">
                <MapPin className="w-4 h-4" />
                {venue.city}, {venue.state}
              </p>
            </div>
          </div>
          {venue.trust_score && (
            <div className="mt-3 ml-[72px]">
              <span className="cmd-badge cmd-badge-warning">
                <Star className="w-4 h-4" />
                {venue.trust_score.toFixed(1)} RATING
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-3">
          {venue.commander_enabled && (
            <span className="cmd-badge cmd-badge-live">
              <Radio className="w-4 h-4" />
              LIVE
            </span>
          )}
          <div className="cmd-icon-box cmd-icon-box-square w-12 h-12 group-hover:cmd-icon-box-glow transition-all">
            <ChevronRight className="w-6 h-6" />
          </div>
        </div>
      </div>

      {runningGames.length > 0 && (
        <>
          <div className="cmd-divider" style={{ margin: '20px 0' }} />
          <div className="flex items-center gap-4 flex-wrap">
            <span className="cmd-badge cmd-badge-live">
              <Users className="w-4 h-4" />
              {runningGames.length} GAME{runningGames.length !== 1 ? 'S' : ''} RUNNING
            </span>
            {totalWaiting > 0 && (
              <span className="cmd-badge cmd-badge-warning">
                <Clock className="w-4 h-4" />
                {totalWaiting} WAITING
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {runningGames.slice(0, 4).map((game) => (
              <span key={game.id} className="cmd-badge cmd-badge-primary">
                {game.game_type?.toUpperCase()} {game.stakes}
              </span>
            ))}
            {runningGames.length > 4 && (
              <span className="cmd-badge cmd-badge-chrome">
                +{runningGames.length - 4} MORE
              </span>
            )}
          </div>
        </>
      )}

      {venue.distance_mi && (
        <div className="mt-4 text-xs text-[#64748B] font-bold uppercase tracking-[0.2em]">
          {venue.distance_mi} miles away
        </div>
      )}
    </Link>
  );
}
