import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateNetwork } from './generateNetwork';
import type { Difficulty } from './types';

const generate = (seed: string, difficulty: Difficulty = 'medium') =>
  generateNetwork({ prng: createPrng(seed), difficulty });

describe('generateNetwork', () => {
  // --- Determinism ---

  it('produces deterministic output for the same seed and difficulty', async () => {
    const a = await generate('det-seed');
    const b = await generate('det-seed');
    expect(a.topology.routerPublicIp).toBe(b.topology.routerPublicIp);
    expect(a.machines.length).toBe(b.machines.length);
    expect(a.machines.map((m) => m.ip)).toEqual(b.machines.map((m) => m.ip));
  });

  it('produces different output for different seeds', async () => {
    const a = await generate('alpha');
    const b = await generate('beta');
    expect(a.topology.routerPublicIp).not.toBe(b.topology.routerPublicIp);
  });

  // --- Topology ---

  it('generates layers matching difficulty config', async () => {
    expect((await generate('easy-test', 'easy')).topology.layers.length).toBe(1);
    expect((await generate('medium-test', 'medium')).topology.layers.length).toBe(2);
    expect((await generate('hard-test', 'hard')).topology.layers.length).toBe(3);
  });

  it('generates a router with a public IP', async () => {
    const net = await generate('router-test');
    expect(net.topology.routerPublicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(net.routerMachine.role).toBe('router');
    expect(net.routerMachine.ip).toBe(net.topology.routerPublicIp);
  });

  it('assigns an entry variant from the valid set', async () => {
    const validVariants = ['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp'];
    for (let i = 0; i < 20; i++) {
      const net = await generate(`variant-${i}`);
      expect(validVariants).toContain(net.topology.entryVariant);
    }
  });

  it('entry point is an IP of one of the generated machines', async () => {
    const net = await generate('entry-pt');
    const machineIps = net.machines.map((m) => m.ip);
    expect(machineIps).toContain(net.topology.entryPoint);
  });

  // --- Users ---

  it('every machine has users including root', async () => {
    const net = await generate('users-all');
    for (const machine of net.machines) {
      const users = net.usersByMachine[machine.ip];
      expect(users).toBeDefined();
      expect(users!.some((u) => u.userType === 'root')).toBe(true);
    }
  });

  it('router has users', async () => {
    const net = await generate('users-router');
    const routerUsers = net.usersByMachine[net.routerMachine.ip];
    expect(routerUsers).toBeDefined();
    expect(routerUsers!.length).toBeGreaterThanOrEqual(1);
  });

  it('maps router internal .1 IP to router users', async () => {
    const net = await generate('users-internal');
    const layer0Subnet = net.topology.layers[0]!.subnet;
    const routerInternalIp = `${layer0Subnet}.1`;
    const internalUsers = net.usersByMachine[routerInternalIp];
    const publicUsers = net.usersByMachine[net.routerMachine.ip];
    expect(internalUsers).toBeDefined();
    expect(internalUsers).toEqual(publicUsers);
  });

  it('maps inner gateway .1 IPs to gateway users for multi-layer networks', async () => {
    const net = await generate('gateway-users', 'hard');
    expect(net.topology.layers.length).toBe(3);
    for (const layer of net.topology.layers.slice(1)) {
      const downstreamIp = `${layer.subnet}.1`;
      const gatewayUsers = net.usersByMachine[layer.gateway.ip];
      const aliasUsers = net.usersByMachine[downstreamIp];
      expect(aliasUsers).toBeDefined();
      expect(aliasUsers).toEqual(gatewayUsers);
    }
  });

  // --- Credentials ---

  it('generates credentials for every machine', async () => {
    const net = await generate('creds-all');
    for (const machine of net.machines) {
      const creds = net.credentials[machine.ip];
      expect(creds).toBeDefined();
      expect(creds!.length).toBeGreaterThanOrEqual(1);
      // root cred always present
      expect(creds!.some((c) => c.username === 'root')).toBe(true);
    }
  });

  // --- Enrichment ---

  it('machines have users populated on remoteMachine', async () => {
    const net = await generate('enrich-users');
    for (const machine of net.machines) {
      expect(machine.remoteMachine.users.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('router has users populated on remoteMachine', async () => {
    const net = await generate('enrich-router');
    expect(net.routerMachine.remoteMachine.users.length).toBeGreaterThanOrEqual(1);
  });

  it('machines with NC variant have backdoor port owner', async () => {
    for (let i = 0; i < 50; i++) {
      const net = await generate(`nc-enrich-${i}`);
      for (const m of net.machines) {
        if (m.accessVariant !== 'nc') continue;
        const elite = m.remoteMachine.ports.find((p) => p.service === 'elite' && p.open);
        if (elite) {
          expect(elite.owner).toBeDefined();
        }
      }
    }
  });

  // --- Network config update ---

  it('updated network config has a config entry for every machine and router', async () => {
    const net = await generate('config-entries');
    for (const machine of net.machines) {
      expect(net.updatedNetworkConfig.machineConfigs[machine.ip]).toBeDefined();
    }
    expect(net.updatedNetworkConfig.machineConfigs[net.routerMachine.ip]).toBeDefined();
  });

  it('updated config machines have users populated', async () => {
    const net = await generate('config-users');
    for (const config of Object.values(net.updatedNetworkConfig.machineConfigs)) {
      for (const rm of config.machines) {
        // Machines referenced by configs should have users
        // (gateway .1 IPs get their users from the alias map)
        const users = net.usersByMachine[rm.ip];
        if (users && users.length > 0) {
          expect(rm.users.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  // --- Filesystems ---

  it('generates a filesystem for every machine and the router', async () => {
    const net = await generate('fs-all');
    for (const machine of net.machines) {
      expect(net.fileSystems[machine.ip]).toBeDefined();
      expect(net.fileSystems[machine.ip]!.type).toBe('directory');
    }
    expect(net.fileSystems[net.routerMachine.ip]).toBeDefined();
  });

  it('skips filesystem generation when skipFileSystems is true', async () => {
    const net = await generateNetwork({
      prng: createPrng('skip-fs'),
      difficulty: 'medium',
      skipFileSystems: true,
    });
    expect(Object.keys(net.fileSystems).length).toBe(0);
  });

  it('machine filesystems contain /etc/hostname', async () => {
    const net = await generate('fs-hostname');
    for (const machine of net.machines) {
      const fs = net.fileSystems[machine.ip];
      expect(fs).toBeDefined();
      const etc = fs?.type === 'directory' ? fs.children?.['etc'] : undefined;
      expect(etc?.type).toBe('directory');
      if (etc?.type === 'directory') {
        expect(etc.children?.['hostname']).toBeDefined();
      }
    }
  });

  it('router /etc/hosts lists only layer 0 machines and first gateway', async () => {
    for (const diff of ['easy', 'medium', 'hard'] as const) {
      const net = await generate(`fs-router-hosts-${diff}`, diff);
      const routerFs = net.fileSystems[net.routerMachine.ip];
      expect(routerFs).toBeDefined();
      const etc = routerFs?.type === 'directory' ? routerFs.children?.['etc'] : undefined;
      expect(etc?.type).toBe('directory');
      if (etc?.type !== 'directory') continue;
      const hosts = etc.children?.['hosts'];
      expect(hosts).toBeDefined();
      if (hosts?.type !== 'file' || !hosts.content) continue;

      // Layer 0 machines should be listed
      net.topology.layers[0]!.machines.forEach((m) => {
        expect(hosts.content).toContain(m.hostname);
      });

      // First inner gateway should be listed (if multi-layer)
      if (net.topology.layers.length > 1) {
        expect(hosts.content).toContain(net.topology.layers[1]!.gateway.hostname);
      }

      // Machines from deeper layers (1+) should NOT be listed
      net.topology.layers.slice(1).forEach((layer) => {
        layer.machines.forEach((m) => {
          expect(hosts.content).not.toContain(m.ip);
        });
      });
    }
  });

  it('machines with open SSH have sshd pid file', async () => {
    const net = await generate('fs-sshd-pid');
    for (const machine of net.machines) {
      const hasSshOpen = machine.remoteMachine.ports.some((p) => p.service === 'ssh' && p.open);
      if (!hasSshOpen) continue;
      const fs = net.fileSystems[machine.ip];
      const varDir = fs?.type === 'directory' ? fs.children?.['var'] : undefined;
      const runDir = varDir?.type === 'directory' ? varDir.children?.['run'] : undefined;
      if (runDir?.type === 'directory') {
        expect(runDir.children?.['sshd.pid']).toBeDefined();
      }
    }
  });

  // --- Topology overrides ---

  it('respects usedIps to avoid IP collisions', async () => {
    const net1 = await generate('collision-test');
    const blocked = new Set([net1.topology.routerPublicIp]);
    const net2 = await generateNetwork({
      prng: createPrng('collision-test'),
      difficulty: 'medium',
      topologyOverrides: { usedIps: blocked },
    });
    expect(net2.topology.routerPublicIp).not.toBe(net1.topology.routerPublicIp);
  });

  it('passes objectiveType to port closures', async () => {
    // script_fix skips all closures — every machine keeps SSH open
    const net = await generateNetwork({
      prng: createPrng('obj-scriptfix'),
      difficulty: 'medium',
      objectiveType: 'script_fix',
    });
    for (const m of net.machines) {
      const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
      if (sshPort) {
        expect(sshPort.open).toBe(true);
      }
    }
  });

  // --- SNMP variant handling ---

  it('generates SNMP config for border router when entry variant is snmp', async () => {
    for (let i = 0; i < 50; i++) {
      const net = await generateNetwork({
        prng: createPrng(`snmp-router-${i}`),
        difficulty: 'easy',
        topologyOverrides: { entryVariantOverride: 'snmp' },
      });
      if (net.topology.entryVariant !== 'snmp') continue;

      const routerFs = net.fileSystems[net.routerMachine.ip];
      const etc = routerFs?.type === 'directory' ? routerFs.children?.['etc'] : undefined;
      if (etc?.type === 'directory') {
        const snmpDir = etc.children?.['snmp'];
        expect(snmpDir).toBeDefined();
        if (snmpDir?.type === 'directory') {
          expect(snmpDir.children?.['snmpd.conf']).toBeDefined();
        }
      }
      return; // found one, test passes
    }
  });
});
