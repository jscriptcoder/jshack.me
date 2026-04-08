import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine, DnsRecord } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import { createHydraCommand } from './hydra';
import { md5 } from '../utils/md5';

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

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
  ],
  users: [
    { username: 'root', passwordHash: NON_WORDLIST_PASSWORD_HASH, userType: 'root' },
    { username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' },
    { username: 'guest', passwordHash: GUEST_PASSWORD_HASH, userType: 'guest' },
  ],
  ...overrides,
});

type HydraContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
  readonly dnsRecords?: readonly DnsRecord[];
  readonly machineFiles?: Readonly<Record<string, Record<string, FileNode>>>;
  readonly localFiles?: Readonly<Record<string, FileNode>>;
  readonly currentPath?: string;
};

const createMockContext = (config: HydraContextConfig = {}) => {
  const {
    machines = [],
    localIP = '192.168.1.100',
    dnsRecords = [],
    machineFiles = {},
    localFiles = { '/usr/share/wordlists/passwords.txt': mkWordlistNode() },
    currentPath = '/home/user',
  } = config;
  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
    resolveDomain: (domain: string) => dnsRecords.find((r) => r.domain === domain),
    resolveNat: (ip: string, _port: number) => ({ ip, port: _port }),
    findMachineUsers: (ip: string) => machines.find((m) => m.ip === ip)?.users ?? [],
    getNodeFromMachine: (ip: string, path: string) =>
      (machineFiles[ip]?.[path] as FileNode | undefined) ?? null,
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
        ports: [{ port: 161, service: 'snmp', open: true, protocol: 'udp' }],
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
        ports: [{ port: 80, service: 'http', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50')).toThrow(
        'no open SSH/FTP/SNMP services on 192.168.1.50',
      );
    });

    it('should throw when requested service is not open', () => {
      const machine = getMockRemoteMachine({
        ports: [{ port: 22, service: 'ssh', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('192.168.1.50', 'ftp')).toThrow('no open ftp service on 192.168.1.50');
    });

    it('should skip closed ports', () => {
      const machine = getMockRemoteMachine({
        ports: [
          { port: 21, service: 'ftp', open: false },
          { port: 22, service: 'ssh', open: true },
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

    it('should not crack user when password is in wordlist but random >= 0.18', async () => {
      const machine = getMockRemoteMachine({
        users: [{ username: 'ftpuser', passwordHash: WORDLIST_PASSWORD_HASH, userType: 'user' }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const result = hydra.fn('192.168.1.50', 'ssh');
      if (!isAsyncOutput(result)) throw new Error('Expected async output');
      const lines = await collectAsyncLines(result);
      expect(lines.some((l) => l.includes('login: ftpuser'))).toBe(false);
      expect(lines.some((l) => l.includes('0 of 1'))).toBe(true);
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

    const snmpMachine = (_rwCommunity?: string): RemoteMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.1',
        hostname: 'router01',
        ports: [
          { port: 22, service: 'ssh', open: true },
          { port: 161, service: 'snmp', open: true, protocol: 'udp' },
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
        ports: [{ port: 22, service: 'ssh', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.1', 'snmp')).toThrow('no open snmp service on 10.0.0.1');
    });

    it('should throw when no snmpd.conf exists on the machine', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.1',
        ports: [{ port: 161, service: 'snmp', open: true, protocol: 'udp' }],
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
          { port: 22, service: 'ssh', open: true },
          { port: 161, service: 'snmp', open: true, protocol: 'udp' },
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

    const mysqlMachine = (): RemoteMachine =>
      getMockRemoteMachine({
        ip: '10.0.0.5',
        hostname: 'dbserver',
        ports: [
          { port: 22, service: 'ssh', open: true },
          { port: 3306, service: 'mysql', open: true },
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
        ports: [{ port: 22, service: 'ssh', open: true }],
      });
      const hydra = createHydraCommand(createMockContext({ machines: [machine] }));
      expect(() => hydra.fn('10.0.0.5', 'mysql')).toThrow('no open mysql service on 10.0.0.5');
    });

    it('should throw when no data.json exists', () => {
      const machine = getMockRemoteMachine({
        ip: '10.0.0.5',
        ports: [{ port: 3306, service: 'mysql', open: true }],
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
});
