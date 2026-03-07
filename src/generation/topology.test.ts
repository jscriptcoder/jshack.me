import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology } from './topology';
import type { Difficulty } from './types';

// Checks if an IP falls within RFC 1918 private ranges
const isPrivateIp = (ip: string): boolean => {
  const octets = ip.split('.').map(Number);
  if (octets[0] === 10) return true;
  if (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return false;
};

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

  it('router has a valid public IP from the known prefix pool', () => {
    const validFirstOctets = [45, 51, 62, 78, 91, 103, 138, 162, 185, 198, 203, 212];
    const result = generateTopology(createPrng('pub-ip-test'), 'medium');
    const octets = result.routerPublicIp.split('.').map(Number);
    expect(validFirstOctets).toContain(octets[0]);
    expect(octets[1]).toBeGreaterThanOrEqual(1);
    expect(octets[2]).toBeGreaterThanOrEqual(1);
    expect(octets[3]).toBeGreaterThanOrEqual(2);
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
    // eth1 is the internal gateway (private subnet .1)
    const eth1Ip = routerConfig?.interfaces[1]?.inet ?? '';
    expect(eth1Ip).toMatch(/\.1$/);
    expect(isPrivateIp(eth1Ip)).toBe(true);
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

  it('generates varied public IP first octets across seeds', () => {
    const firstOctets = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const result = generateTopology(createPrng(`variety-pub-${i}`), 'medium');
        return Number(result.routerPublicIp.split('.')[0]);
      }),
    );
    // With 12 possible prefixes and 30 seeds, expect at least 3 distinct first octets
    expect(firstOctets.size).toBeGreaterThanOrEqual(3);
  });

  it('generates varied internal subnet prefixes across seeds', () => {
    const prefixes = new Set(
      Array.from({ length: 30 }, (_, i) => {
        const result = generateTopology(createPrng(`variety-priv-${i}`), 'medium');
        return result.machines[0]?.ip.split('.')[0];
      }),
    );
    // With 3 range types (10.x, 172.x, 192.168.x), expect at least 2 distinct first octets
    expect(prefixes.size).toBeGreaterThanOrEqual(2);
  });

  it('generates unique hostnames even when multiple machines share a role', () => {
    // Hard difficulty produces 4-6 internal machines, increasing duplicate role likelihood
    const seeds = Array.from({ length: 30 }, (_, i) => `hostname-unique-${i}`);
    const difficulties: readonly Difficulty[] = ['hard', 'medium', 'easy'];

    for (const seed of seeds) {
      for (const difficulty of difficulties) {
        const result = generateTopology(createPrng(seed), difficulty);
        const hostnames = result.machines.map((m) => m.hostname);
        const unique = new Set(hostnames);
        expect(unique.size).toBe(hostnames.length);
      }
    }
  });

  it('internal subnets never collide with static 192.168.1.x network', () => {
    Array.from({ length: 50 }, (_, i) => {
      const result = generateTopology(createPrng(`collision-${i}`), 'medium');
      result.machines.forEach((m) => {
        expect(m.ip).not.toMatch(/^192\.168\.1\./);
      });
    });
  });

  // accessVariant tests
  it('every machine has an accessVariant field', () => {
    const result = generateTopology(createPrng('variant-test'), 'medium');
    result.machines.forEach((m) => {
      expect(m.accessVariant).toBeDefined();
      expect(['ssh', 'ftp', 'nc', 'exploit', 'http']).toContain(m.accessVariant);
    });
    expect(result.routerMachine.accessVariant).toBeDefined();
  });

  it('in forwarded mode, entry machine accessVariant matches entryVariant', () => {
    // In forwarded mode, the entry machine IS the player-facing entry point
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`entry-var-${i}`), 'easy'),
    );
    results
      .filter((r) => r.natForwarding !== undefined)
      .forEach((r) => {
        const entry = r.machines.find((m) => m.ip === r.entryPoint);
        expect(entry?.accessVariant).toBe(r.entryVariant);
      });
  });

  it('in router-first mode, router accessVariant matches entryVariant', () => {
    // In router-first mode, the router IS the player-facing entry point
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`router-var-${i}`), 'hard'),
    );
    results.forEach((r) => {
      expect(r.routerMachine.accessVariant).toBe(r.entryVariant);
    });
  });

  it('accessVariant is deterministic for the same seed', () => {
    const a = generateTopology(createPrng('det-variant'), 'medium');
    const b = generateTopology(createPrng('det-variant'), 'medium');
    a.machines.forEach((m, i) => {
      expect(m.accessVariant).toBe(b.machines[i]?.accessVariant);
    });
    expect(a.routerMachine.accessVariant).toBe(b.routerMachine.accessVariant);
  });

  it('non-entry machines have varied accessVariants across seeds', () => {
    const variants = new Set<string>();
    Array.from({ length: 30 }, (_, i) => {
      const result = generateTopology(createPrng(`variety-${i}`), 'hard');
      result.machines
        .filter((m) => m.ip !== result.entryPoint)
        .forEach((m) => variants.add(m.accessVariant));
    });
    // With 5 possible variants and 30 seeds (hard = 4-6 machines each), expect at least 3
    expect(variants.size).toBeGreaterThanOrEqual(3);
  });
});
