import { describe, it, expect } from 'vitest';
import { generateTechpartsNetwork } from './techpartsNetwork';
import type { WorldNetwork } from '../../worldNetworks/types';

const buildRow = (overrides: Partial<WorldNetwork> = {}): WorldNetwork => ({
  public_ip: '198.51.100.80',
  seed: 'techparts',
  name: 'techparts.io',
  description: 'Worldwide electronic components reseller.',
  theme: 'techparts',
  public_domain: 'techparts.io',
  search_metadata: {
    title: 'TechParts Global',
    description: 'OEM, refurbished, and bulk electronics.',
    keywords: ['electronics', 'components', 'cpu'],
  },
  ...overrides,
});

const buildCtx = (allRows: ReadonlyArray<WorldNetwork>) => ({
  allocateIp: async () => '198.51.100.80',
  allRows,
});

describe('generateTechpartsNetwork — network shape', () => {
  it('produces a single-machine network where the router IS the only machine', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));

    expect(network.machines).toEqual([]);
    expect(network.routerMachine.ip).toBe('198.51.100.80');
    expect(network.routerPublicIp).toBe('198.51.100.80');
  });

  it('uses public_domain as the router hostname', async () => {
    const row = buildRow({ public_domain: 'techparts.io' });
    const network = await generateTechpartsNetwork(row, buildCtx([row]));

    expect(network.routerMachine.hostname).toBe('techparts.io');
    expect(network.routerDomain).toBe('techparts.io');
  });

  it('uses the allocator-provided IP for the router', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, {
      allocateIp: async () => '203.0.113.50',
      allRows: [row],
    });

    expect(network.routerMachine.ip).toBe('203.0.113.50');
    expect(network.routerPublicIp).toBe('203.0.113.50');
  });

  it('uses the row seed', async () => {
    const row = buildRow({ seed: 'custom-seed-xyz' });
    const network = await generateTechpartsNetwork(row, buildCtx([row]));

    expect(network.seed).toBe('custom-seed-xyz');
  });

  it('exposes the machine via networkConfig.machineConfigs keyed by public IP', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));

    expect(network.networkConfig.machineConfigs['198.51.100.80']).toBeDefined();
  });
});
