import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindFsContentBatch } from './supabaseFindFsContentBatch';

// PR 6 of plans/cross-player-base-fs-replication.md — batch fetch of
// machine_filesystems.content for the projected-paths overlay. The
// handler computes the intersection of the regen tree's file inventory
// and FS_PROJECTED_CONTENT_PATHS, then asks for those exact paths in
// one round-trip.

describe('createSupabaseFindFsContentBatch', () => {
  it('returns the path → content map on a successful query', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: [
        { path: '/etc/passwd', content: 'root:hash:0' },
        { path: '/etc/redis/redis.conf', content: 'requirepass abc' },
      ],
      error: null,
    });
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({
      machine_id: 'omen-aabbccdd',
      paths: ['/etc/passwd', '/etc/redis/redis.conf'],
    });

    expect(queryFn).toHaveBeenCalledWith({
      machine_id: 'omen-aabbccdd',
      paths: ['/etc/passwd', '/etc/redis/redis.conf'],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentByPath.get('/etc/passwd')).toBe('root:hash:0');
      expect(result.contentByPath.get('/etc/redis/redis.conf')).toBe('requirepass abc');
    }
  });

  it('returns an empty map when no rows match', async () => {
    const queryFn = vi.fn().mockResolvedValue({ data: [], error: null });
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({ machine_id: 'omen-aabbccdd', paths: ['/etc/passwd'] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.contentByPath.size).toBe(0);
  });

  it('drops rows whose content is null (only projected non-null rows are included)', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: [
        { path: '/etc/passwd', content: 'real-content' },
        { path: '/var/run/sshd.pid', content: null },
      ],
      error: null,
    });
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({
      machine_id: 'omen-aabbccdd',
      paths: ['/etc/passwd', '/var/run/sshd.pid'],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentByPath.has('/etc/passwd')).toBe(true);
      expect(result.contentByPath.has('/var/run/sshd.pid')).toBe(false);
    }
  });

  it('short-circuits with empty result when paths array is empty', async () => {
    const queryFn = vi.fn();
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({ machine_id: 'omen-aabbccdd', paths: [] });
    expect(queryFn).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, contentByPath: new Map() });
  });

  it('returns ok:false on query error', async () => {
    const queryFn = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({ machine_id: 'omen-aabbccdd', paths: ['/etc/passwd'] });
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false on rejected promise', async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error('network'));
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({ machine_id: 'omen-aabbccdd', paths: ['/etc/passwd'] });
    expect(result).toEqual({ ok: false });
  });

  it('returns ok:false on a malformed row (defensive)', async () => {
    const queryFn = vi.fn().mockResolvedValue({
      data: [{ path: 42, content: 'wrong-types' }],
      error: null,
    });
    const findFn = createSupabaseFindFsContentBatch(queryFn);

    const result = await findFn({ machine_id: 'omen-aabbccdd', paths: ['/etc/passwd'] });
    expect(result).toEqual({ ok: false });
  });
});
