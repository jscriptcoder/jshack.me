import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import type { Difficulty } from './types';

describe('generateTopology', () => {
  it('produces deterministic output for the same seed', () => {
    const a = generateTopology(createPrng('topo-seed'), 'medium');
    const b = generateTopology(createPrng('topo-seed'), 'medium');
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const a = generateTopology(createPrng('topo-alpha'), 'medium');
    const b = generateTopology(createPrng('topo-beta'), 'medium');
    expect(a.machines.map((m) => m.ip)).not.toEqual(b.machines.map((m) => m.ip));
  });

  it('generates correct machine count for easy difficulty', () => {
    const result = generateTopology(createPrng('easy-test'), 'easy');
    expect(result.machines).toHaveLength(2);
  });

  it('generates 3-4 machines for medium difficulty', () => {
    const counts = Array.from({ length: 20 }, (_, i) => {
      const result = generateTopology(createPrng(`medium-${i}`), 'medium');
      return result.machines.length;
    });
    counts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(3);
      expect(c).toBeLessThanOrEqual(4);
    });
  });

  it('generates 4-6 machines for hard difficulty', () => {
    const counts = Array.from({ length: 20 }, (_, i) => {
      const result = generateTopology(createPrng(`hard-${i}`), 'hard');
      return result.machines.length;
    });
    counts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(4);
      expect(c).toBeLessThanOrEqual(6);
    });
  });

  it('assigns internal IPs on the same subnet starting from .10', () => {
    const result = generateTopology(createPrng('ip-test'), 'medium');
    const ips = result.machines.map((m) => m.ip);
    const parts = ips.map((ip) => ip.split('.'));
    parts.forEach((p, i) => {
      expect(p[3]).toBe(String(10 + i));
    });
    const subnet = `${parts[0]?.[0]}.${parts[0]?.[1]}.${parts[0]?.[2]}`;
    parts.forEach((p) => {
      expect(`${p[0]}.${p[1]}.${p[2]}`).toBe(subnet);
    });
  });

  it('entry point is a webserver or workstation', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      generateTopology(createPrng(`entry-${i}`), 'medium'),
    );
    results.forEach((r) => {
      const entry = r.machines.find((m) => m.ip === r.entryPoint);
      expect(entry).toBeDefined();
      expect(['webserver', 'workstation']).toContain(entry?.role);
    });
  });

  it('generates DNS records for all internal machines plus router', () => {
    const result = generateTopology(createPrng('dns-test'), 'medium');
    const firstConfig = Object.values(result.networkConfig.machineConfigs)[0];
    // Internal DNS includes all mission machines + router
    expect(firstConfig?.dnsRecords).toHaveLength(result.machines.length + 1);
    result.machines.forEach((m) => {
      const dns = firstConfig?.dnsRecords.find((d) => d.ip === m.ip);
      expect(dns).toBeDefined();
      expect(dns?.domain).toBe(`${m.hostname}.mission`);
    });
  });

  it('each internal machine config excludes itself from visible machines', () => {
    const result = generateTopology(createPrng('self-test'), 'medium');
    result.machines.forEach((m) => {
      const config = result.networkConfig.machineConfigs[m.ip];
      expect(config).toBeDefined();
      const ips = config?.machines.map((rm) => rm.ip) ?? [];
      expect(ips).not.toContain(m.ip);
      // Visible machines = other internal machines + router internal IP
      expect(config?.machines).toHaveLength(result.machines.length);
    });
  });

  it('generates valid network interfaces for each internal machine', () => {
    const result = generateTopology(createPrng('iface-test'), 'medium');
    result.machines.forEach((m) => {
      const config = result.networkConfig.machineConfigs[m.ip];
      expect(config?.interfaces).toHaveLength(1);
      const iface = config?.interfaces[0];
      expect(iface?.name).toBe('eth0');
      expect(iface?.inet).toBe(m.ip);
      expect(iface?.flags).toContain('UP');
    });
  });

  (['easy', 'medium', 'hard'] as readonly Difficulty[]).forEach((diff) => {
    it(`all internal machines have SSH open for ${diff} difficulty`, () => {
      const result = generateTopology(createPrng(`ssh-${diff}`), diff);
      result.machines.forEach((m) => {
        const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
        expect(sshPort).toBeDefined();
        expect(sshPort?.open).toBe(true);
      });
    });
  });

  // Router-specific tests
  it('generates a router machine with role "router"', () => {
    const result = generateTopology(createPrng('router-test'), 'medium');
    expect(result.routerMachine).toBeDefined();
    expect(result.routerMachine.role).toBe('router');
  });

  it('router has a public IP in 45.x.x.x range', () => {
    const result = generateTopology(createPrng('pub-ip-test'), 'medium');
    expect(result.routerPublicIp).toMatch(/^45\.\d+\.\d+\.\d+$/);
    expect(result.routerMachine.ip).toBe(result.routerPublicIp);
  });

  it('router config has dual interfaces (eth0 public, eth1 internal)', () => {
    const result = generateTopology(createPrng('dual-iface'), 'medium');
    const routerConfig = result.networkConfig.machineConfigs[result.routerPublicIp];
    expect(routerConfig).toBeDefined();
    expect(routerConfig?.interfaces).toHaveLength(2);
    expect(routerConfig?.interfaces[0]?.name).toBe('eth0');
    expect(routerConfig?.interfaces[1]?.name).toBe('eth1');
    expect(routerConfig?.interfaces[0]?.inet).toBe(result.routerPublicIp);
    // eth1 is the internal gateway (x.x.x.1)
    expect(routerConfig?.interfaces[1]?.inet).toMatch(/^10\.\d+\.\d+\.1$/);
  });

  it('router can see all internal machines', () => {
    const result = generateTopology(createPrng('router-sees'), 'medium');
    const routerConfig = result.networkConfig.machineConfigs[result.routerPublicIp];
    expect(routerConfig?.machines).toHaveLength(result.machines.length);
    result.machines.forEach((m) => {
      const found = routerConfig?.machines.find((rm) => rm.ip === m.ip);
      expect(found).toBeDefined();
    });
  });

  it('internal machines cannot see router public IP directly', () => {
    const result = generateTopology(createPrng('no-pub-ip'), 'medium');
    result.machines.forEach((m) => {
      const config = result.networkConfig.machineConfigs[m.ip];
      const routerVisible = config?.machines.find((rm) => rm.ip === result.routerPublicIp);
      expect(routerVisible).toBeUndefined();
      // But router internal gateway IS visible
      const gatewayVisible = config?.machines.find((rm) => rm.ip.endsWith('.1'));
      expect(gatewayVisible).toBeDefined();
    });
  });

  it('hard difficulty always produces router-first mode (no forwarding)', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      generateTopology(createPrng(`hard-fwd-${i}`), 'hard'),
    );
    results.forEach((r) => {
      expect(r.natForwarding).toBeUndefined();
    });
  });

  it('forwarded mode sets natForwarding with correct IPs', () => {
    // Search for a seed that produces forwarded mode
    let found = false;
    for (let i = 0; i < 50; i++) {
      const result = generateTopology(createPrng(`fwd-${i}`), 'easy');
      if (result.natForwarding) {
        expect(result.natForwarding.publicIp).toBe(result.routerPublicIp);
        expect(result.natForwarding.internalIp).toBe(result.entryPoint);
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('external DNS records contain only router public IP', () => {
    const result = generateTopology(createPrng('ext-dns'), 'medium');
    expect(result.externalDnsRecords).toHaveLength(1);
    expect(result.externalDnsRecords[0]?.ip).toBe(result.routerPublicIp);
  });
});
