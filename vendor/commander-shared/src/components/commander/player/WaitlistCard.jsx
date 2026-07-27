/**
 * WaitlistCard Component - Dark industrial sci-fi gaming UI
 * Metallic chrome frames, rivets, glowing accents
 */
import { Clock, MapPin, X, Zap, AlertTriangle } from 'lucide-react';

export default function WaitlistCard({ entry, onLeave, confirmingLeave = false }) {
  const { waitlist_entry, venue, position, estimated_wait } = entry;
  const isCalled = waitlist_entry?.status === 'called';

  return (
    <div className={`cmd-panel cmd-corner-lights p-6 ${isCalled ? 'shadow-[0_0_30px_rgba(16,185,129,0.4)]' : ''}`}>
      {/* Corner glow lights */}
      <span className="cmd-light cmd-light-tl" />
      <span className="cmd-light cmd-light-tr" />
      <span className="cmd-light cmd-light-bl" />
      <span className="cmd-light cmd-light-br" />

      {/* Rivets */}
      <div className="absolute top-3 left-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute top-3 right-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute bottom-3 left-3"><span className="cmd-rivet cmd-rivet-sm" /></div>
      <div className="absolute bottom-3 right-3"><span className="cmd-rivet cmd-rivet-sm" /></div>

      {/* Seat Ready Alert */}
      {isCalled && (
        <div className="mb-5 cmd-inset p-5 text-center" style={{
          borderColor: '#10B981',
          boxShadow: '0 0 25px rgba(16, 185, 129, 0.3), inset 0 4px 12px rgba(0,0,0,0.5)'
        }}>
          <div className="flex items-center justify-center gap-3">
            <AlertTriangle className="w-6 h-6 text-[#10B981]" />
            <div>
              <p className="font-extrabold text-[#10B981] text-lg uppercase tracking-wider cmd-text-glow">
                YOUR SEAT IS READY!
              </p>
              <p className="text-sm text-[#CBD5E1] font-medium mt-1">Please Check In At The Desk</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="cmd-icon-box cmd-icon-box-glow w-14 h-14">
            <Zap className="w-7 h-7" />
          </div>
          <div>
            <h3 className="font-extrabold text-xl tracking-wide">
              <span className="text-[#22D3EE] cmd-text-glow">{waitlist_entry?.game_type?.toUpperCase()}</span>
              <span className="text-white ml-2">{waitlist_entry?.stakes}</span>
            </h3>
            {venue && (
              <p className="text-sm text-[#64748B] flex items-center gap-2 mt-1 font-medium">
                <MapPin className="w-4 h-4" />
                {venue.name}
              </p>
            )}
          </div>
        </div>
        {onLeave && !isCalled && (
          confirmingLeave ? (
            <button onClick={onLeave} className="cmd-btn py-2 px-3 text-xs font-bold" style={{ background: '#EF4444', color: '#fff' }}>
              Confirm Leave?
            </button>
          ) : (
            <button onClick={onLeave} className="cmd-btn cmd-btn-danger py-3 px-4" title="Leave Waitlist">
              <X className="w-5 h-5" />
            </button>
          )
        )}
      </div>

      {/* Stats */}
      <div className="mt-6 flex items-center justify-center gap-10">
        <div className="text-center">
          <div className="cmd-stat-value">#{position}</div>
          <div className="cmd-stat-label">Position</div>
        </div>

        <div className="h-16 w-px" style={{
          background: 'linear-gradient(180deg, transparent 0%, #22D3EE 50%, transparent 100%)',
          boxShadow: '0 0 10px rgba(34, 211, 238, 0.5)'
        }} />

        <div className="text-center">
          <div className="cmd-stat-value flex items-center gap-3">
            <Clock className="w-10 h-10 text-[#64748B]" />
            {estimated_wait || '--'}
          </div>
          <div className="cmd-stat-label">Est. Minutes</div>
        </div>
      </div>

      {/* Footer */}
      <div className="cmd-divider" style={{ margin: '24px 0 16px 0' }} />

      <div className="flex items-center justify-between">
        <span className="text-xs text-[#64748B] font-bold uppercase tracking-wider">
          Joined {waitlist_entry?.created_at
            ? new Date(waitlist_entry.created_at).toLocaleTimeString()
            : '--'}
        </span>
        {waitlist_entry?.call_count > 0 && (
          <span className="cmd-badge cmd-badge-warning">
            <AlertTriangle className="w-4 h-4" />
            CALLED {waitlist_entry.call_count}x
          </span>
        )}
      </div>
    </div>
  );
}
