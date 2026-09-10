/**
 * The one clock the whole world's vulnerabilities derive from.
 *
 * A hardcoded constant rather than a stored row: identical for every player by
 * construction, with no table to seed, no fetch to cache and no offline story to
 * write. The client computes the day to RENDER (`nmap -sV`) and the server
 * recomputes it from its own clock to AUTHORIZE, which is the same
 * client-renders / server-enforces split the scan resolvers already use — so a
 * forged client clock changes what a player SEES and never what they GET.
 *
 * The day is a WHOLE number deliberately. The entire world turns over at one
 * instant each day rather than CVEs trickling in at odd hours, which is what
 * makes "everything was clean this morning" a true sentence a player can act on.
 *
 * `gameDayAt` takes the clock as a parameter and never reads one itself: only
 * two places in the game turn a clock into a day — a command, through the
 * environment's `now()`, and the server, at a scan action. Everything below them
 * takes the number. That is what makes a timeline testable at any day without an
 * override existing anywhere that could be left switched on in production.
 */

import { asEpochMs, type EpochMs } from '../types';

const DAY_MS = 86_400_000;

/**
 * When the world began. **A DEVELOPMENT ANCHOR, not the launch date.**
 *
 * It is set in the past so the treadmill is already running while the phase is
 * built — a world at day zero has no published CVEs and no shipped fixes, and
 * none of the attack/patch loop can be played or verified against it. It must be
 * re-stamped to the real launch date before players exist, and a tripwire test
 * fails once it goes stale so that stays a decision rather than an oversight.
 *
 * Freely movable until launch, because no CVE is ever persisted and every
 * generated box is frozen at its package's starting version. Irreversible after,
 * because shifting it would retroactively rewrite every published CVE and every
 * player's exposure.
 */
export const WORLD_EPOCH = asEpochMs(Date.UTC(2026, 8, 1));

/** Whole days elapsed since the world began, floored at zero — a clock reading
 *  before the epoch means the anchor has been moved into the future, and the
 *  world is simply clean until it arrives. Walking a package's timeline from a
 *  negative day would run it backwards out of its own starting tuple. */
export const gameDayAt = (now: EpochMs): number =>
  Math.max(0, Math.floor((now - WORLD_EPOCH) / DAY_MS));
