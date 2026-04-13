import { describe, it, expect } from 'vitest';
import { createPrng } from './prng';
import { generateTopology, generateSubnetLayer } from './topology';
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

  it('generates 5-7 machines for medium difficulty (2 layers + gateway)', () => {
    const counts = Array.from({ length: 20 }, (_, i) => {
      const result = generateTopology(createPrng(`medium-${i}`), 'medium');
      return result.machines.length;
    });
    counts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(5);
      expect(c).toBeLessThanOrEqual(7);
    });
  });

  it('generates 8-11 machines for hard difficulty (3 layers + 2 gateways)', () => {
    const counts = Array.from({ length: 20 }, (_, i) => {
      const result = generateTopology(createPrng(`hard-${i}`), 'hard');
      return result.machines.length;
    });
    counts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(8);
      expect(c).toBeLessThanOrEqual(11);
    });
  });

  it('assigns unique IPs within each subnet layer with valid last octets', () => {
    const result = generateTopology(createPrng('ip-test'), 'hard');
    // Group machines by subnet prefix (first 3 octets)
    const bySubnet = new Map<string, string[]>();
    result.machines.forEach((m) => {
      const parts = m.ip.split('.');
      const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
      const existing = bySubnet.get(subnet) ?? [];
      bySubnet.set(subnet, [...existing, m.ip]);
    });

    // Each subnet should have unique last octets in valid range
    bySubnet.forEach((ips) => {
      const lastOctets = ips.map((ip) => Number(ip.split('.')[3]));
      lastOctets.forEach((o) => {
        expect(o).toBeGreaterThanOrEqual(2);
        expect(o).toBeLessThanOrEqual(254);
      });
      expect(new Set(lastOctets).size).toBe(lastOctets.length);
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

  it('generates per-layer DNS records for machines in each layer', () => {
    const result = generateTopology(createPrng('dns-test'), 'easy');
    const layer0 = result.layers[0]!;
    const firstMachineConfig = result.networkConfig.machineConfigs[layer0.machines[0]!.ip];

    // Layer 0 machines should have DNS records for their layer peers + gateway
    layer0.machines.forEach((m) => {
      const dns = firstMachineConfig?.dnsRecords.find((d) => d.ip === m.ip);
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
    });
  });

  it('generates valid network interfaces for each internal machine', () => {
    const result = generateTopology(createPrng('iface-test'), 'medium');
    // Non-gateway machines have 1 interface; gateways have 2 (tested separately)
    result.machines
      .filter((m) => m.role !== 'router')
      .forEach((m) => {
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

  it('router can see layer 0 machines and first gateway', () => {
    const result = generateTopology(createPrng('router-sees'), 'medium');
    const routerConfig = result.networkConfig.machineConfigs[result.routerPublicIp];
    const layer0 = result.layers[0]!;

    // Router sees layer 0 machines
    layer0.machines.forEach((m) => {
      const found = routerConfig?.machines.find((rm) => rm.ip === m.ip);
      expect(found).toBeDefined();
    });

    // For multi-layer, router also sees the first gateway
    if (result.layers.length > 1) {
      const gateway = result.layers[1]!.gateway;
      const found = routerConfig?.machines.find((rm) => rm.ip === gateway.ip);
      expect(found).toBeDefined();
    }

    // Router does NOT see deeper layer machines
    if (result.layers.length > 1) {
      result.layers[1]!.machines.forEach((m) => {
        const found = routerConfig?.machines.find((rm) => rm.ip === m.ip);
        expect(found).toBeUndefined();
      });
    }
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

  it('hard difficulty always produces router-first mode for border router', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      generateTopology(createPrng(`hard-fwd-${i}`), 'hard'),
    );
    results.forEach((r) => {
      expect(r.natForwarding).toBeUndefined();
    });
  });

  it('hard difficulty inner layers can have forwarded mode', () => {
    let foundForwarded = false;
    for (let i = 0; i < 50; i++) {
      const result = generateTopology(createPrng(`hard-inner-fwd-${i}`), 'hard');
      // Border router is always router-first on hard
      expect(result.natForwarding).toBeUndefined();
      // Inner layers may have forwarding (30% chance on hard)
      for (let j = 1; j < result.layers.length; j++) {
        if (result.layers[j]!.isForwarded) {
          foundForwarded = true;
        }
      }
    }
    expect(foundForwarded).toBe(true);
  });

  it('forwarded mode sets natForwarding with port-level rules', () => {
    // Search for a seed that produces forwarded mode
    let found = false;
    for (let i = 0; i < 50; i++) {
      const result = generateTopology(createPrng(`fwd-${i}`), 'easy');
      if (result.natForwarding) {
        expect(result.natForwarding.publicIp).toBe(result.routerPublicIp);
        expect(result.natForwarding.rules.length).toBeGreaterThan(0);
        result.natForwarding.rules.forEach((rule) => {
          expect(rule.internalIp).toBe(result.entryPoint);
        });
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

  it('router DNS record in network config uses public IP, not internal gateway IP', () => {
    const result = generateTopology(createPrng('router-dns'), 'medium');
    const routerConfig = result.networkConfig.machineConfigs[result.routerPublicIp];
    const routerDns = routerConfig?.dnsRecords.find((r) =>
      r.domain.includes(result.routerMachine.hostname),
    );
    expect(routerDns?.ip).toBe(result.routerPublicIp);
  });

  it('layer 0 machines resolve router hostname to internal gateway IP', () => {
    const result = generateTopology(createPrng('layer0-dns'), 'hard');
    const layer0Subnet = result.layers[0]!.subnet;
    const internalGatewayIp = `${layer0Subnet}.1`;
    const layer0Machines = result.layers[0]!.machines;
    for (const machine of layer0Machines) {
      const config = result.networkConfig.machineConfigs[machine.ip];
      const routerDns = config?.dnsRecords.find((r) =>
        r.domain.includes(result.routerMachine.hostname),
      );
      expect(routerDns?.ip).toBe(internalGatewayIp);
    }
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

  // Variant-specific port tests
  it('NC variant machines have a backdoor port with elite service', () => {
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`nc-port-${i}`), 'hard'),
    );
    const ncMachines = results.flatMap((r) => r.machines).filter((m) => m.accessVariant === 'nc');
    expect(ncMachines.length).toBeGreaterThan(0);
    ncMachines.forEach((m) => {
      const backdoor = m.remoteMachine.ports.find((p) => p.service === 'elite' && p.open);
      expect(backdoor).toBeDefined();
      expect([4444, 31337, 8888, 1337, 9999, 5555, 6666, 1234]).toContain(backdoor?.port);
    });
  });

  it('FTP variant machines have port 21 open', () => {
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`ftp-port-${i}`), 'hard'),
    );
    const ftpMachines = results.flatMap((r) => r.machines).filter((m) => m.accessVariant === 'ftp');
    expect(ftpMachines.length).toBeGreaterThan(0);
    ftpMachines.forEach((m) => {
      const ftpPort = m.remoteMachine.ports.find((p) => p.port === 21);
      expect(ftpPort).toBeDefined();
      expect(ftpPort?.open).toBe(true);
    });
  });

  it('HTTP variant machines have an HTTP-like port open', () => {
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`http-port-${i}`), 'hard'),
    );
    const httpMachines = results
      .flatMap((r) => r.machines)
      .filter((m) => m.accessVariant === 'http');
    expect(httpMachines.length).toBeGreaterThan(0);
    httpMachines.forEach((m) => {
      const httpPort = m.remoteMachine.ports.find(
        (p) =>
          p.open && (p.service === 'http' || p.service === 'https' || p.service === 'http-alt'),
      );
      expect(httpPort).toBeDefined();
    });
  });

  it('exploit variant machines have a port matching a vulnerability template', () => {
    const vulnerablePorts = [
      21, 25, 53, 80, 110, 143, 445, 502, 873, 1194, 1883, 3306, 5432, 5900, 6379, 8080, 8443, 9200,
      27017,
    ];
    const results = Array.from({ length: 30 }, (_, i) =>
      generateTopology(createPrng(`exploit-port-${i}`), 'hard'),
    );
    const exploitMachines = results
      .flatMap((r) => r.machines)
      .filter((m) => m.accessVariant === 'exploit');
    expect(exploitMachines.length).toBeGreaterThan(0);
    exploitMachines.forEach((m) => {
      const hasVulnPort = m.remoteMachine.ports.some(
        (p) => vulnerablePorts.includes(p.port) && p.open,
      );
      expect(hasVulnPort).toBe(true);
    });
  });

  it('all machines still have SSH port 22', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      generateTopology(createPrng(`ssh-still-${i}`), 'hard'),
    );
    results
      .flatMap((r) => r.machines)
      .forEach((m) => {
        const sshPort = m.remoteMachine.ports.find((p) => p.port === 22);
        expect(sshPort).toBeDefined();
      });
  });

  // accessVariant tests
  it('dns role can appear as a non-entry machine', () => {
    let foundDns = false;
    for (let i = 0; i < 100; i++) {
      const result = generateTopology(createPrng(`dns-role-${i}`), 'hard');
      if (result.machines.some((m) => m.role === 'dns')) {
        foundDns = true;
        // DNS machines should never be entry points
        const dnsMachine = result.machines.find((m) => m.role === 'dns')!;
        expect(dnsMachine.ip).not.toBe(result.entryPoint);
        break;
      }
    }
    expect(foundDns).toBe(true);
  });

  it('dns machines have port 53 (UDP) open and port 22 (SSH) open', () => {
    let tested = false;
    for (let i = 0; i < 100; i++) {
      const result = generateTopology(createPrng(`dns-ports-${i}`), 'hard');
      const dns = result.machines.find((m) => m.role === 'dns');
      if (dns) {
        const dnsPort = dns.remoteMachine.ports.find((p) => p.port === 53);
        expect(dnsPort).toBeDefined();
        expect(dnsPort?.open).toBe(true);
        expect(dnsPort?.protocol).toBe('udp');
        expect(dnsPort?.service).toBe('dns');
        const sshPort = dns.remoteMachine.ports.find((p) => p.port === 22);
        expect(sshPort).toBeDefined();
        expect(sshPort?.open).toBe(true);
        tested = true;
        break;
      }
    }
    expect(tested).toBe(true);
  });

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

  it('SNMP entry variant produces router with filtered TCP and open UDP 161', () => {
    const result = generateTopology(createPrng('snmp-test'), 'hard', {
      entryVariantOverride: 'snmp',
    });

    // Router-first mode (hard = always router-first)
    expect(result.natForwarding).toBeUndefined();
    expect(result.entryVariant).toBe('snmp');
    expect(result.routerMachine.accessVariant).toBe('snmp');

    // Router should have SSH closed and SNMP UDP 161 open
    const sshPort = result.routerMachine.remoteMachine.ports.find((p) => p.port === 22);
    const snmpPort = result.routerMachine.remoteMachine.ports.find((p) => p.port === 161);
    expect(sshPort?.open).toBe(false);
    expect(snmpPort?.open).toBe(true);
    expect(snmpPort?.protocol).toBe('udp');
    expect(snmpPort?.service).toBe('snmp');
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

  it('avoids public IPs in the usedIps override', () => {
    const seed = 'used-ips-test';
    const result1 = generateTopology(createPrng(seed), 'medium');
    const blocked = new Set([result1.routerPublicIp]);
    const result2 = generateTopology(createPrng(seed), 'medium', { usedIps: blocked });
    expect(result2.routerPublicIp).not.toBe(result1.routerPublicIp);
  });

  // SubnetLayer tests
  describe('layers', () => {
    it('easy has 1 layer, medium has 2, hard has 3', () => {
      expect(generateTopology(createPrng('layers-e'), 'easy').layers).toHaveLength(1);
      expect(generateTopology(createPrng('layers-m'), 'medium').layers).toHaveLength(2);
      expect(generateTopology(createPrng('layers-h'), 'hard').layers).toHaveLength(3);
    });

    it('each layer has a unique subnet prefix', () => {
      const result = generateTopology(createPrng('unique-subnets'), 'hard');
      const subnets = result.layers.map((l) => l.subnet);
      expect(new Set(subnets).size).toBe(subnets.length);
    });

    it('layer machines have IPs on their own subnet', () => {
      const result = generateTopology(createPrng('layer-ips'), 'hard');
      result.layers.forEach((layer) => {
        layer.machines.forEach((m) => {
          expect(m.ip.startsWith(`${layer.subnet}.`)).toBe(true);
        });
      });
    });

    it('each layer has 2-3 machines (excluding gateways)', () => {
      const results = Array.from({ length: 20 }, (_, i) =>
        generateTopology(createPrng(`per-layer-${i}`), 'hard'),
      );
      results.forEach((r) => {
        r.layers.forEach((layer) => {
          expect(layer.machines.length).toBeGreaterThanOrEqual(2);
          expect(layer.machines.length).toBeLessThanOrEqual(3);
        });
      });
    });

    it('layer 0 gateway is the outer router', () => {
      const result = generateTopology(createPrng('layer0-gw'), 'medium');
      expect(result.layers[0]!.gateway.ip).toBe(result.routerPublicIp);
      expect(result.layers[0]!.gateway.role).toBe('router');
    });

    it('inner layer gateways are router-role machines on the upstream subnet', () => {
      const result = generateTopology(createPrng('inner-gw'), 'hard');
      for (let i = 1; i < result.layers.length; i++) {
        const gateway = result.layers[i]!.gateway;
        const upstreamSubnet = result.layers[i - 1]!.subnet;
        expect(gateway.role).toBe('router');
        expect(gateway.ip.startsWith(`${upstreamSubnet}.`)).toBe(true);
      }
    });

    it('inner gateways have dual interfaces (upstream eth0, downstream eth1)', () => {
      const result = generateTopology(createPrng('gw-ifaces'), 'hard');
      for (let i = 1; i < result.layers.length; i++) {
        const gateway = result.layers[i]!.gateway;
        const downstreamSubnet = result.layers[i]!.subnet;
        const config = result.networkConfig.machineConfigs[gateway.ip];
        expect(config).toBeDefined();
        expect(config?.interfaces).toHaveLength(2);
        expect(config?.interfaces[0]?.name).toBe('eth0');
        expect(config?.interfaces[1]?.name).toBe('eth1');
        expect(config?.interfaces[1]?.inet).toBe(`${downstreamSubnet}.1`);
      }
    });

    it('inner gateways can see machines from both adjacent layers', () => {
      const result = generateTopology(createPrng('gw-visibility'), 'hard');
      for (let i = 1; i < result.layers.length; i++) {
        const gateway = result.layers[i]!.gateway;
        const upstreamLayer = result.layers[i - 1]!;
        const downstreamLayer = result.layers[i]!;
        const config = result.networkConfig.machineConfigs[gateway.ip];
        const visibleIps = config?.machines.map((rm) => rm.ip) ?? [];

        // Gateway sees upstream layer machines
        upstreamLayer.machines.forEach((m) => {
          expect(visibleIps).toContain(m.ip);
        });
        // Gateway sees downstream layer machines
        downstreamLayer.machines.forEach((m) => {
          expect(visibleIps).toContain(m.ip);
        });
      }
    });

    it('machines in one layer cannot see machines in other layers', () => {
      const result = generateTopology(createPrng('isolation'), 'hard');
      for (let i = 0; i < result.layers.length; i++) {
        const layer = result.layers[i]!;
        for (const machine of layer.machines) {
          const config = result.networkConfig.machineConfigs[machine.ip];
          const visibleIps = config?.machines.map((rm) => rm.ip) ?? [];

          // Should NOT see machines from other layers (only gateways connect them)
          for (let j = 0; j < result.layers.length; j++) {
            if (j === i) continue;
            result.layers[j]!.machines.forEach((m) => {
              expect(visibleIps).not.toContain(m.ip);
            });
          }
        }
      }
    });

    it('layer 0 entryVariant matches topology entryVariant', () => {
      const result = generateTopology(createPrng('entry-var'), 'medium');
      expect(result.layers[0]!.entryVariant).toBe(result.entryVariant);
    });

    it('entry point is on layer 0', () => {
      const result = generateTopology(createPrng('entry-layer0'), 'hard');
      const layer0Ips = result.layers[0]!.machines.map((m) => m.ip);
      expect(layer0Ips).toContain(result.entryPoint);
    });

    it('outermost layer isForwarded matches natForwarding presence', () => {
      const results = Array.from({ length: 30 }, (_, i) =>
        generateTopology(createPrng(`layer-fwd-${i}`), 'easy'),
      );
      results.forEach((r) => {
        expect(r.layers[0]!.isForwarded).toBe(r.natForwarding !== undefined);
      });
    });

    it('inner gateway machines are included in the flat machines array', () => {
      const result = generateTopology(createPrng('flat-gw'), 'hard');
      for (let i = 1; i < result.layers.length; i++) {
        const gateway = result.layers[i]!.gateway;
        const found = result.machines.find((m) => m.ip === gateway.ip);
        expect(found).toBeDefined();
      }
    });

    it('layers are deterministic for the same seed', () => {
      const a = generateTopology(createPrng('layer-det'), 'hard');
      const b = generateTopology(createPrng('layer-det'), 'hard');
      expect(a.layers).toEqual(b.layers);
    });

    it('all hostnames are unique across all layers and gateways', () => {
      const results = Array.from({ length: 20 }, (_, i) =>
        generateTopology(createPrng(`host-uniq-${i}`), 'hard'),
      );
      results.forEach((r) => {
        const allHostnames = [...r.machines.map((m) => m.hostname), r.routerMachine.hostname];
        expect(new Set(allHostnames).size).toBe(allHostnames.length);
      });
    });
  });
});

describe('generateSubnetLayer', () => {
  const makeConfig = (overrides: Partial<Parameters<typeof generateSubnetLayer>[1]> = {}) => ({
    minMachines: 2,
    maxMachines: 3,
    difficulty: 'medium' as Difficulty,
    isOuterLayer: true,
    usedSubnets: new Set<string>(),
    usedHostnames: new Set<string>(),
    ...overrides,
  });

  it('produces deterministic output for the same seed', () => {
    const a = generateSubnetLayer(createPrng('subnet-det'), makeConfig());
    const b = generateSubnetLayer(createPrng('subnet-det'), makeConfig());
    expect(a).toEqual(b);
  });

  it('produces different output for different seeds', () => {
    const a = generateSubnetLayer(createPrng('subnet-alpha'), makeConfig());
    const b = generateSubnetLayer(createPrng('subnet-beta'), makeConfig());
    expect(a.subnet).not.toBe(b.subnet);
  });

  it('generates machine count within [min, max] range', () => {
    const counts = Array.from({ length: 30 }, (_, i) => {
      const result = generateSubnetLayer(
        createPrng(`count-${i}`),
        makeConfig({
          minMachines: 2,
          maxMachines: 4,
        }),
      );
      return result.machines.length;
    });
    counts.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(2);
      expect(c).toBeLessThanOrEqual(4);
    });
  });

  it('generates machines with IPs on the returned subnet', () => {
    const result = generateSubnetLayer(createPrng('subnet-ips'), makeConfig());
    result.machines.forEach((m) => {
      expect(m.ip.startsWith(`${result.subnet}.`)).toBe(true);
    });
  });

  it('entryPoint is the first machine IP', () => {
    const result = generateSubnetLayer(createPrng('subnet-entry'), makeConfig());
    expect(result.entryPoint).toBe(result.machines[0]?.ip);
  });

  it('entry machine is a webserver or workstation', () => {
    const results = Array.from({ length: 20 }, (_, i) =>
      generateSubnetLayer(createPrng(`entry-role-${i}`), makeConfig()),
    );
    results.forEach((r) => {
      const entry = r.machines.find((m) => m.ip === r.entryPoint);
      expect(['webserver', 'workstation']).toContain(entry?.role);
    });
  });

  it('avoids subnets in usedSubnets set', () => {
    const first = generateSubnetLayer(createPrng('avoid-subnet'), makeConfig());
    const second = generateSubnetLayer(
      createPrng('avoid-subnet'),
      makeConfig({
        usedSubnets: new Set([first.subnet]),
      }),
    );
    expect(second.subnet).not.toBe(first.subnet);
  });

  it('shares usedHostnames across calls to prevent duplicates', () => {
    const shared = new Set<string>();
    const a = generateSubnetLayer(
      createPrng('host-share-a'),
      makeConfig({
        usedHostnames: shared,
      }),
    );
    const b = generateSubnetLayer(
      createPrng('host-share-b'),
      makeConfig({
        usedHostnames: shared,
      }),
    );
    const allHostnames = [...a.machines, ...b.machines].map((m) => m.hostname);
    expect(new Set(allHostnames).size).toBe(allHostnames.length);
  });

  it('returns gatewayPorts array', () => {
    const result = generateSubnetLayer(createPrng('gw-ports'), makeConfig());
    expect(result.gatewayPorts).toBeDefined();
    expect(result.gatewayPorts.length).toBeGreaterThan(0);
  });

  it('returns a valid entryVariant', () => {
    const result = generateSubnetLayer(createPrng('variant'), makeConfig());
    expect(['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp']).toContain(result.entryVariant);
  });

  it('returns isForwarded boolean', () => {
    const result = generateSubnetLayer(createPrng('fwd'), makeConfig());
    expect(typeof result.isForwarded).toBe('boolean');
  });

  it('respects entryVariantOverride', () => {
    const result = generateSubnetLayer(
      createPrng('override'),
      makeConfig({
        entryVariantOverride: 'http',
      }),
    );
    expect(result.entryVariant).toBe('http');
  });

  it('respects forwardedOverride', () => {
    const forwarded = generateSubnetLayer(
      createPrng('fwd-override'),
      makeConfig({
        forwardedOverride: true,
      }),
    );
    expect(forwarded.isForwarded).toBe(true);

    const routerFirst = generateSubnetLayer(
      createPrng('fwd-override'),
      makeConfig({
        forwardedOverride: false,
      }),
    );
    expect(routerFirst.isForwarded).toBe(false);
  });
});

describe('generateTopology — router firmware assignment', () => {
  it('assigns a firmwareVendor to every router-role machine', () => {
    const result = generateTopology(createPrng('firmware-routers'), 'medium');
    const routers = result.machines.filter((m) => m.role === 'router');
    expect(routers.length).toBeGreaterThan(0);
    for (const router of routers) {
      expect(router.remoteMachine.firmwareVendor).toBeDefined();
    }
  });

  it('leaves non-router machines without a firmwareVendor', () => {
    const result = generateTopology(createPrng('firmware-nonrouters'), 'hard');
    const nonRouters = result.machines.filter((m) => m.role !== 'router');
    expect(nonRouters.length).toBeGreaterThan(0);
    for (const machine of nonRouters) {
      expect(machine.remoteMachine.firmwareVendor).toBeUndefined();
    }
  });

  it('assigns different vendors across routers in different seeds (not hardcoded)', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => `fw-variety-${i}`);
    const vendors = new Set<string>();
    for (const seed of seeds) {
      const result = generateTopology(createPrng(seed), 'medium');
      const router = result.machines.find((m) => m.role === 'router');
      if (router?.remoteMachine.firmwareVendor) {
        vendors.add(router.remoteMachine.firmwareVendor);
      }
    }
    // With 6 vendors and 20 seeds, we should see at least 3 distinct values
    expect(vendors.size).toBeGreaterThanOrEqual(3);
  });
});
