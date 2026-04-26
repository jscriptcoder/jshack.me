import { useMemo, useCallback } from 'react';
import type { Command } from '../components/Terminal/types';
import { echoCommand } from '../commands/echo';
import { authorCommand } from '../commands/author';
import { clearCommand } from '../commands/clear';
import { exitCommand } from '../commands/exit';
import { createSuCommand } from '../commands/su';
import { createHelpCommand } from '../commands/help';
import { createManCommand } from '../commands/man';
import { createNodeCommand } from '../commands/node';
import { createResetCommand } from '../commands/reset';
import { createThemeCommand } from '../commands/theme';
import { createIdentityCommand } from '../commands/identity';
import { getIdentity } from '../identity';
import { clearAllPatches as clearAllPatchesOnServer } from '../patchRegistry/client';
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
import { createKillCommand } from '../commands/kill';
import { xtermCommand } from '../commands/xterm';
import { createWriteFile } from '../scripting';
import { useMission } from '../mission';
import {
  isCommandVisible,
  checkCommandAccess,
  wrapWithAccessCheck,
} from '../commands/availability';
import { wrapWithLibraryCheck } from '../commands/libraryDeps';
import { createLddCommand } from '../commands/ldd';
import { useFileSystemCommands } from './useFileSystemCommands';
import { useNetworkCommands } from './useNetworkCommands';
import { useWifiCommands } from './useWifiCommands';
import { useSession } from '../session/SessionContext';
import { getGameTime } from '../session/gameTime';
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
  'author',
  'theme',
  'reset',
  'xterm',
  'identity',
]);

type UseCommandsResult = {
  readonly commands: ReadonlyMap<string, Command>;
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
    readFile,
    readFileFromMachine,
    writeFileToMachine,
    createFileOnMachine,
    createFile,
    writeFile,
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
    commands.set(
      'reset',
      createResetCommand({
        getDatabase,
        clearAllPatches: () => clearAllPatchesOnServer(getIdentity()),
      }),
    );
    commands.set(
      'theme',
      createThemeCommand({
        setTheme,
        getCurrentTheme: () => session.theme,
      }),
    );
    commands.set('identity', createIdentityCommand({ getIdentity }));

    const logFs = { readFileFromMachine, writeFileToMachine, createFileOnMachine };

    const suCommand = createSuCommand({
      getUsers,
      readFile: (path: string, userType: 'root' | 'user' | 'guest') =>
        readFileFromMachine({ machineId: session.machine, path, cwd: '/', userType }),
      findMachineUsers: () => findMachineUsers(session.machine),
      setUsername,
      setCurrentPath,
      // Fire-and-forget: su.ts is a sync command; pushSession's local state
      // update happens when the server call resolves. Race window is the
      // server round-trip; acceptable for Phase 1+3.
      pushSession: (destination) => {
        void pushSession('su', {
          machine: session.machine,
          hostname: session.hostname,
          ...destination,
        }).catch((error) => {
          console.error('[useCommands] pushSession su failed:', error);
        });
      },
      onAuthResult: (success, targetUser) => {
        const hostname = resolveHostname(session.machine, getMachineInfo);
        const formatter = success ? formatSuSuccess : formatSuFailed;
        const logLine = formatter({
          date: new Date(),
          hostname,
          pid: generatePid(),
          targetUser,
          fromUser: session.username,
        });
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
        getSystemFn: () => {
          if (!activeMission) return undefined;
          const missionType = activeMission.objective.type;
          if (missionType !== 'script_fix' && missionType !== 'script_auto') return undefined;
          const { expectedChecksum } = activeMission.objective;
          return (value: unknown) => {
            if (String(value) === expectedChecksum) return 'System check: PASS';
            return 'System check: FAIL — script output is incorrect';
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
        getCurrentMachine: () => getMachineInfo(session.machine),
        getNode,
        readFile: (path: string) => readFile(path, 'root'),
        createFile,
        writeFile,
        deleteFile: (path: string, userType) =>
          deleteNodeFromMachine({
            machineId: session.machine,
            path,
            cwd: '/',
            userType,
          }),
        getUserType: () => session.userType,
        isWifiConnected: () => wifiConnected,
        getGameTime,
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
      'kill',
      createKillCommand({
        getMachine: () => session.machine,
        getMachineInfo,
        getNodeFromMachine,
        deleteNodeFromMachine,
        getUserType: () => session.userType,
        getUsername: () => session.username,
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
    commands.set(
      'ldd',
      createLddCommand({
        getNode: (path: string) => getNodeFromMachine(session.machine, path, '/'),
      }),
    );

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

    // Wrap every command with the library-presence check. The wrapper is a
    // no-op for commands without a libraryDeps entry, so this is safe to
    // apply blanketly. Ordering: access-check runs first (binary exists +
    // executable), then library-check (dynamic linker loads .so files) —
    // matching real Linux execution order.
    commands.forEach((cmd, name) => {
      commands.set(
        name,
        wrapWithLibraryCheck(cmd, name, (path: string) =>
          getNodeFromMachine(session.machine, path, '/'),
        ),
      );
    });

    // Script-facing execution context: every shell command's `fn`, plus script-only
    // helpers (writeFile) that never appear in the shell command Map. Scripts reach
    // everything through this single merged namespace via `node script.js`.
    const writeFileHelper = createWriteFile({
      resolvePath,
      getNode,
      getUserType: () => session.userType,
      createFile,
      writeFile,
    });

    const executionContext: Record<string, (...args: unknown[]) => unknown> = {
      ...Object.fromEntries(Array.from(commands.entries()).map(([name, cmd]) => [name, cmd.fn])),
      writeFile: writeFileHelper as (...args: unknown[]) => unknown,
    };

    resolvedExecutionContext = executionContext;

    // Show all commands with a visible binary (or builtins/game commands) —
    // no user-type filtering, all users see the same commands
    const commandNames = Array.from(commands.keys()).filter((name) =>
      isCommandVisible(name, session.machine, getNodeFromMachine, session.currentPath),
    );

    return { commands, executionContext, commandNames };
  }, [
    fileSystemCommands,
    networkCommands,
    wifiCommands,
    getUsers,
    session.username,
    session.userType,
    session.machine,
    session.hostname,
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
    readFile,
    writeFile,
    usedPublicIps,
  ]);
};
