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

import { packageTimeline, type CveSeverity } from './packageTimeline';

export type LiveCve = {
  /** `CVE-YYYY-NNNNNNN`, where the year is the calendar year it published in. */
  readonly cve: string;
  readonly severity: CveSeverity;
  /** Game day it published on — before this, the package is genuinely clean. */
  readonly publishedAt: number;
};

/**
 * The CVE live against `key` at `version` on `gameDay`, or undefined when there
 * is none — the package is still inside its safe window, or the version is one
 * this world never shipped.
 *
 * An unrecognised version reads as clean, which is reachable today: the manifest
 * is root-writable, so a player can type a version nothing has a timeline for.
 * Harmless while nothing is exploitable; the exploit and upgrade paths own
 * deciding whether that should stay a free defence.
 */
export const liveCve = (key: string, version: string, gameDay: number): LiveCve | undefined => {
  const [entry] = packageTimeline(key, gameDay);
  if (entry === undefined || entry.version !== version || gameDay < entry.publishedAt) {
    return undefined;
  }
  return { cve: entry.cve, severity: entry.severity, publishedAt: entry.publishedAt };
};
