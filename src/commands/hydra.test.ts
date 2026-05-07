import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { GeneratedUser } from '../generation/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createHydraCommand } from './hydra';
import { md5 } from '../utils/md5';
import { passwords as passwordPool } from '../generation/pools';

// Test fixtures need passwordHash on each user to synthesize /etc/passwd
// content (mkPasswdNodeFromUsers below). The runtime RemoteUser type
// dropped passwordHash in step 6 of plans/etc-passwd-canonical.md, so
// fixtures use GeneratedUser (a superset). Production code that consumes
// RemoteMachine.users gets the structural subtype unchanged via
// covariance.
type FixtureMachine = Omit<RemoteMachine, 'users'> & {
  readonly users: readonly GeneratedUser[];
};

// --- Factory Functions ---

// Passwords that are IN the wordlist file (crackable via hydra)
const WORDLIST_PASSWORD = 'admin';
const WORDLIST_PASSWORD_HASH = md5(WORDLIST_PASSWORD);
const GUEST_PASSWORD = 'guest';
const GUEST_PASSWORD_HASH = md5(GUEST_PASSWORD);

// Password NOT in the wordlist file (never crackable)
const NON_WORDLIST_PASSWORD = 's3cur3!';
const NON_WORDLIST_PASSWORD_HASH = md5(NON_WORDLIST_PASSWORD);

// The wordlist file content — simulates /usr/share/wordlists/passwords.txt
const MOCK_WORDLIST_CONTENT = [GUEST_PASSWORD, WORDLIST_PASSWORD, 'password', 'letmein'].join('\n');

const mkWordlistNode = (): FileNode => ({
  name: 'passwords.txt',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
  content: MOCK_WORDLIST_CONTENT,
});

const getMockRemoteMachine = (overrides?: Partial<FixtureMachine>): FixtureMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [
    { port: 21, service: 'ftp', serviceVersion: 'latest', open: true },
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
  ],
  users: [
    { username: 'root', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' },
    { username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' },
    { username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' },
  ],
  ...overrides,
});

// Build a /etc/passwd FileNode from a list of users. Used as the default
// content for every machine in the mock context, so tests that exercise
// the SSH/FTP brute-force path (which reads /etc/passwd to source live
// hashes) can rely on the synthesized file matching the machine's users.
// Tests can override the default by providing explicit machineFiles[ip]
// entries for '/etc/passwd', or opt out entirely via noEtcPasswd.
const mkPasswdNodeFromUsers = (users: readonly GeneratedUser[]): FileNode => ({
  name: 'passwd',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: [] },
  content: users
    .map((u, i) => {
      const uid = u.userType === 'root' ? 0 : u.userType === 'guest' ? 65534 : 1000 + i;
      const home = u.userType === 'root' ? '/root' : `/home/${u.username}`;
      return `${u.username}:${u.passwordHash}:${uid}:${uid}:${u.username}:${home}:/bin/bash`;
    })
    .join('\n'),
});

const passwdLine = (username: string, hash: string, uid = 1000) =>
  `${username}:${hash}:${uid}:${uid}:${username}:/home/${username}:/bin/bash`;

const mkPasswdNode = (lines: readonly string[]): FileNode => ({
  name: 'passwd',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root', 'user'], write: ['root'], execute: [] },
  content: lines.join('\n'),
});

const mkVirtualUsersNode = (
  entries: ReadonlyArray<{ readonly username: string; readonly passwordHash: string }>,
): FileNode => ({
  name: 'virtual_users.conf',
  type: 'file',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: [] },
  content: entries.map((e) => `${e.username}:${e.passwordHash}`).join('\n'),
});

type HydraContextConfig = {
  readonly machines?: readonly FixtureMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
  readonly machineFiles?: Readonly<Record<string, Record<string, FileNode>>>;
  readonly localFiles?: Readonly<Record<string, FileNode>>;
  readonly currentPath?: string;
  // IPs for which the synthesized default /etc/passwd should be omitted
  // (simulates an unreadable / deleted /etc/passwd for sabotage tests).
  readonly noEtcPasswd?: readonly string[];
};

const createMockContext = (config: HydraContextConfig = {}) => {
  const {
    machines = [],
    localIP = '192.168.1.100',
    dnsRecords = [],
    machineFiles = {},
    localFiles = { '/usr/share/wordlists/passwords.txt': mkWordlistNode() },
    currentPath = '/home/user',
    noEtcPasswd = [],
  } = config;
  // Layer synthesized /etc/passwd defaults under any explicit per-test
  // machineFiles entries. Explicit overrides win; noEtcPasswd lets a test
  // simulate "file does not exist" by skipping the default for that IP.
  const noEtcPasswdSet = new Set(noEtcPasswd);
  const mergedMachineFiles: Record<string, Record<string, FileNode>> = {};
  machines.forEach((m) => {
    const explicit = machineFiles[m.ip] ?? {};
    if (noEtcPasswdSet.has(m.ip) || '/etc/passwd' in explicit) {
      mergedMachineFiles[m.ip] = explicit;
    } else {
      mergedMachineFiles[m.ip] = {
        '/etc/passwd': mkPasswdNodeFromUsers(m.users),
        ...explicit,
      };
    }
  });
  // Also include any machineFiles entries for IPs not in machines (e.g.,
  // tests that mock a hostname-only target).
  Object.keys(machineFiles).forEach((ip) => {
    if (!(ip in mergedMachineFiles)) {
      mergedMachineFiles[ip] = machineFiles[ip] as Record<string, FileNode>;
    }
  });
  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat: (ip: string, _port: number) => ({ ip, port: _port }),
    findMachineUsers: (ip: string) => machines.find((m) => m.ip === ip)?.users ?? [],
    getNodeFromMachine: (ip: string, path: string) =>
      (mergedMachineFiles[ip]?.[path] as FileNode | undefined) ?? null,
    getLocalNode: (path: string) => (localFiles[path] as FileNode | undefined) ?? null,
    getCurrentPath: () => currentPath,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const collectAsyncLines = (output: AsyncOutput): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const lines: string[] = [];
    output.start(
      (line) => lines.push(line),
      () => resolve(lines),
    );
    vi.runAllTimers();
  });

// --- Tests ---

describe('hydra command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('argument validation', () => {
    it('should throw when no host given', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn()).toThrow('hydra: missing host');
    });

    it('should throw for invalid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'telnet')).toThrow(
        'hydra: unsupported service "telnet"',
      );
    });

    it('should accept "snmp" as valid service', () => {
      const machine = getMockRemoteMachine({
        ports: [
          { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
        ],
      });
      const snmpdConf: FileNode = {
        name: 'snmpd.conf',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: [] },
        content: 'rocommunity public\nrwcommunity private\nsysDescr Router',
      };
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: { '192.168.1.50': { '/etc/snmp/snmpd.conf': snmpdConf } },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'snmp');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should accept "ssh" as valid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Should not throw for service validation — will proceed to async output
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should accept "ftp" as valid service', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ftp');
      expect(isAsyncOutput(result)).toBe(true);
    });
  });

  describe('host resolution', () => {
    it('should resolve IP addresses directly', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should resolve domain names via DNS', () => {
      const machine = getMockRemoteMachine();
      const dnsRecords: readonly DnsRecord[] = [
        { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
      ];
      const hydra = createHydraCommand(createMockContext({ machines: [machine], dnsRecords }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('fileserver.local');
      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should throw for unresolvable domain', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('unknown.host')).toThrow(
        'hydra: unknown.host: Name or service not known',
      );
    });

    it('should reject localhost by IP', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('192.168.1.100')).toThrow('hydra: cannot attack localhost');
    });

    it('should reject localhost by name', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('localhost')).toThrow('hydra: cannot attack localhost');
    });

    it('should reject 127.0.0.1', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('127.0.0.1')).toThrow('hydra: cannot attack localhost');
    });

    it('should throw for unreachable machine', () => {
      const hydra = createHydraCommand(createMockContext());
      expect(() => hydra.fn('10.0.0.1')).toThrow(
        'hydra: connect to 10.0.0.1: Connection timed out',
      );
    });
  });

  describe('service validation', () => {
    it('should throw when no attackable services are open', () => {
      const machine = getMockRemoteMachine({
        ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50')).toThrow(
        'no open SSH/FTP/SNMP services on 192.168.1.50',
      );
    });

    it('should throw when requested service is not open', () => {
      const machine = getMockRemoteMachine({
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'ftp')).toThrow('no open ftp service on 192.168.1.50');
    });

    it('should skip closed ports', () => {
      const machine = getMockRemoteMachine({
        ports: [
          { port: 21, service: 'ftp', serviceVersion: 'latest', open: false },
          { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      // Filtering to ftp only should fail since it's closed
      expect(() => hydra.fn('192.168.1.50', 'ftp')).toThrow('no open ftp service');
    });
  });

  describe('user filtering', () => {
    it('should attack all users when no user filter given', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Make all crack attempts succeed
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      // Should reference all 3 users in summary
      expect(lines.some((l) => l.includes('3 target users'))).toBe(true);
    });

    it('should filter to specific user', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh', 'guest');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('1 target user '))).toBe(true);
    });

    it('should throw for unknown user', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'ssh', 'nobody')).toThrow(
        'hydra: user "nobody" not found on 192.168.1.50',
      );
    });
  });

  describe('cracking mechanic', () => {
    it('should always crack guest users whose password is in wordlist', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: guest'))).toBe(true);
      expect(lines.some((l) => l.includes('1 of 1'))).toBe(true);
    });

    it('should crack user when password is in wordlist and random < 0.18', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(true);
    });

    it('is deterministic: running hydra twice produces the same outcome', async () => {
      // Regression guard: before this change, probability rolls let players
      // "loop until lucky". Now the wordlist is the sole gate — same input
      // always produces the same output, no matter how many times hydra runs.
      const machine = getMockRemoteMachine({
        users: [
          { username: 'notcrackable', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' },
          { username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      const run1Result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(run1Result)) throw new Error('Expected async output');
      const run1Lines = await collectAsyncLines(run1Result);
      const run2Result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(run2Result)) throw new Error('Expected async output');
      const run2Lines = await collectAsyncLines(run2Result);

      // Guest cracks both runs; root never does, no matter how many loops.
      expect(run1Lines.some((l) => l.includes('login: guest'))).toBe(true);
      expect(run2Lines.some((l) => l.includes('login: guest'))).toBe(true);
      expect(run1Lines.some((l) => l.includes('login: notcrackable'))).toBe(false);
      expect(run2Lines.some((l) => l.includes('login: notcrackable'))).toBe(false);
    });

    it('always cracks user when password is in wordlist (no probability roll)', async () => {
      // Removed the old probability gate: if the hash is in the wordlist,
      // it cracks deterministically regardless of Math.random value.
      const machine = getMockRemoteMachine({
        users: [{ username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(true);
      expect(lines.some((l) => l.includes('1 of 1'))).toBe(true);
    });

    it('should never crack user whose password is NOT in wordlist regardless of probability', async () => {
      const machine = getMockRemoteMachine({
        users: [
          { username: 'ftpuser', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'user' },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      // Even with Math.random = 0 (would pass probability), wordlist gate blocks it
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
    });

    it('should never crack root whose password is NOT in wordlist', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'root', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: root'))).toBe(false);
    });

    it('should not produce a result line when password hash is unknown', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'guest', passwordHash: 'not_a_real_hash', userType: 'guest' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login:'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
    });

    it('should throw when wordlist file is not found', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine], localFiles: {} }));
      expect(() => hydra.fn('192.168.1.50', 'ssh')).toThrow('wordlist not found: passwords.txt');
    });

    it('should find wordlist in cwd before /usr/share/wordlists/', async () => {
      const cwdWordlist: FileNode = {
        name: 'passwords.txt',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: [] },
        content: GUEST_PASSWORD, // Only guest password in cwd wordlist
      };
      const machine = getMockRemoteMachine({
        users: [{ username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          localFiles: { '/home/user/passwords.txt': cwdWordlist },
          currentPath: '/home/user',
        }),
      );
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: guest'))).toBe(true);
    });
  });

  describe('cracking mechanic — /etc/passwd is canonical', () => {
    // /etc/passwd is the source of truth for hashes during brute-force.
    // The static users[].passwordHash cache is no longer consulted as a
    // fallback, so password_reset rotates take effect AND sabotage works:
    // garbling /etc/passwd locks accounts out of cracking attempts.

    it('finds 0 candidates when /etc/passwd is unreadable on the target', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({ machines: [machine], noEtcPasswd: ['192.168.1.50'] }),
      );
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login:'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 0'))).toBe(true);
    });

    it('excludes users who are missing from /etc/passwd from the brute-force', async () => {
      // Cache lists bob with a wordlist-crackable hash, but /etc/passwd
      // doesn't have an entry for bob — only alice. After step 3, bob has
      // no candidate hash and is dropped from the brute-force entirely.
      const machine = getMockRemoteMachine({
        users: [{ username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: {
            '192.168.1.50': {
              '/etc/passwd': mkPasswdNode([passwdLine('alice', WORDLIST_PASSWORD_HASH)]),
            },
          },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: bob'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 0'))).toBe(true);
    });

    it('reflects the live /etc/passwd hash after password_reset — old wordlist match no longer cracks', async () => {
      // Cache holds the stale (pre-reset) hash; /etc/passwd has the rolled
      // hash. The wordlist matched the cache pre-reset; post-reset it no
      // longer applies because hydra now reads the live hash.
      const machine = getMockRemoteMachine({
        users: [{ username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: {
            '192.168.1.50': {
              '/etc/passwd': mkPasswdNode([passwdLine('bob', NON_WORDLIST_PASSWORD_HASH)]),
            },
          },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: bob'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
    });

    it('cracks against the new hash when password_reset rolls TO a wordlist password', async () => {
      // The inverse of the above: cache holds an uncrackable hash, but
      // /etc/passwd has been rotated to a wordlist password. Hydra picks
      // up the new hash and cracks it.
      const machine = getMockRemoteMachine({
        users: [{ username: 'bob', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: {
            '192.168.1.50': {
              '/etc/passwd': mkPasswdNode([passwdLine('bob', WORDLIST_PASSWORD_HASH)]),
            },
          },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes(`login: bob   password: ${WORDLIST_PASSWORD}`))).toBe(
        true,
      );
    });

    it('FTP virtual_users.conf still overrides /etc/passwd hashes during brute-force', async () => {
      // Regression check for the vsftpd overlay: virtual_users.conf wins
      // when it lists the user. /etc/passwd has a non-crackable hash for
      // bob; virtual_users.conf has a crackable one. Bob is cracked via
      // the virtual hash on the FTP service.
      const machine = getMockRemoteMachine({
        ports: [{ port: 21, service: 'ftp', serviceVersion: 'latest', open: true }],
        users: [{ username: 'bob', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: {
            '192.168.1.50': {
              '/etc/passwd': mkPasswdNode([passwdLine('bob', NON_WORDLIST_PASSWORD_HASH)]),
              '/etc/vsftpd/virtual_users.conf': mkVirtualUsersNode([
                { username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH },
              ]),
            },
          },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'ftp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes(`login: bob   password: ${WORDLIST_PASSWORD}`))).toBe(
        true,
      );
    });

    it('excludes users whose /etc/passwd entry has an empty hash field', async () => {
      // Sabotage shape: /etc/passwd has the user line but the hash field
      // is empty (e.g., truncated edit). The user has no candidate hash
      // and is excluded from the brute-force, like the missing-user case.
      const machine = getMockRemoteMachine({
        users: [{ username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: {
            '192.168.1.50': {
              '/etc/passwd': mkPasswdNode(['bob::1001:1001:bob:/home/bob:/bin/bash']),
            },
          },
        }),
      );
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: bob'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 0'))).toBe(true);
    });

    it('parses /etc/passwd on newline boundaries — cracks all wordlist users in a multi-user file', async () => {
      // Three users, all with hashes in the wordlist, all on separate
      // lines. If the parser failed to split on newlines, only the first
      // line would be considered and only one user would crack.
      const machine = getMockRemoteMachine({
        users: [
          { username: 'root', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'root' },
          { username: 'bob', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' },
          { username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' },
        ],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: root'))).toBe(true);
      expect(lines.some((l) => l.includes('login: bob'))).toBe(true);
      expect(lines.some((l) => l.includes('login: guest'))).toBe(true);
      expect(lines.some((l) => l.includes('3 of 3'))).toBe(true);
    });
  });

  describe('output format', () => {
    it('should show header', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines[0]).toBe('Hydra v9.4 — Network Login Cracker');
    });

    it('should show DATA line with service info', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('[DATA] attacking ssh://192.168.1.50:22'))).toBe(true);
    });

    it('should show STATUS progress lines', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      const statusLines = lines.filter((l) => l.includes('[STATUS]'));
      expect(statusLines.length).toBe(4);
    });

    it('should show success lines with port, service, host, login, password', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      const successLine = lines.find((l) => l.includes('[22][ssh]'));
      expect(successLine).toBeDefined();
      expect(successLine).toContain('host: 192.168.1.50');
      expect(successLine).toContain('login: guest');
      expect(successLine).toContain(`password: ${GUEST_PASSWORD}`);
    });

    it('should show summary line', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('of 3 target users successfully cracked'))).toBe(true);
    });

    it('should attack both services when no filter given', async () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('attacking ftp://'))).toBe(true);
      expect(lines.some((l) => l.includes('attacking ssh://'))).toBe(true);
    });
  });

  describe('cancellation', () => {
    it('should support cancel', () => {
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      expect(result.cancel).toBeDefined();
    });
  });

  describe('SNMP community string brute-force', () => {
    const snmpdConf = (rwCommunity: string): FileNode => ({
      name: 'snmpd.conf',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      content: `rocommunity public\nrwcommunity ${rwCommunity}\nsysDescr Router v1.0`,
    });

    const snmpMachine = (_rwCommunity?: string): FixtureMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.1',
        hostname: 'router01',
        ports: [
          { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
          { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
        ],
      });

    const snmpContext = (rwCommunity: string) =>
      createMockContext({
        machines: [snmpMachine(rwCommunity)],
        machineFiles: { '10.0.0.1': { '/etc/snmp/snmpd.conf': snmpdConf(rwCommunity) } },
      });

    it('should find RW community string from the wordlist', async () => {
      const hydra = createHydraCommand(snmpContext('private'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('community: private'))).toBe(true);
      expect(lines.some((l) => l.includes('access: read-write'))).toBe(true);
    });

    it('should find community string regardless of pool position', async () => {
      const hydra = createHydraCommand(snmpContext('C1sc0'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('community: C1sc0'))).toBe(true);
    });

    it('should show DATA line targeting snmp', async () => {
      const hydra = createHydraCommand(snmpContext('private'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('[DATA] attacking snmp://10.0.0.1:161'))).toBe(true);
    });

    it('should show STATUS progress lines', async () => {
      const hydra = createHydraCommand(snmpContext('private'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      const statusLines = lines.filter((l) => l.includes('[STATUS]'));
      expect(statusLines.length).toBeGreaterThan(0);
    });

    it('should show summary with 1 valid community string found', async () => {
      const hydra = createHydraCommand(snmpContext('private'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('1 valid community string found'))).toBe(true);
    });

    it('should throw when SNMP port is not open', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.1',
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.1', 'snmp')).toThrow('no open snmp service on 10.0.0.1');
    });

    it('should throw when no snmpd.conf exists on the machine', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.1',
        ports: [
          { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
        ],
      });
      // No machineFiles provided — getNodeFromMachine returns null
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.1', 'snmp')).toThrow('no SNMP agent responding');
    });

    it('should report 0 found when RW community is not in wordlist', async () => {
      const hydra = createHydraCommand(snmpContext('super_obscure_string'));
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('community:'))).toBe(false);
      expect(lines.some((l) => l.includes('0 valid community strings found'))).toBe(true);
    });

    it('should not include SNMP when attacking all services without filter', async () => {
      // SNMP requires explicit service filter — auto-discovery only includes SSH/FTP
      const machine = getMockRemoteMachine({
        ip: '10.0.0.1',
        ports: [
          { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
          { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
        ],
      });
      const hydra = createHydraCommand(
        createMockContext({
          machines: [machine],
          machineFiles: { '10.0.0.1': { '/etc/snmp/snmpd.conf': snmpdConf('private') } },
        }),
      );
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('10.0.0.1');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      // Should only attack SSH, not SNMP
      expect(lines.some((l) => l.includes('attacking ssh://'))).toBe(true);
      expect(lines.some((l) => l.includes('attacking snmp://'))).toBe(false);
    });
  });

  describe('MySQL credential brute-force', () => {
    // guest password hash: md5('guest') = 084e0343a0486ff05530df6c705c8bb4
    const mysqlDataJson = (
      creds?: readonly { username: string; passwordHash: string; userType: string }[],
    ): FileNode => ({
      name: 'data.json',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      content: JSON.stringify({
        name: 'app_prod',
        credentials: creds ?? [
          { username: 'root', passwordHash: 'ca8f678fec022c9892f0ffee16eb0aa3', userType: 'root' },
          {
            username: 'webapp',
            passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99',
            userType: 'user',
          },
          {
            username: 'readonly',
            passwordHash: '084e0343a0486ff05530df6c705c8bb4',
            userType: 'guest',
          },
        ],
        tables: {},
      }),
    });

    const mysqlMachine = (): FixtureMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.5',
        hostname: 'dbserver',
        ports: [
          { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
          { port: 3306, service: 'mysql', serviceVersion: 'latest', open: true },
        ],
      });

    const mysqlContext = (dataJson?: FileNode) =>
      createMockContext({
        machines: [mysqlMachine()],
        machineFiles: {
          '10.0.0.5': { '/var/lib/mysql/data.json': dataJson ?? mysqlDataJson() },
        },
      });

    it('should crack guest-type MySQL user when random < 1.0', async () => {
      const hydra = createHydraCommand(mysqlContext());
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('10.0.0.5', 'mysql');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: readonly'))).toBe(true);
      expect(lines.some((l) => l.includes('[3306][mysql]'))).toBe(true);
    });

    it('should show DATA line targeting mysql', async () => {
      const hydra = createHydraCommand(mysqlContext());
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('10.0.0.5', 'mysql');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('[DATA] attacking mysql://10.0.0.5:3306'))).toBe(true);
    });

    it('should filter by username', async () => {
      const hydra = createHydraCommand(mysqlContext());
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('10.0.0.5', 'mysql', 'webapp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: readonly'))).toBe(false);
      expect(lines.some((l) => l.includes('of 1 target user'))).toBe(true);
    });

    it('should throw when user not found', () => {
      const hydra = createHydraCommand(mysqlContext());
      expect(() => hydra.fn('10.0.0.5', 'mysql', 'nonexistent')).toThrow(
        'user "nonexistent" not found',
      );
    });

    it('should throw when MySQL port is not open', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.5',
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.5', 'mysql')).toThrow('no open mysql service on 10.0.0.5');
    });

    it('should throw when no data.json exists', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.5',
        ports: [{ port: 3306, service: 'mysql', serviceVersion: 'latest', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.5', 'mysql')).toThrow('no MySQL server responding');
    });

    it('should not auto-discover MySQL (requires explicit service filter)', async () => {
      const hydra = createHydraCommand(mysqlContext());
      vi.spyOn(Math, 'random').mockReturnValue(0);
      const result = hydra.fn('10.0.0.5');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('attacking mysql://'))).toBe(false);
      expect(lines.some((l) => l.includes('attacking ssh://'))).toBe(true);
    });

    it('should show summary line', async () => {
      const hydra = createHydraCommand(mysqlContext());
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('10.0.0.5', 'mysql');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('of 3 target users successfully cracked'))).toBe(true);
    });
  });

  describe('onBruteForceAggregate callback (ssh + ftp default flow)', () => {
    it('fires exactly once per attacked service when default mode attacks ssh and ftp', async () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(2);
      const calls = onBruteForceAggregate.mock.calls.map((c) => ({
        service: c[0].service,
        port: c[0].port,
      }));
      expect(calls).toContainEqual({ service: 'ssh', port: 22 });
      expect(calls).toContainEqual({ service: 'ftp', port: 21 });
    });

    it('reports the target IP and port actually attacked on each service', async () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIp: '192.168.1.50',
          port: 22,
          service: 'ssh',
        }),
      );
    });

    it('reports attempts as users.length × ATTEMPTS_PER_USER', async () => {
      const onBruteForceAggregate = vi.fn();
      // Three users × 128 attempts = 384 expected.
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ attempts: 3 * 128 }),
      );
    });

    it('populates successes with {username, password} for each cracked user', async () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine({
        users: [
          { username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' },
          { username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' },
          { username: 'root', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' },
        ],
      });
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      const [info] = onBruteForceAggregate.mock.calls[0]!;
      expect(info.successes).toHaveLength(2);
      expect(info.successes).toContainEqual({ username: 'guest', password: GUEST_PASSWORD });
      expect(info.successes).toContainEqual({
        username: 'ftpuser',
        password: WORDLIST_PASSWORD,
      });
      // root password is not in the wordlist — must not appear as a success.
      expect(info.successes.some((s: { username: string }) => s.username === 'root')).toBe(false);
    });

    it('fires with empty successes when no user is crackable', async () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine({
        users: [{ username: 'root', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' }],
      });
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'ssh', attempts: 128, successes: [] }),
      );
    });

    it('does NOT fire when hydra is cancelled before the service summary runs', () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine();
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine] }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      result.start(
        () => {},
        () => {},
      );
      result.cancel?.();
      vi.runAllTimers();

      expect(onBruteForceAggregate).not.toHaveBeenCalled();
    });

    it('reports the resolved IP (not the hostname) when host is a domain', async () => {
      const onBruteForceAggregate = vi.fn();
      const machine = getMockRemoteMachine();
      const dnsRecords: readonly DnsRecord[] = [
        { domain: 'fileserver.local', ip: '192.168.1.50', type: 'A' },
      ];
      const hydra = createHydraCommand({
        ...createMockContext({ machines: [machine], dnsRecords }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('fileserver.local', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ targetIp: '192.168.1.50' }),
      );
    });
  });

  describe('onBruteForceAggregate callback (snmp mode)', () => {
    const snmpdConf = (rwCommunity: string): FileNode => ({
      name: 'snmpd.conf',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      content: `rocommunity public\nrwcommunity ${rwCommunity}\nsysDescr Router v1.0`,
    });

    const snmpMachine = (): FixtureMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.1',
        hostname: 'router01',
        ports: [
          { port: 161, service: 'snmp', serviceVersion: 'latest', open: true, protocol: 'udp' },
        ],
      });

    it('fires once with service=snmp, port=161, and the discovered community on success', async () => {
      const onBruteForceAggregate = vi.fn();
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [snmpMachine()],
          machineFiles: { '10.0.0.1': { '/etc/snmp/snmpd.conf': snmpdConf('private') } },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIp: '10.0.0.1',
          port: 161,
          service: 'snmp',
          successes: [{ community: 'private' }],
        }),
      );
    });

    it('fires with empty successes when the rw community is not in the pool', async () => {
      const onBruteForceAggregate = vi.fn();
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [snmpMachine()],
          machineFiles: {
            '10.0.0.1': { '/etc/snmp/snmpd.conf': snmpdConf('not-a-real-community-string-xyz') },
          },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.1', 'snmp');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'snmp', successes: [] }),
      );
    });
  });

  describe('onBruteForceAggregate callback (redis mode)', () => {
    const redisConf = (requirepass: string): FileNode => ({
      name: 'redis.conf',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      content: `bind 0.0.0.0\nport 6379\nrequirepass ${requirepass}\n`,
    });

    const redisMachine = (): FixtureMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.7',
        hostname: 'cache01',
        ports: [{ port: 6379, service: 'redis', serviceVersion: 'latest', open: true }],
      });

    // Known-crackable password: first entry of the project-wide password pool.
    // Import-derived rather than hardcoded so it stays correct if the pool is
    // re-encoded.
    const CRACKABLE_REDIS_PASSWORD = passwordPool[0]!;

    it('fires once with service=redis, port=6379, and the discovered password on success', async () => {
      const onBruteForceAggregate = vi.fn();
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [redisMachine()],
          machineFiles: {
            '10.0.0.7': { '/etc/redis/redis.conf': redisConf(CRACKABLE_REDIS_PASSWORD) },
          },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.7', 'redis');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          targetIp: '10.0.0.7',
          port: 6379,
          service: 'redis',
          successes: [{ password: CRACKABLE_REDIS_PASSWORD }],
        }),
      );
    });

    it('fires with empty successes when the requirepass is not in any pool', async () => {
      const onBruteForceAggregate = vi.fn();
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [redisMachine()],
          machineFiles: {
            '10.0.0.7': { '/etc/redis/redis.conf': redisConf('not-in-any-pool-xyz-abc-123') },
          },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.7', 'redis');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'redis', successes: [] }),
      );
    });
  });

  describe('onBruteForceAggregate callback (mysql mode)', () => {
    // md5('guest') = 084e0343a0486ff05530df6c705c8bb4 — 'guest' IS in the wordlist.
    // md5('password') = 5f4dcc3b5aa765d61d8327deb882cf99 — 'password' IS in the wordlist.
    // md5('s3cur3!notInList') = something else — not in wordlist.
    const mysqlDataJson = (): FileNode => ({
      name: 'data.json',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      content: JSON.stringify({
        name: 'app_prod',
        credentials: [
          { username: 'root', passwordHash: md5('s3cur3!notInList'), userType: 'root' },
          {
            username: 'webapp',
            passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99',
            userType: 'user',
          },
          {
            username: 'readonly',
            passwordHash: '084e0343a0486ff05530df6c705c8bb4',
            userType: 'guest',
          },
        ],
        tables: {},
      }),
    });

    const mysqlMachine = (): FixtureMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.5',
        hostname: 'dbserver',
        ports: [{ port: 3306, service: 'mysql', serviceVersion: 'latest', open: true }],
      });

    it('fires once with service=mysql, port=3306, and {username,password} per crack', async () => {
      const onBruteForceAggregate = vi.fn();
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [mysqlMachine()],
          machineFiles: { '10.0.0.5': { '/var/lib/mysql/data.json': mysqlDataJson() } },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.5', 'mysql');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      const [info] = onBruteForceAggregate.mock.calls[0]!;
      expect(info).toEqual(
        expect.objectContaining({
          targetIp: '10.0.0.5',
          port: 3306,
          service: 'mysql',
        }),
      );
      // Two of the three users have wordlist-hit passwords.
      expect(info.successes).toHaveLength(2);
      expect(info.successes).toContainEqual({ username: 'webapp', password: 'password' });
      expect(info.successes).toContainEqual({ username: 'readonly', password: 'guest' });
    });

    it('fires with empty successes when no user is crackable by the wordlist', async () => {
      const onBruteForceAggregate = vi.fn();
      const uncrackableJson: FileNode = {
        name: 'data.json',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: [] },
        content: JSON.stringify({
          name: 'app_prod',
          credentials: [
            { username: 'root', passwordHash: md5('unguessable-xyz'), userType: 'root' },
          ],
          tables: {},
        }),
      };
      const hydra = createHydraCommand({
        ...createMockContext({
          machines: [mysqlMachine()],
          machineFiles: { '10.0.0.5': { '/var/lib/mysql/data.json': uncrackableJson } },
        }),
        onBruteForceAggregate,
      });
      const result = hydra.fn('10.0.0.5', 'mysql');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      await collectAsyncLines(result);

      expect(onBruteForceAggregate).toHaveBeenCalledTimes(1);
      expect(onBruteForceAggregate).toHaveBeenCalledWith(
        expect.objectContaining({ service: 'mysql', successes: [] }),
      );
    });
  });
});
