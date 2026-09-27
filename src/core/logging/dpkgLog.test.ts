import { describe, expect, it } from 'vitest';
import { asGameTime } from '../types';
import {
  DPKG_LOG_OWNER,
  DPKG_LOG_PATH,
  DPKG_LOG_PERMISSIONS,
  formatPackageDowngradeLine,
} from './dpkgLog';

/**
 * dpkg-log (`/var/log/dpkg.log`) line formatting — the record a box keeps of a package
 * being rolled BACKWARDS, and the only place its owner can learn that it happened.
 *
 * Real `dpkg.log` carries no address field, so this line is a deliberate hybrid: dpkg's
 * own columns plus the `Client "ip"` field the vsftpd exploit lines already established
 * for cross-player events, so a player meets a familiar field in a new file. Nothing in
 * this game PARSES a log — the defender reads with `cat` — so the line answers to a
 * human, and one line in one file beats a truer pair of files the reader must correlate.
 *
 * No architecture column. The manifest every scan and exploit reads names `Package`,
 * `Status` and `Version` and nothing else, so `redis:amd64` would be the only token in
 * the line that no other part of the world could corroborate.
 *
 * Pure: the timestamp is supplied by the caller, so the whole line is assertable.
 */

// 2026-08-14 13:56:02 UTC. Seconds are the only single-digit field, so this fixture
// alone does NOT prove the date is padded — see the padding case below.
const AUG_14 = asGameTime(Date.UTC(2026, 7, 14, 13, 56, 2));

// 2026-01-05 04:07:09 UTC — month, day, hour, minute and second ALL single digit, so
// every pad in the stamp is exercised at once. Without this a formatter that dropped
// padding entirely would still pass every other test in this file.
const JAN_5 = asGameTime(Date.UTC(2026, 0, 5, 4, 7, 9));

describe('the dpkg log storage identity', () => {
  it('lives at /var/log/dpkg.log, owned by root', () => {
    // The literal path IS the interface: a defender types it into `cat`, and every other
    // assertion here compares against the constant, so only spelling it out can catch
    // the file quietly moving somewhere nobody thinks to look.
    expect(DPKG_LOG_PATH).toBe('/var/log/dpkg.log');
    // Owner decides who may write. A log an attacker's tier could own is a log they
    // could edit away the record of their own visit from.
    expect(DPKG_LOG_OWNER).toBe('root');
  });

  it('is readable by every account on the box, and writable only by root', () => {
    // Root-only READ would hide the evidence from the very person it is for: the box's
    // owner reads this after something went wrong, and may not be sitting as root.
    expect(DPKG_LOG_PERMISSIONS.read).toEqual(['root', 'user', 'guest']);
    // The downgrade is a system action, so the write is the system's — a visitor who
    // reached user or guest must not be able to rewrite what the box recorded of them.
    expect(DPKG_LOG_PERMISSIONS.write).toEqual(['root']);
    expect(DPKG_LOG_PERMISSIONS.execute).toEqual(['root']);
  });
});

describe('formatPackageDowngradeLine', () => {
  it('names the release the box left before the one it landed on, and the client that moved it', () => {
    const line = formatPackageDowngradeLine({
      packageName: 'redis',
      fromVersion: '7.9.7',
      toVersion: '7.2.5',
      fromIp: '203.0.113.199',
      time: AUG_14,
    });

    // Old version then new, which is the order dpkg writes and the order that tells the
    // owner which way the box moved. Swapped, the line reads as an upgrade and the whole
    // record means the opposite of what happened.
    expect(line).toBe('2026-08-14 13:56:02 downgrade redis 7.9.7 7.2.5 Client "203.0.113.199"');
  });

  it('pads every field of the date, so lines from early months still sort and align', () => {
    const line = formatPackageDowngradeLine({
      packageName: 'vsftpd',
      fromVersion: '3.0.5',
      toVersion: '3.0.3',
      fromIp: '198.51.100.7',
      time: JAN_5,
    });

    expect(line).toBe('2026-01-05 04:07:09 downgrade vsftpd 3.0.5 3.0.3 Client "198.51.100.7"');
  });

  it('carries the address even when the box moved itself, so a foreign one is readable as foreign', () => {
    // One shape for every downgrade, whoever ran it: the formatter has nothing to branch
    // on, and an owner who knows what their own address looks like in this file is the
    // one who can spot an address that is not theirs.
    const line = formatPackageDowngradeLine({
      packageName: 'redis',
      fromVersion: '7.9.7',
      toVersion: '7.2.5',
      fromIp: '192.168.4.22',
      time: AUG_14,
    });

    expect(line).toBe('2026-08-14 13:56:02 downgrade redis 7.9.7 7.2.5 Client "192.168.4.22"');
  });
});
