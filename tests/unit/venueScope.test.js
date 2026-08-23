/**
 * Venue scoping.
 *
 * The bug this pins (fixed 2026-08-22): guardStaff proves a session is valid,
 * not which room it belongs to, and the tournament id is a URL parameter. 24 of
 * the 41 routes under pages/api/tournaments never compared the two, so an
 * ordinary session for venue A could act on venue B's live event.
 *
 * The helper fails CLOSED on a missing venue on either side. That is safe
 * because verifyStaffSession already guarantees a real venue_id on both auth
 * paths (auth.js fails closed with NO_VENUE for PIN sessions, and the owner
 * path looks the row up by venue_id) - so no legitimate session is refused.
 */
import { describe, it, expect, vi } from 'vitest';
import { isSameVenue, denyCrossVenue } from '../../src/lib/commander/venueScope';

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

describe('isSameVenue', () => {
  it('matches a staff and tournament in the same venue', () => {
    expect(isSameVenue({ venue_id: 12 }, { venue_id: 12 })).toBe(true);
  });

  it('tolerates the int/string round trip through JSON and HMAC signing', () => {
    expect(isSameVenue({ venue_id: '12' }, { venue_id: 12 })).toBe(true);
    expect(isSameVenue({ venue_id: 12 }, { venue_id: '12' })).toBe(true);
  });

  it('rejects different venues', () => {
    expect(isSameVenue({ venue_id: 12 }, { venue_id: 13 })).toBe(false);
  });

  // The old hand-written guards were `if (staff.venue_id && ...)`, so every one
  // of these bypassed the check entirely.
  it.each([null, undefined, ''])('fails closed when the staff venue is %s', (v) => {
    expect(isSameVenue({ venue_id: v }, { venue_id: 12 })).toBe(false);
  });

  it.each([null, undefined, ''])('fails closed when the tournament venue is %s', (v) => {
    expect(isSameVenue({ venue_id: 12 }, { venue_id: v })).toBe(false);
  });

  it('does not let null and 0 collapse into a match', () => {
    // Number(null) === 0, so a Number()-based comparison would call these equal.
    expect(isSameVenue({ venue_id: null }, { venue_id: 0 })).toBe(false);
    expect(isSameVenue({ venue_id: 0 }, { venue_id: null })).toBe(false);
  });

  it('fails closed on a missing object entirely', () => {
    expect(isSameVenue(null, { venue_id: 12 })).toBe(false);
    expect(isSameVenue({ venue_id: 12 }, null)).toBe(false);
  });
});

describe('denyCrossVenue', () => {
  it('lets a same-venue request through and writes nothing', () => {
    const res = mockRes();
    expect(denyCrossVenue(res, { venue_id: 7 }, { venue_id: 7 })).toBe(false);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('stops a cross-venue request with a 403', () => {
    const res = mockRes();
    expect(denyCrossVenue(res, { venue_id: 7 }, { venue_id: 8 })).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('WRONG_VENUE');
  });

  it('does not reveal whether the tournament exists or who owns it', () => {
    const res = mockRes();
    denyCrossVenue(res, { venue_id: 7 }, { venue_id: 8 });
    const text = JSON.stringify(res.body);
    // An id or venue number in the message turns a 403 into an enumeration
    // oracle for every event on the platform.
    expect(text).not.toMatch(/\b8\b/);
    expect(text.toLowerCase()).not.toContain('not found');
  });

  it('uses the caller supplied subject in the message', () => {
    const res = mockRes();
    denyCrossVenue(res, { venue_id: 7 }, { venue_id: 8 }, 'Entry');
    expect(res.body.error.message).toBe('Entry Belongs To A Different Venue');
  });
});
