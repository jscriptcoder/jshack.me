/**
 * What vulnerability a package at a version has, on a given day of the world.
 *
 * ONE derivation over every axis. A daemon, a shared object and a router's
 * firmware image are all just a key with a version here, because
 * `/var/lib/dpkg/status` is one flat namespace in which they are
 * indistinguishable — so a scanner, `apt`, and the exploit that later reads this
 * cannot end up disagreeing about whether a box is exposed. What a CVE GRANTS
 * does differ by axis, and that is deliberately NOT decided here: a library's
 * privilege floor and a service's effect pool belong to the tools that fire an
 * exploit, not to the fact one exists.
 *
 * The history itself lives in `packageTimeline`; this is the question everything
 * else actually asks of it — WHICH release is this box sitting on, and has its
 * hole landed yet. Everything is recomputed, never stored, so the same key at the
 * same game day reconstructs the same CVE on the client (to render it) and on the
 * server (to authorize against it), which is what makes a forged client clock
 * unable to change anything a player actually GETS.
 *
 * The version comes from the box's own manifest rather than from the template
 * table, because a box will move off what it shipped with and a scan answering
 * from the table would keep pointing at a hole its owner had already closed.
 */

import { liveRelease, type CveSeverity } from './packageTimeline';

export type LiveCve = {
  /** `CVE-YYYY-NNNNNNN`, where the year is the calendar year it published in. */
  readonly cve: string;
  readonly severity: CveSeverity;
  /** Game day it published on — before this, the package is genuinely clean. */
  readonly publishedAt: number;
};

/**
 * The CVE live against `key` at `version` on `gameDay`, or undefined when there
 * is none — the release this box is on has not published its hole yet, or the
 * package has no history in this world at all.
 *
 * What `version` MEANS is `installedRelease`'s rule, not this one's: the manifest
 * is root-writable, so the string is whatever a player last wrote there, and it
 * resolves to the nearest release at or below it. A hand-typed future version is
 * therefore worth exactly what upgrading is worth, and no more.
 */
export const liveCve = (key: string, version: string, gameDay: number): LiveCve | undefined => {
  const release = liveRelease(key, version, gameDay);
  return release === undefined
    ? undefined
    : { cve: release.cve, severity: release.severity, publishedAt: release.publishedAt };
};
