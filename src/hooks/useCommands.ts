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

// Hardcoded localhost users — localhost doesn't exist in the network config like remote
// machines do, so its users can't be dynamically looked up via getMachine()
const LOCAL_USERS = ['root', 'jshacker', 'guest'] as const;

// Shell builtins and game commands don't need binary checks
const SKIP_ACCESS_CHECK = new Set([
  'cd',
  'exit',
  'clear',
  'echo',
  'pwd',
  'help',
  'whoami',
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
    popAllSessions,
    popSession,
    canReturn,
    markMachineBricked,
    isMachineBricked,
  } = useSession();
  const { findMachineUsers } = useNetwork();
  const { resolvePath, getNode, readFileFromMachine, createFile, getNodeFromMachine, canTraverse } =
    useFileSystem();
  const { isMissionActive, startMission, abortMission, completeMission, activeMission } =
    useMission();

  const getUsers = useCallback((): readonly string[] => {
    if (session.machine === 'localhost') {
      return LOCAL_USERS;
    }
    return findMachineUsers(session.machine).map((u) => u.username);
  }, [session.machine, findMachineUsers]);

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

    const suCommand = createSuCommand({ getUsers });
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
          if (!activeMission || activeMission.objective.type !== 'script_fix') return undefined;
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
    commands.set('accept', createAcceptCommand({ startMission, isMissionActive }));
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
      }),
    );

    commands.set(
      'reboot',
      createRebootCommand({
        getMachine: () => session.machine,
        getNodeFromMachine,
        readFileFromMachine,
        popSession,
        canReturn,
        markMachineBricked,
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
    popAllSessions,
    popSession,
    canReturn,
    markMachineBricked,
    isMachineBricked,
  ]);
};
