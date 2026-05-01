import { describe, it, expect, vi } from 'vitest';
import { generateHomeNetwork, homeNetworkSeed } from './generateHomeNetwork';

// Helper: derive a single-player-style seed from gameSeed + wifiIndex.
const seedOf = (gameSeed: string, wifiIndex: number) => homeNetworkSeed(gameSeed, wifiIndex);

describe('generateHomeNetwork', () => {
  it('produces deterministic output for the same seed and essid', async () => {
    const a = await generateHomeNetwork({ seed: seedOf('seed-a', 0), essid: 'NET-A' });
    const b = await generateHomeNetwork({ seed: seedOf('seed-a', 0), essid: 'NET-A' });
    expect(a.router.publicIp).toBe(b.router.publicIp);
    expect(a.machines.length).toBe(b.machines.length);
    expect(a.layers.length).toBe(b.layers.length);
    expect(a.difficulty).toBe(b.difficulty);
  });

  it('produces different output for different seeds', async () => {
    const a = await generateHomeNetwork({ seed: seedOf('seed-a', 0), essid: 'NET-A' });
    const b = await generateHomeNetwork({ seed: seedOf('seed-b', 0), essid: 'NET-B' });
    expect(a.router.publicIp).not.toBe(b.router.publicIp);
  });

  it('produces different output for different WiFi indices via the seed helper', async () => {
    const a = await generateHomeNetwork({ seed: seedOf('same-seed', 0), essid: 'NET-0' });
    const b = await generateHomeNetwork({ seed: seedOf('same-seed', 1), essid: 'NET-1' });
    expect(a.router.publicIp).not.toBe(b.router.publicIp);
  });

  it('has a router with a public IP outside the private ranges', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('test', 0), essid: 'TEST' });
    expect(network.router.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(network.router.publicIp).not.toMatch(/^10\./);
    expect(network.router.publicIp).not.toMatch(/^192\.168\./);
    expect(network.router.publicIp).not.toMatch(/^172\.(1[6-9]|2\d|3[01])\./);
  });

  it('has unique IPs across all machines', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('unique-ip', 0), essid: 'TEST' });
    const ips = network.machines.map((m) => m.ip);
    expect(new Set(ips).size).toBe(ips.length);
  });

  it('defaults localhostIp to .100 in the outermost subnet when slotIp is not provided', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('test', 0), essid: 'TEST' });
    const layer0Subnet = network.layers[0]!.subnet;
    expect(network.localhostIp).toBe(`${layer0Subnet}.100`);
  });

  it('uses the supplied slotIp for localhostIp instead of the default .100', async () => {
    const network = await generateHomeNetwork({
      seed: seedOf('slot-ip-test', 0),
      essid: 'TEST',
      slotIp: '.187',
    });
    const layer0Subnet = network.layers[0]!.subnet;
    expect(network.localhostIp).toBe(`${layer0Subnet}.187`);
  });

  it('exposes the supplied hostname on the returned network', async () => {
    const network = await generateHomeNetwork({
      seed: seedOf('hostname-test', 0),
      essid: 'TEST',
      hostname: 'skylab-9k3',
    });
    expect(network.hostname).toBe('skylab-9k3');
  });

  it('leaves hostname undefined when none is supplied (single-player path)', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('no-hostname', 0), essid: 'TEST' });
    expect(network.hostname).toBeUndefined();
  });

  it('uses the supplied routerPublicIp instead of the PRNG-derived one (multiplayer path)', async () => {
    // The multiplayer join handler stores the router IP in
    // home_networks.public_ip. The client must derive network.router.publicIp
    // from that server value, not from the local PRNG — otherwise
    // home_network_occupants lookups (keyed on network_id = public_ip)
    // miss with the wrong IP, and any cross-player WAN-side flow
    // (curl/nmap to the public router IP) targets the wrong host.
    const network = await generateHomeNetwork({
      seed: seedOf('mp-test', 0),
      essid: 'TEST',
      routerPublicIp: '45.112.92.132',
    });
    expect(network.router.publicIp).toBe('45.112.92.132');
  });

  it('routerPublicIp override takes precedence over allocateIp callback', async () => {
    // If both seams are wired (rare but possible), the explicit override
    // wins — the server-allocated IP is the canonical truth.
    const allocateIp = vi.fn(async () => 'wrong.allocator.value');
    const network = await generateHomeNetwork({
      seed: seedOf('mp-precedence', 0),
      essid: 'TEST',
      routerPublicIp: '45.112.92.132',
      allocateIp,
    });
    expect(network.router.publicIp).toBe('45.112.92.132');
    expect(allocateIp).not.toHaveBeenCalled();
  });

  it('two clients with the same seed but the same routerPublicIp see the same router', async () => {
    // The bug this fix addresses: two players on the same LAN have the
    // same seed (`home-${publicIp}`) but were getting their own PRNG-
    // derived router IP, which differed from the server's stored
    // public_ip. Passing the server's public_ip as the override aligns
    // both clients with each other AND with the home_networks row.
    const a = await generateHomeNetwork({
      seed: 'home-45.112.92.132',
      essid: 'TEST',
      routerPublicIp: '45.112.92.132',
    });
    const b = await generateHomeNetwork({
      seed: 'home-45.112.92.132',
      essid: 'TEST',
      routerPublicIp: '45.112.92.132',
    });
    expect(a.router.publicIp).toBe('45.112.92.132');
    expect(b.router.publicIp).toBe('45.112.92.132');
  });

  it('stores essid', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('test', 0), essid: 'MY-WIFI' });
    expect(network.essid).toBe('MY-WIFI');
  });

  it('generates network configs for all machines + router', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('config-test', 0), essid: 'TEST' });
    for (const machine of network.machines) {
      expect(network.networkConfig.machineConfigs[machine.ip]).toBeDefined();
    }
    expect(network.networkConfig.machineConfigs[network.router.publicIp]).toBeDefined();
    expect(network.networkConfig.machineConfigs[network.router.internalIp]).toBeDefined();
  });

  it('generates filesystems for all machines + router', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('fs-test', 0), essid: 'TEST' });
    for (const machine of network.machines) {
      expect(network.fileSystems[machine.ip]).toBeDefined();
      expect(network.fileSystems[machine.ip]!.type).toBe('directory');
    }
    expect(network.fileSystems[network.router.publicIp]).toBeDefined();
    expect(network.fileSystems[network.router.internalIp]).toBeDefined();
  });

  it('has machines with users', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('users-test', 0), essid: 'TEST' });
    for (const machine of network.machines) {
      expect(machine.remoteMachine.users.length).toBeGreaterThanOrEqual(2);
      expect(machine.remoteMachine.users.some((u) => u.userType === 'root')).toBe(true);
    }
  });

  it('sets a serviceVersion on every port of every generated machine', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('version-audit', 0), essid: 'TEST' });
    const allMachines = [network.routerMachine, ...network.machines];
    for (const machine of allMachines) {
      for (const port of machine.remoteMachine.ports) {
        expect(port.serviceVersion).toBeDefined();
        expect(typeof port.serviceVersion).toBe('string');
        expect(port.serviceVersion.length).toBeGreaterThan(0);
      }
    }
  });

  it('avoids public IPs in the usedIps set', async () => {
    const network = await generateHomeNetwork({
      seed: seedOf('collision-seed', 0),
      essid: 'NET-0',
    });
    const blocked = new Set([network.router.publicIp]);
    const network2 = await generateHomeNetwork({
      seed: seedOf('collision-seed', 0),
      essid: 'NET-0',
      usedIps: blocked,
    });
    expect(network2.router.publicIp).not.toBe(network.router.publicIp);
  });

  it('produces unique public IPs across multiple WiFi indices', async () => {
    const publicIps = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const network = await generateHomeNetwork({
        seed: seedOf('multi-wifi', i),
        essid: `NET-${i}`,
        usedIps: publicIps,
      });
      expect(publicIps).not.toContain(network.router.publicIp);
      publicIps.add(network.router.publicIp);
    }
    expect(publicIps.size).toBe(10);
  });

  it('has DNS records for layer machines', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('dns-test', 0), essid: 'TEST' });
    const layer0 = network.layers[0]!;
    const sampleIp = layer0.machines[0]?.ip ?? '';
    const sampleConfig = network.networkConfig.machineConfigs[sampleIp];
    expect(sampleConfig).toBeDefined();
    expect(sampleConfig!.dnsRecords.length).toBeGreaterThanOrEqual(1);
  });

  it('has layers based on difficulty', async () => {
    const layerCounts = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const network = await generateHomeNetwork({
        seed: seedOf(`layer-seed-${i}`, 0),
        essid: 'TEST',
      });
      layerCounts.add(network.layers.length);
      expect(network.layers.length).toBeGreaterThanOrEqual(1);
      expect(network.layers.length).toBeLessThanOrEqual(3);
    }
    expect(layerCounts.size).toBeGreaterThanOrEqual(2);
  });

  it('has machines with access variants', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('variant-test', 0), essid: 'TEST' });
    for (const machine of network.machines) {
      expect(machine.accessVariant).toBeDefined();
      expect(['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp']).toContain(machine.accessVariant);
    }
  });

  it('has an entry variant and entry point', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('entry-test', 0), essid: 'TEST' });
    expect(network.entryVariant).toBeDefined();
    expect(['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp']).toContain(network.entryVariant);
    expect(network.entryPoint).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('has a routerMachine with users', async () => {
    const network = await generateHomeNetwork({ seed: seedOf('router-test', 0), essid: 'TEST' });
    expect(network.routerMachine).toBeDefined();
    expect(network.routerMachine.role).toBe('router');
    expect(network.routerMachine.remoteMachine.users.length).toBeGreaterThanOrEqual(1);
  });

  it('aliases inner gateway configs under downstream .1 IPs for multi-layer networks', async () => {
    for (let i = 0; i < 50; i++) {
      const network = await generateHomeNetwork({
        seed: seedOf(`gateway-alias-${i}`, 0),
        essid: 'TEST',
      });
      if (network.layers.length > 1) {
        const layer1 = network.layers[1]!;
        const downstreamGatewayIp = `${layer1.subnet}.1`;
        expect(network.networkConfig.machineConfigs[downstreamGatewayIp]).toBeDefined();
        expect(network.fileSystems[downstreamGatewayIp]).toBeDefined();
        return;
      }
    }
  });

  it('uses allocator-returned IP when allocateIp is provided', async () => {
    const allocated = '198.50.51.52';
    const allocateIp = vi
      .fn<(kind: 'home_network') => Promise<string>>()
      .mockResolvedValue(allocated);
    const network = await generateHomeNetwork({
      seed: seedOf('alloc-home', 0),
      essid: 'NET',
      allocateIp,
    });
    expect(network.router.publicIp).toBe(allocated);
    expect(network.routerMachine.ip).toBe(allocated);
    expect(allocateIp).toHaveBeenCalledWith('home_network');
  });

  it('falls back to PRNG roll when allocateIp is omitted (single-player default)', async () => {
    const a = await generateHomeNetwork({ seed: seedOf('no-alloc-home', 0), essid: 'NET' });
    const b = await generateHomeNetwork({ seed: seedOf('no-alloc-home', 0), essid: 'NET' });
    expect(a.router.publicIp).toBe(b.router.publicIp);
  });
});

describe('homeNetworkSeed', () => {
  it('builds a stable seed for the (gameSeed, wifiIndex) pair', () => {
    expect(homeNetworkSeed('alpha', 0)).toBe(homeNetworkSeed('alpha', 0));
  });

  it('changes when gameSeed changes', () => {
    expect(homeNetworkSeed('alpha', 0)).not.toBe(homeNetworkSeed('beta', 0));
  });

  it('changes when wifiIndex changes', () => {
    expect(homeNetworkSeed('alpha', 0)).not.toBe(homeNetworkSeed('alpha', 1));
  });
});
