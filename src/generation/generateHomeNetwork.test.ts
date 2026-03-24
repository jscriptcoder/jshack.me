import { describe, it, expect } from 'vitest';
import { generateHomeNetwork } from './generateHomeNetwork';

describe('generateHomeNetwork', () => {
  it('should produce deterministic output for same inputs', () => {
    const a = generateHomeNetwork('seed-a', 0, 'NET-A');
    const b = generateHomeNetwork('seed-a', 0, 'NET-A');
    expect(a.subnet).toBe(b.subnet);
    expect(a.router.publicIp).toBe(b.router.publicIp);
    expect(a.machines.length).toBe(b.machines.length);
  });

  it('should produce different output for different seeds', () => {
    const a = generateHomeNetwork('seed-a', 0, 'NET-A');
    const b = generateHomeNetwork('seed-b', 0, 'NET-B');
    expect(a.subnet).not.toBe(b.subnet);
  });

  it('should produce different output for different WiFi indices', () => {
    const a = generateHomeNetwork('same-seed', 0, 'NET-0');
    const b = generateHomeNetwork('same-seed', 1, 'NET-1');
    expect(a.subnet).not.toBe(b.subnet);
  });

  it('should have 2-4 machines', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']) {
      const network = generateHomeNetwork(seed, 0, 'TEST');
      expect(network.machines.length).toBeGreaterThanOrEqual(2);
      expect(network.machines.length).toBeLessThanOrEqual(4);
    }
  });

  it('should have a router with public IP', () => {
    const network = generateHomeNetwork('test', 0, 'TEST');
    expect(network.router.publicIp).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    // Public IP should not be in private ranges
    expect(network.router.publicIp).not.toMatch(/^10\./);
    expect(network.router.publicIp).not.toMatch(/^192\.168\./);
    expect(network.router.publicIp).not.toMatch(/^172\.(1[6-9]|2\d|3[01])\./);
  });

  it('should have unique IPs for all machines', () => {
    const network = generateHomeNetwork('unique-ip', 0, 'TEST');
    const ips = network.machines.map((m) => m.ip);
    expect(new Set(ips).size).toBe(ips.length);
  });

  it('should set localhostIp in the subnet', () => {
    const network = generateHomeNetwork('test', 0, 'TEST');
    expect(network.localhostIp).toMatch(new RegExp(`^${network.subnet.replace(/\./g, '\\.')}\\.`));
    expect(network.localhostIp.endsWith('.100')).toBe(true);
  });

  it('should store essid', () => {
    const network = generateHomeNetwork('test', 0, 'MY-WIFI');
    expect(network.essid).toBe('MY-WIFI');
  });

  it('should generate network configs for all machines + router', () => {
    const network = generateHomeNetwork('config-test', 0, 'TEST');
    const configKeys = Object.keys(network.networkConfig.machineConfigs);
    // One config per machine + one for router
    expect(configKeys.length).toBe(network.machines.length + 1);
    // Router config exists
    expect(network.networkConfig.machineConfigs[network.router.publicIp]).toBeDefined();
  });

  it('should generate filesystems for all machines + router', () => {
    const network = generateHomeNetwork('fs-test', 0, 'TEST');
    const fsKeys = Object.keys(network.fileSystems);
    expect(fsKeys.length).toBe(network.machines.length + 1);
    // Each machine has a filesystem
    for (const machine of network.machines) {
      expect(network.fileSystems[machine.ip]).toBeDefined();
      expect(network.fileSystems[machine.ip].type).toBe('directory');
    }
  });

  it('should have machines with users', () => {
    const network = generateHomeNetwork('users-test', 0, 'TEST');
    for (const machine of network.machines) {
      expect(machine.remoteMachine.users.length).toBeGreaterThanOrEqual(2);
      // Should have root
      expect(machine.remoteMachine.users.some((u) => u.userType === 'root')).toBe(true);
    }
  });

  it('should avoid public IPs in the usedIps set', () => {
    const network = generateHomeNetwork('collision-seed', 0, 'NET-0');
    const blocked = new Set([network.router.publicIp]);
    const network2 = generateHomeNetwork('collision-seed', 0, 'NET-0', blocked);
    expect(network2.router.publicIp).not.toBe(network.router.publicIp);
  });

  it('should produce unique public IPs across multiple WiFi indices', () => {
    const publicIps = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const network = generateHomeNetwork('multi-wifi', i, `NET-${i}`, publicIps);
      expect(publicIps).not.toContain(network.router.publicIp);
      publicIps.add(network.router.publicIp);
    }
    expect(publicIps.size).toBe(10);
  });

  it('should have DNS records for all machines', () => {
    const network = generateHomeNetwork('dns-test', 0, 'TEST');
    const firstMachineConfig = Object.values(network.networkConfig.machineConfigs)[0];
    expect(firstMachineConfig.dnsRecords.length).toBeGreaterThanOrEqual(
      network.machines.length + 1,
    );
  });
});
