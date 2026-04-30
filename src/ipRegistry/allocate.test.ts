import { describe, it, expect, vi } from 'vitest';
import { allocateIp } from './allocate';
import type { InsertResult } from './types';

describe('allocateIp', () => {
  it('returns ok with the rolled IP when insert succeeds on first try', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const rollIp = vi.fn<() => string>().mockReturnValue('51.1.2.3');

    const result = await allocateIp({ kind: 'mission_instance' }, { insertIp, rollIp });

    expect(result).toEqual({ ok: true, ip: '51.1.2.3' });
    expect(insertIp).toHaveBeenCalledOnce();
  });

  it('retries on conflict and succeeds with the next roll', async () => {
    const insertIp = vi
      .fn<(row: unknown) => Promise<InsertResult>>()
      .mockResolvedValueOnce('conflict')
      .mockResolvedValueOnce('ok');
    const rollIp = vi
      .fn<() => string>()
      .mockReturnValueOnce('51.1.2.3')
      .mockReturnValueOnce('62.4.5.6');

    const result = await allocateIp({ kind: 'mission_instance' }, { insertIp, rollIp });

    expect(result).toEqual({ ok: true, ip: '62.4.5.6' });
    expect(insertIp).toHaveBeenCalledTimes(2);
    expect(rollIp).toHaveBeenCalledTimes(2);
  });

  it('passes kind, owner_key, and instance_ref through to insertIp', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const rollIp = vi.fn<() => string>().mockReturnValue('51.1.2.3');

    await allocateIp(
      { kind: 'home_network', owner_key: 'ed25519:abc', instance_ref: 'ref-xyz' },
      { insertIp, rollIp },
    );

    expect(insertIp).toHaveBeenCalledWith({
      ip: '51.1.2.3',
      kind: 'home_network',
      owner_key: 'ed25519:abc',
      instance_ref: 'ref-xyz',
    });
  });

  it('omits owner_key and instance_ref from insertIp payload when not provided', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('ok');
    const rollIp = vi.fn<() => string>().mockReturnValue('51.1.2.3');

    await allocateIp({ kind: 'darknet_hub' }, { insertIp, rollIp });

    expect(insertIp).toHaveBeenCalledWith({
      ip: '51.1.2.3',
      kind: 'darknet_hub',
    });
  });

  it('returns not-ok after exhausting retries on repeated conflicts', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('conflict');
    const rollIp = vi.fn<() => string>().mockReturnValue('51.1.2.3');

    const result = await allocateIp({ kind: 'mission_instance' }, { insertIp, rollIp });

    expect(result.ok).toBe(false);
  });

  it('returns not-ok immediately when insert errors', async () => {
    const insertIp = vi.fn<(row: unknown) => Promise<InsertResult>>().mockResolvedValue('error');
    const rollIp = vi.fn<() => string>().mockReturnValue('51.1.2.3');

    const result = await allocateIp({ kind: 'mission_instance' }, { insertIp, rollIp });

    expect(result.ok).toBe(false);
    expect(insertIp).toHaveBeenCalledOnce();
  });

  // Contract tripwire: dev-only test_network IPs (seeded via the
  // test_networks migration) are reserved in public_ips with
  // kind='test_network'. Any allocator roll that lands on a reserved
  // IP MUST return PK conflict and trigger a retry — otherwise the
  // allocator could hand a test fixture's IP to a real mission/home
  // and leak [TEST] data into gameplay. This test pins that contract
  // explicitly in test-network terms (the existing "retries on
  // conflict" test covers the mechanism abstractly).
  it('skips test_network reserved IPs via PK conflict retry', async () => {
    const insertIp = vi
      .fn<(row: unknown) => Promise<InsertResult>>()
      .mockResolvedValueOnce('conflict') // 203.0.113.42 reserved in public_ips
      .mockResolvedValueOnce('ok'); // next roll is free
    const rollIp = vi
      .fn<() => string>()
      .mockReturnValueOnce('203.0.113.42')
      .mockReturnValueOnce('51.1.2.3');

    const result = await allocateIp({ kind: 'mission_instance' }, { insertIp, rollIp });

    expect(result).toEqual({ ok: true, ip: '51.1.2.3' });
    expect(insertIp).toHaveBeenCalledTimes(2);
  });
});
