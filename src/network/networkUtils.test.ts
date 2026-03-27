import { describe, it, expect } from 'vitest';
import type { RemoteMachine, Port } from './types';
import type { GeneratedMachine, NatForwardingRule, SubnetLayer } from '../generation/types';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import type { SshdPortOverride } from './sshdStateParser';
import type { FtpdPortOverride } from './ftpdStateParser';
import type { NcPortOverride } from './ncStateParser';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import {
  applyDaemonOverrides,
  applySnmpFirewallOverrides,
  applyDynamicOverrides,
  buildMergedRouterView,
  buildRouterRemoteView,
  collectGatewayIps,
  buildGatewayAliasMap,
} from './networkUtils';

// -- Factories --

const createPort = (overrides: Partial<Port> = {}): Port => ({
  port: 80,
  service: 'http',
  open: true,
  ...overrides,
});

const createMachine = (overrides: Partial<RemoteMachine> = {}): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'test-machine',
  ports: [],
  users: [],
  ...overrides,
});

const createGeneratedMachine = (overrides: Partial<GeneratedMachine> = {}): GeneratedMachine => ({
  ip: '10.0.0.1',
  hostname: 'test-machine',
  role: 'workstation',
  accessVariant: 'ssh',
  remoteMachine: createMachine(),
  ...overrides,
});

describe('applyDaemonOverrides', () => {
  describe('sshd overrides', () => {
    it('should open an existing closed port matching the override', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 22, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([{ port: 22, service: 'ssh', open: true }]);
    });

    it('should add a new port when daemon runs on non-default port', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly SshdPortOverride[] = [{ port: 2222, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([{ port: 2222, service: 'ssh', open: true }]);
    });

    it('should remove closed default port when daemon runs on a different port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([{ port: 2223, service: 'ssh', open: true }]);
    });

    it('should preserve unrelated ports when removing closed default port', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 22, service: 'ssh', open: false }),
          createPort({ port: 80, service: 'http', open: true }),
        ],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', open: true },
        { port: 2223, service: 'ssh', open: true },
      ]);
    });

    it('should not remove an open port with the same service', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', open: true },
        { port: 2223, service: 'ssh', open: true },
      ]);
    });
  });

  describe('ftpd overrides', () => {
    it('should remove closed default ftp port when ftpd runs on a different port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 21, service: 'ftp', open: false })],
      });
      const overrides: readonly FtpdPortOverride[] = [{ port: 2121, service: 'ftp', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([{ port: 2121, service: 'ftp', open: true }]);
    });

    it('should open existing ftp port when daemon runs on same port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 21, service: 'ftp', open: false })],
      });
      const overrides: readonly FtpdPortOverride[] = [{ port: 21, service: 'ftp', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([{ port: 21, service: 'ftp', open: true }]);
    });
  });

  describe('combined overrides', () => {
    it('should handle both sshd and ftpd overrides simultaneously', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 22, service: 'ssh', open: false }),
          createPort({ port: 21, service: 'ftp', open: false }),
          createPort({ port: 80, service: 'http', open: true }),
        ],
      });
      const overrides: readonly (SshdPortOverride | FtpdPortOverride)[] = [
        { port: 2222, service: 'ssh', open: true },
        { port: 2121, service: 'ftp', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', open: true },
        { port: 2222, service: 'ssh', open: true },
        { port: 2121, service: 'ftp', open: true },
      ]);
    });

    it('should return machine unchanged when no overrides given', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      });

      const result = applyDaemonOverrides(machine, []);

      expect(result.ports).toEqual([{ port: 22, service: 'ssh', open: false }]);
    });
  });

  describe('nc listener overrides with owner', () => {
    it('should add new port with owner when nc listener override has owner', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly NcPortOverride[] = [
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ]);
    });

    it('should open existing elite port and add owner', () => {
      const machine = createMachine({
        ports: [createPort({ port: 4444, service: 'elite', open: false })],
      });
      const overrides: readonly NcPortOverride[] = [
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'root', userType: 'root', homePath: '/root' },
        },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'root', userType: 'root', homePath: '/root' },
        },
      ]);
    });

    it('should handle nc listener override alongside sshd override', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      });
      const overrides: readonly (SshdPortOverride | NcPortOverride)[] = [
        { port: 22, service: 'ssh', open: true },
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', open: true },
        {
          port: 4444,
          service: 'elite',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ]);
    });
  });
});

describe('applySnmpFirewallOverrides', () => {
  it('should open a closed port matching the override', () => {
    const machine = createMachine({
      ports: [createPort({ port: 22, service: 'ssh', open: false })],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([{ port: 22, service: 'ssh', open: true }]);
  });

  it('should close an open port matching the override', () => {
    const machine = createMachine({
      ports: [createPort({ port: 80, service: 'http', open: true })],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 80, open: false }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([{ port: 80, service: 'http', open: false }]);
  });

  it('should not affect ports without a matching override', () => {
    const machine = createMachine({
      ports: [
        createPort({ port: 22, service: 'ssh', open: false }),
        createPort({ port: 80, service: 'http', open: true }),
      ],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ]);
  });

  it('should return machine unchanged when no overrides given', () => {
    const machine = createMachine({
      ports: [createPort({ port: 22, service: 'ssh', open: false })],
    });

    const result = applySnmpFirewallOverrides(machine, []);

    expect(result.ports).toEqual([{ port: 22, service: 'ssh', open: false }]);
  });
});

describe('buildMergedRouterView', () => {
  it('should expose forwarded ports on the router using public port numbers', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      hostname: 'router',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      hostname: 'target',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([{ port: 2222, service: 'ssh', open: true }]);
  });

  it('should not forward closed internal ports', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([]);
  });

  it('should keep router own ports alongside forwarded ports', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        ports: [createPort({ port: 80, service: 'http', open: true })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([
      { port: 80, service: 'http', open: true },
      { port: 2222, service: 'ssh', open: true },
    ]);
  });

  it('should override router port when forwarded port collides', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        ports: [createPort({ port: 80, service: 'http', open: false })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 8080, service: 'http-alt', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 80, internalIp: '10.0.0.5', internalPort: 8080 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([{ port: 80, service: 'http-alt', open: true }]);
  });

  it('should merge users from router and forwarded machines, deduplicating by username', () => {
    const sharedUser = { username: 'admin', passwordHash: 'hash1', userType: 'root' as const };
    const routerUser = {
      username: 'router-user',
      passwordHash: 'hash2',
      userType: 'user' as const,
    };
    const targetUser = {
      username: 'target-user',
      passwordHash: 'hash3',
      userType: 'user' as const,
    };

    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        users: [sharedUser, routerUser],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
        users: [sharedUser, targetUser],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.users).toEqual([sharedUser, routerUser, targetUser]);
  });

  it('should use router ip and hostname in the result', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      hostname: 'gw-router',
      remoteMachine: createMachine({ ip: '203.0.113.1', hostname: 'gw-router' }),
    });

    const result = buildMergedRouterView(router, [], []);

    expect(result.ip).toBe('203.0.113.1');
    expect(result.hostname).toBe('gw-router');
  });

  it('should ignore machines not referenced by any rule', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1' }),
    });
    const unreferencedMachine = createGeneratedMachine({
      ip: '10.0.0.99',
      remoteMachine: createMachine({
        ip: '10.0.0.99',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
        users: [{ username: 'ghost', passwordHash: 'h', userType: 'user' }],
      }),
    });

    const result = buildMergedRouterView(router, [unreferencedMachine], []);

    expect(result.ports).toEqual([]);
    expect(result.users).toEqual([]);
  });
});

// -- Helpers for new tests --

const createSubnetLayer = (overrides: Partial<SubnetLayer> = {}): SubnetLayer => ({
  subnet: '10.0.1',
  gateway: createGeneratedMachine({ ip: '10.0.0.50', hostname: 'gw', role: 'router' }),
  entryVariant: 'ssh',
  machines: [],
  isForwarded: false,
  ...overrides,
});

const createHomeNetwork = (overrides: Partial<HomeNetwork> = {}): HomeNetwork => ({
  essid: 'TEST-WIFI',
  localhostIp: '10.0.0.100',
  router: { publicIp: '45.0.0.1', hostname: 'router01', internalIp: '10.0.0.1' },
  routerMachine: createGeneratedMachine({
    ip: '45.0.0.1',
    hostname: 'router01',
    role: 'router',
  }),
  entryPoint: '10.0.0.10',
  entryVariant: 'ssh',
  machines: [],
  layers: [createSubnetLayer({ subnet: '10.0.0' })],
  networkConfig: { machineConfigs: {} },
  fileSystems: {},
  difficulty: 'easy',
  ...overrides,
});

describe('collectGatewayIps', () => {
  it('should return empty array when no networks provided', () => {
    expect(collectGatewayIps(undefined, undefined, null)).toEqual([]);
  });

  it('should include mission router IP', () => {
    const router = createGeneratedMachine({ ip: '203.0.113.1' });

    const result = collectGatewayIps(router, undefined, null);

    expect(result).toEqual(['203.0.113.1']);
  });

  it('should include mission inner gateway IPs', () => {
    const router = createGeneratedMachine({ ip: '203.0.113.1' });
    const layers: readonly SubnetLayer[] = [
      createSubnetLayer({ subnet: '10.0.0' }),
      createSubnetLayer({
        subnet: '10.0.1',
        gateway: createGeneratedMachine({ ip: '10.0.0.50' }),
      }),
    ];

    const result = collectGatewayIps(router, layers, null);

    expect(result).toContain('10.0.0.50');
  });

  it('should include home router public IP and internal .1 IP', () => {
    const home = createHomeNetwork();

    const result = collectGatewayIps(undefined, undefined, home);

    expect(result).toContain('45.0.0.1');
    expect(result).toContain('10.0.0.1');
  });

  it('should include home inner gateway upstream and .1 alias IPs', () => {
    const innerGateway = createGeneratedMachine({ ip: '10.0.0.50', role: 'router' });
    const home = createHomeNetwork({
      layers: [
        createSubnetLayer({ subnet: '10.0.0' }),
        createSubnetLayer({ subnet: '10.0.1', gateway: innerGateway }),
      ],
    });

    const result = collectGatewayIps(undefined, undefined, home);

    expect(result).toContain('10.0.0.50');
    expect(result).toContain('10.0.1.1');
  });
});

describe('buildGatewayAliasMap', () => {
  it('should return empty map when no home network', () => {
    expect(buildGatewayAliasMap(null).size).toBe(0);
  });

  it('should map border router internal .1 IP to routerMachine', () => {
    const home = createHomeNetwork();

    const map = buildGatewayAliasMap(home);

    expect(map.get('10.0.0.1')).toBe(home.routerMachine);
  });

  it('should map inner gateway .1 IP to gateway machine', () => {
    const innerGateway = createGeneratedMachine({ ip: '10.0.0.50', role: 'router' });
    const home = createHomeNetwork({
      layers: [
        createSubnetLayer({ subnet: '10.0.0' }),
        createSubnetLayer({ subnet: '10.0.1', gateway: innerGateway }),
      ],
    });

    const map = buildGatewayAliasMap(home);

    expect(map.get('10.0.1.1')).toBe(innerGateway);
  });
});

describe('buildRouterRemoteView', () => {
  it('should return plain remoteMachine when no rules or overrides', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      hostname: 'gw',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        hostname: 'gw',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
      }),
    });

    const result = buildRouterRemoteView(router, [], [], []);

    expect(result).toEqual(router.remoteMachine);
  });

  it('should apply iptables merge and SNMP overrides together', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        ports: [createPort({ port: 22, service: 'ssh', open: false })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 80, service: 'http', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '10.0.0.5', internalPort: 80 },
    ];
    const snmp: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

    const result = buildRouterRemoteView(router, [target], rules, snmp);

    // SSH opened by SNMP, HTTP forwarded on 8080
    expect(result.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: 22, open: true }),
        expect.objectContaining({ port: 8080, service: 'http', open: true }),
      ]),
    );
  });
});

describe('applyDynamicOverrides', () => {
  const noopReader = () => null;

  it('should return machine unchanged when no overrides apply', () => {
    const machine = createMachine({ ip: '10.0.0.5' });
    const ctx = {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: noopReader,
    };

    expect(applyDynamicOverrides(machine, ctx)).toBe(machine);
  });

  it('should apply gateway NAT merge for mission gateways', () => {
    const gateway = createGeneratedMachine({
      ip: '10.0.0.50',
      role: 'router',
      remoteMachine: createMachine({ ip: '10.0.0.50', ports: [] }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.1.10',
      remoteMachine: createMachine({
        ip: '10.0.1.10',
        ports: [createPort({ port: 22, service: 'ssh', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.1.10', internalPort: 22 },
    ];

    const result = applyDynamicOverrides(gateway.remoteMachine, {
      allIptablesRules: new Map([['10.0.0.50', rules]]),
      allSnmpOverrides: new Map(),
      missionMachines: [gateway, target],
      homeGatewayByAliasIp: new Map(),
      readNode: noopReader,
    });

    expect(result.ports).toEqual([{ port: 2222, service: 'ssh', open: true }]);
  });

  it('should find home gateway by .1 alias IP and preserve the visible IP', () => {
    const gateway = createGeneratedMachine({
      ip: '45.0.0.1',
      role: 'router',
      remoteMachine: createMachine({ ip: '45.0.0.1', ports: [] }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.10',
      remoteMachine: createMachine({
        ip: '10.0.0.10',
        ports: [createPort({ port: 80, service: 'http', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 80, internalIp: '10.0.0.10', internalPort: 80 },
    ];
    // The router is visible at .1 but its GeneratedMachine uses the public IP
    const visibleMachine = createMachine({ ip: '10.0.0.1', hostname: 'router01' });

    const result = applyDynamicOverrides(visibleMachine, {
      allIptablesRules: new Map([['10.0.0.1', rules]]),
      allSnmpOverrides: new Map(),
      homeMachines: [target],
      homeGatewayByAliasIp: new Map([['10.0.0.1', gateway]]),
      readNode: noopReader,
    });

    expect(result.ip).toBe('10.0.0.1');
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', open: true }),
    );
  });

  it('should apply sshd daemon override from PID file', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 22, service: 'ssh', open: false })],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/sshd.pid') {
        return {
          name: 'sshd.pid',
          type: 'file' as const,
          content: 'sshd:port=22',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 22, service: 'ssh', open: true }),
    );
  });
});
