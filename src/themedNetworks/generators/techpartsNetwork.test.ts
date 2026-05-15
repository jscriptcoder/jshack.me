import { describe, it, expect } from 'vitest';
import { generateTechpartsNetwork, pickApacheCveVersion } from './techpartsNetwork';
import type { WorldNetwork } from '../../worldNetworks/types';
import type { FileNode } from '../../filesystem/types';
import { TECHPARTS_PAGES, LINKED_PAGES, HIDDEN_PAGES } from '../content/techparts/pages';
import {
  findGeneratedVersion,
  CVE_TIMING_CONFIG,
  buildGeneratedVuln,
} from '../../generation/timeline';
import { findExploitableCve } from '../../generation/findExploitableCve';

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
  it('opens port 80 (http) with a Layer-2 procedural Apache version', async () => {
    // techparts.io's port 80 must NOT pin a Layer-1 hand-authored version
    // (which would be day-0 exploitable). The serviceVersion has to come
    // from the procedural timeline so the CVE is gated on publishedAt.
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const port80 = network.routerMachine.remoteMachine.ports.find((p) => p.port === 80);

    expect(port80).toBeDefined();
    expect(port80!.open).toBe(true);
    expect(port80!.service).toBe('http');
    expect(port80!.serviceVersion).toMatch(/^Apache\//);
    const entry = findGeneratedVersion('http', port80!.serviceVersion, 10_000, CVE_TIMING_CONFIG);
    expect(entry).toBeDefined();
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

  it('stamps a www-data owner on port 80 so msfconsole accepts the Apache CVE', async () => {
    // msfconsole.ts:216 rejects ports without an owner ("service not
    // exploitable") even when findExploitableCve returns a valid template.
    // The picker constrains the rolled effect to shell_full at user tier,
    // so the spawned shell lands as www-data (the user-tier user the
    // generator ships in /etc/passwd) — never root.
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const port80 = network.routerMachine.remoteMachine.ports.find((p) => p.port === 80);

    expect(port80?.owner).toBeDefined();
    expect(port80?.owner?.username).toBe('www-data');
    expect(port80?.owner?.userType).toBe('user');
    expect(port80?.owner?.homePath).toBe('/home/www-data');
  });

  it('leaves port 443 without an owner (no natural CVE = msfconsole bails earlier)', async () => {
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const port443 = network.routerMachine.remoteMachine.ports.find((p) => p.port === 443);

    expect(port443?.owner).toBeUndefined();
  });

  it('port 80 has no live CVE at gameTime=0 (procedural CVE not yet published)', async () => {
    // The whole point of the time-gated approach: techparts.io appears
    // safe at game start. The Layer-2 walker assigns publishedAt > 0 to
    // every entry (3-14 day gaps), so findExploitableCve returns
    // undefined while gameTime hasn't reached the version's publishedAt.
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const machine = network.routerMachine.remoteMachine;
    const port80 = machine.ports.find((p) => p.port === 80);

    expect(port80).toBeDefined();
    const vuln = findExploitableCve(machine, port80!, 0);
    expect(vuln).toBeUndefined();
  });

  it('port 80 has a live shell_full:user CVE by gameTime=30', async () => {
    // 30 days is well past the worst-case 14-day first-CVE window, so
    // the picker's chosen Apache version's CVE has reliably published
    // by then. The picker's allowlist (shell_full:user only) means the
    // effect is deterministically constrained — never root, never
    // backdoor_port_open, never script_exec.
    const row = buildRow();
    const network = await generateTechpartsNetwork(row, buildCtx([row]));
    const machine = network.routerMachine.remoteMachine;
    const port80 = machine.ports.find((p) => p.port === 80);

    expect(port80).toBeDefined();
    const vuln = findExploitableCve(machine, port80!, 30);
    expect(vuln).toBeDefined();
    expect(vuln!.effect.kind).toBe('shell_full');
    expect(vuln!.effect.tier).toBe('user');
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

describe('pickApacheCveVersion', () => {
  it('returns an Apache version string', () => {
    const picked = pickApacheCveVersion();
    expect(picked.version).toMatch(/^Apache\//);
  });

  it('returns a version locatable in the http procedural timeline', () => {
    // Confirms the picker is choosing from the Layer-2 walker, not a
    // hand-authored Layer-1 entry. findGeneratedVersion walks the http
    // timeline up to ~10k game days — easily covers any plausible pick.
    const picked = pickApacheCveVersion();
    const entry = findGeneratedVersion('http', picked.version, 10_000, CVE_TIMING_CONFIG);
    expect(entry).toBeDefined();
  });

  it('returns shell_full as the effect kind', () => {
    const picked = pickApacheCveVersion();
    expect(picked.effect.kind).toBe('shell_full');
  });

  it('returns user as the effect tier', () => {
    // Restricting to user tier caps damage at /var/www/html defacement —
    // www-data cannot brick /etc/passwd or system files. Recovery is a
    // generator re-run + DELETE FROM patches LIKE '/var/www/html/%'.
    const picked = pickApacheCveVersion();
    expect(picked.effect.tier).toBe('user');
  });

  it('is deterministic across consecutive calls', () => {
    // The PRNG seeds are stable per (service, index), so the picker must
    // return the same { version, effect } across repeated calls. This is
    // load-bearing for cross-player consistency — every browser computes
    // the same techparts.io CVE.
    const a = pickApacheCveVersion();
    const b = pickApacheCveVersion();
    expect(a).toEqual(b);
  });

  it('returns the http-derived effect for the picked version', () => {
    // Anchors the picker's effect to the http effect pool. If the picker
    // ever computed effects via a different service key (e.g.,
    // buildGeneratedVuln('ssh', entry)), the rolled effect would diverge
    // from what http's PRNG actually produces for that index — even though
    // both pools happen to contain shell_full at user tier. This test pins
    // the (service, index) → effect contract end-to-end.
    const picked = pickApacheCveVersion();
    const entry = findGeneratedVersion('http', picked.version, 10_000, CVE_TIMING_CONFIG);
    expect(entry).toBeDefined();
    const httpEffect = buildGeneratedVuln('http', entry!).effect;
    expect(picked.effect).toEqual(httpEffect);
  });
});
