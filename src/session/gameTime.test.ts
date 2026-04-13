import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initGameTimeIfUnset,
  readStartedAt,
  getGameTime,
  resetGameTime,
  MS_PER_DAY,
} from './gameTime';

const FIXED_NOW = 1_700_000_000_000; // 2023-11-14-ish

describe('gameTime', () => {
  beforeEach(() => {
    resetGameTime();
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    resetGameTime();
    vi.useRealTimers();
  });

  describe('initGameTimeIfUnset', () => {
    it('records the current time on first call', () => {
      const anchor = initGameTimeIfUnset();
      expect(anchor).toBe(FIXED_NOW);
      expect(readStartedAt()).toBe(FIXED_NOW);
    });

    it('returns the existing anchor on subsequent calls without overwriting', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW + 5 * MS_PER_DAY);
      const anchor = initGameTimeIfUnset();
      expect(anchor).toBe(FIXED_NOW);
    });
  });

  describe('getGameTime', () => {
    it('returns 0 when no anchor has been set', () => {
      expect(getGameTime()).toBe(0);
    });

    it('returns 0 immediately after initialization', () => {
      initGameTimeIfUnset();
      expect(getGameTime()).toBe(0);
    });

    it('returns the number of whole days since startedAt', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW + 5 * MS_PER_DAY);
      expect(getGameTime()).toBe(5);
    });

    it('rounds down — 1.5 days is day 1', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW + Math.floor(1.5 * MS_PER_DAY));
      expect(getGameTime()).toBe(1);
    });

    it('never returns a negative value even if the system clock moves backward', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW - 5 * MS_PER_DAY);
      expect(getGameTime()).toBe(0);
    });

    it('grows with offline accrual — simulating coming back after a week', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW + 7 * MS_PER_DAY);
      expect(getGameTime()).toBe(7);
    });
  });

  describe('resetGameTime', () => {
    it('clears the anchor so the next init starts fresh', () => {
      initGameTimeIfUnset();
      vi.setSystemTime(FIXED_NOW + 10 * MS_PER_DAY);
      resetGameTime();
      expect(readStartedAt()).toBeNull();
      expect(getGameTime()).toBe(0);
      const fresh = initGameTimeIfUnset();
      expect(fresh).toBe(FIXED_NOW + 10 * MS_PER_DAY);
    });
  });
});
