import { describe, it, expect } from 'vitest';
import { generateSearchEngineNetwork } from './searchEngineNetwork';
import { INDEX_PATH } from '../handlers/searchEngine';
import type { WorldNetwork } from '../../worldNetworks/types';
import type { FileNode } from '../../filesystem/types';

// --- Factories ---

const buildRow = (overrides: Partial<WorldNetwork> = {}): WorldNetwork => ({
  public_ip: '203.0.113.43',
  seed: 'findit-basic',
  name: 'findit.io',
  description: 'Search engine',
  theme: 'search-engine',
  public_domain: 'findit.io',
  search_metadata: {
    title: 'findit.io',
    description: 'Search the public web.',
    keywords: ['search', 'find', 'engine'],
  },
  ...overrides,
});

const buildCtx = (allRows: ReadonlyArray<WorldNetwork>) => ({
  allocateIp: async () => '203.0.113.43',
  allRows,
});

// Walks a FileNode tree and returns the file at the given path, or null.
const readFileFromTree = (root: FileNode, path: string): string | null => {
  const segments = path.split('/').filter((s) => s.length > 0);
  let current: FileNode = root;
  for (const seg of segments) {
    if (current.type !== 'directory' || !current.children?.[seg]) return null;
    current = current.children[seg];
  }
  return current.type === 'file' ? (current.content ?? null) : null;
};

// --- Network shape ---

describe('generateSearchEngineNetwork — network shape', () => {
  it('produces a single-machine network where the router IS the only machine', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    expect(network.machines).toEqual([]);
    expect(network.routerMachine.ip).toBe('203.0.113.43');
    expect(network.routerPublicIp).toBe('203.0.113.43');
  });

  it('uses public_domain as the router hostname', async () => {
    const row = buildRow({ public_domain: 'findit.io' });
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    expect(network.routerMachine.hostname).toBe('findit.io');
    expect(network.routerDomain).toBe('findit.io');
  });

  it('opens both port 80 (http) and port 443 (https)', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    const ports = network.routerMachine.remoteMachine.ports;
    const port80 = ports.find((p) => p.port === 80);
    const port443 = ports.find((p) => p.port === 443);

    expect(port80?.open).toBe(true);
    expect(port80?.service).toBe('http');
    expect(port443?.open).toBe(true);
    expect(port443?.service).toBe('https');
  });

  it('exposes the machine via networkConfig.machineConfigs keyed by public IP', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    expect(network.networkConfig.machineConfigs['203.0.113.43']).toBeDefined();
  });

  it('uses the row seed', async () => {
    const row = buildRow({ seed: 'custom-seed-xyz' });
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    expect(network.seed).toBe('custom-seed-xyz');
  });

  it('uses the allocator-provided IP for the router', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, {
      allocateIp: async () => '198.51.100.99',
      allRows: [row],
    });

    expect(network.routerMachine.ip).toBe('198.51.100.99');
    expect(network.routerPublicIp).toBe('198.51.100.99');
  });
});

// --- Filesystem ---

describe('generateSearchEngineNetwork — filesystem', () => {
  it('puts a landing page at /var/www/html/index.html', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    const fs = network.fileSystems['203.0.113.43'];
    expect(fs).toBeDefined();
    const landing = readFileFromTree(fs!, '/var/www/html/index.html');
    expect(landing).not.toBeNull();
    expect(landing).toContain('findit.io');
  });

  it('writes the index file at the path the search handler reads', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    const fs = network.fileSystems['203.0.113.43'];
    expect(readFileFromTree(fs!, INDEX_PATH)).not.toBeNull();
  });
});

// --- Index building ---

describe('generateSearchEngineNetwork — index building', () => {
  it('includes findit.io itself in the index when its row has search_metadata', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));

    const fs = network.fileSystems['203.0.113.43'];
    const indexJson = readFileFromTree(fs!, INDEX_PATH);
    expect(indexJson).not.toBeNull();
    const parsed = JSON.parse(indexJson!) as ReadonlyArray<{ readonly domain: string }>;
    expect(parsed.some((e) => e.domain === 'findit.io')).toBe(true);
  });

  it('includes all peer rows whose search_metadata + public_domain are set', async () => {
    const findit = buildRow();
    const techparts = buildRow({
      public_ip: '203.0.113.44',
      seed: 'techparts',
      name: 'techparts.io',
      theme: 'shop',
      public_domain: 'techparts.io',
      search_metadata: {
        title: 'Tech Parts Store',
        description: 'Components.',
        keywords: ['gpu', 'cpu'],
      },
    });

    const network = await generateSearchEngineNetwork(findit, buildCtx([findit, techparts]));
    const fs = network.fileSystems['203.0.113.43'];
    const parsed = JSON.parse(readFileFromTree(fs!, INDEX_PATH)!) as ReadonlyArray<{
      readonly domain: string;
      readonly title: string;
      readonly keywords: readonly string[];
    }>;

    const tech = parsed.find((e) => e.domain === 'techparts.io');
    expect(tech?.title).toBe('Tech Parts Store');
    expect(tech?.keywords).toEqual(['gpu', 'cpu']);
  });

  it('skips rows without search_metadata (e.g., playground)', async () => {
    const findit = buildRow();
    const playground = buildRow({
      public_ip: '203.0.113.42',
      name: 'Playground',
      theme: 'playground',
      public_domain: null,
      search_metadata: null,
    });

    const network = await generateSearchEngineNetwork(findit, buildCtx([findit, playground]));
    const fs = network.fileSystems['203.0.113.43'];
    const parsed = JSON.parse(readFileFromTree(fs!, INDEX_PATH)!) as ReadonlyArray<{
      readonly domain: string;
    }>;

    expect(parsed.some((e) => e.domain === 'Playground')).toBe(false);
  });

  it('skips rows with search_metadata but no public_domain (no resolvable URL)', async () => {
    const findit = buildRow();
    const ghostRow = buildRow({
      public_ip: '203.0.113.44',
      name: 'Ghost',
      public_domain: null,
      search_metadata: {
        title: 'Ghost',
        description: 'No domain.',
        keywords: ['ghost'],
      },
    });

    const network = await generateSearchEngineNetwork(findit, buildCtx([findit, ghostRow]));
    const fs = network.fileSystems['203.0.113.43'];
    const parsed = JSON.parse(readFileFromTree(fs!, INDEX_PATH)!);
    expect(JSON.stringify(parsed)).not.toContain('Ghost');
  });

  it('emits valid JSON for the index file', async () => {
    const row = buildRow();
    const network = await generateSearchEngineNetwork(row, buildCtx([row]));
    const fs = network.fileSystems['203.0.113.43'];
    const raw = readFileFromTree(fs!, INDEX_PATH)!;

    expect(() => JSON.parse(raw)).not.toThrow();
  });
});
