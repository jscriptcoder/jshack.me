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
 * (which machine + which log path) differ. That also makes it the one place a line
 * is held to being ONE line, whichever caller-sent field it was built from.
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

/** A line break inside the line, spelled out the way a daemon writes one it was sent.
 *  Most of a line is the caller's own words — a path, an account, a package name — and a
 *  break left standing would end the line early and start another the caller wrote
 *  whole, timestamp and address included, in a log somebody else reads as evidence.
 *  Written rather than refused, because the attempt is itself something to record. */
const onOneLine = (line: string): string => line.replace(/\r/g, '\\r').replace(/\n/g, '\\n');

/** Land several lines in ONE append: they are one event to the box, and an append each
 *  would be a read-modify-write each, racing over the same file. The lines arrive apart
 *  rather than already joined, so the only breaks in what is written are the ones
 *  between them. */
export const appendMachineLogLines = async (
  deps: AppendMachineLogDeps,
  target: MachineLogTarget,
  lines: readonly string[],
): Promise<void> => {
  const existing = await deps.readLog({ machine_id: target.machineId, path: target.path });
  if (existing.error) return;

  const current = logAsReadersSeeIt(existing.data);
  await deps.upsertPatch({
    writer_key: target.writerKey,
    machine_id: target.machineId,
    path: target.path,
    content: `${current}${lines.map(onOneLine).join('\n')}\n`,
    owner: target.owner,
    permissions: target.permissions,
    node_type: 'file',
  });
};

export const appendMachineLog = (
  deps: AppendMachineLogDeps,
  target: MachineLogTarget,
  line: string,
): Promise<void> => appendMachineLogLines(deps, target, [line]);
