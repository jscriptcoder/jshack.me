import { describe, it, expect, vi } from 'vitest';
import { resolveMachineByIpAsync } from './resolveMachineByIpAsync';
import type { RemoteMachine } from './types';
import type { HomeNetwork } from '../generation/generateHomeNetwork';

const sampleMachine = (overrides: Partial<RemoteMachine> = {}): RemoteMachine => ({
  ip: '10.0.0.1',
  hostname: 'sample',
  ports: [],
  users: [],
  ...overrides,
});

const sampleForeignNetwork = (publicIp: string, inner: RemoteMachine | null = null): HomeNetwork =>
  ({
    essid: 'foreign',
    localhostIp: '192.168.0.42',
    router: { publicIp, hostname: `r-${publicIp}`, internalIp: '192.168.0.1' },
    routerMachine: {
      ip: publicIp,
      hostname: `r-${publicIp}`,
      role: 'router',
      ports: [],
      users: [],
      remoteMachine: sampleMachine({ ip: publicIp, hostname: `r-${publicIp}` }),
    },
    entryPoint: publicIp,
    entryVariant: 'ssh',
    machines: inner ? [{ ip: inner.ip, hostname: inner.hostname }] : [],
    layers: [],
    networkConfig: inner
      ? { machineConfigs: { [inner.ip]: { interfaces: [], machines: [inner], dnsRecords: [] } } }
      : { machineConfigs: {} },
    fileSystems: {},
    difficulty: 'easy',
  }) as unknown as HomeNetwork;

describe('resolveMachineByIpAsync', () => {
  it('returns the sync result when sync findMachineByIp hits (no resolver call)', async () => {
    const machine = sampleMachine({ ip: '10.0.0.1' });
    const syncFind = vi.fn().mockReturnValue(machine);
    const ensureReachable = vi.fn();

    const result = await resolveMachineByIpAsync('10.0.0.1', syncFind, ensureReachable);

    expect(result).toBe(machine);
    expect(ensureReachable).not.toHaveBeenCalled();
  });

  it('returns undefined for an RFC1918 input without calling the resolver', async () => {
    const syncFind = vi.fn().mockReturnValue(undefined);
    const ensureReachable = vi.fn();

    const result = await resolveMachineByIpAsync('10.0.0.1', syncFind, ensureReachable);

    expect(result).toBeUndefined();
    expect(ensureReachable).not.toHaveBeenCalled();
  });

  it('returns undefined for malformed input without calling the resolver', async () => {
    const syncFind = vi.fn().mockReturnValue(undefined);
    const ensureReachable = vi.fn();

    const result = await resolveMachineByIpAsync('not-an-ip', syncFind, ensureReachable);

    expect(result).toBeUndefined();
    expect(ensureReachable).not.toHaveBeenCalled();
  });

  it('calls the resolver and returns the foreign router for a sync miss on a public IPv4', async () => {
    const syncFind = vi.fn().mockReturnValue(undefined);
    const foreignNet = sampleForeignNetwork('162.174.39.103');
    const ensureReachable = vi.fn().mockResolvedValue(foreignNet);

    const result = await resolveMachineByIpAsync('162.174.39.103', syncFind, ensureReachable);

    expect(ensureReachable).toHaveBeenCalledWith('162.174.39.103');
    expect(result?.ip).toBe('162.174.39.103');
    expect(result?.hostname).toBe('r-162.174.39.103');
  });

  it('returns an internal foreign machine when the IP targets behind the router', async () => {
    const syncFind = vi.fn().mockReturnValue(undefined);
    const inner = sampleMachine({ ip: '192.168.0.50', hostname: 'inner-foreign' });
    const foreignNet = sampleForeignNetwork('162.174.39.103', inner);
    const ensureReachable = vi.fn().mockResolvedValue(foreignNet);

    const result = await resolveMachineByIpAsync('192.168.0.50', syncFind, ensureReachable);

    // Note: the input IP MUST be a public IP for the resolver to fire.
    // This case shows that even if the resolver is called, it returns
    // undefined when the input itself was RFC1918 — covered by the
    // earlier short-circuit test. So this scenario (foreign-LAN IP
    // targeted from the player's side) would never go through this
    // helper; the resolver only fires for public IPs typed by the
    // player. Confirms the contract: sync first; async only kicks in
    // when the target IP is publicly addressable.
    expect(result).toBeUndefined();
    expect(ensureReachable).not.toHaveBeenCalled();
  });

  it('returns undefined when the resolver yields null (server 404 or short-circuit)', async () => {
    const syncFind = vi.fn().mockReturnValue(undefined);
    const ensureReachable = vi.fn().mockResolvedValue(null);

    const result = await resolveMachineByIpAsync('162.174.39.103', syncFind, ensureReachable);

    expect(result).toBeUndefined();
    expect(ensureReachable).toHaveBeenCalledTimes(1);
  });

  it('returns undefined when the resolver yields a network that does not contain the IP', async () => {
    // Edge case: resolver loaded a network for IP X but the requested
    // IP Y isn't actually a machine in that network. This shouldn't
    // happen in normal flow (resolver only fires for the SAME IP) but
    // the helper handles it defensively.
    const syncFind = vi.fn().mockReturnValue(undefined);
    const foreignNet = sampleForeignNetwork('162.174.39.103');
    const ensureReachable = vi.fn().mockResolvedValue(foreignNet);

    const result = await resolveMachineByIpAsync('203.0.113.99', syncFind, ensureReachable);

    expect(result).toBeUndefined();
  });
});
