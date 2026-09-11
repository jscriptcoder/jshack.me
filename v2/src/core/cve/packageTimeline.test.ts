import { describe, expect, it } from 'vitest';
import { PACKAGE_TEMPLATES, startingVersionOf } from '../packages/packageVersions';
import { liveCve } from './liveCve';
import {
  assertCveTimingInvariants,
  CVE_TIMING,
  MAX_TIMELINE_ENTRIES,
  packageTimeline,
} from './packageTimeline';

const KEYS = Object.keys(PACKAGE_TEMPLATES);
const SSH = 'openssh-server';
/** Far past any package's first publication, so its CVE is certainly live. */
const LATE = 1000;

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

  it('stops walking rather than running away when asked about a day absurdly far out', () => {
    // `gameDayAt` floors at zero and has no ceiling, so a clock set to the wrong
    // century asks for a walk nobody wants to wait for.
    expect(packageTimeline(SSH, 10_000_000).length).toBe(MAX_TIMELINE_ENTRIES);
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
