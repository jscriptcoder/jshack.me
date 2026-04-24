import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import { generateUsers } from './users';
import { md5 } from '../utils/md5';
import { usernamesByRole } from './pools';
import { secrets } from '../secrets/secrets';

const passwords: readonly string[] = JSON.parse(secrets.MISSION_PASSWORDS) as readonly string[];
const wordlistPasswords: readonly string[] = JSON.parse(
  secrets.WORDLIST_PASSWORDS,
) as readonly string[];
const guestPasswords: readonly string[] = JSON.parse(secrets.GUEST_PASSWORDS) as readonly string[];

const buildTestData = async (seed: string) => {
  const prng = createPrng(seed);
  const topology = await generateTopology(prng, 'medium');
  const users = generateUsers(prng, topology.machines, topology.entryPoint);
  return { topology, users };
};

describe('generateUsers', () => {
  it('produces deterministic output for the same seed', async () => {
    const a = await buildTestData('users-seed');
    const b = await buildTestData('users-seed');
    expect(a.users).toEqual(b.users);
  });

  it('produces different output for different seeds', async () => {
    const a = await buildTestData('users-alpha');
    const b = await buildTestData('users-beta');
    expect(a.users.usersByMachine).not.toEqual(b.users.usersByMachine);
  });

  it('every machine has a root user', async () => {
    const { topology, users } = await buildTestData('root-test');
    topology.machines.forEach((m) => {
      const machineUsers = users.usersByMachine[m.ip];
      expect(machineUsers).toBeDefined();
      const root = machineUsers?.find((u) => u.username === 'root');
      expect(root).toBeDefined();
      expect(root?.userType).toBe('root');
    });
  });

  it('entry machine always has a guest user', async () => {
    for (let i = 0; i < 10; i++) {
      const { topology, users } = await buildTestData(`guest-entry-${i}`);
      const entryUsers = users.usersByMachine[topology.entryPoint];
      const guest = entryUsers?.find((u) => u.username === 'guest');
      expect(guest).toBeDefined();
      expect(guest?.userType).toBe('guest');
    }
  });

  it('each machine has 1-2 regular users from role pool', async () => {
    const { topology, users } = await buildTestData('regular-test');
    topology.machines.forEach((m) => {
      const machineUsers = users.usersByMachine[m.ip] ?? [];
      const regulars = machineUsers.filter((u) => u.userType === 'user');
      expect(regulars.length).toBeGreaterThanOrEqual(1);
      expect(regulars.length).toBeLessThanOrEqual(2);
      regulars.forEach((u) => {
        const pool = usernamesByRole[m.role];
        expect(pool).toContain(u.username);
      });
    });
  });

  it('passwords are hashed with md5', async () => {
    const { topology, users } = await buildTestData('hash-test');
    topology.machines.forEach((m) => {
      const creds = users.credentials[m.ip] ?? [];
      const machineUsers = users.usersByMachine[m.ip] ?? [];
      creds.forEach((cred) => {
        const user = machineUsers.find((u) => u.username === cred.username);
        expect(user).toBeDefined();
        expect(user?.passwordHash).toBe(md5(cred.password));
      });
    });
  });

  it('credentials map includes all users', async () => {
    const { topology, users } = await buildTestData('creds-test');
    topology.machines.forEach((m) => {
      const machineUsers = users.usersByMachine[m.ip] ?? [];
      const creds = users.credentials[m.ip] ?? [];
      machineUsers.forEach((u) => {
        const cred = creds.find((c) => c.username === u.username);
        expect(cred).toBeDefined();
      });
    });
  });

  it('uses passwords from appropriate pool based on variant', async () => {
    const { topology, users } = await buildTestData('pool-test');
    topology.machines.forEach((m) => {
      const creds = users.credentials[m.ip] ?? [];
      creds
        .filter((c) => c.username !== 'guest')
        .forEach((cred) => {
          // Root always from MISSION_PASSWORDS, regular users from either pool
          const allPasswords = [...passwords, ...wordlistPasswords];
          expect(allPasswords).toContain(cred.password);
        });
    });
  });

  it('guest passwords come from guestPasswords pool', async () => {
    const { topology, users } = await buildTestData('guest-pool-test');
    topology.machines.forEach((m) => {
      const creds = users.credentials[m.ip] ?? [];
      const guestCred = creds.find((c) => c.username === 'guest');
      if (guestCred) {
        expect(guestPasswords).toContain(guestCred.password);
      }
    });
  });

  it('guest passwords vary across seeds', async () => {
    const guestPassFromSeeds = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { topology, users } = await buildTestData(`guest-vary-${i}`);
      const entryCreds = users.credentials[topology.entryPoint] ?? [];
      const guestCred = entryCreds.find((c) => c.username === 'guest');
      if (guestCred) {
        guestPassFromSeeds.add(guestCred.password);
      }
    }
    // Should see more than one distinct guest password
    expect(guestPassFromSeeds.size).toBeGreaterThan(1);
  });
});
