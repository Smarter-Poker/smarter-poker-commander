/**
 * useVenueTimeZone / useBusinessToday - the staff venue's time zone and
 * business date on a Commander page (2026-11-28).
 *
 * Both are `null` on the server and on the first client render (hydration
 * law, tests/unit/hydrationSafeRender.law.test.js), then:
 *   1. the zone remembered for this venue (localStorage), else the device's
 *      own zone, right after mount;
 *   2. the venue's `poker_venues.timezone` (or its state's zone) once read.
 * Pages compute their default dates from `today` inside an effect, never in
 * a useState initialiser.
 *
 *   const timeZone = useVenueTimeZone();        // 'America/Chicago' | null
 *   const today = useBusinessToday();           // '2026-11-28' | null
 */
import { useEffect, useState } from 'react';
import {
  browserTimeZone, businessDateKey, isValidTimeZone, venueTimeZone,
} from '../lib/commander/businessDate';

const CACHE_KEY = 'commander_venue_timezone';

function readStaffVenueId() {
  try {
    const s = JSON.parse(localStorage.getItem('commander_staff') || '{}');
    return s?.venue_id ?? null;
  } catch {
    return null;
  }
}

function readCached(venueId) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    if (c && String(c.venue_id) === String(venueId) && isValidTimeZone(c.time_zone)) return c.time_zone;
  } catch { /* ignore */ }
  return null;
}

export default function useVenueTimeZone() {
  const [timeZone, setTimeZone] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const venueId = readStaffVenueId();
    setTimeZone(readCached(venueId) || browserTimeZone());
    if (venueId === null || venueId === undefined || venueId === '') return undefined;
    (async () => {
      try {
        const { supabase } = await import('../lib/supabase');
        const { data, error } = await supabase
          .from('poker_venues')
          .select('timezone, state')
          .eq('id', venueId)
          .maybeSingle();
        if (error || !data || cancelled) return;
        const tz = venueTimeZone(data, browserTimeZone());
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ venue_id: venueId, time_zone: tz })); } catch { /* quota */ }
        if (!cancelled) setTimeZone(tz);
      } catch (err) {
        console.warn('[useVenueTimeZone] venue zone lookup failed:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return timeZone;
}

/**
 * Today's business date at the staff venue, re-evaluated every minute so a
 * page left open past midnight rolls over. Null until mounted.
 */
export function useBusinessToday() {
  return useBusinessDate().today;
}

/** Both at once: `{ timeZone, today }`. */
export function useBusinessDate() {
  const timeZone = useVenueTimeZone();
  const [today, setToday] = useState(null);
  useEffect(() => {
    if (!timeZone) return undefined;
    const read = () => setToday(businessDateKey(new Date(), timeZone));
    read();
    const id = setInterval(read, 60 * 1000);
    return () => clearInterval(id);
  }, [timeZone]);
  return { timeZone, today };
}
