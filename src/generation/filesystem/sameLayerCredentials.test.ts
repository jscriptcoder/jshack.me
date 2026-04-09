import { describe, it, expect } from 'vitest';
import { buildSameLayerCredentials } from './sameLayerCredentials';
import type { CredentialMap, SubnetLayer, GeneratedMachine } from '../types';

const makeMachine = (ip: string): GeneratedMachine => ({
  ip,
  hostname: `host-${ip.split('.').pop()}`,
  role: 'webserver',
  accessVariant: 'ssh',
  remoteMachine: { ip, hostname: `host-${ip.split('.').pop()}`, ports: [], users: [] },
});

const makeLayer = (subnet: string, machineIps: readonly string[]): SubnetLayer => ({
  subnet,
  gateway: makeMachine(`${subnet}.1`),
  gatewayType: 'router',
  entryVariant: 'ssh',
  machines: machineIps.map(makeMachine),
  isForwarded: false,
});

describe('buildSameLayerCredentials', () => {
  it('returns empty map when no layers', () => {
    const result = buildSameLayerCredentials([], {});
    expect(result.size).toBe(0);
  });

  it('returns empty map for single-machine layers', () => {
    const layers = [makeLayer('10.0.0', ['10.0.0.10'])];
    const creds: CredentialMap = {
      '10.0.0.10': [{ username: 'admin', password: 'pass1' }],
    };
    const result = buildSameLayerCredentials(layers, creds);
    expect(result.size).toBe(0);
  });

  it('maps machines to peer credentials in the same layer', () => {
    const layers = [makeLayer('10.0.0', ['10.0.0.10', '10.0.0.20'])];
    const creds: CredentialMap = {
      '10.0.0.10': [{ username: 'alice', password: 'pass_a' }],
      '10.0.0.20': [{ username: 'bob', password: 'pass_b' }],
    };
    const result = buildSameLayerCredentials(layers, creds);

    // Machine 10 should see machine 20's creds
    expect(result.get('10.0.0.10')).toEqual([
      { ip: '10.0.0.20', username: 'bob', password: 'pass_b' },
    ]);
    // Machine 20 should see machine 10's creds
    expect(result.get('10.0.0.20')).toEqual([
      { ip: '10.0.0.10', username: 'alice', password: 'pass_a' },
    ]);
  });

  it('excludes root and guest credentials from peers', () => {
    const layers = [makeLayer('10.0.0', ['10.0.0.10', '10.0.0.20'])];
    const creds: CredentialMap = {
      '10.0.0.10': [{ username: 'admin', password: 'pass1' }],
      '10.0.0.20': [
        { username: 'root', password: 'rootpass' },
        { username: 'guest', password: 'guestpass' },
        { username: 'deploy', password: 'deploy123' },
      ],
    };
    const result = buildSameLayerCredentials(layers, creds);

    // Only deploy should appear (root and guest filtered out)
    expect(result.get('10.0.0.10')).toEqual([
      { ip: '10.0.0.20', username: 'deploy', password: 'deploy123' },
    ]);
  });

  it('does not cross layer boundaries', () => {
    const layers = [
      makeLayer('10.0.0', ['10.0.0.10', '10.0.0.20']),
      makeLayer('10.0.1', ['10.0.1.10', '10.0.1.20']),
    ];
    const creds: CredentialMap = {
      '10.0.0.10': [{ username: 'u1', password: 'p1' }],
      '10.0.0.20': [{ username: 'u2', password: 'p2' }],
      '10.0.1.10': [{ username: 'u3', password: 'p3' }],
      '10.0.1.20': [{ username: 'u4', password: 'p4' }],
    };
    const result = buildSameLayerCredentials(layers, creds);

    // Layer 0 machines should only see layer 0 peers
    const m10peers = result.get('10.0.0.10')!;
    expect(m10peers.every((c) => c.ip.startsWith('10.0.0'))).toBe(true);

    // Layer 1 machines should only see layer 1 peers
    const m110peers = result.get('10.0.1.10')!;
    expect(m110peers.every((c) => c.ip.startsWith('10.0.1'))).toBe(true);
  });

  it('skips machines with no eligible peer credentials', () => {
    const layers = [makeLayer('10.0.0', ['10.0.0.10', '10.0.0.20'])];
    const creds: CredentialMap = {
      '10.0.0.10': [{ username: 'admin', password: 'pass1' }],
      '10.0.0.20': [{ username: 'root', password: 'rootonly' }],
    };
    const result = buildSameLayerCredentials(layers, creds);

    // Machine 10 has no eligible peers (only root on machine 20)
    expect(result.has('10.0.0.10')).toBe(false);
    // Machine 20 sees machine 10's admin
    expect(result.get('10.0.0.20')).toEqual([
      { ip: '10.0.0.10', username: 'admin', password: 'pass1' },
    ]);
  });
});
