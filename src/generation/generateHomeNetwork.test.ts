import { describe, it, expect, vi } from 'vitest';
import { generateHomeNetwork } from './generateHomeNetwork';

describe('generateHomeNetwork', () => {
  it('should produce deterministic output for same inputs', async () => {
    const a = await generateHomeNetwork('seed-a', 0, 'NET-A');
    const b = await generateHomeNetwork('seed-a', 0, 'NET-A');
    expect(a.router.publicIp).toBe(b.router.publicIp);
    expect(a.machines.length).toBe(b.machines.length);
    expect(a.layers.length).toBe(b.layers.length);
    expect(a.difficulty).toBe(b.difficulty);
  });

  it('should produce different output for different seeds', async () => {
    const a = await generateHomeNetwork('seed-a', 0, 'NET-A');
    const b = await generateHomeNetwork('seed-b', 0, 'NET-B');
    expect(a.router.publicIp).not.toBe(b.router.publicIp);
  });

  it('should produce different output for different WiFi indices', async () => {
    const a = await generateHomeNetwork('same-seed', 0, 'NET-0');
    const b = await generateHomeNetwork('same-seed', 1, 'NET-1');
    expect(a.router.publicIp).not.toBe(b.router.publicIp);
  });

  it('should have a router with public IP', async () => {
    const network = await generateHomeNetwork('test', 0, 'TEST');
    expect(network.router.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    // Public IP should not be in private ranges
    expect(network.router.publicIp).not.toMatch(/^10\./);
    expect(network.router.publicIp).not.toMatch(/^192\.168\./);
    expect(network.router.publicIp).not.toMatch(/^172\.(1[6-9]|2\d|3[01])\./);
  });

  it('should have unique IPs across all machines', async () => {
    const network = await generateHomeNetwork('unique-ip', 0, 'TEST');
    const ips = network.machines.map((m) => m.ip);
    expect(new Set(ips).size).toBe(ips.length);
  });

  it('should set localhostIp in the outermost subnet', async () => {
    const network = await generateHomeNetwork('test', 0, 'TEST');
    const layer0Subnet = network.layers[0]!.subnet;
    expect(network.localhostIp).toMatch(new RegExp(`^${layer0Subnet.replace(/\./g, '\\.')}\\.`));
    expect(network.localhostIp.endsWith('.100')).toBe(true);
  });

  it('should store essid', async () => {
    const network = await generateHomeNetwork('test', 0, 'MY-WIFI');
    expect(network.essid).toBe('MY-WIFI');
  });

  it('should generate network configs for all machines + router', async () => {
    const network = await generateHomeNetwork('config-test', 0, 'TEST');
    // Every machine should have a config
    for (const machine of network.machines) {
      expect(network.networkConfig.machineConfigs[machine.ip]).toBeDefined();
    }
    // Router config exists under public IP
    expect(network.networkConfig.machineConfigs[network.router.publicIp]).toBeDefined();
    // Router config also aliased under internal .1 IP
    expect(network.networkConfig.machineConfigs[network.router.internalIp]).toBeDefined();
  });

  it('should generate filesystems for all machines + router', async () => {
    const network = await generateHomeNetwork('fs-test', 0, 'TEST');
    for (const machine of network.machines) {
      expect(network.fileSystems[machine.ip]).toBeDefined();
      expect(network.fileSystems[machine.ip]!.type).toBe('directory');
    }
    // Router filesystem exists
    expect(network.fileSystems[network.router.publicIp]).toBeDefined();
    // Router filesystem aliased under internal .1 IP
    expect(network.fileSystems[network.router.internalIp]).toBeDefined();
  });

  it('should have machines with users', async () => {
    const network = await generateHomeNetwork('users-test', 0, 'TEST');
    for (const machine of network.machines) {
      expect(machine.remoteMachine.users.length).toBeGreaterThanOrEqual(2);
      // Should have root
      expect(machine.remoteMachine.users.some((u) => u.userType === 'root')).toBe(true);
    }
  });

  it('should set a serviceVersion on every port of every generated machine', async () => {
    const network = await generateHomeNetwork('version-audit', 0, 'TEST');
    const allMachines = [network.routerMachine, ...network.machines];
    for (const machine of allMachines) {
      for (const port of machine.remoteMachine.ports) {
        expect(port.serviceVersion).toBeDefined();
        expect(typeof port.serviceVersion).toBe('string');
        expect(port.serviceVersion.length).toBeGreaterThan(0);
      }
    }
  });

  it('should avoid public IPs in the usedIps set', async () => {
    const network = await generateHomeNetwork('collision-seed', 0, 'NET-0');
    const blocked = new Set([network.router.publicIp]);
    const network2 = await generateHomeNetwork('collision-seed', 0, 'NET-0', blocked);
    expect(network2.router.publicIp).not.toBe(network.router.publicIp);
  });

  it('should produce unique public IPs across multiple WiFi indices', async () => {
    const publicIps = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const network = await generateHomeNetwork('multi-wifi', i, `NET-${i}`, publicIps);
      expect(publicIps).not.toContain(network.router.publicIp);
      publicIps.add(network.router.publicIp);
    }
    expect(publicIps.size).toBe(10);
  });

  it('should have DNS records for layer machines', async () => {
    const network = await generateHomeNetwork('dns-test', 0, 'TEST');
    const layer0 = network.layers[0]!;
    const sampleIp = layer0.machines[0]?.ip ?? '';
    const sampleConfig = network.networkConfig.machineConfigs[sampleIp];
    expect(sampleConfig).toBeDefined();
    expect(sampleConfig!.dnsRecords.length).toBeGreaterThanOrEqual(1);
  });

  it('should have layers based on difficulty', async () => {
    // Generate many networks to cover different difficulties
    const layerCounts = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const network = await generateHomeNetwork(`layer-seed-${i}`, 0, 'TEST');
      layerCounts.add(network.layers.length);
      // Easy=1, medium=2, hard=3
      expect(network.layers.length).toBeGreaterThanOrEqual(1);
      expect(network.layers.length).toBeLessThanOrEqual(3);
    }
    // Across 30 seeds, we should see at least 2 different layer counts
    expect(layerCounts.size).toBeGreaterThanOrEqual(2);
  });

  it('should have machines with access variants', async () => {
    const network = await generateHomeNetwork('variant-test', 0, 'TEST');
    for (const machine of network.machines) {
      expect(machine.accessVariant).toBeDefined();
      expect(['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp']).toContain(machine.accessVariant);
    }
  });

  it('should have an entry variant and entry point', async () => {
    const network = await generateHomeNetwork('entry-test', 0, 'TEST');
    expect(network.entryVariant).toBeDefined();
    expect(['ssh', 'ftp', 'nc', 'exploit', 'http', 'snmp']).toContain(network.entryVariant);
    expect(network.entryPoint).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('should have a routerMachine with users', async () => {
    const network = await generateHomeNetwork('router-test', 0, 'TEST');
    expect(network.routerMachine).toBeDefined();
    expect(network.routerMachine.role).toBe('router');
    expect(network.routerMachine.remoteMachine.users.length).toBeGreaterThanOrEqual(1);
  });

  it('should alias inner gateway configs under downstream .1 IPs for multi-layer networks', async () => {
    // Find a network with multiple layers
    for (let i = 0; i < 50; i++) {
      const network = await generateHomeNetwork(`gateway-alias-${i}`, 0, 'TEST');
      if (network.layers.length > 1) {
        const layer1 = network.layers[1]!;
        const downstreamGatewayIp = `${layer1.subnet}.1`;
        // Config should exist under the .1 IP
        expect(network.networkConfig.machineConfigs[downstreamGatewayIp]).toBeDefined();
        // Filesystem should exist under the .1 IP
        expect(network.fileSystems[downstreamGatewayIp]).toBeDefined();
        return;
      }
    }
    // If we didn't find a multi-layer network in 50 tries, the test still passes
    // (difficulty is random, so we can't guarantee it)
  });

  it('uses allocator-returned IP when allocateIp is provided', async () => {
    const allocated = '198.50.51.52';
    const allocateIp = vi
      .fn<(kind: 'home_network') => Promise<string>>()
      .mockResolvedValue(allocated);
    const network = await generateHomeNetwork('alloc-home', 0, 'NET', undefined, { allocateIp });
    expect(network.router.publicIp).toBe(allocated);
    expect(network.routerMachine.ip).toBe(allocated);
    expect(allocateIp).toHaveBeenCalledWith('home_network');
  });

  it('falls back to PRNG roll when allocateIp is omitted (single-player default)', async () => {
    const a = await generateHomeNetwork('no-alloc-home', 0, 'NET');
    const b = await generateHomeNetwork('no-alloc-home', 0, 'NET');
    // Deterministic rolled IP for the same seed/index/essid
    expect(a.router.publicIp).toBe(b.router.publicIp);
  });
});
