import { describe, expect, it, vi } from 'vitest';

import type { GeneratedMachine } from '../generation/types';
import type { RemoteMachine } from './types';
import {
  chainForwardBackdoor,
  type BackdoorForwardDeps,
  type BackdoorForwardResult,
} from './backdoorForwarding';

const makeRemote = (ip: string, hostname: string): RemoteMachine => ({
  ip,
  hostname,
  ports: [],
  users: [],
});

const makeGateway = (ip: string, hostname: string): GeneratedMachine => ({
  ip,
  hostname,
  role: 'router',
  accessVariant: 'ssh',
  remoteMachine: makeRemote(ip, hostname),
});

const makeDeps = (
  initial: Record<string, string> = {},
): { deps: BackdoorForwardDeps; store: Map<string, string> } => {
  const store = new Map(Object.entries(initial));
  const deps: BackdoorForwardDeps = {
    readIptables: (ip) => store.get(ip) ?? null,
    writeIptables: (ip, content) => {
      store.set(ip, content);
    },
  };
  return { deps, store };
};

type RunOpts = Omit<Parameters<typeof chainForwardBackdoor>[0], 'deps'>;

const run = (opts: RunOpts): { result: BackdoorForwardResult; store: Map<string, string> } => {
  const { deps, store } = makeDeps();
  const result = chainForwardBackdoor({ ...opts, deps });
  return { result, store };
};

describe('chainForwardBackdoor', () => {
  it('is a no-op when the gateway chain is empty (home network, unknown IP)', () => {
    const writeIptables = vi.fn();
    const deps: BackdoorForwardDeps = { readIptables: () => null, writeIptables };

    const result = chainForwardBackdoor({
      machineIp: '192.168.1.42',
      internalPort: 4444,
      gatewayChain: [],
      deps,
    });

    expect(result.rules).toEqual([]);
    expect(result.publicEdgePort).toBeNull();
    expect(writeIptables).not.toHaveBeenCalled();
  });

  it('writes a single forward rule on the border router for a layer-0 backdoor', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const { result, store } = run({
      machineIp: '10.50.100.20',
      internalPort: 4444,
      gatewayChain: [border],
    });

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toEqual({
      gatewayIp: '203.0.113.5',
      publicPort: 4444,
      internalIp: '10.50.100.20',
      internalPort: 4444,
    });
    expect(result.publicEdgePort).toBe(4444);
    expect(store.get('203.0.113.5')).toContain('forward 4444 to 10.50.100.20:4444');
  });

  it('writes rules on every gateway in a multi-layer chain (innermost first)', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const innerGw = makeGateway('10.50.100.1', 'gw');
    const { result, store } = run({
      machineIp: '10.50.200.15',
      internalPort: 9001,
      gatewayChain: [innerGw, border],
    });

    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]!.gatewayIp).toBe('10.50.100.1');
    expect(result.rules[1]!.gatewayIp).toBe('203.0.113.5');
    expect(store.get('10.50.100.1')).toContain('forward 9001 to 10.50.200.15:9001');
    expect(store.get('203.0.113.5')).toContain('forward 9001 to 10.50.200.15:9001');
  });

  it('picks the next free port when the preferred port is already forwarded on a gateway', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const { deps, store } = makeDeps({
      '203.0.113.5': 'forward 4444 to 10.50.100.99:4444',
    });

    const result = chainForwardBackdoor({
      machineIp: '10.50.100.20',
      internalPort: 4444,
      gatewayChain: [border],
      deps,
    });

    expect(result.rules[0]!.publicPort).toBe(4445);
    expect(store.get('203.0.113.5')).toContain('forward 4444 to 10.50.100.99:4444');
    expect(store.get('203.0.113.5')).toContain('forward 4445 to 10.50.100.20:4444');
  });

  it("picks the next free port independently per gateway (one gateway has collision, another doesn't)", () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const innerGw = makeGateway('10.50.100.1', 'gw');
    const { deps, store } = makeDeps({
      '203.0.113.5': 'forward 4444 to 10.0.0.99:4444',
    });

    const result = chainForwardBackdoor({
      machineIp: '10.50.200.15',
      internalPort: 4444,
      gatewayChain: [innerGw, border],
      deps,
    });

    expect(result.rules[0]!.publicPort).toBe(4444);
    expect(result.rules[1]!.publicPort).toBe(4445);
    expect(result.publicEdgePort).toBe(4445);
    expect(store.get('10.50.100.1')).toBe('forward 4444 to 10.50.200.15:4444');
    expect(store.get('203.0.113.5')).toContain('forward 4445 to 10.50.200.15:4444');
  });

  it('preserves existing iptables content (comments, prior rules) when appending', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const { deps, store } = makeDeps({
      '203.0.113.5':
        '# Port Forwarding Rules\n# forward <pub> to <ip>:<port>\nforward 22 to 10.50.100.10:22',
    });

    chainForwardBackdoor({
      machineIp: '10.50.100.20',
      internalPort: 4444,
      gatewayChain: [border],
      deps,
    });

    const content = store.get('203.0.113.5')!;
    expect(content).toContain('# Port Forwarding Rules');
    expect(content).toContain('forward 22 to 10.50.100.10:22');
    expect(content).toContain('forward 4444 to 10.50.100.20:4444');
  });

  it('creates a fresh rules.v4 when the gateway has no existing content', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const { deps, store } = makeDeps({});

    chainForwardBackdoor({
      machineIp: '10.50.100.20',
      internalPort: 4444,
      gatewayChain: [border],
      deps,
    });

    expect(store.get('203.0.113.5')).toBe('forward 4444 to 10.50.100.20:4444');
  });

  it('publicEdgePort reports the port on the last gateway in the chain (the edge)', () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const innerGw = makeGateway('10.50.100.1', 'gw');
    const { deps } = makeDeps({
      '203.0.113.5': 'forward 4444 to 10.0.0.99:4444\nforward 4445 to 10.0.0.98:4444',
    });

    const result = chainForwardBackdoor({
      machineIp: '10.50.200.15',
      internalPort: 4444,
      gatewayChain: [innerGw, border],
      deps,
    });

    // Edge router had 4444 AND 4445 taken → should pick 4446
    expect(result.publicEdgePort).toBe(4446);
    expect(result.rules[0]!.publicPort).toBe(4444); // inner gateway was free
  });
});
