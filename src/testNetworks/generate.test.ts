import { describe, it, expect, vi } from 'vitest';
import { generateTestNetworkFileSystems } from './generate';
import type { TestNetwork } from './types';
import type { FileNode } from '../filesystem/types';

const makeNode = (name: string): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  children: {},
});

describe('generateTestNetworkFileSystems', () => {
  it('returns an empty Record when testNetworks is empty', async () => {
    const generator = vi.fn();

    const result = await generateTestNetworkFileSystems([], generator);

    expect(result).toEqual({});
    expect(generator).not.toHaveBeenCalled();
  });

  it('calls the generator once per test network with seed + an allocator returning that network public_ip', async () => {
    const generator = vi.fn().mockResolvedValue({ fileSystems: {} });
    const networks: TestNetwork[] = [
      {
        public_ip: '203.0.113.42',
        seed: 'test-basic',
        name: 'Basic',
        description: null,
      },
      {
        public_ip: '203.0.113.43',
        seed: 'test-medium',
        name: 'Medium',
        description: null,
      },
    ];

    await generateTestNetworkFileSystems(networks, generator);

    expect(generator).toHaveBeenCalledTimes(2);
    const firstCall = generator.mock.calls[0];
    expect(firstCall[0]).toBe('test-basic');
    // The allocator passed in the options should resolve to the test network's public_ip
    const firstAllocator = (firstCall[2] as { allocateIp: () => Promise<string> }).allocateIp;
    await expect(firstAllocator()).resolves.toBe('203.0.113.42');

    const secondCall = generator.mock.calls[1];
    expect(secondCall[0]).toBe('test-medium');
    const secondAllocator = (secondCall[2] as { allocateIp: () => Promise<string> }).allocateIp;
    await expect(secondAllocator()).resolves.toBe('203.0.113.43');
  });

  it('merges fileSystems from each generated network into one Record', async () => {
    const node1 = makeNode('basic-machine');
    const node2 = makeNode('medium-machine');
    const generator = vi
      .fn()
      .mockResolvedValueOnce({ fileSystems: { '203.0.113.42': node1 } })
      .mockResolvedValueOnce({ fileSystems: { '203.0.113.43': node2 } });
    const networks: TestNetwork[] = [
      { public_ip: '203.0.113.42', seed: 's1', name: 'A', description: null },
      { public_ip: '203.0.113.43', seed: 's2', name: 'B', description: null },
    ];

    const result = await generateTestNetworkFileSystems(networks, generator);

    expect(result).toEqual({
      '203.0.113.42': node1,
      '203.0.113.43': node2,
    });
  });

  it('preserves all machines when a single test network produces a multi-machine LAN', async () => {
    const router = makeNode('router');
    const internal1 = makeNode('internal-1');
    const internal2 = makeNode('internal-2');
    const generator = vi.fn().mockResolvedValueOnce({
      fileSystems: {
        '203.0.113.42': router,
        '10.0.0.5': internal1,
        '10.0.0.6': internal2,
      },
    });
    const networks: TestNetwork[] = [
      { public_ip: '203.0.113.42', seed: 's1', name: 'A', description: null },
    ];

    const result = await generateTestNetworkFileSystems(networks, generator);

    expect(Object.keys(result).sort()).toEqual(['10.0.0.5', '10.0.0.6', '203.0.113.42']);
  });
});
