import { useMemo, useCallback } from 'react';
import type { Command } from '../components/Terminal/types';
import { echoCommand } from '../commands/echo';
import { authorCommand } from '../commands/author';
import { clearCommand } from '../commands/clear';
import { exitCommand } from '../commands/exit';
import { createSuCommand } from '../commands/su';
import { createHelpCommand } from '../commands/help';
import { createManCommand } from '../commands/man';
import { createResolveCommand } from '../commands/resolve';
import { createNodeCommand } from '../commands/node';
import { createResetCommand } from '../commands/reset';
import { createThemeCommand } from '../commands/theme';
import { createMissionsCommand } from '../commands/missions';
import { createAcceptCommand } from '../commands/accept';
import { createAbortCommand } from '../commands/abort';
import { createMailCommand } from '../commands/mail';
import { createAptCommand } from '../commands/apt';
import { createRebootCommand } from '../commands/reboot';
import { createSshdCommand } from '../commands/sshd';
import { createVsftpdCommand } from '../commands/vsftpd';
import { createSystemctlCommand } from '../commands/systemctl';
import { createBashCommand } from '../commands/bash';
import { createPsCommand } from '../commands/ps';
import { xtermCommand } from '../commands/xterm';
import { useMission } from '../mission';
import {
  isCommandVisible,
  checkCommandAccess,
  wrapWithAccessCheck,
} from '../commands/availability';
import { useFileSystemCommands } from './useFileSystemCommands';
import { useNetworkCommands } from './useNetworkCommands';
import { useWifiCommands } from './useWifiCommands';
import { useSession } from '../session/SessionContext';
import { useNetwork } from '../network';
import { useFileSystem } from '../filesystem';
import { getDatabase } from '../utils/storageCache';
import { appendToMachineLog } from '../logging/appendToMachineLog';
import { formatSuSuccess, formatSuFailed } from '../logging/formatters';
import { generatePid, resolveHostname } from '../logging/utils';

// Shell builtins and game commands don't need binary checks
const SKIP_ACCESS_CHECK = new Set([
  'cd',
  'exit',
  'clear',
  'echo',
  'pwd',
  'help',
  'whoami',
  'bash',
  'missions',
  'accept',
  'abort',
  'mail',
  'output',
  'resolve',
  'author',
  'theme',
  'reset',
  'xterm',
]);

type UseCommandsResult = {
  readonly executionContext: Record<string, (...args: unknown[]) => unknown>;
  readonly commandNames: readonly string[];
};

export const useCommands = (): UseCommandsResult => {
  const fileSystemCommands = useFileSystemCommands();
  const networkCommands = useNetworkCommands();
  const wifiCommands = useWifiCommands();
  const {
    session,
    setTheme,
    setUsername,
    setCurrentPath,
    pushSession,
    popAllSessions,
    popSession,
    canReturn,
    markMachineBricked,
    isMachineBricked,
    wifiConnected,
  } = useSession();
  const { findMachineUsers, getMachine: getMachineInfo } = useNetwork();
  const {
    resolvePath,
    getNode,
    readFileFromMachine,
    writeFileToMachine,
    createFileOnMachine,
    createFile,
    getNodeFromMachine,
    deleteNodeFromMachine,
    canTraverse,
  } = useFileSystem();
  const {
    isMissionActive,
    startMission,
    abortMission,
    completeMission,
    activeMission,
    usedPublicIps,
  } = useMission();

  const getUsers = useCallback((): readonly string[] => {
    if (session.machine === 'localhost') {
      // Parse usernames from /etc/passwd on the localhost filesystem
      const passwdContent = readFileFromMachine({
        machineId: 'localhost',
        path: '/etc/passwd',
        cwd: '/',
        userType: 'root',
      });
      if (passwdContent) {
        return passwdContent
          .split('\n')
          .filter((line) => line.includes(':'))
          .map((line) => line.split(':')[0]);
      }
      return ['root', session.username, 'guest'];
    }
    return findMachineUsers(session.machine).map((u) => u.username);
  }, [session.machine, session.username, findMachineUsers, readFileFromMachine]);

  return useMemo(() => {
    // Circular dependency workaround: node(path) needs the full execution context
    // (which includes node itself). We declare this mutable ref first, pass a lazy
    // getter to createNodeCommand, then assign the real context after building it.
    // The getter is only called at execution time, so the assignment always happens first.
    let resolvedExecutionContext: Record<string, (...args: unknown[]) => unknown> = {};

    const commands = new Map<string, Command>();

    commands.set('echo', echoCommand);
    commands.set('author', authorCommand);
    commands.set('clear', clearCommand);
    commands.set('exit', exitCommand);
    commands.set('xterm', xtermCommand);
    commands.set('resolve', createResolveCommand());
    commands.set('reset', createResetCommand({ getDatabase }));
    commands.set(
      'theme',
      createThemeCommand({
        setTheme,
        getCurrentTheme: () => session.theme,
      }),
    );

    const logFs = { readFileFromMachine, writeFileToMachine, createFileOnMachine };

    const suCommand = createSuCommand({
      getUsers,
      readFile: (path: string, userType: 'root' | 'user' | 'guest') =>
        readFileFromMachine({ machineId: session.machine, path, cwd: '/', userType }),
      findMachineUsers: () => findMachineUsers(session.machine),
      setUsername,
      setCurrentPath,
      pushSession: () => pushSession('su'),
      onAuthResult: (success, targetUser) => {
        const hostname = resolveHostname(session.machine, getMachineInfo);
        const formatter = success ? formatSuSuccess : formatSuFailed;
        const logLine = formatter(
          new Date(),
          hostname,
          generatePid(),
          targetUser,
          session.username,
        );
        appendToMachineLog(session.machine, '/var/log/auth.log', logLine, logFs);
      },
    });
    commands.set('su', suCommand);

    commands.set(
      'node',
      createNodeCommand({
        resolvePath,
        getNode,
        getUserType: () => session.userType,
        canTraverse: (path: string) => canTraverse(path, session.userType),
        getExecutionContext: () => resolvedExecutionContext,
        getDecodeFn: () => {
          const missionType = activeMission?.objective.type;
          if (missionType !== 'script_fix' && missionType !== 'script_auto') return undefined;
          const { expectedChecksum, expectedProof } = activeMission.objective;
          return (value: unknown) => {
            if (String(value) === expectedChecksum) return expectedProof;
            return 'ERROR: checksum mismatch — script output is incorrect';
          };
        },
      }),
    );

    commands.set(
      'missions',
      createMissionsCommand({ isMissionActive, getActiveMission: () => activeMission }),
    );
    commands.set(
      'accept',
      createAcceptCommand({
        startMission,
        isMissionActive,
        getUsedPublicIps: () => usedPublicIps,
      }),
    );
    commands.set('abort', createAbortCommand({ abortMission, isMissionActive, popAllSessions }));
    commands.set(
      'mail',
      createMailCommand({
        getActiveMission: () => activeMission,
        completeMission,
        readFileFromMachine,
        isMachineBricked,
      }),
    );

    commands.set(
      'apt',
      createAptCommand({
        getMachine: () => session.machine,
        getNode,
        createFile,
        getUserType: () => session.userType,
        isWifiConnected: () => wifiConnected,
      }),
    );

    commands.set(
      'reboot',
      createRebootCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
        readFileFromMachine,
        popSession,
        canReturn,
        markMachineBricked,
      }),
    );

    commands.set(
      'sshd',
      createSshdCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
        createFileOnMachine: createFile,
      }),
    );

    commands.set(
      'vsftpd',
      createVsftpdCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
        createFileOnMachine: createFile,
      }),
    );

    commands.set(
      'systemctl',
      createSystemctlCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
        createFileOnMachine: createFile,
        deleteFileOnMachine: deleteNodeFromMachine,
      }),
    );

    commands.set(
      'ps',
      createPsCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
      }),
    );

    commands.set(
      'bash',
      createBashCommand({
        getNode: (path) => getNodeFromMachine(session.machine, path, '/'),
        getUserType: () => session.userType,
        getExecutionContext: () => resolvedExecutionContext,
      }),
    );

    fileSystemCommands.forEach((cmd, name) => commands.set(name, cmd));
    networkCommands.forEach((cmd, name) => commands.set(name, cmd));
    wifiCommands.forEach((cmd, name) => commands.set(name, cmd));

    const getVisibleCommands = () =>
      Array.from(commands.keys())
        .filter((name) =>
          isCommandVisible(name, session.machine, getNodeFromMachine, session.currentPath),
        )
        .map((name) => commands.get(name))
        .filter((cmd): cmd is Command => cmd !== undefined);

    const getCommandsMap = () => commands;

    const helpCommand = createHelpCommand(getVisibleCommands);
    const manCommand = createManCommand(getCommandsMap);

    commands.set('help', helpCommand);
    commands.set('man', manCommand);

    // Wrap all non-builtin/non-game commands with unified access check
    // (binary existence + execute permissions)
    commands.forEach((cmd, name) => {
      if (!SKIP_ACCESS_CHECK.has(name)) {
        commands.set(
          name,
          wrapWithAccessCheck(cmd, name, () =>
            checkCommandAccess(
              name,
              session.machine,
              getNodeFromMachine,
              session.currentPath,
              session.userType,
            ),
          ),
        );
      }
    });

    const executionContext: Record<string, (...args: unknown[]) => unknown> = Object.fromEntries(
      Array.from(commands.entries()).map(([name, cmd]) => [name, cmd.fn]),
    );

    resolvedExecutionContext = executionContext;

    // Show all commands with a visible binary (or builtins/game commands) —
    // no user-type filtering, all users see the same commands
    const commandNames = Array.from(commands.keys()).filter((name) =>
      isCommandVisible(name, session.machine, getNodeFromMachine, session.currentPath),
    );

    return { executionContext, commandNames };
  }, [
    fileSystemCommands,
    networkCommands,
    wifiCommands,
    getUsers,
    session.username,
    session.userType,
    session.machine,
    session.currentPath,
    session.theme,
    setTheme,
    resolvePath,
    getNode,
    getNodeFromMachine,
    createFile,
    canTraverse,
    isMissionActive,
    startMission,
    abortMission,
    completeMission,
    activeMission,
    readFileFromMachine,
    setUsername,
    setCurrentPath,
    pushSession,
    findMachineUsers,
    popAllSessions,
    popSession,
    canReturn,
    markMachineBricked,
    isMachineBricked,
    wifiConnected,
    getMachineInfo,
    writeFileToMachine,
    createFileOnMachine,
    deleteNodeFromMachine,
  ]);
};
