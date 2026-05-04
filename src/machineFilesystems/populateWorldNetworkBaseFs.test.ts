import { describe, it, expect, vi } from 'vitest';
import { regenWorldNetworkRows } from './populateWorldNetworkBaseFs';
import { flattenFileSystemsToRows } from './flattenFileNode';
import type { WorldNetwork } from '../worldNetworks/types';
import type { ThemedGenerator, ThemedGeneratorContext } from '../worldNetworks/generate';
import type { MissionNetwork, GeneratedMachine } from '../generation/types';
import type { RemoteMachine } from '../network/types';
import type { FileNode } from '../filesystem/types';

// --- Factories ---

const buildRow = (overrides: Partial<WorldNetwork> = {}): WorldNetwork => ({
  public_ip: '203.0.113.1',
  seed: 'seed-1',
  name: 'Test Net',
  description: null,
  theme: 'playground',
  public_domain: null,
  search_metadata: null,
  ...overrides,
});

const allOpen = {
  read: ['root', 'user', 'guest'],
  write: ['root', 'user', 'guest'],
  execute: ['root', 'user', 'guest'],
} as const;

const mkDir = (
  name: string,
  children: Readonly<Record<string, FileNode>> = {},
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: allOpen,
  children,
});

const mkFile = (
  name: string,
  content: string,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: allOpen,
  content,
});

// Minimal MissionNetwork factory — only `fileSystems` is consumed by the
// helper; the rest are required by the type but never read here. Mirrors
// the shape generateSearchEngineNetwork produces so any future divergence
// in the canonical type surfaces as a compile error in this factory.
const mkRouterMachine = (ip: string): GeneratedMachine => {
  const remote: RemoteMachine = { ip, hostname: 'stub', ports: [], users: [] };
  return {
    ip,
    hostname: 'stub',
    role: 'router',
    accessVariant: 'http',
    remoteMachine: remote,
  };
};

const mkNetwork = (
  fileSystems: Readonly<Record<string, FileNode>>,
  publicIp = '203.0.113.1',
): MissionNetwork => {
  const router = mkRouterMachine(publicIp);
  return {
    seed: 'stub',
    difficulty: 'easy',
    entryPoint: publicIp,
    entryVariant: 'http',
    machines: [],
    fileSystems,
    networkConfig: { machineConfigs: {} },
    objective: {
      type: 'tamper',
      description: 'unused',
      targetMachine: publicIp,
      targetPath: '/dev/null',
      targetContent: '',
      clientEmail: 'unused@example.com',
      expectedProof: '',
    },
    clientEmail: 'unused@example.com',
    routerPublicIp: publicIp,
    routerMachine: router,
    routerDomain: 'stub',
    domainEntry: false,
    layers: [],
  };
};

// --- Tests ---

describe('regenWorldNetworkRows', () => {
  it('returns the flattened rows of the generated fileSystems', async () => {
    const fs = {
      'host-a': mkDir('root', {
        etc: mkDir('etc', { hosts: mkFile('hosts', '127.0.0.1 localhost') }),
      }),
    };
    const generator: ThemedGenerator = async () => mkNetwork(fs);
    const row = buildRow();

    const rows = await regenWorldNetworkRows({
      row,
      allRows: [row],
      selectGenerator: () => generator,
    });

    expect(rows).toEqual(flattenFileSystemsToRows(fs));
  });

  it('selects the generator using the row theme (not a hard-coded theme, not allRows[0].theme)', async () => {
    // Pinned: peer placed FIRST in allRows with a DIFFERENT theme so a
    // mutant that read input.allRows[0].theme instead of input.row.theme
    // surfaces here.
    const selectGenerator = vi
      .fn<(theme: string) => ThemedGenerator>()
      .mockReturnValue(async () => mkNetwork({}));
    const peer = buildRow({ public_ip: '198.51.100.99', theme: 'playground' });
    const row = buildRow({ theme: 'search-engine' });

    await regenWorldNetworkRows({ row, allRows: [peer, row], selectGenerator });

    expect(selectGenerator).toHaveBeenCalledWith('search-engine');
  });

  it("invokes the dispatched generator with the row and a context whose allocateIp resolves to the row's public_ip", async () => {
    // Pinned: peer placed FIRST in allRows so a mutant that read
    // input.allRows[0] instead of input.row would surface here. Without
    // this, every test with allRows=[row] would let position-confusion
    // mutations survive.
    let captured: { row: WorldNetwork; ctx: ThemedGeneratorContext } | null = null;
    const generator: ThemedGenerator = async (row, ctx) => {
      captured = { row, ctx };
      return mkNetwork({});
    };
    const peer = buildRow({ public_ip: '198.51.100.99', theme: 'playground' });
    const row = buildRow({ public_ip: '198.51.100.7', theme: 'search-engine' });

    await regenWorldNetworkRows({
      row,
      allRows: [peer, row],
      selectGenerator: () => generator,
    });

    expect(captured).not.toBeNull();
    const captureNotNull = captured as unknown as {
      row: WorldNetwork;
      ctx: ThemedGeneratorContext;
    };
    expect(captureNotNull.row).toBe(row);
    await expect(captureNotNull.ctx.allocateIp('mission_instance')).resolves.toBe('198.51.100.7');
  });

  it('forwards the input allRows verbatim into the generator context', async () => {
    let capturedAllRows: ReadonlyArray<WorldNetwork> | null = null;
    const generator: ThemedGenerator = async (_row, ctx) => {
      capturedAllRows = ctx.allRows;
      return mkNetwork({});
    };
    const peer = buildRow({ public_ip: '192.0.2.99', theme: 'playground' });
    const row = buildRow({ public_ip: '192.0.2.80', theme: 'search-engine' });
    const allRows = [row, peer];

    await regenWorldNetworkRows({ row, allRows, selectGenerator: () => generator });

    expect(capturedAllRows).toBe(allRows);
  });

  it('emits one row per FileNode across multiple machines', async () => {
    // Pinned: the helper must flatten EVERY machine in the network, not
    // just the first. A mutant that returned only the first machine's
    // rows would survive a single-machine fixture but fail this multi-
    // machine assertion. Mirrors the home-network behavior — every NPC
    // contributes rows.
    const fs = {
      'm-1': mkDir('root', { a: mkFile('a', 'A') }),
      'm-2': mkDir('root', { b: mkFile('b', 'B') }),
    };
    const generator: ThemedGenerator = async () => mkNetwork(fs);
    const row = buildRow();

    const rows = await regenWorldNetworkRows({
      row,
      allRows: [row],
      selectGenerator: () => generator,
    });

    const m1Paths = rows.filter((r) => r.machine_id === 'm-1').map((r) => r.path);
    const m2Paths = rows.filter((r) => r.machine_id === 'm-2').map((r) => r.path);
    expect(m1Paths.sort()).toEqual(['/', '/a']);
    expect(m2Paths.sort()).toEqual(['/', '/b']);
  });
});
