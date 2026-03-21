import type { MachineId, PermissionResult } from '../filesystem/types';

export type LogFileSystemDeps = {
  readonly readFileFromMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    userType: 'root',
  ) => string | null;
  readonly writeFileToMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: 'root',
  ) => PermissionResult;
  readonly createFileOnMachine: (
    machineId: MachineId,
    path: string,
    cwd: string,
    content: string,
    userType: 'root',
  ) => PermissionResult;
};

/** Append a log line to a file on a remote machine, creating it if missing. */
export const appendToMachineLog = (
  machineId: string,
  logPath: string,
  logLine: string,
  fs: LogFileSystemDeps,
): void => {
  const existing = fs.readFileFromMachine(machineId, logPath, '/', 'root');

  if (existing === null) {
    fs.createFileOnMachine(machineId, logPath, '/', logLine, 'root');
    return;
  }

  const base = existing.replace(/\n$/, '');
  const newContent = base === '' ? logLine : `${base}\n${logLine}`;
  fs.writeFileToMachine(machineId, logPath, '/', newContent, 'root');
};
