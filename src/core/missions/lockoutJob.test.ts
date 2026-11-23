import { describe, expect, it } from 'vitest';
import { keyBoxSuffix, lockoutJob } from './targetRoles.js';
import { missionKind } from './missionShape.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const LOCKOUT_NUMBERS = Array.from({ length: 5000 }, (_unused, index) => index * 8381 + 2)
  .filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254)
  .filter((missionNumber) => missionKind(missionNumber) === 'lockout');

/** The names an intruder gives the account they add, each passing for a system account. */
const INTRUDER_ACCOUNTS = [
  'dbus',
  'netadm',
  'ntpd',
  'sshd-agent',
  'sysadm',
  'syslogd',
  'systemd-sync',
  'toor',
];

describe('what a lock-them-out job names', () => {
  it('names its target box for the machine it is, so the contractor knows the box they land on', () => {
    expect(LOCKOUT_NUMBERS.length).toBeGreaterThan(200);
    for (const missionNumber of LOCKOUT_NUMBERS) {
      expect(keyBoxSuffix(missionNumber), `contract ${missionNumber}`).toBe(
        lockoutJob(missionNumber).role.suffix,
      );
    }
  });

  it('draws every one of the seven machines', () => {
    const suffixes = new Set(
      LOCKOUT_NUMBERS.map((missionNumber) => lockoutJob(missionNumber).role.suffix),
    );

    expect([...suffixes].sort()).toEqual(['access', 'backup', 'billing', 'ci', 'lic', 'mon', 'nvr']);
  });

  it('names the added account one of eight that pass for system accounts, each drawn', () => {
    const accounts = LOCKOUT_NUMBERS.map((missionNumber) => lockoutJob(missionNumber).account);

    expect([...new Set(accounts)].sort()).toEqual(INTRUDER_ACCOUNTS);
  });
});
