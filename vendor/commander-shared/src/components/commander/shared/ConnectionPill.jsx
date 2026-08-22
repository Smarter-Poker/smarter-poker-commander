/**
 * ConnectionPill - Live / Reconnecting badge for realtime-backed screens
 *
 * WHY IT EXISTS
 * -------------
 * Commander screens are realtime-first: when the Supabase channel is proven
 * healthy the fallback poll backs off from seconds to minutes. That is a good
 * trade only if the floor can see when the channel is NOT healthy, because in
 * that state the screen is running on the slower fallback and updates arrive
 * on a poll rather than instantly.
 *
 * Deliberately subtle: a small pill, no animation, no colour on the healthy
 * path beyond a green dot. It sits next to the tournament status chips.
 *
 * @param {object} props
 * @param {object} props.conn  Return value of useTournamentRealtime / useCommanderSync
 * @param {boolean} [props.showWhenLive=true] Hide the pill entirely while healthy
 */
export default function ConnectionPill({ conn, showWhenLive = true }) {
    const status = conn?.status || 'connecting';
    const isLive = status === 'live';

    if (isLive && !showWhenLive) return null;

    const label = isLive ? 'Live' : (status === 'connecting' ? 'Connecting' : 'Reconnecting');
    const color = isLive ? '#31A24C' : '#F59E0B';

    return (
        <span
            className="px-2 py-0.5 rounded text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
            style={{ backgroundColor: `${color}1A`, color }}
            title={isLive
                ? 'Realtime Connected. Updates Arrive Instantly.'
                : 'Realtime Is Down. This Screen Is Refreshing On Its Fallback Poll.'}
        >
            <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: color }}
            />
            {label}
        </span>
    );
}
