import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import {
  generateFtpVirtualUsers,
  formatVirtualUsersConf,
  parseVirtualUsersConf,
} from './ftpCredentials';
import type { RemoteUser } from '../network/types';
import { md5 } from '../utils/md5';
import { passwords } from './pools';

const systemUsers: readonly RemoteUser[] = [
  { username: 'root', passwordHash: md5('s3cur3!'), userType: 'root' },
  { username: 'webadmin', passwordHash: md5('p4ssw0rd'), userType: 'user' },
  { username: 'guest', passwordHash: md5('guest'), userType: 'guest' },
];

describe('generateFtpVirtualUsers', () => {
  it('generates one FTP user per system user with different password hashes', () => {
    const prng = createPrng('test-seed');
    const ftpUsers = generateFtpVirtualUsers(prng, systemUsers);

    expect(ftpUsers).toHaveLength(3);
    expect(ftpUsers[0]?.username).toBe('root');
    expect(ftpUsers[1]?.username).toBe('webadmin');
    expect(ftpUsers[2]?.username).toBe('guest');

    // FTP passwords should differ from system passwords
    expect(ftpUsers[0]?.passwordHash).not.toBe(systemUsers[0]?.passwordHash);
    expect(ftpUsers[1]?.passwordHash).not.toBe(systemUsers[1]?.passwordHash);
  });

  it('generates passwords from WORDLIST_PASSWORDS (not MISSION_PASSWORDS)', () => {
    const prng = createPrng('test-seed-2');
    const ftpUsers = generateFtpVirtualUsers(prng, systemUsers);

    // FTP password hashes should NOT be from the mission passwords pool
    const missionHashes = new Set(passwords.map((p) => md5(p)));
    ftpUsers.forEach((user) => {
      expect(missionHashes.has(user.passwordHash)).toBe(false);
    });
  });

  it('is deterministic for the same seed', () => {
    const ftpUsers1 = generateFtpVirtualUsers(createPrng('same-seed'), systemUsers);
    const ftpUsers2 = generateFtpVirtualUsers(createPrng('same-seed'), systemUsers);
    expect(ftpUsers1).toEqual(ftpUsers2);
  });
});

describe('formatVirtualUsersConf', () => {
  it('formats users as username:hash lines', () => {
    const users = [
      { username: 'root', passwordHash: 'abc123', userType: 'root' as const },
      { username: 'admin', passwordHash: 'def456', userType: 'user' as const },
    ];
    expect(formatVirtualUsersConf(users)).toBe('root:abc123\nadmin:def456');
  });
});

describe('parseVirtualUsersConf', () => {
  it('parses username:hash lines', () => {
    const content = 'root:abc123\nadmin:def456';
    const users = parseVirtualUsersConf(content);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ username: 'root', passwordHash: 'abc123', userType: 'user' });
    expect(users[1]).toEqual({ username: 'admin', passwordHash: 'def456', userType: 'user' });
  });

  it('skips empty lines', () => {
    const content = 'root:abc123\n\nadmin:def456\n';
    expect(parseVirtualUsersConf(content)).toHaveLength(2);
  });

  it('skips malformed lines without colon', () => {
    const content = 'root:abc123\nbadline\nadmin:def456';
    expect(parseVirtualUsersConf(content)).toHaveLength(2);
  });

  it('roundtrips with formatVirtualUsersConf', () => {
    const prng = createPrng('roundtrip');
    const original = generateFtpVirtualUsers(prng, systemUsers);
    const content = formatVirtualUsersConf(original);
    const parsed = parseVirtualUsersConf(content);

    expect(parsed).toHaveLength(original.length);
    parsed.forEach((p, i) => {
      expect(p.username).toBe(original[i]?.username);
      expect(p.passwordHash).toBe(original[i]?.passwordHash);
    });
  });
});
