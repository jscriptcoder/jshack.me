import { describe, it, expect, vi } from 'vitest';
import { generateWorldNetworks, type ThemedGenerator } from './generate';
import type { WorldNetwork } from './types';
import type { FileNode } from '../filesystem/types';

const makeNode = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  children: {},
});

// Build a fake "MissionNetwork-like" return shape — only the fields we
// pass through matter for these tests. The real generator returns much
// more (objective, difficulty, etc.); the helper should preserve all of
// it without inspection.
const makeFakeNetwork = (publicIp: string, machineName: string) => ({
  seed: 'whatever',
  fileSystems: { [publicIp]: makeNode(machineName) },
  machines: [{ ip: publicIp, hostname: machineName }],
  networkConfig: { _marker: 'config' },
  routerMachine: { ip: publicIp, hostname: machineName },
  layers: [],
});

const buildRow = (overrides: Partial<WorldNetwork> = {}): WorldNetwork => ({
  public_ip: '203.0.113.42',
  seed: 'whatever',
  name: 'Test',
  description: null,
  theme: 'playground',
  public_domain: null,
  search_metadata: null,
  ...overrides,
});

describe('generateWorldNetworks', () => {
  it('returns an empty array when input is empty', async () => {
    const generator = vi.fn();
    const select = vi.fn().mockReturnValue(generator);

    const result = await generateWorldNetworks([], select);

    expect(result).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    expect(generator).not.toHaveBeenCalled();
  });

  it('dispatches per row by theme — selectGenerator receives row.theme', async () => {
    const generator: ThemedGenerator = vi
      .fn()
      .mockResolvedValue(makeFakeNetwork('203.0.113.42', 'placeholder'));
    const select = vi.fn().mockReturnValue(generator);
    const rows: WorldNetwork[] = [
      buildRow({ public_ip: '203.0.113.42', seed: 'playground-basic', theme: 'playground' }),
      buildRow({ public_ip: '203.0.113.43', seed: 'office-template', theme: 'office' }),
    ];

    await generateWorldNetworks(rows, select);

    expect(select).toHaveBeenNthCalledWith(1, 'playground');
    expect(select).toHaveBeenNthCalledWith(2, 'office');
  });

  it('passes the row + ctx (allocateIp pinned to row.public_ip + allRows) to the generator', async () => {
    const generator = vi.fn().mockResolvedValue(makeFakeNetwork('203.0.113.42', 'placeholder'));
    const rows: WorldNetwork[] = [
      buildRow({ public_ip: '203.0.113.42', seed: 'playground-basic', theme: 'playground' }),
      buildRow({ public_ip: '203.0.113.43', seed: 'office-template', theme: 'office' }),
    ];

    await generateWorldNetworks(rows, () => generator);

    expect(generator).toHaveBeenCalledTimes(2);

    const [firstRow, firstCtx] = generator.mock.calls[0] as [
      WorldNetwork,
      { allocateIp: () => Promise<string>; allRows: ReadonlyArray<WorldNetwork> },
    ];
    expect(firstRow.seed).toBe('playground-basic');
    expect(firstCtx.allRows).toEqual(rows);
    await expect(firstCtx.allocateIp()).resolves.toBe('203.0.113.42');

    const [, secondCtx] = generator.mock.calls[1] as [
      WorldNetwork,
      { allocateIp: () => Promise<string> },
    ];
    await expect(secondCtx.allocateIp()).resolves.toBe('203.0.113.43');
  });

  it('returns the full generated networks (machines + networkConfig + routerMachine, not just fileSystems)', async () => {
    const network1 = makeFakeNetwork('203.0.113.42', 'playground');
    const network2 = makeFakeNetwork('203.0.113.43', 'office');
    const generator = vi.fn().mockResolvedValueOnce(network1).mockResolvedValueOnce(network2);
    const rows: WorldNetwork[] = [
      buildRow({ public_ip: '203.0.113.42', seed: 's1', name: 'A', theme: 'playground' }),
      buildRow({ public_ip: '203.0.113.43', seed: 's2', name: 'B', theme: 'office' }),
    ];

    const result = await generateWorldNetworks(rows, () => generator);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(network1);
    expect(result[1]).toBe(network2);
  });

  it('preserves row order in the returned array', async () => {
    const a = makeFakeNetwork('203.0.113.10', 'first');
    const b = makeFakeNetwork('203.0.113.11', 'second');
    const c = makeFakeNetwork('203.0.113.12', 'third');
    let resolveB!: (v: typeof b) => void;
    const generator = vi
      .fn()
      .mockResolvedValueOnce(a)
      .mockReturnValueOnce(
        new Promise<typeof b>((resolve) => {
          resolveB = resolve;
        }),
      )
      .mockResolvedValueOnce(c);
    const rows: WorldNetwork[] = [
      buildRow({ public_ip: '203.0.113.10', seed: 's1', name: 'A' }),
      buildRow({ public_ip: '203.0.113.11', seed: 's2', name: 'B' }),
      buildRow({ public_ip: '203.0.113.12', seed: 's3', name: 'C' }),
    ];

    const promise = generateWorldNetworks(rows, () => generator);
    setTimeout(() => resolveB(b), 0);

    const result = await promise;

    expect(result.map((n) => n.routerMachine?.hostname)).toEqual(['first', 'second', 'third']);
  });
});
