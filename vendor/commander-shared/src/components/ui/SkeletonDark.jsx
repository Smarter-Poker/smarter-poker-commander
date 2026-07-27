/**
 * SkeletonDark — shimmer placeholder for dark-theme Commander/Club Arena pages
 *
 * Usage:
 *   import SkeletonDark from '../ui/SkeletonDark';
 *
 *   {loading && <SkeletonDark variant="table-rows" rows={5} />}
 *   {loading && <SkeletonDark variant="stat-cards" count={4} />}
 *   {loading && <SkeletonDark variant="waitlist" rows={6} />}
 *   {loading && <SkeletonDark variant="tournament" />}
 *   {loading && <SkeletonDark variant="poker-room" />}
 */

const CSS = `
@keyframes sk-dark-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.sk-dark {
  background: linear-gradient(90deg, #2A2B2C 25%, #3A3B3C 50%, #2A2B2C 75%);
  background-size: 200% 100%;
  animation: sk-dark-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
}
`;

function Box({ w = '100%', h = 14, r = 6, mb = 0, style = {} }) {
    return (
        <div className="sk-dark" style={{
            width: w, height: h, borderRadius: r,
            marginBottom: mb, flexShrink: 0, ...style
        }} />
    );
}

// ── Single stat card (e.g. "Active Tables: 4")
function StatCard() {
    return (
        <div style={{ background: '#242526', border: '1px solid #3A3B3C', borderRadius: 10, padding: '16px 18px' }}>
            <Box w="40%" h={11} mb={10} style={{ opacity: 0.6 }} />
            <Box w="55%" h={26} mb={8} />
            <Box w="30%" h={10} style={{ opacity: 0.4 }} />
        </div>
    );
}

// ── Table/waitlist row (name + seat + status + action)
function TableRow() {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '11px 14px', borderBottom: '1px solid #3A3B3C'
        }}>
            <Box w={36} h={36} r={8} />
            <div style={{ flex: 1 }}>
                <Box w="45%" h={13} mb={6} />
                <Box w="28%" h={10} />
            </div>
            <Box w={60} h={24} r={20} />
            <Box w={72} h={30} r={8} />
        </div>
    );
}

// ── Waitlist entry row (player + game type + wait time + action)
function WaitlistRow() {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 14px', borderBottom: '1px solid #3A3B3C'
        }}>
            <Box w={32} h={32} r={16} />
            <div style={{ flex: 1 }}>
                <Box w="40%" h={13} mb={5} />
                <Box w="55%" h={10} />
            </div>
            <Box w={48} h={22} r={6} style={{ opacity: 0.7 }} />
            <Box w={56} h={28} r={8} />
        </div>
    );
}

// ── Poker room — table grid card
function PokerTableCard() {
    return (
        <div style={{
            background: '#242526', border: '1px solid #3A3B3C', borderRadius: 12,
            padding: 14, minWidth: 200
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <Box w="40%" h={16} />
                <Box w={52} h={22} r={11} />
            </div>
            {/* Seat bubbles */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {Array.from({ length: 9 }).map((_, i) => <Box key={i} w={28} h={28} r={14} />)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
                <Box w="50%" h={30} r={8} />
                <Box w="50%" h={30} r={8} />
            </div>
        </div>
    );
}

// ── Tournament page skeleton
function TournamentSkeleton() {
    return (
        <div>
            {/* Header */}
            <div style={{ background: '#242526', borderRadius: 12, padding: 20, marginBottom: 12, border: '1px solid #3A3B3C' }}>
                <Box w="55%" h={22} mb={10} />
                <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
                    <Box w={80} h={13} />
                    <Box w={80} h={13} />
                    <Box w={80} h={13} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Box w={100} h={36} r={8} />
                    <Box w={100} h={36} r={8} />
                </div>
            </div>
            {/* Stat row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                {Array.from({ length: 4 }).map((_, i) => <StatCard key={i} />)}
            </div>
            {/* Entry list */}
            <div style={{ background: '#242526', borderRadius: 12, border: '1px solid #3A3B3C', overflow: 'hidden' }}>
                {Array.from({ length: 6 }).map((_, i) => <TableRow key={i} />)}
            </div>
        </div>
    );
}

// ── Dealer rotation skeleton
function DealerRotationSkeleton() {
    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} style={{ background: '#242526', borderRadius: 12, padding: 14, border: '1px solid #3A3B3C' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                            <Box w={40} h={40} r={20} />
                            <div style={{ flex: 1 }}>
                                <Box w="70%" h={14} mb={6} />
                                <Box w="40%" h={10} />
                            </div>
                        </div>
                        <Box w="100%" h={28} r={8} />
                    </div>
                ))}
            </div>
            <div style={{ background: '#242526', borderRadius: 12, border: '1px solid #3A3B3C', overflow: 'hidden' }}>
                {Array.from({ length: 4 }).map((_, i) => <TableRow key={i} />)}
            </div>
        </div>
    );
}

export default function SkeletonDark({ variant = 'table-rows', rows = 5, count = 4 }) {
    return (
        <>
            <style>{CSS}</style>

            {variant === 'table-rows' && (
                <div style={{ background: '#242526', borderRadius: 12, border: '1px solid #3A3B3C', overflow: 'hidden' }}>
                    {Array.from({ length: rows }).map((_, i) => <TableRow key={i} />)}
                </div>
            )}

            {variant === 'waitlist' && (
                <div style={{ background: '#242526', borderRadius: 12, border: '1px solid #3A3B3C', overflow: 'hidden' }}>
                    {Array.from({ length: rows }).map((_, i) => <WaitlistRow key={i} />)}
                </div>
            )}

            {variant === 'stat-cards' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
                    {Array.from({ length: count }).map((_, i) => <StatCard key={i} />)}
                </div>
            )}

            {variant === 'poker-room' && (
                <div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 14 }}>
                        {Array.from({ length: count }).map((_, i) => <PokerTableCard key={i} />)}
                    </div>
                    <div style={{ background: '#242526', borderRadius: 12, border: '1px solid #3A3B3C', overflow: 'hidden' }}>
                        {Array.from({ length: rows }).map((_, i) => <WaitlistRow key={i} />)}
                    </div>
                </div>
            )}

            {variant === 'tournament' && <TournamentSkeleton />}

            {variant === 'dealer-rotation' && <DealerRotationSkeleton />}
        </>
    );
}
