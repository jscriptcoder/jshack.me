import { describe, expect, it } from 'vitest';
import { asEpochMs } from '../types';
import { gameDayAt, WORLD_EPOCH } from './worldClock';

const DAY_MS = 86_400_000;
const at = (offsetMs: number) => asEpochMs(WORLD_EPOCH + offsetMs);

/**
 * The world clock every CVE in the game derives from. One hardcoded epoch, one
 * integer day, identical for every player by construction — no row to seed, no
 * fetch to cache, and nothing a forged client clock can move, because the server
 * computes the same number from its own clock.
 *
 * The day is WHOLE deliberately: the entire world turns over at one instant each
 * day rather than CVEs trickling in at odd hours, which is what makes "the world
 * was clean this morning" a true sentence a player can act on.
 */
describe('game day', () => {
  it('is zero at the epoch itself', () => {
    expect(gameDayAt(at(0))).toBe(0);
  });

  it('counts whole elapsed days', () => {
    expect(gameDayAt(at(11 * DAY_MS))).toBe(11);
  });

  it('holds the previous day until the boundary is actually crossed', () => {
    // One millisecond short of day 4 is still day 3 — the difference between a
    // CVE publishing today and publishing tomorrow.
    expect(gameDayAt(at(4 * DAY_MS - 1))).toBe(3);
    expect(gameDayAt(at(4 * DAY_MS))).toBe(4);
  });

  it('floors at zero before the epoch rather than walking the timeline backwards', () => {
    // Only reachable with the epoch moved into the future, which is exactly what
    // re-stamping it for launch does. A negative day would walk every package's
    // timeline backwards from its starting tuple instead of yielding a clean world.
    expect(gameDayAt(at(-DAY_MS))).toBe(0);
    expect(gameDayAt(at(-1))).toBe(0);
  });
});

/**
 * A dead man's switch on the anchor, not a test of behaviour.
 *
 * `WORLD_EPOCH` is a DEVELOPMENT anchor: it is set in the past so the treadmill
 * is already running while the phase is built. Shipping that value at launch
 * would hand the first players a world already months deep in CVEs — the exact
 * state the hand-authored day-0 CVE table was dropped to avoid. It is freely
 * movable until then and irreversible after, because every published CVE and
 * every player's exposure derives from it.
 *
 * When this fails, it is asking a question rather than reporting a fault:
 * launching, or extending the runway?
 */
describe('the world epoch anchor', () => {
  it('has not gone stale — re-stamp it for launch, or move the runway forward deliberately', () => {
    expect(gameDayAt(asEpochMs(Date.now()))).toBeLessThan(90);
  });
});
