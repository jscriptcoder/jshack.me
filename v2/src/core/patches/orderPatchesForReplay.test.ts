import { describe, it, expect } from 'vitest';
import { orderPatchesForReplay } from './orderPatchesForReplay';

/** A minimal replay-orderable row. The real reads pass richer rows
 *  (`OwnerPatchRow`, own-box rows); this proves the ordering contract those
 *  rows rely on before `applyPatches` folds them left-to-right. */
type ReplayRow = {
  readonly updated_at: string;
  readonly writer_key: string;
  readonly path: string;
};

const T_EARLY = '2026-06-14T12:00:00.000000+00:00';
const T_LATE = '2026-06-14T13:00:00.000000+00:00';

const replayRow = (overrides: Partial<ReplayRow>): ReplayRow => ({
  updated_at: T_EARLY,
  writer_key: 'key-default',
  path: '/tmp/file',
  ...overrides,
});

describe('orderPatchesForReplay', () => {
  it('orders oldest-first so the latest server write replays last (and wins)', () => {
    const older = replayRow({ updated_at: T_EARLY, path: '/tmp/a' });
    const newer = replayRow({ updated_at: T_LATE, path: '/tmp/b' });

    const ordered = orderPatchesForReplay([newer, older]);

    expect(ordered.map((row) => row.path)).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('keeps an already-chronological pair in place (newer stays last)', () => {
    const older = replayRow({ updated_at: T_EARLY, path: '/tmp/a' });
    const newer = replayRow({ updated_at: T_LATE, path: '/tmp/b' });

    const ordered = orderPatchesForReplay([older, newer]);

    expect(ordered.map((row) => row.path)).toEqual(['/tmp/a', '/tmp/b']);
  });

  it('retains every writer’s row for one path, latest writer last (wins)', () => {
    const path = '/tmp/shared';
    const writerB = replayRow({ writer_key: 'key-b', updated_at: T_EARLY, path });
    const writerA = replayRow({ writer_key: 'key-a', updated_at: T_LATE, path });

    const ordered = orderPatchesForReplay([writerA, writerB]);

    expect(ordered).toHaveLength(2);
    expect(ordered.map((row) => row.writer_key)).toEqual(['key-b', 'key-a']);
  });

  it('lets the server timestamp dominate the writer tiebreak (newer ts wins even with an earlier-sorting writer)', () => {
    // early row has a LATER-sorting writer; late row has an EARLIER-sorting
    // writer. Chronology (updated_at) must win, not writer_key.
    const early = replayRow({ updated_at: T_EARLY, writer_key: 'zzz', path: '/tmp/early' });
    const late = replayRow({ updated_at: T_LATE, writer_key: 'aaa', path: '/tmp/late' });

    expect(orderPatchesForReplay([early, late]).map((row) => row.path)).toEqual([
      '/tmp/early',
      '/tmp/late',
    ]);
    expect(orderPatchesForReplay([late, early]).map((row) => row.path)).toEqual([
      '/tmp/early',
      '/tmp/late',
    ]);
  });

  it('breaks an equal-timestamp tie deterministically by writer_key ascending, from either input order', () => {
    const writerZ = replayRow({ writer_key: 'zzz', updated_at: T_EARLY });
    const writerA = replayRow({ writer_key: 'aaa', updated_at: T_EARLY });

    expect(orderPatchesForReplay([writerZ, writerA]).map((row) => row.writer_key)).toEqual([
      'aaa',
      'zzz',
    ]);
    expect(orderPatchesForReplay([writerA, writerZ]).map((row) => row.writer_key)).toEqual([
      'aaa',
      'zzz',
    ]);
  });

  it('preserves input order for rows identical on (updated_at, writer_key)', () => {
    const first = replayRow({ updated_at: T_EARLY, writer_key: 'key-k', path: '/tmp/first' });
    const second = replayRow({ updated_at: T_EARLY, writer_key: 'key-k', path: '/tmp/second' });

    expect(orderPatchesForReplay([first, second]).map((row) => row.path)).toEqual([
      '/tmp/first',
      '/tmp/second',
    ]);
  });

  it('does not mutate the input array', () => {
    const newer = replayRow({ updated_at: T_LATE, path: '/tmp/newer' });
    const older = replayRow({ updated_at: T_EARLY, path: '/tmp/older' });
    const input = [newer, older];

    orderPatchesForReplay(input);

    expect(input.map((row) => row.path)).toEqual(['/tmp/newer', '/tmp/older']);
  });
});
