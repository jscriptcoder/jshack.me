import { describe, it, expect } from 'vitest';
import type { HomeNetwork } from '../generation/generateHomeNetwork';
import type { OccupantSummary } from '../homeNetworks/types';
import { buildForeignLanOccupantMap } from './foreignLanOccupantResolver';

const sampleNetwork = (overrides: Partial<HomeNetwork> = {}): HomeNetwork =>
  ({
    essid: 'ACME-CORP',
    localhostIp: '10.0.0.42',
    router: {
      publicIp: '203.0.113.10',
      hostname: 'router-foo',
      internalIp: '10.0.0.1',
    },
    routerMachine: { ip: '203.0.113.10' },
    entryPoint: '203.0.113.10',
    entryVariant: 'single_layer',
    machines: [],
    layers: [
      {
        subnet: '10.0.0',
        gateway: { ip: '10.0.0.1' },
        gatewayType: 'router',
        entryVariant: 'ssh',
        machines: [],
        isForwarded: true,
      },
    ],
    networkConfig: { machineConfigs: {} },
    fileSystems: {},
    ...overrides,
  }) as unknown as HomeNetwork;

const occupant = (overrides: Partial<OccupantSummary> = {}): OccupantSummary => ({
  network_id: '203.0.113.10',
  lan_ip: '.42',
  hostname: 'rocket-aabbccdd',
  ...overrides,
});

describe('buildForeignLanOccupantMap', () => {
  it('returns an empty map for empty inputs', () => {
    const map = buildForeignLanOccupantMap([], []);
    expect(map.size).toBe(0);
  });

  it('returns an empty map when foreign networks are present but occupants are empty', () => {
    const map = buildForeignLanOccupantMap([sampleNetwork()], []);
    expect(map.size).toBe(0);
  });

  it('skips occupants whose network_id has no matching foreign network', () => {
    const map = buildForeignLanOccupantMap(
      [sampleNetwork()],
      [occupant({ network_id: '198.51.100.50' })],
    );
    expect(map.size).toBe(0);
  });

  it('keys entries by full IP composed from subnet + lan_ip', () => {
    const map = buildForeignLanOccupantMap(
      [sampleNetwork()],
      [occupant({ lan_ip: '.42', hostname: 'rocket-aabbccdd' })],
    );
    expect(map.size).toBe(1);
    const entry = map.get('10.0.0.42');
    expect(entry).toEqual({
      workstationId: 'rocket-aabbccdd',
      networkId: '203.0.113.10',
      layer0Subnet: '10.0.0',
    });
  });

  it('emits one entry per occupant across multiple foreign networks', () => {
    const networkA = sampleNetwork({
      router: { publicIp: '203.0.113.10', hostname: 'r-a', internalIp: '10.0.0.1' },
      layers: [
        {
          subnet: '10.0.0',
          gateway: { ip: '10.0.0.1' },
          gatewayType: 'router',
          entryVariant: 'ssh',
          machines: [],
          isForwarded: true,
        },
      ] as unknown as HomeNetwork['layers'],
    });
    const networkB = sampleNetwork({
      router: { publicIp: '198.51.100.20', hostname: 'r-b', internalIp: '192.168.1.1' },
      layers: [
        {
          subnet: '192.168.1',
          gateway: { ip: '192.168.1.1' },
          gatewayType: 'router',
          entryVariant: 'ssh',
          machines: [],
          isForwarded: true,
        },
      ] as unknown as HomeNetwork['layers'],
    });
    const occupants: readonly OccupantSummary[] = [
      occupant({ network_id: '203.0.113.10', lan_ip: '.42', hostname: 'rocket-aabbccdd' }),
      occupant({ network_id: '198.51.100.20', lan_ip: '.77', hostname: 'glider-eeff0011' }),
    ];

    const map = buildForeignLanOccupantMap([networkA, networkB], occupants);

    expect(map.size).toBe(2);
    expect(map.get('10.0.0.42')).toEqual({
      workstationId: 'rocket-aabbccdd',
      networkId: '203.0.113.10',
      layer0Subnet: '10.0.0',
    });
    expect(map.get('192.168.1.77')).toEqual({
      workstationId: 'glider-eeff0011',
      networkId: '198.51.100.20',
      layer0Subnet: '192.168.1',
    });
  });

  it('does not merge colliding host octets across different subnets', () => {
    const networkA = sampleNetwork({
      router: { publicIp: '203.0.113.10', hostname: 'r-a', internalIp: '10.0.0.1' },
      layers: [
        {
          subnet: '10.0.0',
          gateway: { ip: '10.0.0.1' },
          gatewayType: 'router',
          entryVariant: 'ssh',
          machines: [],
          isForwarded: true,
        },
      ] as unknown as HomeNetwork['layers'],
    });
    const networkB = sampleNetwork({
      router: { publicIp: '198.51.100.20', hostname: 'r-b', internalIp: '192.168.1.1' },
      layers: [
        {
          subnet: '192.168.1',
          gateway: { ip: '192.168.1.1' },
          gatewayType: 'router',
          entryVariant: 'ssh',
          machines: [],
          isForwarded: true,
        },
      ] as unknown as HomeNetwork['layers'],
    });
    const occupants: readonly OccupantSummary[] = [
      occupant({ network_id: '203.0.113.10', lan_ip: '.42', hostname: 'rocket-aabbccdd' }),
      occupant({ network_id: '198.51.100.20', lan_ip: '.42', hostname: 'glider-eeff0011' }),
    ];

    const map = buildForeignLanOccupantMap([networkA, networkB], occupants);

    expect(map.size).toBe(2);
    expect(map.get('10.0.0.42')?.workstationId).toBe('rocket-aabbccdd');
    expect(map.get('192.168.1.42')?.workstationId).toBe('glider-eeff0011');
  });

  it('skips occupants whose foreign network has no layer-0 subnet', () => {
    const networkWithoutLayers = sampleNetwork({
      layers: [] as unknown as HomeNetwork['layers'],
    });
    const map = buildForeignLanOccupantMap([networkWithoutLayers], [occupant()]);
    expect(map.size).toBe(0);
  });
});
