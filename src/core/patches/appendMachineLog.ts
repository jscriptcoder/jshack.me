/**
 * appendMachineLog — the shared server-side primitive for landing one already-
 * formatted syslog line on a machine's log file as the SYSTEM, not the player.
 *
 * It is a read-modify-write expressed as a patch: read the log as a READER sees it,
 * append `${line}\n`, upsert. "As a reader sees it" is the latest of every writer's
 * rows at the path, not the appender's own row: a root wipe (a truncate, or an `rm`
 * tombstone) lands under the WIPER's key, so building on the appender's own older
 * row would bring the wiped lines back with the next line recorded, and no wipe
 * would ever stick.
 *
 * It deliberately bypasses L1/L2 — a service (sshd
 * today; nmap/ftp/nc/mysqld/redis next) records the login/scan it just handled,
 * so the write is the system's, not a player-tier action. Every such server
 * action reuses THIS function; only the formatter (the line) and the target
 * (which machine + which log path) differ.
 *
 * Fire-and-forget by design: system logging must never break the action it
 * records, so it returns nothing and surfaces no error. A FAILED read bails
 * without writing — better to drop one log line than clobber an existing log
 * with a contentless write when the read transiently failed.
 */

import type { AbsPath } from '../types.js';
import type { FilePermissions } from '../filesystem/types.js';
import type { ListPathPatchesResult, PatchRow } from './upsertPatch.js';
import { orderPatchesForReplay } from './orderPatchesForReplay.js';

export type MachineLogReadQuery = {
  readonly machine_id: string;
  readonly path: string;
};

/** Every writer's row at the log's path on the machine. */
export type MachineLogReadResult = ListPathPatchesResult;

/** The log a reader sees, which every system append builds on: the latest of every
 *  writer's rows at the path. A tombstone (`content: null`) reads as an empty log, so
 *  the next line recreates the file holding only itself. */
export const logAsReadersSeeIt = (rows: MachineLogReadResult['data']): string =>
  orderPatchesForReplay(rows ?? []).at(-1)?.content ?? '';

export type AppendMachineLogDeps = {
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type MachineLogTarget = {
  /** Provenance of the log line: the acting player (the one whose action — scan,
   *  login — the system recorded). The row keys on `(machineId, path, writerKey)`
   *  in the shared journal. */
  readonly writerKey: string;
  readonly machineId: string;
  readonly path: AbsPath;
  readonly owner: string;
  readonly permissions: FilePermissions;
};

export const appendMachineLog = async (
  deps: AppendMachineLogDeps,
  target: MachineLogTarget,
  line: string,
): Promise<void> => {
  const existing = await deps.readLog({ machine_id: target.machineId, path: target.path });
  if (existing.error) return;

  const current = logAsReadersSeeIt(existing.data);
  await deps.upsertPatch({
    writer_key: target.writerKey,
    machine_id: target.machineId,
    path: target.path,
    content: `${current}${line}\n`,
    owner: target.owner,
    permissions: target.permissions,
    node_type: 'file',
  });
};
