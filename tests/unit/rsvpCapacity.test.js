import { describe, expect, it } from 'vitest';

import {
  rsvpGuestCount,
  rsvpSeatCount,
} from '../../vendor/commander-shared/src/components/commander/home-games/rsvpCapacity.mjs';

describe('home-game RSVP capacity', () => {
  it('normalizes current and legacy guest-count fields without negative seats', () => {
    expect(rsvpGuestCount({ bringing_guests: 2.9 })).toBe(2);
    expect(rsvpGuestCount({ guest_count: '3' })).toBe(3);
    expect(rsvpGuestCount({ bringing_guests: -4 })).toBe(0);
    expect(rsvpGuestCount({ bringing_guests: 'unknown' })).toBe(0);
  });

  it('counts each confirmed player and every guest as an occupied seat', () => {
    expect(rsvpSeatCount([
      { bringing_guests: 2 },
      { guest_count: 1 },
      {},
    ])).toBe(6);
  });

  it('fails closed for a non-array RSVP collection', () => {
    expect(rsvpSeatCount(null)).toBe(0);
    expect(rsvpSeatCount({ bringing_guests: 9 })).toBe(0);
  });
});
