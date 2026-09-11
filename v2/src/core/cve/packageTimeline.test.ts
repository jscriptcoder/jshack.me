import { describe, expect, it } from 'vitest';
import { PACKAGE_TEMPLATES, startingVersionOf } from '../packages/packageVersions';
import { liveCve } from './liveCve';
import {
  assertCveTimingInvariants,
  CVE_TIMING,
  MAX_TIMELINE_ENTRIES,
  installedRelease,
  packageTimeline,
  severityForRoll,
} from './packageTimeline';
import { WORLD_EPOCH } from './worldClock';

const KEYS = Object.keys(PACKAGE_TEMPLATES);
const SSH = 'openssh-server';
/** Far past any package's first publication, so its CVE is certainly live. */
const LATE = 1000;
const DAY_MS = 86_400_000;

const yearOfDay = (day: number): number => new Date(WORLD_EPOCH + day * DAY_MS).getUTCFullYear();

/** Which component a release bumped — 0 major, 1 minor, 2 patch — or -1 for a
 *  release that changed nothing, which is a release that never happened. */
const bumpedComponent = (before: readonly number[], after: readonly number[]): number =>
  after.findIndex((component, position) => component !== before[position]);

/**
 * The versions a package moves through, and when each one's vulnerability lands.
 *
 * Every box in the world currently sits on entry 0 and stays there, because nothing
 * has been able to move a version. This is what `apt upgrade` walks along — so the
 * walk has to reach forward past the day being asked about, or a fully patched box
 * would have nowhere left to go.
 */
describe("a package's version timeline", () => {
  it('starts at the version every box in the world ships with', () => {
    for (const key of KEYS) {
      expect(packageTimeline(key, LATE)[0]?.version).toBe(startingVersionOf(key));
    }
  });

  it('publishes its first entry on the day the world has already published', () => {
    // The lock the whole walk rests on. Entry 0's gap is the FIRST draw of this
    // package's stream either way, so learning to walk forward must leave the CVE
    // every box currently carries exactly where it is — ids and days already sit in
    // players' log files.
    for (const key of KEYS) {
      const published = liveCve(key, startingVersionOf(key) ?? '', LATE)?.publishedAt;
      expect(packageTimeline(key, LATE)[0]?.publishedAt).toBe(published);
    }
  });

  it('moves forward — every entry publishes strictly after the one before it', () => {
    const timeline = packageTimeline(SSH, 400);
    expect(timeline.length).toBeGreaterThan(1);
    for (const [position, entry] of timeline.slice(1).entries()) {
      expect(entry.publishedAt).toBeGreaterThan(timeline[position]!.publishedAt);
    }
  });

  it('releases a higher version at each step, bumping one component and zeroing what sits below', () => {
    const timeline = packageTimeline(SSH, 400);
    for (const [position, entry] of timeline.slice(1).entries()) {
      const before = timeline[position]!.tuple;
      const bumped = bumpedComponent(before, entry.tuple);
      expect(bumped).toBeGreaterThanOrEqual(0);
      expect(entry.tuple).toEqual(
        before.map((component, index) =>
          index < bumped ? component : index === bumped ? component + 1 : 0,
        ),
      );
      expect(entry.version).toBe(entry.tuple.join('.'));
    }
  });

  it('releases majors, minors and patches — not one kind of bump wearing three names', () => {
    // 5/15/80 is what makes a version read like real software over a year of play
    // (1.26.0 → 1.26.7 → 1.27.0 → 2.0.0). A weighting collapsed to a single kind
    // would still pass every other case here.
    const timeline = packageTimeline(SSH, 5000);
    const kinds = new Set(
      timeline.slice(1).map((entry, position) => bumpedComponent(timeline[position]!.tuple, entry.tuple)),
    );
    expect(kinds).toEqual(new Set([0, 1, 2]));
  });

  it('gives every entry a fix that lands inside the configured delay', () => {
    for (const entry of packageTimeline(SSH, 400)) {
      expect(entry.patchDelay).toBeGreaterThanOrEqual(CVE_TIMING.minPatchDelayDays);
      expect(entry.patchDelay).toBeLessThanOrEqual(CVE_TIMING.maxPatchDelayDays);
    }
  });

  it('reaches past the day it was asked about, so a patched box still has somewhere to go', () => {
    // A timeline that stopped at today would leave the newest version looking like the
    // end of the line, and `apt upgrade` with nothing to offer.
    const timeline = packageTimeline(SSH, 100);
    expect(timeline.at(-1)?.publishedAt).toBeGreaterThan(100);
  });

  it('numbers its entries in the order they were released', () => {
    for (const [position, entry] of packageTimeline(SSH, 400).entries()) {
      expect(entry.index).toBe(position);
    }
  });

  it('answers identically every time it is asked', () => {
    // Nothing is persisted: the client walks this to render an upgrade and the server
    // walks it again to authorize against one.
    expect(packageTimeline(SSH, 400)).toEqual(packageTimeline(SSH, 400));
  });

  it('has nothing for a package the world has no version template for', () => {
    expect(packageTimeline('metasploit', LATE)).toEqual([]);
  });

  it('gives each version its own vulnerability rather than the last one wearing a new number', () => {
    const [first, second] = packageTimeline(SSH, 400);
    expect(second?.cve).not.toBe(first?.cve);
  });

  it('never mints the same id twice along a package\'s own history', () => {
    const timeline = packageTimeline(SSH, 5000);
    expect(new Set(timeline.map((entry) => entry.cve)).size).toBe(timeline.length);
  });

  it('keeps every id inside the package\'s own permanent block', () => {
    // The leading digits are the package's number and the trailing five are scattered
    // within it, so two packages can never collide however many CVEs either
    // accumulates — and a serial that simply counted would end every package's first
    // CVE identically, which is the guess that would open the world to somebody who
    // never read a log.
    for (const entry of packageTimeline(SSH, 5000)) {
      expect(entry.cve).toMatch(/^CVE-\d{4}-0[01]\d{5}$/);
    }
  });

  it("names the calendar year the version's vulnerability published in", () => {
    // Unreachable until the walk went past entry 0: every FIRST publication lands
    // inside the epoch's own year by configuration, which left a hardcoded year
    // indistinguishable from a computed one.
    const timeline = packageTimeline(SSH, 400);
    expect(new Set(timeline.map((entry) => yearOfDay(entry.publishedAt))).size).toBeGreaterThan(1);
    for (const entry of timeline) {
      expect(entry.cve.slice(0, 8)).toBe(`CVE-${yearOfDay(entry.publishedAt)}`);
    }
  });

  it('rolls a severity per version rather than one for the package', () => {
    const severities = new Set(packageTimeline(SSH, 5000).map((entry) => entry.severity));
    expect(severities).toEqual(new Set(['critical', 'high', 'medium', 'low']));
  });

  it('carries the exact vulnerability the world has already published for entry zero', () => {
    // The other half of the lock above. A box sitting on its starting version must
    // read the same id and the same severity after the walk as before it.
    for (const key of KEYS) {
      const published = liveCve(key, startingVersionOf(key) ?? '', LATE);
      const [first] = packageTimeline(key, LATE);
      expect({ cve: first?.cve, severity: first?.severity }).toEqual({
        cve: published?.cve,
        severity: published?.severity,
      });
    }
  });

  it('stops walking rather than running away when asked about a day absurdly far out', () => {
    // `gameDayAt` floors at zero and has no ceiling, so a clock set to the wrong
    // century asks for a walk nobody wants to wait for.
    expect(packageTimeline(SSH, 10_000_000).length).toBe(MAX_TIMELINE_ENTRIES);
  });
});

/**
 * Which release a box is ACTUALLY running, given whatever its manifest says.
 *
 * The manifest is the version authority and it is root-WRITABLE, so a player can type
 * anything into it. A version the world never published resolves DOWN to the newest
 * release at or below it, which makes typing a high number buy exactly what being
 * fully patched buys and nothing more — lying is pointless rather than punished.
 * Anything that is not a version at all falls to the release the box was born on, so
 * nonsense costs rather than protects. One rule, total, no carve-out.
 */
describe('the release a box is running', () => {
  it('takes a version the world published at its word', () => {
    const timeline = packageTimeline(SSH, 400);
    expect(installedRelease(SSH, timeline[3]!.version, 400)).toEqual(timeline[3]);
  });

  it('resolves a version the world never published down to the newest release below it', () => {
    const timeline = packageTimeline(SSH, 400);
    // Nothing ever shipped a 9.7.99 — the 9.7 line stopped somewhere short of it and
    // the next release opened 9.8. A box claiming it gets the newest 9.7 there was.
    const newestOn97 = timeline.findLast((entry) => entry.tuple[0] === 9 && entry.tuple[1] === 7);
    expect(newestOn97).toBeDefined();
    expect(installedRelease(SSH, '9.7.99', 400)).toEqual(newestOn97);
  });

  it('gives a version beyond everything published exactly what a fully patched box has', () => {
    const timeline = packageTimeline(SSH, 400);
    expect(installedRelease(SSH, '999.0.0', 400)).toEqual(timeline.at(-1));
  });

  it.each(['banana', '', '9.9.9-never-shipped', 'v9.7.0', '9..7', '  '])(
    'falls back to the version the box was born on for %j, which is not a version at all',
    (typed) => {
      expect(installedRelease(SSH, typed, 400)).toEqual(packageTimeline(SSH, 400)[0]);
    },
  );

  it('falls back to the version the box was born on for one below anything ever released', () => {
    expect(installedRelease(SSH, '1.0.0', 400)).toEqual(packageTimeline(SSH, 400)[0]);
  });

  it('reads a shorter spelling of a released version as that release', () => {
    // `9.7` and `9.7.0` are the same release written two ways; a manifest a player has
    // edited by hand is where the short spelling turns up.
    const [first] = packageTimeline(SSH, 400);
    expect(installedRelease(SSH, '9.7', 400)).toEqual(first);
  });

  it('has nothing for a package the world has no timeline for', () => {
    expect(installedRelease('metasploit', '1.0.0', 400)).toBeUndefined();
  });
});

/**
 * The guard on the config itself. A fix that arrives at or after the NEXT version's own
 * vulnerability leaves no safe window at all — the treadmill stops being demanding and
 * becomes unwinnable — so a config that allows it must never reach a player.
 */
describe('the timing config', () => {
  it('refuses a config that would leave no safe window after a fix', () => {
    expect(() =>
      assertCveTimingInvariants({ ...CVE_TIMING, maxPatchDelayDays: CVE_TIMING.minSafeWindowDays }),
      // Both halves of the message: the guard's whole job is telling a developer WHICH
      // two numbers conflict, so a message that named neither would be a silent throw.
    ).toThrow(/maxPatchDelayDays \(3\).*strictly less than.*minSafeWindowDays \(3\).*safe window/s);
  });

  it('accepts the config the world actually ships with', () => {
    expect(() => assertCveTimingInvariants(CVE_TIMING)).not.toThrow();
  });
});

/**
 * The published distribution, pinned at every boundary on both sides. No package in the
 * world rolls exactly 10, 60 or 90, so a band silently shifting by one would change what
 * a whole class of targets is worth and nothing else here would see it.
 */
describe('the severity a roll lands on', () => {
  it.each([
    [0, 'critical'],
    [9, 'critical'],
    [10, 'high'],
    [59, 'high'],
    [60, 'medium'],
    [89, 'medium'],
    [90, 'low'],
    [99, 'low'],
  ])('rolls %i as %s', (roll, severity) => {
    expect(severityForRoll(roll)).toBe(severity);
  });
});
