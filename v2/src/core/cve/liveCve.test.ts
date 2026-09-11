import { describe, expect, it } from 'vitest';
import { PACKAGE_TEMPLATES, startingVersionOf } from '../packages/packageVersions';
import { assertCveTimingInvariants, CVE_TIMING, liveCve, severityForRoll } from './liveCve';

const KEYS = Object.keys(PACKAGE_TEMPLATES);
const SSH = 'openssh-server';
const startOf = (key: string): string => {
  const version = startingVersionOf(key);
  if (version === undefined) throw new Error(`no template for ${key}`);
  return version;
};
/** Far past any package's first publication, so the CVE is certainly live. */
const LATE = 1000;

/**
 * The vulnerability every box in the world inherits from the version it runs.
 *
 * One derivation over every axis: a daemon, a shared object and (from the
 * firmware slice) a router image are all just a key with a version, because
 * `/var/lib/dpkg/status` is itself one flat namespace in which they are
 * indistinguishable. What a CVE GRANTS differs per axis and is not decided here.
 */
describe('a package with a published CVE', () => {
  it('publishes its first CVE inside the configured safe window, never on day zero', () => {
    // The world is genuinely clean when it begins and the treadmill introduces
    // itself — that is why there is no hand-authored day-0 CVE table.
    for (const key of KEYS) {
      const live = liveCve(key, startOf(key), LATE);
      expect(live?.publishedAt).toBeGreaterThanOrEqual(CVE_TIMING.minSafeWindowDays);
      expect(live?.publishedAt).toBeLessThanOrEqual(CVE_TIMING.maxSafeWindowDays);
    }
  });

  it('is invisible the day before it publishes and live on the day itself', () => {
    const published = liveCve(SSH, startOf(SSH), LATE);
    const day = published?.publishedAt ?? 0;
    expect(liveCve(SSH, startOf(SSH), day - 1)).toBeUndefined();
    expect(liveCve(SSH, startOf(SSH), day)).toEqual(published);
  });

  it('answers identically every time it is asked', () => {
    // Nothing is persisted: the same question at the same game day has to
    // reconstruct the same CVE, on the client and on the server alike.
    expect(liveCve(SSH, startOf(SSH), LATE)).toEqual(liveCve(SSH, startOf(SSH), LATE));
  });

  it('does not publish every package on the same day', () => {
    const days = new Set(KEYS.map((key) => liveCve(key, startOf(key), LATE)?.publishedAt));
    expect(days.size).toBeGreaterThan(1);
  });

  it('carries a severity that forecasts what the door is worth', () => {
    for (const key of KEYS) {
      expect(['critical', 'high', 'medium', 'low']).toContain(liveCve(key, startOf(key), LATE)?.severity);
    }
  });
});

/**
 * The world is a pure function of the epoch and these seeds, so it can be pinned
 * exactly. This is a lock against SILENT drift: reordering a PRNG draw, renaming
 * a seed string or renumbering a package would republish CVEs that players
 * already have written down in their logs, and nothing else in the suite would
 * notice. Changing any row here is a deliberate act, not a passing detail.
 *
 * EVERY package, not a sample. The derivation is about to learn to walk forward
 * to the versions `apt upgrade` reaches, and the one thing that walk must not do
 * is disturb the entry every box in the world currently sits on — so the lock has
 * to cover the whole table the walk could disturb, libraries included. The
 * coverage case below is what stops a new package slipping in BESIDE the lock
 * instead of under it.
 *
 * All four severity bands appear here, which is the honest way to show each one
 * is reachable — a distribution assertion over fifteen packages would not be.
 */
const WORLD_PINS = [
  ['openssh-server', 'CVE-2026-0149031', 'medium', 8],
  ['nginx', 'CVE-2026-0269486', 'high', 9],
  ['vsftpd', 'CVE-2026-0378750', 'low', 5],
  ['mysql', 'CVE-2026-0458876', 'medium', 14],
  ['redis', 'CVE-2026-0597580', 'critical', 9],
  ['bind9', 'CVE-2026-0666363', 'medium', 14],
  ['snmp', 'CVE-2026-0712758', 'medium', 4],
  ['libpam', 'CVE-2026-0833104', 'medium', 3],
  ['libcrypt', 'CVE-2026-0900028', 'high', 8],
  ['libsystemd', 'CVE-2026-1027505', 'high', 4],
  ['libreadline', 'CVE-2026-1130181', 'high', 8],
  ['libssl', 'CVE-2026-1212003', 'low', 14],
  ['libz', 'CVE-2026-1396234', 'medium', 10],
  ['libxml2', 'CVE-2026-1466733', 'medium', 6],
  ['libpcre', 'CVE-2026-1544019', 'high', 9],
] as const;

describe('the world these seeds actually produce', () => {
  it.each(WORLD_PINS)('pins %s', (key, cve, severity, publishedAt) => {
    expect(liveCve(key, startOf(key), LATE)).toEqual({ cve, severity, publishedAt });
  });

  it('covers every package the world ships', () => {
    expect([...WORLD_PINS].map(([key]) => key).sort()).toEqual([...KEYS].sort());
  });
});

describe('a package with no live CVE', () => {
  it('has none before its publication day', () => {
    expect(liveCve(SSH, startOf(SSH), 0)).toBeUndefined();
  });

  it('has none for a version the package never shipped', () => {
    // The manifest is root-WRITABLE, so this is a line a player can type.
    expect(liveCve(SSH, '9.9.9', LATE)).toBeUndefined();
  });

  it('has none for a package the world has no version template for', () => {
    expect(liveCve('metasploit', '1.0.0', LATE)).toBeUndefined();
  });
});

describe('a library', () => {
  it('derives its CVE exactly as a service does', () => {
    // The axis is not a parameter. `msfconsole --local` will read this same
    // answer for a shared object that no port advertises.
    const live = liveCve('libssl', startOf('libssl'), LATE);
    expect(live).toEqual({
      cve: expect.stringMatching(/^CVE-\d{4}-\d{7}$/),
      severity: expect.any(String),
      publishedAt: expect.any(Number),
    });
  });
});

describe('a CVE id', () => {
  it('names the calendar year the vulnerability actually published in', () => {
    for (const key of KEYS) {
      const live = liveCve(key, startOf(key), LATE);
      const publishedOn = new Date(Date.UTC(2026, 8, 1) + (live?.publishedAt ?? 0) * 86_400_000);
      expect(live?.cve.slice(4, 8)).toBe(String(publishedOn.getUTCFullYear()));
    }
  });

  it('is unique across every package in the world', () => {
    const ids = KEYS.map((key) => liveCve(key, startOf(key), LATE)?.cve);
    expect(new Set(ids).size).toBe(KEYS.length);
  });

  it('does not end every package on the same four digits', () => {
    // Those four digits key the reset password a compromised player has to
    // reconstruct from their own logs. If every package's first CVE ended the
    // same way, one guess would open most of the world without reading anything.
    const lastFour = new Set(KEYS.map((key) => liveCve(key, startOf(key), LATE)?.cve.slice(-4)));
    expect(lastFour.size).toBe(KEYS.length);
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
