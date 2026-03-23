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

/** Append a log line to a file on a remote machine, creating it if missing. */
export const appendToMachineLog = (
  machineId: string,
  logPath: string,
  logLine: string,
  fs: LogFileSystemDeps,
): void => {
  const existing = fs.readFileFromMachine({ machineId, path: logPath, cwd: '/', userType: 'root' });

  if (existing === null) {
    fs.createFileOnMachine({
      machineId,
      path: logPath,
      cwd: '/',
      content: logLine,
      userType: 'root',
      permissions: LOG_FILE_PERMISSIONS,
    });
    return;
  }

  const base = existing.replace(/\n$/, '');
  const newContent = base === '' ? logLine : `${base}\n${logLine}`;
  fs.writeFileToMachine({
    machineId,
    path: logPath,
    cwd: '/',
    content: newContent,
    userType: 'root',
  });
};
