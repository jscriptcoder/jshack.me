import type {
  FilePermissions,
  MachineCreateOp,
  MachineFileOp,
  MachineWriteOp,
  PermissionResult,
} from '../filesystem/types';

export type LogFileSystemDeps = {
  readonly readFileFromMachine: (op: MachineFileOp) => string | null;
  readonly writeFileToMachine: (op: MachineWriteOp) => PermissionResult;
  readonly createFileOnMachine: (op: MachineCreateOp) => PermissionResult;
};

// Log files should be world-readable, like real Linux /var/log/ files
const LOG_FILE_PERMISSIONS: FilePermissions = {
  read: ['root', 'user', 'guest'],
  write: ['root'],
  execute: ['root'],
};

// Append one or more log lines to a file on a remote machine, creating it if
// missing. Pass an array when emitting a burst of related lines from the same
// React tick (e.g. hydra's aggregate + per-success lines): they are joined
// with `\n` and committed in a single read-modify-write cycle so the
// underlying patch upsert sees one atomic content update. Two separate
// `appendToMachineLog` calls in the same tick still race because both observe
// the pre-batch React state — collect the lines into an array instead.
export const appendToMachineLog = (
  machineId: string,
  logPath: string,
  logLines: string | readonly string[],
  fs: LogFileSystemDeps,
): void => {
  const lines = typeof logLines === 'string' ? [logLines] : logLines;
  if (lines.length === 0) return;

  const joined = lines.join('\n');
  const existing = fs.readFileFromMachine({ machineId, path: logPath, cwd: '/', userType: 'root' });

  if (existing === null) {
    fs.createFileOnMachine({
      machineId,
      path: logPath,
      cwd: '/',
      content: joined,
      userType: 'root',
      permissions: LOG_FILE_PERMISSIONS,
    });
    return;
  }

  const base = existing.replace(/\n$/, '');
  const newContent = base === '' ? joined : `${base}\n${joined}`;
  fs.writeFileToMachine({
    machineId,
    path: logPath,
    cwd: '/',
    content: newContent,
    userType: 'root',
  });
};
