/**
 * Venue business dates (2026-11-28). Changelog:
 * docs/changelog/2026-11-28-venue-business-date.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  DEFAULT_TIME_ZONE, US_STATE_TIME_ZONES, addDaysToKey, businessDateKey, businessDayRange,
  businessDayStartISO, dayOfWeekOfKey, diffDaysKeys, endOfMonthKey, endOfYearKey, formatDateKey,
  isDateKey, isValidTimeZone, parseDateKey, reportRangeStartISO, startOfWeekKey, stateTimeZone,
  toDateTimeLocalValue, venueTimeZone, yearOfKey, zonedParts, zonedTimeToDate,
} from '../../src/lib/commander/businessDate';
import { fetchVenueTimeZone, clearVenueTimeZoneCache } from '../../src/lib/commander/venueTimeZone';
import useVenueTimeZone, { useBusinessToday, useBusinessDate } from '../../src/hooks/useVenueTimeZone';
import { taxEventDate } from '../../src/lib/commander/taxEvents';

describe('businessDateKey: the calendar date at the venue', () => {
  it('9:30 PM Central on Nov 27 is Nov 27 in Chicago and New York, Nov 28 in UTC', () => {
    const at = new Date('2026-11-28T03:30:00Z');
    expect(businessDateKey(at, 'America/Chicago')).toBe('2026-11-27');
    expect(businessDateKey(at, 'America/New_York')).toBe('2026-11-27'); // 10:30 PM EST
    expect(businessDateKey(at, 'America/Denver')).toBe('2026-11-27');
    expect(businessDateKey(at, 'America/Los_Angeles')).toBe('2026-11-27');
    expect(businessDateKey(at, 'UTC')).toBe('2026-11-28');
  });
  it('12:30 AM Eastern is the new day in New York while Chicago is still on the old one', () => {
    const at = new Date('2026-11-28T05:30:00Z');
    expect(businessDateKey(at, 'America/New_York')).toBe('2026-11-28');
    expect(businessDateKey(at, 'America/Chicago')).toBe('2026-11-27');
  });
  it('6:00 PM Central is the exact instant the UTC date rolls over', () => {
    expect(businessDateKey(new Date('2026-11-27T23:59:59Z'), 'UTC')).toBe('2026-11-27');
    expect(businessDateKey(new Date('2026-11-28T00:00:00Z'), 'UTC')).toBe('2026-11-28');
    expect(businessDateKey(new Date('2026-11-28T00:00:00Z'), 'America/Chicago')).toBe('2026-11-27');
    expect(businessDateKey(new Date('2026-11-28T05:59:59Z'), 'America/Chicago')).toBe('2026-11-27');
    expect(businessDateKey(new Date('2026-11-28T06:00:00Z'), 'America/Chicago')).toBe('2026-11-28');
  });
  it('Phoenix keeps MST all summer while Denver moves to MDT', () => {
    const at = new Date('2026-07-04T06:30:00Z'); // 11:30 PM MST Jul 3; 12:30 AM MDT Jul 4
    expect(businessDateKey(at, 'America/Phoenix')).toBe('2026-07-03');
    expect(businessDateKey(at, 'America/Denver')).toBe('2026-07-04');
  });
  it('defaults to now in Central; an invalid zone falls back to Central; a bad date is null', () => {
    expect(isDateKey(businessDateKey())).toBe(true);
    const at = new Date('2026-11-28T03:30:00Z');
    expect(businessDateKey(at, 'Not/AZone')).toBe(businessDateKey(at, DEFAULT_TIME_ZONE));
    expect(businessDateKey(new Date('nope'), 'America/Chicago')).toBeNull();
  });
  it('zonedParts gives the venue wall clock (midnight is hour 0, not 24)', () => {
    expect(zonedParts(new Date('2026-11-28T06:00:00Z'), 'America/Chicago')).toMatchObject({ year: 2026, month: 11, day: 28, hour: 0, minute: 0 });
  });
});

describe('venueTimeZone: timezone, else state, else Central', () => {
  it('uses poker_venues.timezone when it is a real zone', () => {
    expect(venueTimeZone({ timezone: 'America/Denver', state: 'TX' })).toBe('America/Denver');
    expect(venueTimeZone({ timezone: ' America/Phoenix ', state: null })).toBe('America/Phoenix');
  });
  it('falls back to the state for the 256 venues with no timezone', () => {
    expect(venueTimeZone({ timezone: null, state: 'TX' })).toBe('America/Chicago');
    expect(venueTimeZone({ timezone: null, state: 'fl' })).toBe('America/New_York');
    expect(venueTimeZone({ timezone: '', state: 'OR' })).toBe('America/Los_Angeles');
    expect(venueTimeZone({ timezone: 'Garbage/Zone', state: 'AZ' })).toBe('America/Phoenix');
    expect(stateTimeZone('MI')).toBe('America/Detroit');
  });
  it('falls back to Central for a non-state ("Tour", "MULTI"), a missing row, or nothing', () => {
    expect(venueTimeZone({ timezone: null, state: 'Tour' })).toBe('America/Chicago');
    expect(venueTimeZone({ state: 'MULTI' })).toBe('America/Chicago');
    expect(venueTimeZone(null)).toBe('America/Chicago');
    expect(venueTimeZone(undefined, 'America/New_York')).toBe('America/New_York');
  });
  it('every state zone is one this runtime can format in', () => {
    expect(Object.keys(US_STATE_TIME_ZONES).length).toBeGreaterThanOrEqual(51);
    for (const tz of Object.values(US_STATE_TIME_ZONES)) expect(isValidTimeZone(tz)).toBe(true);
  });
});

describe('business day ranges for timestamptz queries', () => {
  it('a Central day is 06:00Z to 06:00Z in winter', () => {
    expect(businessDayRange('2026-11-27', 'America/Chicago')).toEqual({
      start: '2026-11-27T06:00:00.000Z', end: '2026-11-28T06:00:00.000Z',
    });
  });
  it('spring forward is a 23-hour day, fall back a 25-hour day', () => {
    expect(businessDayRange('2026-03-08', 'America/Chicago')).toEqual({
      start: '2026-03-08T06:00:00.000Z', end: '2026-03-09T05:00:00.000Z',
    });
    expect(businessDayRange('2026-11-01', 'America/Chicago')).toEqual({
      start: '2026-11-01T05:00:00.000Z', end: '2026-11-02T06:00:00.000Z',
    });
    expect(businessDayRange('2026-03-08', 'America/New_York')).toEqual({
      start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z',
    });
  });
  it('Phoenix days are always 07:00Z to 07:00Z', () => {
    expect(businessDayRange('2026-01-15', 'America/Phoenix')).toEqual({ start: '2026-01-15T07:00:00.000Z', end: '2026-01-16T07:00:00.000Z' });
    expect(businessDayRange('2026-07-15', 'America/Phoenix')).toEqual({ start: '2026-07-15T07:00:00.000Z', end: '2026-07-16T07:00:00.000Z' });
  });
  it('wall times in the DST gap step forward; in the overlap take the first occurrence', () => {
    expect(zonedTimeToDate('2026-03-08', 'America/Chicago', 2, 30).toISOString()).toBe('2026-03-08T08:30:00.000Z');
    expect(zonedTimeToDate('2026-11-01', 'America/Chicago', 1, 30).toISOString()).toBe('2026-11-01T06:30:00.000Z');
    expect(zonedTimeToDate('2026-11-27', 'America/Chicago', 19, 0).toISOString()).toBe('2026-11-28T01:00:00.000Z');
  });
  it('businessDayStartISO is the venue midnight of the current day', () => {
    expect(businessDayStartISO(new Date('2026-11-28T03:30:00Z'), 'America/Chicago')).toBe('2026-11-27T06:00:00.000Z');
    expect(businessDayStartISO(new Date('2026-11-28T03:30:00Z'), 'UTC')).toBe('2026-11-28T00:00:00.000Z');
  });
  it('report windows: today from the venue midnight, rolling windows unchanged', () => {
    const now = new Date('2026-11-28T03:30:00Z');
    expect(reportRangeStartISO('today', 'America/Chicago', now)).toBe('2026-11-27T06:00:00.000Z');
    expect(reportRangeStartISO('week', 'America/Chicago', now)).toBe('2026-11-21T03:30:00.000Z');
    expect(reportRangeStartISO('month', 'America/Chicago', now)).toBe('2026-10-28T03:30:00.000Z');
    expect(reportRangeStartISO('quarter', 'America/Chicago', now)).toBe('2026-08-28T03:30:00.000Z');
  });
  it('a bad key gives null, never a range from "undefined"', () => {
    expect(businessDayRange('undefined', 'America/Chicago')).toBeNull();
    expect(businessDayRange('', 'America/Chicago')).toBeNull();
  });
});

describe('date-key arithmetic and display', () => {
  it('steps across months, years and leap days', () => {
    expect(addDaysToKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysToKey('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysToKey('2026-11-22', 7)).toBe('2026-11-29');
    expect(addDaysToKey('nope', 1)).toBeNull();
    expect(diffDaysKeys('2026-03-07', '2026-03-09')).toBe(2); // across spring forward
    expect(diffDaysKeys('2026-11-28', '2026-11-28')).toBe(0);
  });
  it('weeks, months, years', () => {
    expect(dayOfWeekOfKey('2026-11-28')).toBe(6); // Saturday
    expect(startOfWeekKey('2026-11-28', 0)).toBe('2026-11-22');
    expect(startOfWeekKey('2026-11-22', 0)).toBe('2026-11-22');
    expect(startOfWeekKey('2026-11-28', 1)).toBe('2026-11-23');
    expect(endOfMonthKey('2026-11-28')).toBe('2026-11-30');
    expect(endOfMonthKey('2028-02-03')).toBe('2028-02-29');
    expect(endOfYearKey('2026-05-05')).toBe('2026-12-31');
    expect(yearOfKey('2026-01-01')).toBe(2026);
    expect(yearOfKey('2026-01-01T00:00:00Z')).toBe(2026);
  });
  it('validates real calendar dates only', () => {
    expect(isDateKey('2026-11-28')).toBe(true);
    expect(isDateKey('2026-02-30')).toBe(false);
    expect(isDateKey('2026-11-28T00:00:00Z')).toBe(false);
    expect(isDateKey(null)).toBe(false);
  });
  it('a DATE value prints as its own day (new Date("2026-01-01") is Dec 31 in the US)', () => {
    expect(formatDateKey('2026-01-01', { month: 'long', day: 'numeric', year: 'numeric' })).toBe('January 1, 2026');
    expect(formatDateKey('2026-11-28', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })).toBe('Saturday, November 28, 2026');
    expect(formatDateKey('bad')).toBe('');
    const d = parseDateKey('2026-01-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
    expect(parseDateKey('2026-01-01T00:00:00Z').getDate()).toBe(1);
    expect(parseDateKey(null)).toBeNull();
  });
  it('datetime-local values are device-local wall time and round-trip through new Date()', () => {
    const local = new Date(2026, 10, 28, 19, 5);
    expect(toDateTimeLocalValue(local)).toBe('2026-11-28T19:05');
    expect(new Date(toDateTimeLocalValue(local)).getTime()).toBe(local.getTime());
    expect(toDateTimeLocalValue(local.toISOString())).toBe('2026-11-28T19:05');
    expect(toDateTimeLocalValue(null)).toBe('');
    expect(toDateTimeLocalValue('nope')).toBe('');
  });
});

describe('W-2G event date is the venue-local day', () => {
  it('a tournament ending 9:30 PM Central is dated that day, not the next', () => {
    const t = { ended_at: '2026-11-28T03:30:00Z' };
    expect(taxEventDate(t, 'America/Chicago')).toBe('2026-11-27');
    expect(taxEventDate(t, 'UTC')).toBe('2026-11-28');
    expect(taxEventDate(t)).toBe('2026-11-27'); // default zone is Central
  });
});

function fakeClient(row, error = null) {
  const calls = [];
  const q = {
    select: (c) => { calls.push(['select', c]); return q; },
    eq: (k, v) => { calls.push(['eq', k, v]); return q; },
    maybeSingle: async () => ({ data: row, error }),
  };
  return { calls, from: (t) => { calls.push(['from', t]); return q; } };
}

describe('fetchVenueTimeZone', () => {
  beforeEach(() => clearVenueTimeZoneCache());
  it('reads poker_venues.timezone and state for the venue', async () => {
    const c = fakeClient({ timezone: 'America/Denver', state: 'CO' });
    expect(await fetchVenueTimeZone(c, 7)).toBe('America/Denver');
    expect(c.calls).toEqual([['from', 'poker_venues'], ['select', 'timezone, state'], ['eq', 'id', 7]]);
  });
  it('falls back to the state, then Central, and never throws', async () => {
    expect(await fetchVenueTimeZone(fakeClient({ timezone: null, state: 'FL' }), 1)).toBe('America/New_York');
    expect(await fetchVenueTimeZone(fakeClient(null), 2)).toBe('America/Chicago');
    expect(await fetchVenueTimeZone(fakeClient(null, { message: 'down' }), 3)).toBe('America/Chicago');
    expect(await fetchVenueTimeZone({ from: () => { throw new Error('boom'); } }, 4)).toBe('America/Chicago');
    expect(await fetchVenueTimeZone(fakeClient({ timezone: 'America/Denver' }), null)).toBe('America/Chicago');
  });
  it('memoises a venue so one request does not re-read it', async () => {
    const c = fakeClient({ timezone: 'America/Los_Angeles' });
    await fetchVenueTimeZone(c, 9);
    await fetchVenueTimeZone(c, 9);
    expect(c.calls.filter(x => x[0] === 'from')).toHaveLength(1);
  });
});

describe('page hooks render nothing date-like on the server', () => {
  it('useVenueTimeZone / useBusinessToday / useBusinessDate are null during SSR', () => {
    function Probe() {
      const tz = useVenueTimeZone();
      const today = useBusinessToday();
      const both = useBusinessDate();
      return React.createElement('p', null, `${tz}|${today}|${both.timeZone}|${both.today}`);
    }
    expect(renderToString(React.createElement(Probe))).toBe('<p>null|null|null|null</p>');
  });
});
