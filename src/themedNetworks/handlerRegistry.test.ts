import { describe, it, expect } from 'vitest';
import { THEME_HANDLERS, getHandlerForTheme, buildWorldHandlerMap } from './handlerRegistry';
import { searchEngineHandler } from './handlers/searchEngine';
import type { MissionNetwork } from '../generation/types';
import type { WorldNetwork } from '../worldNetworks/types';
import type { GeneratedMachine } from '../generation/types';
import type { RemoteMachine } from '../network/types';

// --- Factories ---

const buildMachine = (overrides: Partial<RemoteMachine> = {}): RemoteMachine => ({
  ip: '203.0.113.42',
  hostname: 'host',
  ports: [],
  users: [],
  ...overrides,
});

const buildGeneratedMachine = (overrides: Partial<GeneratedMachine> = {}): GeneratedMachine => ({
  ip: '203.0.113.42',
  hostname: 'host',
  role: 'router',
  accessVariant: 'ssh',
  remoteMachine: buildMachine(),
  ...overrides,
});

const buildNetwork = (overrides: Partial<MissionNetwork> = {}): MissionNetwork => ({
  seed: 'test-seed',
  difficulty: 'easy',
  entryPoint: '203.0.113.42',
  entryVariant: 'ssh',
  machines: [],
  fileSystems: {},
  networkConfig: { machineConfigs: {} },
  objective: {
    type: 'tamper',
    description: 'unused',
    targetMachine: '203.0.113.42',
    targetPath: '/dev/null',
    targetContent: '',
    clientEmail: 'unused@example.com',
    expectedProof: '',
  },
  clientEmail: 'unused@example.com',
  routerPublicIp: '203.0.113.42',
  routerMachine: buildGeneratedMachine(),
  routerDomain: 'host',
  domainEntry: false,
  layers: [],
  ...overrides,
});

const buildRow = (overrides: Partial<WorldNetwork> = {}): WorldNetwork => ({
  public_ip: '203.0.113.42',
  seed: 'test-seed',
  name: 'Test',
  description: null,
  theme: 'playground',
  search_metadata: null,
  ...overrides,
});

// --- THEME_HANDLERS / getHandlerForTheme ---

describe('THEME_HANDLERS', () => {
  it('registers the search-engine theme to the search handler', () => {
    expect(THEME_HANDLERS['search-engine']).toBe(searchEngineHandler);
  });
});

describe('getHandlerForTheme', () => {
  it('returns the registered handler for a known theme', () => {
    expect(getHandlerForTheme('search-engine')).toBe(searchEngineHandler);
  });

  it('returns undefined for unknown themes', () => {
    expect(getHandlerForTheme('zzzunknown')).toBeUndefined();
  });

  it('returns undefined for the bare playground theme (no handler today)', () => {
    expect(getHandlerForTheme('playground')).toBeUndefined();
  });
});

// --- buildWorldHandlerMap ---

describe('buildWorldHandlerMap', () => {
  it('returns an empty map when no rows or networks supplied', () => {
    expect(buildWorldHandlerMap([], [])).toEqual(new Map());
  });

  it('attaches the search-engine handler to a matching row + network', () => {
    const row = buildRow({ public_ip: '203.0.113.43', theme: 'search-engine' });
    const network = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.43' }),
    });

    const map = buildWorldHandlerMap([row], [network]);

    expect(map.get('203.0.113.43')).toBe(searchEngineHandler);
  });

  it('skips rows whose theme has no registered handler', () => {
    const row = buildRow({ public_ip: '203.0.113.42', theme: 'playground' });
    const network = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.42' }),
    });

    const map = buildWorldHandlerMap([row], [network]);

    expect(map.size).toBe(0);
  });

  it('skips rows whose public_ip does not match any network', () => {
    const row = buildRow({ public_ip: '198.51.100.99', theme: 'search-engine' });
    const network = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.42' }),
    });

    const map = buildWorldHandlerMap([row], [network]);

    expect(map.size).toBe(0);
  });

  it('handles multiple themed rows and preserves IP→handler pairing', () => {
    const rowA = buildRow({ public_ip: '203.0.113.43', theme: 'search-engine' });
    const rowB = buildRow({ public_ip: '203.0.113.44', theme: 'search-engine' });
    const rowC = buildRow({ public_ip: '203.0.113.42', theme: 'playground' });
    const networkA = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.43' }),
    });
    const networkB = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.44' }),
    });
    const networkC = buildNetwork({
      routerMachine: buildGeneratedMachine({ ip: '203.0.113.42' }),
    });

    const map = buildWorldHandlerMap([rowA, rowB, rowC], [networkA, networkB, networkC]);

    expect(map.size).toBe(2);
    expect(map.get('203.0.113.43')).toBe(searchEngineHandler);
    expect(map.get('203.0.113.44')).toBe(searchEngineHandler);
    expect(map.has('203.0.113.42')).toBe(false);
  });
});
