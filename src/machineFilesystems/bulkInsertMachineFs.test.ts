import { describe, it, expect, vi } from 'vitest';
import { createBulkInsertMachineFs } from './bulkInsertMachineFs';
import type { MachineFsRow } from './flattenFileNode';

const mkRow = (i: number): MachineFsRow => ({
  machine_id: 'm1',
  path: `/file-${i}`,
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: ['root'] },
  node_type: 'file',
  content: `content-${i}`,
});

describe('createBulkInsertMachineFs', () => {
  it('returns ok: true with inserted: 0 when given an empty rows array (no DB call)', async () => {
    const bulkInsertFn = vi.fn();
    const insert = createBulkInsertMachineFs(bulkInsertFn);

    expect(await insert([])).toEqual({ ok: true, inserted: 0 });
    expect(bulkInsertFn).not.toHaveBeenCalled();
  });

  it('issues a single batch when rows fit in one chunk', async () => {
    const bulkInsertFn = vi.fn().mockResolvedValue({ error: null });
    const insert = createBulkInsertMachineFs(bulkInsertFn);
    const rows = Array.from({ length: 10 }, (_, i) => mkRow(i));

    const result = await insert(rows);

    expect(result).toEqual({ ok: true, inserted: 10 });
    expect(bulkInsertFn).toHaveBeenCalledTimes(1);
    expect(bulkInsertFn).toHaveBeenCalledWith(rows);
  });

  it('chunks rows beyond the 500-row threshold', async () => {
    // 1200 rows → ceil(1200 / 500) = 3 chunks of 500/500/200.
    const bulkInsertFn = vi.fn().mockResolvedValue({ error: null });
    const insert = createBulkInsertMachineFs(bulkInsertFn);
    const rows = Array.from({ length: 1200 }, (_, i) => mkRow(i));

    const result = await insert(rows);

    expect(result).toEqual({ ok: true, inserted: 1200 });
    expect(bulkInsertFn).toHaveBeenCalledTimes(3);
    expect(bulkInsertFn.mock.calls[0]?.[0]).toHaveLength(500);
    expect(bulkInsertFn.mock.calls[1]?.[0]).toHaveLength(500);
    expect(bulkInsertFn.mock.calls[2]?.[0]).toHaveLength(200);
  });

  it('returns ok: false on first failed chunk and stops issuing further chunks', async () => {
    // Pinned: a partial-success that pretended ok:true would leave
    // machine_filesystems half-populated and invisible until the
    // operator re-ran the backfill. Caller sees the failure and
    // decides retry vs. abort.
    const bulkInsertFn = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: 'XX001', message: 'connection lost' } });
    const insert = createBulkInsertMachineFs(bulkInsertFn);
    const rows = Array.from({ length: 1200 }, (_, i) => mkRow(i));

    const result = await insert(rows);

    expect(result).toEqual({ ok: false });
    // Stops after the first error — the third chunk should NOT have run.
    expect(bulkInsertFn).toHaveBeenCalledTimes(2);
  });

  it('forwards the rows to bulkInsertFn unchanged (no transformation)', async () => {
    const bulkInsertFn = vi.fn().mockResolvedValue({ error: null });
    const insert = createBulkInsertMachineFs(bulkInsertFn);
    const customRow: MachineFsRow = {
      machine_id: 'router',
      path: '/etc/hostname',
      owner: 'user',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      node_type: 'file',
      content: 'router-1',
    };

    await insert([customRow]);

    expect(bulkInsertFn).toHaveBeenCalledWith([customRow]);
  });
});
