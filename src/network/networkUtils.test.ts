import { describe, it, expect } from 'vitest';
import type { RemoteMachine, Port } from './types';
import type { GeneratedMachine, NatForwardingRule, SubnetLayer } from '../generation/types';
import type { SnmpFirewallOverride } from './snmpFirewallParser';
import type { SshdPortOverride } from './sshdStateParser';
import type { FtpdPortOverride } from './ftpdStateParser';
import type { NcPortOverride } from './ncStateParser';
import type { InfraPortOverride } from './infraDaemonStateParser';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import {
  applyDaemonOverrides,
  applySnmpFirewallOverrides,
  applyDynamicOverrides,
  buildCanonicalKeyedRulesMap,
  buildMergedRouterView,
  buildRouterRemoteView,
  buildWorldExternalDnsRecords,
  collectGatewayIps,
  collectWorldGatewayIps,
  buildGatewayAliasMap,
  buildWorldRouterRemoteViews,
  findMachineInWorldNetworks,
} from './networkUtils';
import type { MissionNetwork } from '../generation/types';

// -- Factories --

const createPort = (overrides: Partial<Port> = {}): Port => ({
  port: 80,
  service: 'http',
  serviceVersion: 'latest',
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 22, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should add a new port when daemon runs on non-default port', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly SshdPortOverride[] = [{ port: 2222, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should remove closed default port when daemon runs on a different port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 2223, service: 'ssh', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should preserve unrelated ports when removing closed default port', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false }),
          createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
        ],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', serviceVersion: 'latest', open: true },
        { port: 2223, service: 'ssh', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should not remove an open port with the same service', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
      });
      const overrides: readonly SshdPortOverride[] = [{ port: 2223, service: 'ssh', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
        { port: 2223, service: 'ssh', serviceVersion: 'latest', open: true },
      ]);
    });
  });

  describe('ftpd overrides', () => {
    it('should remove closed default ftp port when ftpd runs on a different port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 21, service: 'ftp', serviceVersion: 'latest', open: false })],
      });
      const overrides: readonly FtpdPortOverride[] = [{ port: 2121, service: 'ftp', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 2121, service: 'ftp', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should open existing ftp port when daemon runs on same port', () => {
      const machine = createMachine({
        ports: [createPort({ port: 21, service: 'ftp', serviceVersion: 'latest', open: false })],
      });
      const overrides: readonly FtpdPortOverride[] = [{ port: 21, service: 'ftp', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 21, service: 'ftp', serviceVersion: 'latest', open: true },
      ]);
    });
  });

  describe('combined overrides', () => {
    it('should handle both sshd and ftpd overrides simultaneously', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false }),
          createPort({ port: 21, service: 'ftp', serviceVersion: 'latest', open: false }),
          createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
        ],
      });
      const overrides: readonly (SshdPortOverride | FtpdPortOverride)[] = [
        { port: 2222, service: 'ssh', open: true },
        { port: 2121, service: 'ftp', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', serviceVersion: 'latest', open: true },
        { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
        { port: 2121, service: 'ftp', serviceVersion: 'latest', open: true },
      ]);
    });

    it('should return machine unchanged when no overrides given', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      });

      const result = applyDaemonOverrides(machine, []);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: false },
      ]);
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
          serviceVersion: 'latest',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ]);
    });

    it('should open existing elite port and add owner', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 4444, service: 'elite', serviceVersion: 'latest', open: false }),
        ],
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
          serviceVersion: 'latest',
          open: true,
          owner: { username: 'root', userType: 'root', homePath: '/root' },
        },
      ]);
    });

    it('should handle nc listener override alongside sshd override', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
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
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
        {
          port: 4444,
          service: 'elite',
          serviceVersion: 'latest',
          open: true,
          owner: { username: 'webadmin', userType: 'user', homePath: '/home/webadmin' },
        },
      ]);
    });
  });

  describe('infra overrides (http/mysql/redis/etc.)', () => {
    it('adds a new port when machine has no matching entry', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly InfraPortOverride[] = [{ port: 80, service: 'http', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', serviceVersion: 'latest', open: true },
      ]);
    });

    it('opens an existing closed port while preserving its serviceVersion + owner', () => {
      const machine = createMachine({
        ports: [
          createPort({
            port: 80,
            service: 'http',
            serviceVersion: 'Apache/2.4.49',
            open: false,
            owner: { username: 'www-data', userType: 'user', homePath: '/var/www' },
          }),
        ],
      });
      const overrides: readonly InfraPortOverride[] = [{ port: 80, service: 'http', open: true }];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        {
          port: 80,
          service: 'http',
          serviceVersion: 'Apache/2.4.49',
          open: true,
          owner: { username: 'www-data', userType: 'user', homePath: '/var/www' },
        },
      ]);
    });

    it('is idempotent on a port that is already open with the matching service', () => {
      const machine = createMachine({
        ports: [
          createPort({ port: 3306, service: 'mysql', serviceVersion: 'MySQL 8.0', open: true }),
        ],
      });
      const overrides: readonly InfraPortOverride[] = [
        { port: 3306, service: 'mysql', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 3306, service: 'mysql', serviceVersion: 'MySQL 8.0', open: true },
      ]);
    });

    it('handles multiple ports from one daemon (nginx serving 80 + 443)', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly InfraPortOverride[] = [
        { port: 80, service: 'http', open: true },
        { port: 443, service: 'https', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 80, service: 'http', serviceVersion: 'latest', open: true },
        { port: 443, service: 'https', serviceVersion: 'latest', open: true },
      ]);
    });

    it('handles infra override alongside an sshd override', () => {
      const machine = createMachine({
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      });
      const overrides: readonly (SshdPortOverride | InfraPortOverride)[] = [
        { port: 22, service: 'ssh', open: true },
        { port: 6379, service: 'redis', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports).toEqual([
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
        { port: 6379, service: 'redis', serviceVersion: 'latest', open: true },
      ]);
    });

    it('does NOT attach an owner field on infra overrides (only nc has owner)', () => {
      const machine = createMachine({ ports: [] });
      const overrides: readonly InfraPortOverride[] = [
        { port: 3306, service: 'mysql', open: true },
      ];

      const result = applyDaemonOverrides(machine, overrides);

      expect(result.ports[0]).not.toHaveProperty('owner');
    });
  });
});

describe('applySnmpFirewallOverrides', () => {
  it('should open a closed port matching the override', () => {
    const machine = createMachine({
      ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([
      { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    ]);
  });

  it('should close an open port matching the override', () => {
    const machine = createMachine({
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 80, open: false }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([
      { port: 80, service: 'http', serviceVersion: 'latest', open: false },
    ]);
  });

  it('should not affect ports without a matching override', () => {
    const machine = createMachine({
      ports: [
        createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false }),
        createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
      ],
    });
    const overrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

    const result = applySnmpFirewallOverrides(machine, overrides);

    expect(result.ports).toEqual([
      { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
      { port: 80, service: 'http', serviceVersion: 'latest', open: true },
    ]);
  });

  it('should return machine unchanged when no overrides given', () => {
    const machine = createMachine({
      ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
    });

    const result = applySnmpFirewallOverrides(machine, []);

    expect(result.ports).toEqual([
      { port: 22, service: 'ssh', serviceVersion: 'latest', open: false },
    ]);
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([
      { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
    ]);
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
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
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([
      { port: 80, service: 'http', serviceVersion: 'latest', open: true },
      { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
    ]);
  });

  it('should override router port when forwarded port collides', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({
        ip: '203.0.113.1',
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: false })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [
          createPort({ port: 8080, service: 'http-alt', serviceVersion: 'latest', open: true }),
        ],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 80, internalIp: '10.0.0.5', internalPort: 8080 },
    ];

    const result = buildMergedRouterView(router, [target], rules);

    expect(result.ports).toEqual([
      { port: 80, service: 'http-alt', serviceVersion: 'latest', open: true },
    ]);
  });

  it('should merge users from router and forwarded machines, deduplicating by username', () => {
    const sharedUser = { username: 'admin', userType: 'root' as const };
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
        users: [{ username: 'ghost', userType: 'user' }],
      }),
    });

    const result = buildMergedRouterView(router, [unreferencedMachine], []);

    expect(result.ports).toEqual([]);
    expect(result.users).toEqual([]);
  });

  // --- Workstation-occupant forwarding (piece 2a) ---
  //
  // Forward rules pointing at LAN-occupant workstations resolve through the
  // optional 4th parameter. Occupants are RemoteMachine (not GeneratedMachine)
  // because their port state comes from applyDynamicOverrides reading pid
  // files — there's no static router-internal machine to anchor to.

  it('forwards a rule targeting a workstation occupant by IP', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const occupant = createMachine({
      ip: '172.29.209.171',
      hostname: 'hacker-0036ad3c',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [], rules, [occupant]);

    expect(result.ports).toEqual([
      { port: 8080, service: 'http', serviceVersion: 'latest', open: true },
    ]);
  });

  it('drops occupant forwards when the targeted port is closed', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const occupant = createMachine({
      ip: '172.29.209.171',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: false })],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [], rules, [occupant]);

    expect(result.ports).toEqual([]);
  });

  it('drops occupant forwards when no matching port exists on the workstation', () => {
    // Workstation has no apache2/nginx running — pid file absent, port not in
    // the overlaid view. Rule resolves to an unknown port and silently drops.
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const occupant = createMachine({ ip: '172.29.209.171', ports: [] });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [], rules, [occupant]);

    expect(result.ports).toEqual([]);
  });

  it('mixes NPC and occupant forwards in a single rule set', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const npc = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
      }),
    });
    const occupant = createMachine({
      ip: '172.29.209.171',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [npc], rules, [occupant]);

    expect(result.ports).toEqual([
      { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
      { port: 8080, service: 'http', serviceVersion: 'latest', open: true },
    ]);
  });

  it('does NOT merge occupant users into the router user list', () => {
    // Workstation users live behind the per-player /etc/passwd projection,
    // not the router. Surfacing them via the NAT merge would leak occupant
    // accounts onto the router's externally-visible user roster.
    const routerUser = { username: 'admin', userType: 'root' as const };
    const occupantUser = { username: 'alice', userType: 'user' as const };

    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', users: [routerUser] }),
    });
    const occupant = createMachine({
      ip: '172.29.209.171',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
      users: [occupantUser],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [], rules, [occupant]);

    expect(result.users).toEqual([routerUser]);
  });

  it('NPC internalMachines wins on IP collision with an occupant entry', () => {
    // Defensive: workstation LAN IPs shouldn't collide with NPC home-machine
    // IPs in practice, but if a future generator stamps a clashing IP, the
    // structured NPC entry wins (richer port + user metadata).
    const router = createGeneratedMachine({
      ip: '203.0.113.1',
      remoteMachine: createMachine({ ip: '203.0.113.1', ports: [] }),
    });
    const npc = createGeneratedMachine({
      ip: '172.29.209.171',
      remoteMachine: createMachine({
        ip: '172.29.209.171',
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'apache2', open: true })],
      }),
    });
    const occupant = createMachine({
      ip: '172.29.209.171',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'nginx', open: true })],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];

    const result = buildMergedRouterView(router, [npc], rules, [occupant]);

    // NPC version string wins → 'apache2', not 'nginx'
    expect(result.ports).toEqual([
      { port: 8080, service: 'http', serviceVersion: 'apache2', open: true },
    ]);
  });
});

// -- Helpers for new tests --

const createSubnetLayer = (overrides: Partial<SubnetLayer> = {}): SubnetLayer => ({
  subnet: '10.0.1',
  gateway: createGeneratedMachine({ ip: '10.0.0.50', hostname: 'gw', role: 'router' }),
  gatewayType: 'router',
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

const createWorldNetwork = (overrides: Partial<MissionNetwork> = {}): MissionNetwork => ({
  seed: 'world-seed',
  difficulty: 'easy',
  entryPoint: '203.0.113.42',
  entryVariant: 'ssh',
  machines: [],
  fileSystems: {},
  networkConfig: { machineConfigs: {} },
  objective: {
    type: 'tamper',
    description: 'unused for world networks',
    targetMachine: '203.0.113.42',
    targetPath: '/dev/null',
    targetContent: '',
    clientEmail: 'world@example.com',
    expectedProof: '',
  },
  clientEmail: 'world@example.com',
  routerPublicIp: '203.0.113.42',
  routerMachine: createGeneratedMachine({
    ip: '203.0.113.42',
    hostname: 'world-router',
    role: 'router',
  }),
  routerDomain: 'world.example',
  domainEntry: false,
  layers: [createSubnetLayer({ subnet: '10.0.0' })],
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

describe('buildCanonicalKeyedRulesMap', () => {
  // Pure function. Iterates the gateway-IP list, folds aliases to their
  // canonical primary IP via the alias map, reads each canonical IP once,
  // and keys the result by canonical IP only.

  const fakeFile = (content: string): FileNode => ({
    name: 'fake',
    type: 'file' as const,
    content,
    owner: 'root' as const,
    permissions: { read: [], write: [], execute: [] },
  });

  it('keys the result by canonical IPs only, with aliases collapsed', () => {
    // gatewayIps contains both .1 alias AND canonical for the home router;
    // the result should have ONE entry keyed by the canonical IP.
    const reads: string[] = [];
    const readNode = (machineId: string, path: string) => {
      reads.push(machineId);
      if (machineId === '45.0.0.1' && path === '/etc/iptables/rules.v4') {
        return fakeFile('forward 80 to 10.0.0.10:80');
      }
      return null;
    };
    const map = buildCanonicalKeyedRulesMap(
      ['10.0.0.1', '45.0.0.1'],
      readNode,
      new Map([['10.0.0.1', '45.0.0.1']]),
      '/etc/iptables/rules.v4',
      (content: string) => content.split('\n').map((line) => line),
    );

    expect([...map.keys()]).toEqual(['45.0.0.1']);
    expect(map.get('10.0.0.1')).toBeUndefined();
  });

  it('reads only from canonical IPs, not from aliases', () => {
    // The .1 alias must NOT be queried — patches written via canonical
    // would be invisible if we read from the alias key.
    const reads: string[] = [];
    const readNode = (machineId: string, _path: string) => {
      reads.push(machineId);
      return null;
    };
    buildCanonicalKeyedRulesMap(
      ['10.0.0.1', '45.0.0.1', '10.0.1.1', '10.0.0.50'],
      readNode,
      new Map([
        ['10.0.0.1', '45.0.0.1'],
        ['10.0.1.1', '10.0.0.50'],
      ]),
      '/etc/iptables/rules.v4',
      () => [],
    );

    expect(reads).not.toContain('10.0.0.1');
    expect(reads).not.toContain('10.0.1.1');
    expect(new Set(reads)).toEqual(new Set(['45.0.0.1', '10.0.0.50']));
  });

  it('passes through canonical-only IPs (world / mission gateways without aliases)', () => {
    // World-network gateways aren't in the alias map. They pass through
    // unchanged and the result is keyed by their canonical IP.
    const readNode = (machineId: string, path: string) =>
      machineId === '203.0.113.1' && path === '/etc/iptables/rules.v4'
        ? fakeFile('forward 80 to 10.0.0.10:80')
        : null;
    const map = buildCanonicalKeyedRulesMap(
      ['203.0.113.1'],
      readNode,
      new Map(),
      '/etc/iptables/rules.v4',
      (content: string) => [content],
    );

    expect([...map.keys()]).toEqual(['203.0.113.1']);
  });

  it('skips IPs whose config file is missing or empty', () => {
    // A gateway without /etc/iptables/rules.v4 produces no map entry.
    const readNode = () => null;
    const map = buildCanonicalKeyedRulesMap(
      ['45.0.0.1', '203.0.113.1'],
      readNode,
      new Map(),
      '/etc/iptables/rules.v4',
      () => [],
    );

    expect(map.size).toBe(0);
  });

  it('skips IPs whose parsed result is empty (so the map only carries gateways with real rules)', () => {
    // Parser returning [] for a gateway whose file exists but has no
    // rules — the entry is omitted.
    const readNode = (machineId: string, path: string) =>
      machineId === '45.0.0.1' && path === '/etc/iptables/rules.v4'
        ? fakeFile('# comments only, no rules')
        : null;
    const map = buildCanonicalKeyedRulesMap(
      ['45.0.0.1'],
      readNode,
      new Map(),
      '/etc/iptables/rules.v4',
      () => [],
    );

    expect(map.size).toBe(0);
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      }),
    });
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
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
        expect.objectContaining({
          port: 8080,
          service: 'http',
          serviceVersion: 'latest',
          open: true,
        }),
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
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
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
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
      }),
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 2222, internalIp: '10.0.1.10', internalPort: 22 },
    ];

    const result = applyDynamicOverrides(gateway.remoteMachine, {
      allIptablesRules: new Map([['10.0.0.50', rules]]),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      missionMachines: [gateway, target],
      homeGatewayByAliasIp: new Map(),
      readNode: noopReader,
    });

    expect(result.ports).toEqual([
      { port: 2222, service: 'ssh', serviceVersion: 'latest', open: true },
    ]);
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
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
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
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeMachines: [target],
      homeGatewayByAliasIp: new Map([['10.0.0.1', gateway]]),
      readNode: noopReader,
    });

    expect(result.ip).toBe('10.0.0.1');
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
    );
  });

  it('forwards a home gateway iptables rule targeting a workstation occupant', () => {
    // Player-edited iptables on the home router: forward public 8080 to
    // workstation:80. The workstation is a LAN occupant whose port state
    // is already overlaid (apache2/nginx pid file read upstream).
    const gateway = createGeneratedMachine({
      ip: '45.0.0.1',
      role: 'router',
      remoteMachine: createMachine({ ip: '45.0.0.1', ports: [] }),
    });
    const overlaidOccupant = createMachine({
      ip: '172.29.209.171',
      hostname: 'hacker-0036ad3c',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];
    const visibleMachine = createMachine({ ip: '10.0.0.1', hostname: 'home-router' });

    const result = applyDynamicOverrides(visibleMachine, {
      allIptablesRules: new Map([['10.0.0.1', rules]]),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeMachines: [],
      homeGatewayByAliasIp: new Map([['10.0.0.1', gateway]]),
      overlaidOccupants: [overlaidOccupant],
      readNode: noopReader,
    });

    expect(result.ip).toBe('10.0.0.1');
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 8080, service: 'http', open: true }),
    );
  });

  // End-to-end integration: pid file → occupant overlay → home-router merge.
  // Mirrors what NetworkContext does at runtime — two passes of
  // applyDynamicOverrides chained together. Without this test, a future
  // refactor could break the path between "player runs nginx" and "router
  // exposes forwarded port" while keeping the unit tests green.
  it('end-to-end: workstation nginx.pid → home-router public port via iptables rule', () => {
    const gateway = createGeneratedMachine({
      ip: '45.0.0.1',
      role: 'router',
      remoteMachine: createMachine({ ip: '45.0.0.1', ports: [] }),
    });
    // The workstation occupant as it lives in NetworkContext.occupantMachines —
    // closed-laptop default with empty ports. The pid-file overlay below opens
    // port 80 dynamically.
    const occupantBase = createMachine({
      ip: '172.29.209.171',
      hostname: 'hacker-0036ad3c',
      ports: [],
    });
    const rules: readonly NatForwardingRule[] = [
      { publicPort: 8080, internalIp: '172.29.209.171', internalPort: 80 },
    ];
    const visibleRouter = createMachine({ ip: '10.0.0.1', hostname: 'home-router' });

    // Synthetic FS: the workstation has /var/run/nginx.pid in extended form
    // (player ran `nginx 80` as root). All other paths absent.
    const readNode = (machineId: string, path: string) => {
      if (machineId === '172.29.209.171' && path === '/var/run/nginx.pid') {
        return {
          name: 'nginx.pid',
          type: 'file' as const,
          content: '/usr/sbin/nginx:port=80,user=root,userType=root,home=/root',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const baseCtx = {
      allIptablesRules: new Map([['10.0.0.1', rules]]),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeMachines: [],
      homeGatewayByAliasIp: new Map([['10.0.0.1', gateway]]),
      readNode,
    };

    // First pass: overlay the occupant. The pid file read opens port 80.
    const overlaidOccupant = applyDynamicOverrides(occupantBase, baseCtx);
    expect(overlaidOccupant.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', open: true }),
    );

    // Second pass: overlay the home router with overlaidOccupants populated.
    // The iptables rule resolves through the occupant's open port 80 → public 8080.
    const overlaidRouter = applyDynamicOverrides(visibleRouter, {
      ...baseCtx,
      overlaidOccupants: [overlaidOccupant],
    });
    expect(overlaidRouter.ip).toBe('10.0.0.1');
    expect(overlaidRouter.ports).toContainEqual(
      expect.objectContaining({ port: 8080, service: 'http', open: true }),
    );
  });

  it('should apply sshd daemon override from PID file', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
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
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }),
    );
  });

  it('should let SNMP firewall deny override a running daemon (firewall wins)', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
    });
    // sshd is running (PID file exists)
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
    // But SNMP firewall denies SSH
    const snmpOverrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: false }];

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map([['10.0.0.5', snmpOverrides]]),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    // Firewall should win: port 22 closed despite daemon running
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false }),
    );
  });

  it('should close SSH port when no sshd.pid exists (daemon not running)', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: true })],
    });

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: () => null, // no PID files
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false }),
    );
  });

  it('should close FTP port when no vsftpd.pid exists (daemon not running)', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 21, service: 'ftp', serviceVersion: 'latest', open: true })],
    });

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: () => null, // no PID files
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 21, service: 'ftp', serviceVersion: 'latest', open: false }),
    );
  });

  it('should close infra ports (http/mysql) when their pid files are absent', () => {
    // After the pid-file-source-of-truth unification, http/mysql/redis/etc.
    // are all daemon-backed. A machine with an open infra port but no
    // corresponding pid file closes the port — same semantics as ssh/ftp.
    // (Mission/home generators ship the pid files via buildInfrastructurePidFiles,
    // so generated machines stay reachable; this test exercises a hand-built
    // machine without pid files.)
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [
        createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
        createPort({ port: 3306, service: 'mysql', serviceVersion: 'latest', open: true }),
      ],
    });

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: () => null, // no PID files
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', serviceVersion: 'latest', open: false }),
    );
    expect(result.ports).toContainEqual(
      expect.objectContaining({
        port: 3306,
        service: 'mysql',
        serviceVersion: 'latest',
        open: false,
      }),
    );
  });

  it('should keep http port open when nginx.pid exists on the machine', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/nginx.pid') {
        return {
          name: 'nginx.pid',
          type: 'file' as const,
          content: '/usr/sbin/nginx:port=80',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
    );
  });

  it('should keep mysql port open when mysqld.pid exists on the machine', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 3306, service: 'mysql', serviceVersion: 'latest', open: true })],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/mysqld.pid') {
        return {
          name: 'mysqld.pid',
          type: 'file' as const,
          content: '/usr/sbin/mysqld:port=3306',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({
        port: 3306,
        service: 'mysql',
        serviceVersion: 'latest',
        open: true,
      }),
    );
  });

  it('should keep BOTH http and https ports open when nginx.pid covers them (shared pid file)', () => {
    // nginx.pid serves http, https, and http-alt. Even if the pid content
    // only names one port, the closure logic treats all three services
    // as "running" because they share the same pid file.
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [
        createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true }),
        createPort({ port: 443, service: 'https', serviceVersion: 'latest', open: true }),
      ],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/nginx.pid') {
        return {
          name: 'nginx.pid',
          type: 'file' as const,
          content: '/usr/sbin/nginx:port=80',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', open: true }),
    );
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 443, service: 'https', open: true }),
    );
  });

  it('should keep BOTH http and https ports open when nginx.pid lists both via multi-line content', () => {
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [
        createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: false }),
        createPort({ port: 443, service: 'https', serviceVersion: 'latest', open: false }),
      ],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/nginx.pid') {
        return {
          name: 'nginx.pid',
          type: 'file' as const,
          content: '/usr/sbin/nginx:port=80\n/usr/sbin/nginx:port=443',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', open: true }),
    );
    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 443, service: 'https', open: true }),
    );
  });

  it('should not close NAT-forwarded ports based on local pid file state', () => {
    // The closure scope is `ownPorts` — ports the machine originally
    // declared. NAT-forwarded ports added by step 1 (router merge) are
    // not local ports; the gateway controls them, so the local pid-file
    // logic doesn't touch them.
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [
        // No infra ports declared on this machine.
      ],
    });

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: () => null,
    });

    // No infra ports to close → machine returned with same (empty) ports.
    expect(result.ports).toEqual([]);
  });

  it('should open http port from apache2.pid (workstation with no static http port)', () => {
    const machine = createMachine({ ip: '10.0.0.5', ports: [] });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/apache2.pid') {
        return {
          name: 'apache2.pid',
          type: 'file' as const,
          content: 'apache2:port=80,user=alice,userType=user,home=/home/alice',
          owner: 'user' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({
        port: 80,
        service: 'http',
        open: true,
        owner: { username: 'alice', userType: 'user', homePath: '/home/alice' },
      }),
    );
  });

  it('should stamp root owner when apache2.pid says root', () => {
    const machine = createMachine({ ip: '10.0.0.5', ports: [] });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/apache2.pid') {
        return {
          name: 'apache2.pid',
          type: 'file' as const,
          content: 'apache2:port=443,user=root,userType=root,home=/root',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({
        port: 443,
        service: 'https',
        open: true,
        owner: { username: 'root', userType: 'root', homePath: '/root' },
      }),
    );
  });

  it('should NOT add http port when apache2.pid is absent and no static port exists', () => {
    const machine = createMachine({ ip: '10.0.0.5', ports: [] });
    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode: () => null,
    });

    expect(result.ports.find((p) => p.port === 80)).toBeUndefined();
  });

  it('keeps static http port open when apache2 is running and nginx.pid is absent (closure-exclusion)', () => {
    // Defensive future-proofing: if a machine ships a static http port AND
    // apache2.pid is the daemon serving it (no nginx.pid), the infra closure
    // logic should NOT close http just because nginx.pid is missing — apache2
    // is the running daemon for that service.
    const machine = createMachine({
      ip: '10.0.0.5',
      ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
    });
    const readNode = (machineId: string, path: string) => {
      if (machineId === '10.0.0.5' && path === '/var/run/apache2.pid') {
        return {
          name: 'apache2.pid',
          type: 'file' as const,
          content: 'apache2:port=80,user=root,userType=root,home=/root',
          owner: 'root' as const,
          permissions: { read: [], write: [], execute: [] },
        };
      }
      return null;
    };

    const result = applyDynamicOverrides(machine, {
      allIptablesRules: new Map(),
      allSnmpOverrides: new Map(),
      allAclRules: new Map(),
      allSnmpAclOverrides: new Map(),
      homeGatewayByAliasIp: new Map(),
      readNode,
    });

    expect(result.ports).toContainEqual(
      expect.objectContaining({ port: 80, service: 'http', open: true }),
    );
  });

  // PR #145 made writes via gateway .1 aliases canonicalize to the
  // gateway's primary IP, so the iptables/SNMP/ACL/snmp-ACL maps land
  // under canonical-only keys. Lookups from a LAN viewer (whose
  // machine.ip is the .1 alias) must canonicalize too — otherwise the
  // .1-keyed .get() misses every patch.
  describe('canonicalizes gateway alias IPs for state lookups', () => {
    it('applies an SNMP firewall override keyed by the canonical IP when scanning the gateway via its .1 alias', () => {
      // A snmpset firewallSSH=permit write canonicalizes to the gateway's
      // primary IP (PR #147). A LAN viewer scanning the .1 alias must
      // canonicalize the SNMP-override lookup or the firewall change
      // stays invisible from inside the LAN.
      const visibleMachine = createMachine({
        ip: '10.0.0.1',
        hostname: 'home-router',
        ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
      });
      const snmpOverrides: readonly SnmpFirewallOverride[] = [{ port: 22, open: true }];

      const result = applyDynamicOverrides(visibleMachine, {
        allIptablesRules: new Map(),
        // Overrides keyed by CANONICAL IP only.
        allSnmpOverrides: new Map([['45.0.0.1', snmpOverrides]]),
        allAclRules: new Map(),
        allSnmpAclOverrides: new Map(),
        homeGatewayByAliasIp: new Map(),
        gatewayAliasMap: new Map([['10.0.0.1', '45.0.0.1']]),
        readNode: noopReader,
      });

      expect(result.ports).toContainEqual(
        expect.objectContaining({ port: 22, service: 'ssh', open: true }),
      );
    });

    it('applies an iptables rule keyed by the canonical IP when scanning the gateway via its .1 alias', () => {
      const gateway = createGeneratedMachine({
        ip: '45.0.0.1',
        role: 'router',
        remoteMachine: createMachine({ ip: '45.0.0.1', ports: [] }),
      });
      const target = createGeneratedMachine({
        ip: '10.0.0.10',
        remoteMachine: createMachine({
          ip: '10.0.0.10',
          ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
        }),
      });
      const rules: readonly NatForwardingRule[] = [
        { publicPort: 80, internalIp: '10.0.0.10', internalPort: 80 },
      ];
      const visibleMachine = createMachine({ ip: '10.0.0.1', hostname: 'home-router' });

      const result = applyDynamicOverrides(visibleMachine, {
        // Rules keyed by CANONICAL IP only — the .1-keyed entry is gone
        // post-PR #145 because writes through the .1 alias canonicalize.
        allIptablesRules: new Map([['45.0.0.1', rules]]),
        allSnmpOverrides: new Map(),
        allAclRules: new Map(),
        allSnmpAclOverrides: new Map(),
        homeMachines: [target],
        homeGatewayByAliasIp: new Map([['10.0.0.1', gateway]]),
        gatewayAliasMap: new Map([['10.0.0.1', '45.0.0.1']]),
        readNode: noopReader,
      });

      expect(result.ports).toContainEqual(
        expect.objectContaining({ port: 80, service: 'http', open: true }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// World networks helpers
// ---------------------------------------------------------------------------

describe('collectWorldGatewayIps', () => {
  it('returns an empty array when no world networks supplied', () => {
    expect(collectWorldGatewayIps([])).toEqual([]);
  });

  it('includes each world router public IP', () => {
    const a = createWorldNetwork({
      routerMachine: createGeneratedMachine({ ip: '203.0.113.42', role: 'router' }),
    });
    const b = createWorldNetwork({
      routerMachine: createGeneratedMachine({ ip: '203.0.113.43', role: 'router' }),
    });

    const result = collectWorldGatewayIps([a, b]);

    expect(result).toEqual(expect.arrayContaining(['203.0.113.42', '203.0.113.43']));
  });

  it('includes inner gateway IPs when world networks have multiple layers', () => {
    const inner = createGeneratedMachine({ ip: '10.0.0.50', role: 'router' });
    const wn = createWorldNetwork({
      layers: [
        createSubnetLayer({ subnet: '10.0.0' }),
        createSubnetLayer({ subnet: '10.0.1', gateway: inner }),
      ],
    });

    const result = collectWorldGatewayIps([wn]);

    expect(result).toContain('10.0.0.50');
  });
});

describe('buildWorldRouterRemoteViews', () => {
  it('returns an empty array when no world networks supplied', () => {
    expect(buildWorldRouterRemoteViews([], new Map(), new Map())).toEqual([]);
  });

  it('returns one RemoteMachine view per world network router', () => {
    const a = createWorldNetwork({
      routerMachine: createGeneratedMachine({
        ip: '203.0.113.42',
        hostname: 'gw-a',
        remoteMachine: createMachine({ ip: '203.0.113.42', hostname: 'gw-a' }),
      }),
    });
    const b = createWorldNetwork({
      routerMachine: createGeneratedMachine({
        ip: '203.0.113.43',
        hostname: 'gw-b',
        remoteMachine: createMachine({ ip: '203.0.113.43', hostname: 'gw-b' }),
      }),
    });

    const result = buildWorldRouterRemoteViews([a, b], new Map(), new Map());

    expect(result).toHaveLength(2);
    expect(result[0]?.ip).toBe('203.0.113.42');
    expect(result[1]?.ip).toBe('203.0.113.43');
  });

  it('applies iptables NAT merge when rules exist for the world router', () => {
    const target = createGeneratedMachine({
      ip: '10.0.0.5',
      remoteMachine: createMachine({
        ip: '10.0.0.5',
        ports: [createPort({ port: 80, service: 'http', serviceVersion: 'latest', open: true })],
      }),
    });
    const wn = createWorldNetwork({
      machines: [target],
      routerMachine: createGeneratedMachine({
        ip: '203.0.113.42',
        remoteMachine: createMachine({
          ip: '203.0.113.42',
          ports: [createPort({ port: 22, service: 'ssh', serviceVersion: 'latest', open: false })],
        }),
      }),
    });
    const allIptablesRules = new Map<string, readonly NatForwardingRule[]>([
      ['203.0.113.42', [{ publicPort: 8080, internalIp: '10.0.0.5', internalPort: 80 }]],
    ]);

    const result = buildWorldRouterRemoteViews([wn], allIptablesRules, new Map());

    // NAT merge surfaces the forwarded port on the world router
    expect(result[0]?.ports).toContainEqual(
      expect.objectContaining({ port: 8080, service: 'http' }),
    );
  });
});

describe('findMachineInWorldNetworks', () => {
  it('returns undefined when no world networks contain the IP', () => {
    const wn = createWorldNetwork();
    expect(findMachineInWorldNetworks('1.2.3.4', [wn])).toBeUndefined();
  });

  it('returns undefined when world networks list is empty', () => {
    expect(findMachineInWorldNetworks('203.0.113.42', [])).toBeUndefined();
  });

  it('finds a machine reachable from a world network internal config', () => {
    const internal = createMachine({ ip: '10.0.0.5', hostname: 'inner' });
    const wn = createWorldNetwork({
      networkConfig: {
        machineConfigs: {
          '10.0.0.5': { interfaces: [], machines: [internal], dnsRecords: [] },
        },
      },
    });

    const result = findMachineInWorldNetworks('10.0.0.5', [wn]);

    expect(result?.ip).toBe('10.0.0.5');
  });

  it('finds the world router by its public IP', () => {
    const router = createGeneratedMachine({
      ip: '203.0.113.42',
      remoteMachine: createMachine({ ip: '203.0.113.42', hostname: 'world-gw' }),
    });
    const wn = createWorldNetwork({ routerMachine: router });

    const result = findMachineInWorldNetworks('203.0.113.42', [wn]);

    expect(result?.ip).toBe('203.0.113.42');
    expect(result?.hostname).toBe('world-gw');
  });

  it('searches across multiple world networks and returns the first match', () => {
    const a = createWorldNetwork({
      routerMachine: createGeneratedMachine({
        ip: '203.0.113.42',
        remoteMachine: createMachine({ ip: '203.0.113.42', hostname: 'a-gw' }),
      }),
    });
    const b = createWorldNetwork({
      routerMachine: createGeneratedMachine({
        ip: '203.0.113.43',
        remoteMachine: createMachine({ ip: '203.0.113.43', hostname: 'b-gw' }),
      }),
    });

    expect(findMachineInWorldNetworks('203.0.113.43', [a, b])?.hostname).toBe('b-gw');
  });
});

describe('buildWorldExternalDnsRecords', () => {
  it('returns an empty array when no world networks supplied', () => {
    expect(buildWorldExternalDnsRecords([])).toEqual([]);
  });

  it('emits one A record per world network — hostname → public IP', () => {
    const a = createWorldNetwork({
      routerMachine: createGeneratedMachine({ ip: '203.0.113.42', hostname: 'findit.io' }),
    });
    const b = createWorldNetwork({
      routerMachine: createGeneratedMachine({ ip: '203.0.113.43', hostname: 'techparts.io' }),
    });

    expect(buildWorldExternalDnsRecords([a, b])).toEqual([
      { domain: 'findit.io', ip: '203.0.113.42', type: 'A' },
      { domain: 'techparts.io', ip: '203.0.113.43', type: 'A' },
    ]);
  });

  it('preserves input order so themed-UX sorting upstream stays deterministic', () => {
    const ordered = ['203.0.113.50', '203.0.113.10', '203.0.113.30'].map((ip, i) =>
      createWorldNetwork({
        routerMachine: createGeneratedMachine({ ip, hostname: `host${i}.io` }),
      }),
    );

    const result = buildWorldExternalDnsRecords(ordered);

    expect(result.map((r) => r.ip)).toEqual(['203.0.113.50', '203.0.113.10', '203.0.113.30']);
  });

  it('uses the hostname as the full domain — no TLD synthesis', () => {
    // Themed-network generators are expected to put the full public
    // domain (with TLD) into routerMachine.hostname directly.
    const wn = createWorldNetwork({
      routerMachine: createGeneratedMachine({ ip: '203.0.113.42', hostname: 'findit.io' }),
    });

    const [record] = buildWorldExternalDnsRecords([wn]);

    expect(record?.domain).toBe('findit.io');
  });
});
