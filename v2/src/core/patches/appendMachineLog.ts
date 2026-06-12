/**
 * appendMachineLog — the shared server-side primitive for landing one already-
 * formatted syslog line on a machine's log file as the SYSTEM, not the player.
 *
 * It is a read-modify-write expressed as a patch: read the current log content,
 * append `${line}\n`, upsert. It deliberately bypasses L1/L2 — a service (sshd
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

import type { AbsPath } from '../types';
import type { FilePermissions } from '../filesystem/types';
import type { PatchRow } from './upsertPatch';

export type MachineLogReadQuery = {
  readonly player_key: string;
  readonly machine_id: string;
  readonly path: string;
};

export type MachineLogReadResult = {
  readonly data: { readonly content: string | null } | null;
  readonly error: unknown;
};

export type AppendMachineLogDeps = {
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type MachineLogTarget = {
  /** The viewer whose regenerated copy of the machine the line lands on. */
  readonly playerKey: string;
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
  const existing = await deps.readLog({
    player_key: target.playerKey,
    machine_id: target.machineId,
    path: target.path,
  });
  if (existing.error) return;

  const current = existing.data?.content ?? '';
  await deps.upsertPatch({
    player_key: target.playerKey,
    machine_id: target.machineId,
    path: target.path,
    content: `${current}${line}\n`,
    owner: target.owner,
    permissions: target.permissions,
    node_type: 'file',
  });
};
