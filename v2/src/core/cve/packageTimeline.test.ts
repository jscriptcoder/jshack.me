import { describe, expect, it } from 'vitest';
import {
  FIRMWARE_PACKAGE,
  PACKAGE_TEMPLATES,
  startingVersionOf,
} from '../packages/packageVersions';
import { liveCve } from './liveCve';
import {
  assertCveTimingInvariants,
  bumpForRoll,
  CVE_TIMING,
  MAX_TIMELINE_ENTRIES,
  installedRelease,
  movesForward,
  newestReleaseOn,
  packageTimeline,
  repoHolds,
  severityForRoll,
  upgradeStatusFor,
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

  it('gives each package a fix schedule of its own rather than one the whole world shares', () => {
    // Seeded on the package, as its releases are. One schedule for everybody would ship
    // every package's Nth fix the same number of days after its hole — a pattern a
    // player watching two packages at once would learn to read.
    const schedules = KEYS.map((key) =>
      packageTimeline(key, 400)
        .slice(0, 20)
        .map((entry) => entry.patchDelay)
        .join(','),
    );
    expect(new Set(schedules).size).toBeGreaterThan(1);
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

  // `+999.0.0` is the one that reads a number out of a prefix: parsed loosely it becomes
  // 999, and a sign in front of a lie would buy what the lie without one is refused.
  it.each(['banana', '', '9.9.9-never-shipped', 'v9.7.0', '9..7', '  ', '+999.0.0'])(
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

/** A release whose fix takes the longest the config allows, so the gap before it spans
 *  more than one day and a countdown has somewhere to count from — plus the release
 *  that fix IS. Never the first release, so a box born on entry zero is at least two
 *  steps behind the fix. */
const slowFix = () => {
  const timeline = packageTimeline(SSH, 400);
  const vulnerable = timeline.find(
    (entry) => entry.index >= 1 && entry.patchDelay === CVE_TIMING.maxPatchDelayDays,
  )!;
  return {
    timeline,
    vulnerable,
    fix: timeline[vulnerable.index + 1]!,
    shipsOn: vulnerable.publishedAt + vulnerable.patchDelay,
  };
};

/**
 * Where a box can move to, and whether it can yet.
 *
 * "Up to date" means not exposed rather than on the newest version: the treadmill only
 * asks a player to move once the hole in the release they are on has actually landed,
 * which keeps a quiet box quiet. Once it has, the answer is the newest release whose own
 * hole has NOT — but only after that fix has shipped. Between a CVE publishing and its
 * fix, the honest answer is that there is nothing to install yet, and exactly how long
 * until there is.
 */
describe('what a box can upgrade to', () => {
  it('is up to date while the release it is on is still clean, however old that release is', () => {
    const { fix, shipsOn } = slowFix();
    const [first] = packageTimeline(SSH, 400);
    expect(upgradeStatusFor(SSH, startingVersionOf(SSH)!, first!.publishedAt - 1)).toEqual({
      kind: 'up-to-date',
    });
    expect(upgradeStatusFor(SSH, fix.version, shipsOn)).toEqual({ kind: 'up-to-date' });
  });

  it('says no fix exists yet while one is on its way, counting the days down until it ships', () => {
    // The true days remaining rather than an average: the timeline is deterministic and
    // the client already walks it, so a midpoint would be the game withholding a number
    // it has already handed over — and a real countdown makes "come back tomorrow" a
    // plan rather than a guess.
    const { vulnerable, fix, shipsOn } = slowFix();
    const statusOn = (day: number) => upgradeStatusFor(SSH, vulnerable.version, day);
    expect(statusOn(shipsOn - 2)).toEqual({ kind: 'no-fix-yet', etaDays: 2 });
    expect(statusOn(shipsOn - 1)).toEqual({ kind: 'no-fix-yet', etaDays: 1 });
    expect(statusOn(shipsOn)).toEqual({ kind: 'upgradable', target: fix.version });
  });

  it('moves a box straight to the newest safe release rather than one step along', () => {
    // The step after a box's own release is usually vulnerable too by the time anybody
    // looks, and an upgrade that lands on an open hole is not a fix.
    const { timeline, fix, shipsOn } = slowFix();
    expect(fix.version).not.toBe(timeline[1]!.version);
    expect(upgradeStatusFor(SSH, startingVersionOf(SSH)!, shipsOn)).toEqual({
      kind: 'upgradable',
      target: fix.version,
    });
  });

  it('reads a hand-written version as the release it resolves to', () => {
    const { fix, shipsOn } = slowFix();
    expect(upgradeStatusFor(SSH, '999.0.0', shipsOn)).toEqual({ kind: 'up-to-date' });
    expect(upgradeStatusFor(SSH, 'banana', shipsOn)).toEqual({
      kind: 'upgradable',
      target: fix.version,
    });
  });

  it('has no timeline to offer for firmware, which a player does not move through apt', () => {
    expect(upgradeStatusFor(FIRMWARE_PACKAGE, '1.0.0', LATE)).toEqual({ kind: 'no-timeline' });
  });

  it('offers nothing past the last release the walk will reach, rather than inventing one', () => {
    expect(upgradeStatusFor(SSH, '999.0.0', 10_000_000)).toEqual({ kind: 'no-timeline' });
  });
});

/**
 * What the repo holds today — the version a fresh install lands on.
 *
 * The same question `upgrade` asks, answered from the same walk: a box that installs a
 * package and a box that upgrades one must end up on the same release, or the world
 * would hold two opinions about what it published.
 */
describe('the release the repo holds today', () => {
  it('is the release a package is born on, until its first hole lands', () => {
    const [first] = packageTimeline(SSH, 400);
    expect(newestReleaseOn(SSH, first!.publishedAt - 1)).toBe(startingVersionOf(SSH));
  });

  it('is the fix once that fix has shipped — the very release an upgrade moves a box to', () => {
    const { fix, shipsOn } = slowFix();
    expect(newestReleaseOn(SSH, shipsOn)).toBe(fix.version);
    expect(upgradeStatusFor(SSH, startingVersionOf(SSH)!, shipsOn)).toEqual({
      kind: 'upgradable',
      target: newestReleaseOn(SSH, shipsOn),
    });
  });

  it('is the exposed release itself inside the patch delay, since the fix does not exist yet', () => {
    // Installing into the window buys nothing: the newest thing the repo has is the open
    // one, so a box built today is exposed exactly as every box already standing is.
    const { vulnerable, shipsOn } = slowFix();
    expect(newestReleaseOn(SSH, shipsOn - 1)).toBe(vulnerable.version);
    expect(upgradeStatusFor(SSH, newestReleaseOn(SSH, shipsOn - 1)!, shipsOn - 1)).toEqual({
      kind: 'no-fix-yet',
      etaDays: 1,
    });
  });

  it('is the last release the walk reaches on a clock set past the end of it', () => {
    const timeline = packageTimeline(SSH, 10_000_000);
    expect(newestReleaseOn(SSH, 10_000_000)).toBe(timeline.at(-1)?.version);
  });

  it('is nothing at all for a package this world keeps no history for', () => {
    expect(newestReleaseOn(FIRMWARE_PACKAGE, LATE)).toBeUndefined();
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

/**
 * How far each release moves, pinned at every boundary on both sides for the reason the
 * severity bands are. A walk only sees the kinds it happens to draw, so a band shifting by
 * one — or the weighting turning over until most releases are minors — would still walk
 * forward one bumped component at a time, and nothing else here would notice.
 */
describe('the bump a roll lands on', () => {
  it.each([
    [0, 'major'],
    [4, 'major'],
    [5, 'minor'],
    [19, 'minor'],
    [20, 'patch'],
    [99, 'patch'],
  ])('rolls %i as a %s', (roll, bump) => {
    expect(bumpForRoll(roll)).toBe(bump);
  });
});

/**
 * Which releases a player may name outright.
 *
 * Deliberately not "its CVE has published": the release that FIXES the current hole
 * becomes installable the day that fix ships, and its own hole lands later — so a
 * published-CVE test would refuse the very version a fresh install lands on. What can
 * be named is what the repo can hand over.
 */
describe('the releases the repo will hand over by name', () => {
  it('holds the release a fresh install lands on, and the ones behind it', () => {
    expect(repoHolds(SSH, newestReleaseOn(SSH, LATE)!, LATE)).toBe(true);
    expect(repoHolds(SSH, startingVersionOf(SSH)!, LATE)).toBe(true);
  });

  it('will not hand over a fix that has not shipped yet, though the timeline names it', () => {
    // The boundary that stops pinning being a way FORWARD past the patch delay. One day
    // before the fix ships the box is told the truth and can do nothing about it — and
    // naming that release outright must not be the way out, or the window nobody can buy
    // their way out of is one `install` away from being skipped.
    const { vulnerable, fix, shipsOn } = slowFix();
    expect(upgradeStatusFor(SSH, vulnerable.version, shipsOn - 1)).toMatchObject({
      kind: 'no-fix-yet',
    });
    expect(repoHolds(SSH, fix.version, shipsOn - 1)).toBe(false);
    // And the day it ships, it is on the shelf like anything else.
    expect(repoHolds(SSH, fix.version, shipsOn)).toBe(true);
  });

  it('will not hand over a number this world never released', () => {
    // Below the release the package was born on: older than anything a box can carry, so
    // nothing about upgrades can be what refuses it.
    const born = startingVersionOf(SSH)!;
    const belowBorn = born.replace(/\d+$/, (last) => String(Number(last) - 1));
    expect(packageTimeline(SSH, LATE).map(({ version }) => version)).not.toContain(belowBorn);
    expect(repoHolds(SSH, belowBorn, LATE)).toBe(false);
  });

  it('holds nothing for a package this world keeps no history for', () => {
    // A router's firmware is not upgraded through apt, so there is no shelf to take a
    // release off — naming any version of it is naming something that does not exist.
    expect(repoHolds(FIRMWARE_PACKAGE, '1.0.0', LATE)).toBe(false);
  });
});

/**
 * Which way a version move walks along a package's history.
 *
 * Both ends resolve through `installedRelease`, so a manifest holding a version this
 * world never published is weighed as the release it actually behaves as rather than as
 * the string somebody typed into it.
 */
describe('which way a version move walks', () => {
  it('walks forward onto a newer release and backward onto an older one', () => {
    const born = startingVersionOf(SSH)!;
    const newest = newestReleaseOn(SSH, LATE)!;
    expect(born).not.toBe(newest);
    expect(movesForward(SSH, { from: born, to: newest, gameDay: LATE })).toBe(true);
    expect(movesForward(SSH, { from: newest, to: born, gameDay: LATE })).toBe(false);
  });

  it('does not call standing still a move forward', () => {
    // Reinstalling the release a box already runs changes nothing, so it is not the
    // forward move `upgrade` owns — refusing it would send a player to a verb with
    // nothing to do.
    const newest = newestReleaseOn(SSH, LATE)!;
    expect(movesForward(SSH, { from: newest, to: newest, gameDay: LATE })).toBe(false);
  });

  it('weighs a manifest full of nonsense as the release it actually behaves as', () => {
    // Root can put anything in the manifest with an editor. Whatever is in there, the
    // box behaves as some real release — and the move is judged against THAT, or a
    // hand-edited file would be a way to make any move look like a downgrade.
    const born = startingVersionOf(SSH)!;
    expect(installedRelease(SSH, 'banana', LATE)?.version).toBe(born);
    expect(movesForward(SSH, { from: 'banana', to: born, gameDay: LATE })).toBe(false);
    expect(movesForward(SSH, { from: 'banana', to: newestReleaseOn(SSH, LATE)!, gameDay: LATE })).toBe(
      true,
    );
  });
});
