import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import type { Port, RemoteUser } from '../network/types';
import type { EntryVariant, GeneratedMachine } from './types';
import {
  pickOwnerType,
  findUserByType,
  addNcBackdoorOwner,
  addFtpServerOwner,
  addExploitVulnerability,
  variantEnrichmentFlag,
  enrichMachineWithUsers,
  applyPortClosures,
  applyRedisPortOpening,
} from './enrichment';

// --- Test helpers ---

const mkUser = (username: string, userType: 'root' | 'user' | 'guest'): RemoteUser => ({
  username,
  passwordHash: 'hash',
  userType,
});

const mkPort = (port: number, service: string, open: boolean): Port => ({
  port,
  service,
  open,
});

const mkMachine = (
  ip: string,
  accessVariant: EntryVariant,
  ports: readonly Port[],
  users: readonly RemoteUser[] = [],
  role: 'webserver' | 'database' | 'router' = 'webserver',
): GeneratedMachine => ({
  ip,
  hostname: `host-${ip}`,
  role,
  accessVariant,
  remoteMachine: { ip, hostname: `host-${ip}`, ports, users },
});

const allUsers: readonly RemoteUser[] = [
  mkUser('root', 'root'),
  mkUser('admin', 'user'),
  mkUser('guest', 'guest'),
];

// --- pickOwnerType ---

describe('pickOwnerType', () => {
  it('returns guest, user, or root based on weighted distribution', () => {
    const counts = { guest: 0, user: 0, root: 0 };
    for (let i = 0; i < 100; i++) {
      const prng = createPrng(`pick-owner-${i}`);
      counts[pickOwnerType(prng)]++;
    }
    // Guest should be most common (~60%), root least (~10%)
    expect(counts.guest).toBeGreaterThan(counts.root);
    expect(counts.guest).toBeGreaterThan(counts.user);
  });

  it('is deterministic for the same seed', () => {
    const a = pickOwnerType(createPrng('same'));
    const b = pickOwnerType(createPrng('same'));
    expect(a).toBe(b);
  });
});

// --- findUserByType ---

describe('findUserByType', () => {
  it('returns the preferred type when present', () => {
    expect(findUserByType(allUsers, 'root')?.username).toBe('root');
    expect(findUserByType(allUsers, 'user')?.username).toBe('admin');
    expect(findUserByType(allUsers, 'guest')?.username).toBe('guest');
  });

  it('falls back through the chain when preferred type is missing', () => {
    const noGuest = [mkUser('root', 'root'), mkUser('admin', 'user')];
    // guest → falls back to user
    expect(findUserByType(noGuest, 'guest')?.username).toBe('admin');

    const noUser = [mkUser('root', 'root'), mkUser('guest', 'guest')];
    // user → falls back to guest
    expect(findUserByType(noUser, 'user')?.username).toBe('guest');
  });

  it('returns undefined for empty user list', () => {
    expect(findUserByType([], 'root')).toBeUndefined();
  });
});

// --- addNcBackdoorOwner ---

describe('addNcBackdoorOwner', () => {
  const basePorts: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(4444, 'elite', true)];

  it('assigns an owner to the open elite port', () => {
    const prng = createPrng('nc-owner');
    const result = addNcBackdoorOwner(basePorts, allUsers, prng);
    const elite = result.find((p) => p.service === 'elite');
    expect(elite?.owner).toBeDefined();
    expect(elite?.owner?.username).toBeDefined();
    expect(elite?.owner?.homePath).toBeDefined();
  });

  it('never assigns root as backdoor owner (remaps to user)', () => {
    // Run many seeds — root should never appear as backdoor owner
    for (let i = 0; i < 50; i++) {
      const prng = createPrng(`nc-no-root-${i}`);
      const result = addNcBackdoorOwner(basePorts, allUsers, prng);
      const elite = result.find((p) => p.service === 'elite');
      expect(elite?.owner?.userType).not.toBe('root');
    }
  });

  it('does not modify non-elite ports', () => {
    const prng = createPrng('nc-ssh-unchanged');
    const result = addNcBackdoorOwner(basePorts, allUsers, prng);
    const ssh = result.find((p) => p.service === 'ssh');
    expect(ssh?.owner).toBeUndefined();
  });

  it('does not modify closed elite ports', () => {
    const ports: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(4444, 'elite', false)];
    const prng = createPrng('nc-closed');
    const result = addNcBackdoorOwner(ports, allUsers, prng);
    const elite = result.find((p) => p.service === 'elite');
    expect(elite?.owner).toBeUndefined();
  });

  it('sets homePath to /root for root-type users, /home/username otherwise', () => {
    // Force a user-type owner by using users without guest
    const usersNoGuest = [mkUser('root', 'root'), mkUser('admin', 'user')];
    for (let i = 0; i < 30; i++) {
      const prng = createPrng(`nc-home-${i}`);
      const result = addNcBackdoorOwner(basePorts, usersNoGuest, prng);
      const elite = result.find((p) => p.service === 'elite');
      if (elite?.owner) {
        if (elite.owner.userType === 'root') {
          expect(elite.owner.homePath).toBe('/root');
        } else {
          expect(elite.owner.homePath).toBe(`/home/${elite.owner.username}`);
        }
      }
    }
  });
});

// --- addFtpServerOwner ---

describe('addFtpServerOwner', () => {
  const basePorts: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(21, 'ftp', true)];

  it('assigns an owner to the open FTP port', () => {
    const prng = createPrng('ftp-owner');
    const result = addFtpServerOwner(basePorts, allUsers, prng);
    const ftp = result.find((p) => p.service === 'ftp');
    expect(ftp?.owner).toBeDefined();
  });

  it('can assign root as FTP owner (unlike NC)', () => {
    let sawRoot = false;
    for (let i = 0; i < 100; i++) {
      const prng = createPrng(`ftp-root-${i}`);
      const result = addFtpServerOwner(basePorts, allUsers, prng);
      const ftp = result.find((p) => p.service === 'ftp');
      if (ftp?.owner?.userType === 'root') sawRoot = true;
    }
    expect(sawRoot).toBe(true);
  });

  it('does not modify non-FTP ports', () => {
    const prng = createPrng('ftp-ssh-unchanged');
    const result = addFtpServerOwner(basePorts, allUsers, prng);
    const ssh = result.find((p) => p.service === 'ssh');
    expect(ssh?.owner).toBeUndefined();
  });
});

// --- addExploitVulnerability ---

describe('addExploitVulnerability', () => {
  const basePorts: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(80, 'http', true)];

  it('attaches a vulnerability to the non-SSH open port', () => {
    const prng = createPrng('exploit-vuln');
    const result = addExploitVulnerability(basePorts, allUsers, prng);
    const http = result.find((p) => p.service === 'http');
    expect(http?.vulnerability).toBeDefined();
    expect(http?.owner).toBeDefined();
  });

  it('does not attach vulnerability to SSH ports', () => {
    const prng = createPrng('exploit-skip-ssh');
    const result = addExploitVulnerability(basePorts, allUsers, prng);
    const ssh = result.find((p) => p.service === 'ssh');
    expect(ssh?.vulnerability).toBeUndefined();
    expect(ssh?.owner).toBeUndefined();
  });

  it('does not attach vulnerability to closed ports', () => {
    const ports: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(80, 'http', false)];
    const prng = createPrng('exploit-closed');
    const result = addExploitVulnerability(ports, allUsers, prng);
    const http = result.find((p) => p.service === 'http');
    expect(http?.vulnerability).toBeUndefined();
  });

  it('skips ports with no matching vulnerability template', () => {
    const ports: readonly Port[] = [mkPort(22, 'ssh', true), mkPort(9999, 'unknown-service', true)];
    const prng = createPrng('exploit-no-match');
    const result = addExploitVulnerability(ports, allUsers, prng);
    const unknown = result.find((p) => p.service === 'unknown-service');
    expect(unknown?.vulnerability).toBeUndefined();
  });
});

// --- variantEnrichmentFlag ---

describe('variantEnrichmentFlag', () => {
  it('returns the variant for nc, exploit, and ftp', () => {
    expect(variantEnrichmentFlag('nc')).toBe('nc');
    expect(variantEnrichmentFlag('exploit')).toBe('exploit');
    expect(variantEnrichmentFlag('ftp')).toBe('ftp');
  });

  it('returns null for ssh, http, and snmp', () => {
    expect(variantEnrichmentFlag('ssh')).toBeNull();
    expect(variantEnrichmentFlag('http')).toBeNull();
    expect(variantEnrichmentFlag('snmp')).toBeNull();
  });
});

// --- enrichMachineWithUsers ---

describe('enrichMachineWithUsers', () => {
  it('populates users on the returned machine', () => {
    const machine = mkMachine('10.0.0.1', 'ssh', [mkPort(22, 'ssh', true)]);
    const prng = createPrng('enrich-users');
    const result = enrichMachineWithUsers(machine, allUsers, prng);
    expect(result.remoteMachine.users).toEqual(allUsers);
  });

  it('enriches NC variant with backdoor owner', () => {
    const machine = mkMachine('10.0.0.1', 'nc', [
      mkPort(22, 'ssh', true),
      mkPort(4444, 'elite', true),
    ]);
    const prng = createPrng('enrich-nc');
    const result = enrichMachineWithUsers(machine, allUsers, prng);
    const elite = result.remoteMachine.ports.find((p) => p.service === 'elite');
    expect(elite?.owner).toBeDefined();
  });

  it('enriches exploit variant with vulnerability', () => {
    const machine = mkMachine('10.0.0.1', 'exploit', [
      mkPort(22, 'ssh', true),
      mkPort(80, 'http', true),
    ]);
    const prng = createPrng('enrich-exploit');
    const result = enrichMachineWithUsers(machine, allUsers, prng);
    const http = result.remoteMachine.ports.find((p) => p.service === 'http');
    expect(http?.vulnerability).toBeDefined();
  });

  it('enriches FTP variant with port owner', () => {
    const machine = mkMachine('10.0.0.1', 'ftp', [
      mkPort(22, 'ssh', true),
      mkPort(21, 'ftp', true),
    ]);
    const prng = createPrng('enrich-ftp');
    const result = enrichMachineWithUsers(machine, allUsers, prng);
    const ftp = result.remoteMachine.ports.find((p) => p.service === 'ftp');
    expect(ftp?.owner).toBeDefined();
  });

  it('does not enrich SSH/HTTP/SNMP variants with port owners', () => {
    for (const variant of ['ssh', 'http', 'snmp'] as const) {
      const machine = mkMachine('10.0.0.1', variant, [
        mkPort(22, 'ssh', true),
        mkPort(80, 'http', true),
      ]);
      const prng = createPrng(`enrich-${variant}`);
      const result = enrichMachineWithUsers(machine, allUsers, prng);
      const hasOwner = result.remoteMachine.ports.some((p) => p.owner);
      expect(hasOwner).toBe(false);
    }
  });

  it('preserves machine identity fields', () => {
    const machine = mkMachine('10.0.0.1', 'ssh', [mkPort(22, 'ssh', true)]);
    const prng = createPrng('enrich-identity');
    const result = enrichMachineWithUsers(machine, allUsers, prng);
    expect(result.ip).toBe(machine.ip);
    expect(result.hostname).toBe(machine.hostname);
    expect(result.role).toBe(machine.role);
    expect(result.accessVariant).toBe(machine.accessVariant);
  });
});

// --- applyPortClosures ---

describe('applyPortClosures', () => {
  const buildMachines = (count: number, entryIp: string): readonly GeneratedMachine[] =>
    Array.from({ length: count }, (_, i) => {
      const ip = `10.0.0.${i + 10}`;
      return mkMachine(
        ip,
        'http',
        [mkPort(22, 'ssh', true), mkPort(80, 'http', true)],
        [mkUser('root', 'root'), mkUser('admin', 'user')],
        ip === entryIp ? 'webserver' : 'database',
      );
    });

  it('always consumes 8 PRNG calls for sequence stability', () => {
    const prng1 = createPrng('closure-seq');
    const prng2 = createPrng('closure-seq');
    const machines = buildMachines(4, '10.0.0.10');

    applyPortClosures(prng1, machines, '10.0.0.10');
    applyPortClosures(prng2, [], '10.0.0.10');

    // After calling with different machines, PRNG state should be identical
    // because both consumed exactly 8 calls
    expect(prng1.next()).toBe(prng2.next());
  });

  it('skips closures for script_fix objective', () => {
    const prng = createPrng('closure-scriptfix');
    const machines = buildMachines(4, '10.0.0.10');
    const result = applyPortClosures(prng, machines, '10.0.0.10', 'script_fix');
    expect(result).toBe(machines); // same reference — no modifications
  });

  it('skips closures for sabotage objective', () => {
    const prng = createPrng('closure-sabotage');
    const machines = buildMachines(4, '10.0.0.10');
    const result = applyPortClosures(prng, machines, '10.0.0.10', 'sabotage');
    expect(result).toBe(machines);
  });

  it('skips closures for backdoor objective', () => {
    const prng = createPrng('closure-backdoor');
    const machines = buildMachines(4, '10.0.0.10');
    const result = applyPortClosures(prng, machines, '10.0.0.10', 'backdoor');
    expect(result).toBe(machines);
  });

  it('skips closures for portforward objective', () => {
    const prng = createPrng('closure-portforward');
    const machines = buildMachines(4, '10.0.0.10');
    const result = applyPortClosures(prng, machines, '10.0.0.10', 'portforward');
    expect(result).toBe(machines);
  });

  it('does not skip closures for exfiltrate objective', () => {
    // Run many seeds — at least one should apply a closure
    let anyClosed = false;
    for (let i = 0; i < 50; i++) {
      const prng = createPrng(`closure-exfil-${i}`);
      const machines = buildMachines(4, '10.0.0.10');
      const result = applyPortClosures(prng, machines, '10.0.0.10', 'exfiltrate');
      const sshClosed = result.some(
        (m) => m.ip !== '10.0.0.10' && m.remoteMachine.ports.some((p) => p.port === 22 && !p.open),
      );
      if (sshClosed) anyClosed = true;
    }
    expect(anyClosed).toBe(true);
  });

  it('applies closures when no objectiveType is provided (home network mode)', () => {
    let anyClosed = false;
    for (let i = 0; i < 50; i++) {
      const prng = createPrng(`closure-home-${i}`);
      const machines = buildMachines(4, '10.0.0.10');
      const result = applyPortClosures(prng, machines, '10.0.0.10');
      const sshClosed = result.some(
        (m) => m.ip !== '10.0.0.10' && m.remoteMachine.ports.some((p) => p.port === 22 && !p.open),
      );
      if (sshClosed) anyClosed = true;
    }
    expect(anyClosed).toBe(true);
  });

  it('never closes ports on the entry machine', () => {
    for (let i = 0; i < 50; i++) {
      const prng = createPrng(`closure-entry-safe-${i}`);
      const machines = buildMachines(4, '10.0.0.10');
      const result = applyPortClosures(prng, machines, '10.0.0.10');
      const entry = result.find((m) => m.ip === '10.0.0.10');
      const allOpen = entry?.remoteMachine.ports.every((p) => p.port !== 22 || p.open);
      expect(allOpen).toBe(true);
    }
  });

  it('never closes ports on router machines', () => {
    const machines: readonly GeneratedMachine[] = [
      mkMachine(
        '10.0.0.10',
        'http',
        [mkPort(22, 'ssh', true), mkPort(80, 'http', true)],
        [mkUser('root', 'root'), mkUser('admin', 'user')],
        'webserver',
      ),
      mkMachine(
        '10.0.0.11',
        'ssh',
        [mkPort(22, 'ssh', true), mkPort(80, 'http', true)],
        [mkUser('root', 'root'), mkUser('netops', 'user')],
        'router',
      ),
    ];
    for (let i = 0; i < 50; i++) {
      const prng = createPrng(`closure-router-safe-${i}`);
      const result = applyPortClosures(prng, machines, '10.0.0.10');
      const router = result.find((m) => m.role === 'router');
      expect(router?.remoteMachine.ports.find((p) => p.port === 22)?.open).toBe(true);
    }
  });

  it('when SSH is closed, an NC backdoor with root owner is always present', () => {
    for (let i = 0; i < 100; i++) {
      const prng = createPrng(`closure-ssh-nc-${i}`);
      const machines = buildMachines(4, '10.0.0.10');
      const result = applyPortClosures(prng, machines, '10.0.0.10');

      for (const m of result) {
        const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
        if (!sshClosed) continue;

        // NC backdoor must exist with root owner (both SSH-only and dual closures guarantee this)
        const elite = m.remoteMachine.ports.find((p) => p.service === 'elite' && p.open);
        expect(elite).toBeDefined();
        expect(elite?.owner?.userType).toBe('root');
      }
    }
  });

  it('when SSH is closed, at least one alternative access method (FTP or NC) is available', () => {
    for (let i = 0; i < 100; i++) {
      const prng = createPrng(`closure-alt-access-${i}`);
      const machines = buildMachines(4, '10.0.0.10');
      const result = applyPortClosures(prng, machines, '10.0.0.10');

      for (const m of result) {
        const sshClosed = m.remoteMachine.ports.some((p) => p.port === 22 && !p.open);
        if (!sshClosed) continue;

        const hasFtpOpen = m.remoteMachine.ports.some((p) => p.port === 21 && p.open);
        const hasEliteOpen = m.remoteMachine.ports.some((p) => p.service === 'elite' && p.open);
        expect(hasFtpOpen || hasEliteOpen).toBe(true);
      }
    }
  });

  it('is deterministic for the same seed', () => {
    const machines = buildMachines(4, '10.0.0.10');
    const a = applyPortClosures(createPrng('det'), [...machines], '10.0.0.10');
    const b = applyPortClosures(createPrng('det'), [...machines], '10.0.0.10');
    expect(a).toEqual(b);
  });
});

describe('applyRedisPortOpening', () => {
  const mkDbMachine = (ip: string): GeneratedMachine =>
    mkMachine(
      ip,
      'ssh',
      [
        mkPort(22, 'ssh', true),
        mkPort(3306, 'mysql', true),
        mkPort(5432, 'postgresql', false),
        mkPort(6379, 'redis', false),
        mkPort(27017, 'mongodb', false),
      ],
      [],
      'database',
    );

  it('opens port 6379 on some database machines (~35% rate)', () => {
    let openCount = 0;
    const total = 200;
    for (let i = 0; i < total; i++) {
      const machines = [mkDbMachine('10.0.0.10')];
      const result = applyRedisPortOpening(createPrng(`redis-open-${i}`), machines);
      const redis = result[0]!.remoteMachine.ports.find((p) => p.port === 6379);
      if (redis?.open) openCount++;
    }
    // ~35% rate — allow 15%-55% range
    expect(openCount).toBeGreaterThanOrEqual(total * 0.15);
    expect(openCount).toBeLessThanOrEqual(total * 0.55);
  });

  it('does not open Redis on non-database machines', () => {
    const webMachine = mkMachine(
      '10.0.0.20',
      'ssh',
      [mkPort(22, 'ssh', true), mkPort(80, 'http', true)],
      [],
      'webserver',
    );
    for (let i = 0; i < 50; i++) {
      const result = applyRedisPortOpening(createPrng(`redis-web-${i}`), [webMachine]);
      expect(result[0]!.remoteMachine.ports).toEqual(webMachine.remoteMachine.ports);
    }
  });

  it('is deterministic for the same seed', () => {
    const machines = [mkDbMachine('10.0.0.10'), mkDbMachine('10.0.0.11')];
    const a = applyRedisPortOpening(createPrng('redis-det'), machines);
    const b = applyRedisPortOpening(createPrng('redis-det'), machines);
    expect(a).toEqual(b);
  });

  it('always consumes one PRNG call per database machine', () => {
    const machines = [mkDbMachine('10.0.0.10'), mkDbMachine('10.0.0.11')];
    const prng1 = createPrng('redis-consume');
    applyRedisPortOpening(prng1, machines);
    const after1 = prng1.next();

    const prng2 = createPrng('redis-consume');
    applyRedisPortOpening(prng2, machines);
    const after2 = prng2.next();

    expect(after1).toBe(after2);
  });
});
