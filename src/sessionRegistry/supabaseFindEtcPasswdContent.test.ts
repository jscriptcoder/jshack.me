import { describe, it, expect, vi } from 'vitest';
import { createSupabaseFindEtcPasswdContent } from './supabaseFindEtcPasswdContent';

describe('createSupabaseFindEtcPasswdContent', () => {
  it('returns the row content when a row exists for the machine', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ content: 'root:x:0:0' }], error: null });
    const find = createSupabaseFindEtcPasswdContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({
      ok: true,
      found: true,
      content: 'root:x:0:0',
    });
    expect(query).toHaveBeenCalledWith({ machine_id: 'm1' });
  });

  it('returns found=false when no row exists for the machine (mission case)', async () => {
    // Mission machines have no entry in machine_filesystems. The handler
    // treats this as "no projection available" and no-ops the validation.
    const query = vi.fn().mockResolvedValue({ data: [], error: null });
    const find = createSupabaseFindEtcPasswdContent(query);

    expect(await find({ machine_id: 'mission-router' })).toEqual({ ok: true, found: false });
  });

  it('returns found=true with content=null when the row exists but content was not projected', async () => {
    // Defensive: if a /etc/passwd row exists in machine_filesystems but
    // the dual-write path didn't project content (legacy row, or future
    // allowlist change), treat it the same as "no usable projection".
    const query = vi.fn().mockResolvedValue({ data: [{ content: null }], error: null });
    const find = createSupabaseFindEtcPasswdContent(query);

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
    const find = createSupabaseFindEtcPasswdContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({ ok: false });
  });

  it('returns ok: false on unexpected row shape (defense against drift)', async () => {
    const query = vi.fn().mockResolvedValue({ data: [{ unexpected: 'field' }], error: null });
    const find = createSupabaseFindEtcPasswdContent(query);

    expect(await find({ machine_id: 'm1' })).toEqual({ ok: false });
  });
});
