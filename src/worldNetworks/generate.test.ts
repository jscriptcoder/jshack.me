import { describe, it, expect, vi } from 'vitest';
import { generateWorldNetworks } from './generate';
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

describe('generateWorldNetworks', () => {
  it('returns an empty array when input is empty', async () => {
    const generator = vi.fn();

    const result = await generateWorldNetworks([], generator);

    expect(result).toEqual([]);
    expect(generator).not.toHaveBeenCalled();
  });

  it('calls generator once per row with seed + allocator returning that row public_ip', async () => {
    const generator = vi.fn().mockResolvedValue(makeFakeNetwork('203.0.113.42', 'placeholder'));
    const rows: WorldNetwork[] = [
      {
        public_ip: '203.0.113.42',
        seed: 'playground-basic',
        name: 'Playground',
        description: null,
        theme: 'playground',
      },
      {
        public_ip: '203.0.113.43',
        seed: 'office-template',
        name: 'Office',
        description: null,
        theme: 'office',
      },
    ];

    await generateWorldNetworks(rows, generator);

    expect(generator).toHaveBeenCalledTimes(2);
    const firstCall = generator.mock.calls[0];
    expect(firstCall[0]).toBe('playground-basic');
    expect(firstCall[1]).toBeUndefined();
    const firstAllocator = (firstCall[2] as { allocateIp: () => Promise<string> }).allocateIp;
    await expect(firstAllocator()).resolves.toBe('203.0.113.42');

    const secondCall = generator.mock.calls[1];
    expect(secondCall[0]).toBe('office-template');
    const secondAllocator = (secondCall[2] as { allocateIp: () => Promise<string> }).allocateIp;
    await expect(secondAllocator()).resolves.toBe('203.0.113.43');
  });

  it('returns the full generated networks (machines + networkConfig + routerMachine, not just fileSystems)', async () => {
    const network1 = makeFakeNetwork('203.0.113.42', 'playground');
    const network2 = makeFakeNetwork('203.0.113.43', 'office');
    const generator = vi.fn().mockResolvedValueOnce(network1).mockResolvedValueOnce(network2);
    const rows: WorldNetwork[] = [
      {
        public_ip: '203.0.113.42',
        seed: 's1',
        name: 'A',
        description: null,
        theme: 'playground',
      },
      { public_ip: '203.0.113.43', seed: 's2', name: 'B', description: null, theme: 'office' },
    ];

    const result = await generateWorldNetworks(rows, generator);

    expect(result).toHaveLength(2);
    // The whole network shape passes through — not just fileSystems.
    // This is the corrected behaviour vs the abandoned PR #83 helper,
    // which only returned a merged Record<string, FileNode>.
    expect(result[0]).toBe(network1);
    expect(result[1]).toBe(network2);
  });

  it('preserves row order in the returned array', async () => {
    const a = makeFakeNetwork('203.0.113.10', 'first');
    const b = makeFakeNetwork('203.0.113.11', 'second');
    const c = makeFakeNetwork('203.0.113.12', 'third');
    // Resolve out-of-order to make sure we don't accidentally use
    // settle order vs input order.
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
      { public_ip: '203.0.113.10', seed: 's1', name: 'A', description: null, theme: 'playground' },
      { public_ip: '203.0.113.11', seed: 's2', name: 'B', description: null, theme: 'playground' },
      { public_ip: '203.0.113.12', seed: 's3', name: 'C', description: null, theme: 'playground' },
    ];

    const promise = generateWorldNetworks(rows, generator);
    // Resolve B AFTER C (out of input order).
    setTimeout(() => resolveB(b), 0);

    const result = await promise;

    // Order in result MUST match input order, not settle order.
    expect(result.map((n) => n.routerMachine?.hostname)).toEqual(['first', 'second', 'third']);
  });
});
