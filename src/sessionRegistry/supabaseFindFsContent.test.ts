import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindFsContent } from './supabaseFindFsContent';

describe('createSupabaseFindFsContent', () => {
  it('returns content for a present row at the requested path', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ data: [{ content: 'requirepass abc123' }], error: null });
    const find = createSupabaseFindFsContent(query);

    const result = await find({ machine_id: 'm1', path: '/etc/redis/redis.conf' });

    expect(result).toEqual({ ok: true, found: true, content: 'requirepass abc123' });
    expect(query).toHaveBeenCalledWith({ machine_id: 'm1', path: '/etc/redis/redis.conf' });
  });

  it('returns found=false when no row exists at the path', async () => {
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindFsContent(query);

    expect(await find({ machine_id: 'm1', path: '/missing' })).toEqual({
      ok: true,
      found: false,
    });
  });

  it('returns content=null when the row exists but content was not projected', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ content: null }], error: null });
    const find = createSupabaseFindFsContent(query);

    expect(await find({ machine_id: 'm1', path: '/etc/passwd' })).toEqual({
      ok: true,
      found: true,
      content: null,
    });
  });

  it('returns ok: false when the underlying query errors', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'boom' } });
    const find = createSupabaseFindFsContent(query);

    expect(await find({ machine_id: 'm1', path: '/etc/passwd' })).toEqual({ ok: false });
  });

  it('returns ok: false on unexpected row shape (defense against drift)', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ unexpected: 'field' }], error: null });
    const find = createSupabaseFindFsContent(query);

    expect(await find({ machine_id: 'm1', path: '/etc/passwd' })).toEqual({ ok: false });
  });
});
