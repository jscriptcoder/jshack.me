import { describe, expect, it } from 'vitest';

import type { GeneratedMachine, SubnetLayer } from '../generation/types';
import type { RemoteMachine } from './types';
import { findGatewayChainFor } from './gatewayChain';

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

const makeLayer = (subnet: string, gateway: GeneratedMachine): SubnetLayer => ({
  subnet,
  gateway,
  gatewayType: 'router',
  entryVariant: 'ssh',
  machines: [],
  isForwarded: true,
});

describe('findGatewayChainFor', () => {
  it('returns an empty chain when there are no layers', () => {
    expect(findGatewayChainFor('10.0.1.5', undefined)).toEqual([]);
    expect(findGatewayChainFor('10.0.1.5', [])).toEqual([]);
  });

  it('returns an empty chain when the machine belongs to no layer (home network IP)', () => {
    const border = makeGateway('203.0.113.5', 'router');
    const layers = [makeLayer('10.50.100', border)];

    expect(findGatewayChainFor('192.168.1.42', layers)).toEqual([]);
  });

  it('returns only the border router for a machine in the outer layer', () => {
    const border = makeGateway('203.0.113.5', 'edge-router');
    const layers = [makeLayer('10.50.100', border)];

    const chain = findGatewayChainFor('10.50.100.20', layers);

    expect(chain.map((g) => g.hostname)).toEqual(['edge-router']);
  });

  it('returns gateways innermost-first, edge-last, for a machine two layers deep', () => {
    const border = makeGateway('203.0.113.5', 'edge-router');
    const innerGw = makeGateway('10.50.100.1', 'inner-gw');
    const layers = [makeLayer('10.50.100', border), makeLayer('10.50.200', innerGw)];

    const chain = findGatewayChainFor('10.50.200.15', layers);

    expect(chain.map((g) => g.hostname)).toEqual(['inner-gw', 'edge-router']);
  });

  it('walks three layers deep from innermost machine out to border router', () => {
    const border = makeGateway('203.0.113.5', 'edge-router');
    const gw1 = makeGateway('10.1.0.1', 'gw1');
    const gw2 = makeGateway('10.2.0.1', 'gw2');
    const layers = [
      makeLayer('10.1.0', border),
      makeLayer('10.2.0', gw1),
      makeLayer('10.3.0', gw2),
    ];

    const chain = findGatewayChainFor('10.3.0.42', layers);

    expect(chain.map((g) => g.hostname)).toEqual(['gw2', 'gw1', 'edge-router']);
  });

  it("stops at the machine's layer (deeper layers are not included)", () => {
    const border = makeGateway('203.0.113.5', 'edge');
    const gw1 = makeGateway('10.1.0.1', 'gw1');
    const gw2 = makeGateway('10.2.0.1', 'gw2');
    const layers = [
      makeLayer('10.1.0', border),
      makeLayer('10.2.0', gw1),
      makeLayer('10.3.0', gw2),
    ];

    // Target is in layer[1] — gw2 (fronts layer[2]) should NOT be in the chain
    const chain = findGatewayChainFor('10.2.0.15', layers);

    expect(chain.map((g) => g.hostname)).toEqual(['gw1', 'edge']);
  });
});
