import { describe, expect, it, vi } from 'vitest';
import {
  appendMachineLog,
  type AppendMachineLogDeps,
  type MachineLogTarget,
} from './appendMachineLog.js';
import type { PathPatchRow, PatchRow } from './upsertPatch.js';
import type { AbsPath } from '../types.js';
import { logRow } from '../../test/factories/logRows.js';

const LOG_KEY = 'ap:TYRELL-CORP';
const WIPER_KEY = 'b0b-public-key';
const SAME_INSTANT = '2026-10-04T10:00:00.000000+00:00';

const target = (over: Partial<MachineLogTarget> = {}): MachineLogTarget => ({
  writerKey: LOG_KEY,
  machineId: 'gateway-machine',
  path: '/var/log/auth.log' as AbsPath,
  owner: 'root',
  permissions: { read: ['root'], write: ['root'], execute: [] },
  ...over,
});

/** The log's own copy, holding one line the system wrote before anything a test adds. */
const row = (over: Partial<PathPatchRow> = {}): PathPatchRow =>
  logRow({
    content: 'Oct  4 09:00:00 gw sshd[1]: Accepted password for root from 87.1.2.3\n',
    updated_at: '2026-10-04T09:00:00.000000+00:00',
    writer_key: LOG_KEY,
    ...over,
  });

const makeDeps = (rows: readonly PathPatchRow[] | null, error: unknown = null) => {
  const upsertPatch = vi.fn<(written: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<AppendMachineLogDeps['readLog']>(async () => ({ data: rows, error }));
  return { deps: { readLog, upsertPatch }, upsertPatch, readLog };
};

const NEW_LINE = 'Oct  4 11:00:00 gw sshd[2]: Failed password for root from 193.4.5.6';

describe('appendMachineLog', () => {
  it('starts a log that no one has written yet with the new line', async () => {
    const { deps, upsertPatch } = makeDeps([]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch).toHaveBeenCalledWith({
      writer_key: LOG_KEY,
      machine_id: 'gateway-machine',
      path: '/var/log/auth.log',
      content: `${NEW_LINE}\n`,
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: [] },
      node_type: 'file',
    });
  });

  it('reads every writer’s copy of the log on that machine, not only its own', async () => {
    const { deps, readLog } = makeDeps([]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(readLog).toHaveBeenCalledWith({
      machine_id: 'gateway-machine',
      path: '/var/log/auth.log',
    });
  });

  it('appends after the existing lines when no one else has written the log', async () => {
    const earlier = row();
    const { deps, upsertPatch } = makeDeps([earlier]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${earlier.content}${NEW_LINE}\n`);
  });

  it('builds on a truncate made after its last line, so the wiped lines stay gone', async () => {
    const wipe = row({
      content: '',
      updated_at: '2026-10-04T10:00:00.000000+00:00',
      writer_key: WIPER_KEY,
    });
    const { deps, upsertPatch } = makeDeps([wipe, row()]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${NEW_LINE}\n`);
  });

  it('builds on an rm made after its last line, bringing the file back with only the new line', async () => {
    const tombstone = row({
      content: null,
      updated_at: '2026-10-04T10:00:00.000000+00:00',
      writer_key: WIPER_KEY,
    });
    const { deps, upsertPatch } = makeDeps([tombstone, row()]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${NEW_LINE}\n`);
  });

  it('keeps the lines written after an older wipe, since that wipe was already superseded', async () => {
    const olderWipe = row({
      content: '',
      updated_at: '2026-10-04T08:00:00.000000+00:00',
      writer_key: WIPER_KEY,
    });
    const sinceThen = row();
    const { deps, upsertPatch } = makeDeps([sinceThen, olderWipe]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${sinceThen.content}${NEW_LINE}\n`);
  });

  it('breaks a same-instant tie the way a reader does, by writer key', async () => {
    // 'ap:…' sorts before 'b0b…', so a reader shows the wiper's copy last.
    const wipe = row({ content: '', updated_at: SAME_INSTANT, writer_key: WIPER_KEY });
    const logged = row({ updated_at: SAME_INSTANT });
    const { deps, upsertPatch } = makeDeps([wipe, logged]);

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch.mock.calls[0]![0].content).toBe(`${NEW_LINE}\n`);
  });

  it('writes nothing when the read fails, rather than clobbering the log', async () => {
    const { deps, upsertPatch } = makeDeps(null, new Error('read failed'));

    await appendMachineLog(deps, target(), NEW_LINE);

    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
