import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindVirtualUsersConfContent } from './supabaseFindVirtualUsersConfContent';

describe('createSupabaseFindVirtualUsersConfContent', () => {
  it('returns the row content when a row exists for the machine', async () => {
    const query = vi.fn().mockResolvedValue({
      data: [{ content: 'alice:5f4dcc3b5aa765d61d8327deb882cf99' }],
      error: null,
    });
    const find = createSupabaseFindVirtualUsersConfContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({
      ok: true,
      found: true,
      content: 'alice:5f4dcc3b5aa765d61d8327deb882cf99',
    });
    expect(query).toHaveBeenCalledWith({ machine_id: 'm1' });
  });

  it('returns found=false when no row exists for the machine', async () => {
    // Machines without an FTP daemon have no virtual_users.conf row;
    // handler must fall back to /etc/passwd.
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindVirtualUsersConfContent(query);

    expect(await find({ machine_id: 'no-ftp' })).toEqual({ ok: true, found: false });
  });

  it('returns found=true with content=null when row exists but content was not projected', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ content: null }], error: null });
    const find = createSupabaseFindVirtualUsersConfContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({
      ok: true,
      found: true,
      content: null,
    });
  });

  it('returns ok: false when the underlying query errors', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX001', message: 'boom' } });
    const find = createSupabaseFindVirtualUsersConfContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({ ok: false });
  });

  it('returns ok: false on unexpected row shape (defense against drift)', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ unexpected: 'field' }], error: null });
    const find = createSupabaseFindVirtualUsersConfContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({ ok: false });
  });
});
