/**
 * appendMachineLog — the shared server-side primitive for landing one already-
 * formatted syslog line on a machine's log file as the SYSTEM, not the player.
 *
 * The database appends it (`append_machine_log`), under a lock on the log's machine and
 * path, so two lines landing at the same moment both land: read here and written back,
 * two appends at once built on the same copy and the later one dropped the earlier line.
 * It appends to the log as a READER sees it, the latest of every writer's rows at the
 * path, not the appender's own row: a root wipe (a truncate, or an `rm` tombstone) lands
 * under the WIPER's key, so building on the appender's own older row would bring the
 * wiped lines back with the next line recorded, and no wipe would ever stick.
 *
 * It deliberately bypasses L1/L2 — a service (sshd
 * today; nmap/ftp/nc/mysqld/redis next) records the login/scan it just handled,
 * so the write is the system's, not a player-tier action. Every such server
 * action reuses THIS function; only the formatter (the line) and the target
 * (which machine + which log path) differ. That also makes it the one place a line
 * is held to being ONE line, whichever caller-sent field it was built from.
 *
 * Fire-and-forget by design: system logging must never break the action it
 * records, so it returns nothing and surfaces no error.
 */

import type { AbsPath } from '../types.js';
import type { FilePermissions } from '../filesystem/types.js';

/** Text to add to the end of a machine's log, as the database's append takes it. A
 *  tombstone at the path reads as an empty log, so the text recreates the file holding
 *  only itself. */
export type MachineLogAppend = {
  readonly machine_id: string;
  readonly path: string;
  /** The row the appended log is written as: who the system recorded. */
  readonly writer_key: string;
  readonly owner: string;
  readonly permissions: FilePermissions;
  readonly text: string;
};

export type AppendLog = (append: MachineLogAppend) => Promise<{ readonly error: unknown }>;

export type AppendMachineLogDeps = {
  readonly appendLog: AppendLog;
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
 *  would let another line land between them. The lines arrive apart rather than already
 *  joined, so the only breaks in what is written are the ones between them. */
export const appendMachineLogLines = async (
  deps: AppendMachineLogDeps,
  target: MachineLogTarget,
  lines: readonly string[],
): Promise<void> => {
  await deps.appendLog({
    machine_id: target.machineId,
    path: target.path,
    writer_key: target.writerKey,
    owner: target.owner,
    permissions: target.permissions,
    text: `${lines.map(onOneLine).join('\n')}\n`,
  });
};

export const appendMachineLog = (
  deps: AppendMachineLogDeps,
  target: MachineLogTarget,
  line: string,
): Promise<void> => appendMachineLogLines(deps, target, [line]);
