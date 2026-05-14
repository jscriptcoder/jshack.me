import { describe, it, expect } from 'vitest';
import { generateTechpartsNetwork } from './techpartsNetwork';
import type { WorldNetwork } from '../../worldNetworks/types';
import type { FileNode } from '../../filesystem/types';
import { TECHPARTS_PAGES, LINKED_PAGES, HIDDEN_PAGES } from '../content/techparts/pages';

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

describe('generateTechpartsNetwork — ports', () => {
  it('opens port 80 (http) with version Apache/2.4.49 — natural CVE trigger', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const port80 = network.routerMachine.remoteMachine.ports.find((p) => p.port === 80);

    expect(port80).toBeDefined();
    expect(port80!.open).toBe(true);
    expect(port80!.service).toBe('http');
    expect(port80!.serviceVersion).toBe('Apache/2.4.49');
  });

  it('opens port 443 (https) with version nginx/1.20.1 — decorative no-CVE pairing', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const port443 = network.routerMachine.remoteMachine.ports.find((p) => p.port === 443);

    expect(port443).toBeDefined();
    expect(port443!.open).toBe(true);
    expect(port443!.service).toBe('https');
    expect(port443!.serviceVersion).toBe('nginx/1.20.1');
  });

  it('exposes exactly the two http ports — no extra ports leaking', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));

    expect(network.routerMachine.remoteMachine.ports).toHaveLength(2);
  });
});

// Walks a FileNode tree and returns the node at the given absolute path,
// or null when any path segment misses. Mirrors the helper used in
// searchEngineNetwork.test.ts so test conventions stay aligned.
const readNodeFromTree = (root: FileNode, path: string): FileNode | null => {
  const segments = path.split('/').filter((s) => s.length > 0);
  let current: FileNode = root;
  for (const seg of segments) {
    if (current.type !== 'directory' || !current.children?.[seg]) return null;
    current = current.children[seg];
  }
  return current;
};

const readFileFromTree = (root: FileNode, path: string): string | null => {
  const node = readNodeFromTree(root, path);
  if (!node || node.type !== 'file') return null;
  return node.content ?? null;
};

const fsPathForManifestPath = (manifestPath: string): string =>
  manifestPath === '/' ? '/var/www/html/index.html' : `/var/www/html${manifestPath}`;

describe('generateTechpartsNetwork — filesystem layout', () => {
  it.each(LINKED_PAGES.map((p) => [p.path, fsPathForManifestPath(p.path), p.body] as const))(
    'lays linked manifest path %s at %s with verbatim body',
    async (_manifestPath, fsPath, expectedBody) => {
      const row = buildRow();
      const network = await generateTechpartsNetwork(row, buildCtx([row]));
      const fs = network.fileSystems['198.51.100.80'];

      expect(fs).toBeDefined();
      const fileContent = readFileFromTree(fs!, fsPath);
      expect(fileContent).toBe(expectedBody);
    },
  );

  it.each(HIDDEN_PAGES.map((p) => [p.path, fsPathForManifestPath(p.path), p.body] as const))(
    'lays hidden manifest path %s at %s with verbatim body',
    async (_manifestPath, fsPath, expectedBody) => {
      const row = buildRow();
      const network = await generateTechpartsNetwork(row, buildCtx([row]));
      const fs = network.fileSystems['198.51.100.80'];

      const fileContent = readFileFromTree(fs!, fsPath);
      expect(fileContent).toBe(expectedBody);
    },
  );

  it('creates a /var/www/html/products directory containing the product files', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const fs = network.fileSystems['198.51.100.80'];

    const productsDir = readNodeFromTree(fs!, '/var/www/html/products');
    expect(productsDir).not.toBeNull();
    expect(productsDir!.type).toBe('directory');
    const productPaths = TECHPARTS_PAGES.filter((p) => p.path.startsWith('/products/')).map(
      (p) => p.path,
    );
    expect(productPaths.length).toBeGreaterThan(0);
    for (const productPath of productPaths) {
      const fileName = productPath.replace('/products/', '');
      expect(productsDir!.children?.[fileName]).toBeDefined();
    }
  });

  it('ships root and www-data users in /etc/passwd (mirrors findit.io)', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const fs = network.fileSystems['198.51.100.80'];

    const passwd = readFileFromTree(fs!, '/etc/passwd');
    expect(passwd).not.toBeNull();
    expect(passwd).toContain('root:');
    expect(passwd).toContain('www-data:');
  });
});
