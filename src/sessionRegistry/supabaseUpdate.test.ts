import { describe, it, expect, vi } from 'vitest';
import { createSupabaseEndSession } from './supabaseUpdate';
import type { EndSessionParams } from './types';

const params: EndSessionParams = {
  session_id: '11111111-2222-4333-8444-555555555555',
  player_key: 'pubkey-hex',
  reason: 'user_exit',
};

const okEndOf = (id: string) => ({ data: [{ session_id: id }], error: null });
const noChildren = { data: [], error: null };

describe('createSupabaseEndSession — non-cascade paths (single session)', () => {
  it('returns ok with affected = 1 when one row was updated and no children', async () => {
    const endRow = vi.fn().mockResolvedValue(okEndOf(params.session_id));
    const findChildren = vi.fn().mockResolvedValue(noChildren);
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 1 });
    expect(endRow).toHaveBeenCalledWith(params);
    expect(findChildren).toHaveBeenCalledWith(params.session_id);
  });

  it('returns ok with affected = 0 when no row matched the WHERE filter', async () => {
    // Empty data means: not found, not yours, or already ended.
    // We do NOT cascade in this case — nothing to cascade from.
    const endRow = vi.fn().mockResolvedValue({ data: [], error: null });
    const findChildren = vi.fn().mockResolvedValue(noChildren);
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 0 });
    expect(findChildren).not.toHaveBeenCalled();
  });

  it('returns ok: false when supabase returns an error on the named UPDATE', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: '42501', message: 'RLS violation' } });
    const findChildren = vi.fn().mockResolvedValue(noChildren);
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: false });
    expect(findChildren).not.toHaveBeenCalled();
  });

  it('returns ok with affected = 0 when data is null and no error (defensive)', async () => {
    const endRow = vi.fn().mockResolvedValue({ data: null, error: null });
    const findChildren = vi.fn().mockResolvedValue(noChildren);
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 0 });
    expect(findChildren).not.toHaveBeenCalled();
  });
});

describe('createSupabaseEndSession — cascade behaviour', () => {
  const namedId = params.session_id;
  const childId = '22222222-3333-4444-8555-666666666666';
  const grandchildId = '33333333-4444-4555-8666-777777777777';
  const otherChildId = '44444444-5555-4666-8777-888888888888';

  it('cascades to a single active child with end_reason="cascade"', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValueOnce(okEndOf(namedId)) // named session
      .mockResolvedValueOnce(okEndOf(childId)); // cascaded child
    const findChildren = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ session_id: childId }], error: null }) // children of named
      .mockResolvedValueOnce(noChildren); // children of child
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 2 });

    // Named session ended with caller's reason
    expect(endRow).toHaveBeenNthCalledWith(1, params);
    // Child ended with reason='cascade', same player_key
    expect(endRow).toHaveBeenNthCalledWith(2, {
      session_id: childId,
      player_key: params.player_key,
      reason: 'cascade',
    });
  });

  it('recurses to grandchildren — affected counts the whole subtree', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValueOnce(okEndOf(namedId))
      .mockResolvedValueOnce(okEndOf(childId))
      .mockResolvedValueOnce(okEndOf(grandchildId));
    const findChildren = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ session_id: childId }], error: null }) // named -> child
      .mockResolvedValueOnce({ data: [{ session_id: grandchildId }], error: null }) // child -> grandchild
      .mockResolvedValueOnce(noChildren); // grandchild -> nothing
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 3 });
    expect(endRow).toHaveBeenCalledTimes(3);
    expect(findChildren).toHaveBeenCalledTimes(3);
  });

  it('cascades across multiple sibling children', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValueOnce(okEndOf(namedId))
      .mockResolvedValueOnce(okEndOf(childId))
      .mockResolvedValueOnce(okEndOf(otherChildId));
    const findChildren = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ session_id: childId }, { session_id: otherChildId }],
        error: null,
      }) // named has 2 children
      .mockResolvedValue(noChildren); // both children are leaves
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 3 });
  });

  it('skips already-ended children — they are excluded by the findChildren filter', async () => {
    // findChildren only returns ACTIVE children (the SELECT in api/sessions.ts
    // applies ended_at IS NULL). We don't filter again here.
    const endRow = vi.fn().mockResolvedValueOnce(okEndOf(namedId));
    const findChildren = vi.fn().mockResolvedValue(noChildren); // no active children
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: true, affected: 1 });
    expect(endRow).toHaveBeenCalledTimes(1);
  });

  it('returns ok: false if a cascaded UPDATE fails midway', async () => {
    const endRow = vi
      .fn()
      .mockResolvedValueOnce(okEndOf(namedId))
      .mockResolvedValueOnce({ data: null, error: { code: 'XX001', message: 'storage error' } });
    const findChildren = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ session_id: childId }], error: null });
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: false });
  });

  it('returns ok: false if findChildren errors', async () => {
    const endRow = vi.fn().mockResolvedValueOnce(okEndOf(namedId));
    const findChildren = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { code: 'XX002', message: 'query error' } });
    const endSession = createSupabaseEndSession(endRow, findChildren);

    expect(await endSession(params)).toEqual({ ok: false });
  });
});
