import { describe, expect, it } from 'vitest';
import { formatClock, isDustStormSeason, marsClock, seasonName } from './marsTime';

describe('marsClock', () => {
  // Worked example published with the NASA GISS Mars24 algorithm:
  // 2000-01-06 00:00:00 UTC at the prime meridian.
  const clock = marsClock(new Date(Date.UTC(2000, 0, 6)), { lat: 0, lon: 0 });

  it('reproduces the Mars24 worked example', () => {
    expect(clock.ls).toBeCloseTo(277.18758, 3);
    expect(clock.equationOfTimeDeg).toBeCloseTo(-5.18774, 3);
    expect(clock.mtcHours).toBeCloseTo(23.99425, 3);
    expect(clock.lmstHours).toBeCloseTo(23.99425, 3);
    expect(clock.ltstHours).toBeCloseTo(23.6484, 3);
    expect(clock.declinationDeg).toBeCloseTo(-25.22838, 3);
    expect(clock.subsolarLonWestDeg).toBeCloseTo(174.726, 2);
    expect(clock.sunDistanceAU).toBeCloseTo(1.39358, 4);
  });

  it('puts the Sun below the horizon at local midnight', () => {
    expect(clock.sunElevationDeg).toBeLessThan(-30);
  });

  it('agrees with the season Curiosity REMS reported on 2026-08-25 (Ls 341)', () => {
    const gale = marsClock(new Date(Date.UTC(2026, 7, 25, 12)), { lat: -4.59, lon: 137.44 });
    expect(Math.abs(gale.ls - 341)).toBeLessThan(1.5);
    // Near the equator a day is close to half a sol long.
    const daylight = (gale.sunsetLmst - gale.sunriseLmst + 24) % 24;
    expect(daylight).toBeGreaterThan(11.5);
    expect(daylight).toBeLessThan(12.5);
  });

  it('offsets local time by longitude: 15 degrees east is one hour ahead', () => {
    const date = new Date(Date.UTC(2026, 10, 15));
    const a = marsClock(date, { lat: 0, lon: 0 }).lmstHours;
    const b = marsClock(date, { lat: 0, lon: 15 }).lmstHours;
    expect((b - a + 24) % 24).toBeCloseTo(1, 6);
  });

  it('has no sunrise in polar night', () => {
    const pole = marsClock(new Date(Date.UTC(2000, 0, 6)), { lat: 85, lon: 0 }); // northern winter
    expect(Number.isNaN(pole.sunriseLmst)).toBe(true);
  });
});

describe('helpers', () => {
  it('formats clocks and wraps at midnight', () => {
    expect(formatClock(6.5)).toBe('06:30');
    expect(formatClock(23.9999)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('--:--');
  });
  it('names seasons per hemisphere and flags the dust season', () => {
    expect(seasonName(100, 10)).toBe('summer');
    expect(seasonName(100, -10)).toBe('winter');
    expect(isDustStormSeason(250)).toBe(true);
    expect(isDustStormSeason(90)).toBe(false);
  });
});
