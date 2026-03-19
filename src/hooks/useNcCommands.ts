import { useMemo } from 'react';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import {
  createNcPwdCommand,
  createNcCdCommand,
  createNcLsCommand,
  createNcCatCommand,
  createNcWhoamiCommand,
  ncHelpCommand,
  ncExitCommand,
  createNcBashCommand,
} from '../commands/nc/index';
import { startSshd, SSH_PID_FILE_PATH, type SshdAdapter } from '../commands/sshd';
import { startFtpd, FTP_PID_FILE_PATH, type FtpdAdapter } from '../commands/ftpd';
import { listProcesses, type PsAdapter } from '../commands/ps';
import { useNetwork } from '../network';
import type { Command } from '../components/Terminal/types';
import type { MachineId } from '../filesystem/machineFileSystems';

export const useNcCommands = (): Map<string, Command> | null => {
  const { ncSession, updateNcCwd } = useSession();

  const { resolvePathForMachine, getNodeFromMachine, canTraverseOnMachine, createFileOnMachine } =
    useFileSystem();
  const { getMachine: getMachineInfo } = useNetwork();

  return useMemo(() => {
    if (!ncSession) return null;

    const commands = new Map<string, Command>();

    // Context getters
    const getMachine = () => ncSession.targetIP as MachineId;
    const getCwd = () => ncSession.currentPath;
    const getUserType = () => ncSession.userType;
    const getUsername = () => ncSession.username;

    // pwd - print working directory
    commands.set('pwd', createNcPwdCommand({ getCwd }));

    // cd - change directory
    commands.set(
      'cd',
      createNcCdCommand({
        getMachine,
        getCwd,
        getUserType,
        setCwd: updateNcCwd,
        resolvePath: resolvePathForMachine,
        getNodeFromMachine,
        canTraverseOnMachine,
      }),
    );

    // ls - list directory
    commands.set(
      'ls',
      createNcLsCommand({
        getMachine,
        getCwd,
        getUserType,
        resolvePath: resolvePathForMachine,
        getNodeFromMachine,
        canTraverseOnMachine,
      }),
    );

    // cat - read file
    commands.set(
      'cat',
      createNcCatCommand({
        getMachine,
        getCwd,
        getUserType,
        resolvePath: resolvePathForMachine,
        getNodeFromMachine,
        canTraverseOnMachine,
      }),
    );

    // whoami - show current user
    commands.set('whoami', createNcWhoamiCommand({ getUsername }));

    // bash - execute binary by filesystem path (no PATH in raw nc shell).
    // Collects all registered NC commands plus hidden ones (sshd) so that
    // bash('/bin/cat', '/etc/passwd') works just like cat('/etc/passwd').
    const sshdFn = (...args: unknown[]): string => {
      const machine = getMachine();
      const machineInfo = getMachineInfo(machine);
      const adapter: SshdAdapter = {
        isPortOpen: (port) =>
          machineInfo?.ports.some((p) => p.port === port && p.service === 'ssh' && p.open) ?? false,
        readPidFile: () => {
          const node = getNodeFromMachine(machine, SSH_PID_FILE_PATH, '/');
          return node?.type === 'file' ? (node.content ?? undefined) : undefined;
        },
        writePidFile: (content) =>
          createFileOnMachine(machine, SSH_PID_FILE_PATH, '/', content, 'root'),
      };
      return startSshd(adapter, args);
    };
    const ftpdFn = (...args: unknown[]): string => {
      const machine = getMachine();
      const machineInfo = getMachineInfo(machine);
      const adapter: FtpdAdapter = {
        isPortOpen: (port) =>
          machineInfo?.ports.some((p) => p.port === port && p.service === 'ftp' && p.open) ?? false,
        readPidFile: () => {
          const node = getNodeFromMachine(machine, FTP_PID_FILE_PATH, '/');
          return node?.type === 'file' ? (node.content ?? undefined) : undefined;
        },
        writePidFile: (content) =>
          createFileOnMachine(machine, FTP_PID_FILE_PATH, '/', content, 'root'),
      };
      return startFtpd(adapter, args);
    };
    const psFn = (): string => {
      const machine = getMachine();
      const machineInfo = getMachineInfo(machine);
      const adapter: PsAdapter = {
        getMachineInfo: () => machineInfo,
        readPidFile: (path) => {
          const node = getNodeFromMachine(machine, path, '/');
          return node?.type === 'file' ? (node.content ?? undefined) : undefined;
        },
        readDirectory: (path) => {
          const node = getNodeFromMachine(machine, path, '/');
          if (node?.type !== 'directory' || !node.children) return undefined;
          const entries: Record<string, string> = {};
          for (const [name, child] of Object.entries(node.children)) {
            if (child.type === 'file' && child.content) entries[name] = child.content;
          }
          return entries;
        },
      };
      const header = 'PID     USER       COMMAND';
      const rows = listProcesses(adapter).map(
        (p) => `${String(p.pid).padEnd(8)}${p.user.padEnd(11)}${p.command}`,
      );
      return [header, ...rows].join('\n');
    };
    const bashCommands = new Map<string, (...args: unknown[]) => unknown>();
    commands.forEach((cmd, name) => bashCommands.set(name, cmd.fn));
    bashCommands.set('sshd', sshdFn);
    bashCommands.set('ftpd', ftpdFn);
    bashCommands.set('ps', psFn);
    commands.set(
      'bash',
      createNcBashCommand({
        getMachine,
        getUserType,
        getNodeFromMachine,
        findCommand: (name) => bashCommands.get(name),
      }),
    );

    // help - show available commands
    commands.set('help', ncHelpCommand);

    // exit - close connection
    commands.set('exit', ncExitCommand);

    return commands;
  }, [
    ncSession,
    updateNcCwd,
    resolvePathForMachine,
    getNodeFromMachine,
    canTraverseOnMachine,
    createFileOnMachine,
    getMachineInfo,
  ]);
};
