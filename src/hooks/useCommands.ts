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
import { applyCommandRestrictions, getAccessibleCommandNames } from '../commands/permissions';
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

type UseCommandsResult = {
  readonly executionContext: Record<string, (...args: unknown[]) => unknown>;
  readonly commandNames: readonly string[];
};

export const useCommands = (): UseCommandsResult => {
  const fileSystemCommands = useFileSystemCommands();
  const networkCommands = useNetworkCommands();
  const wifiCommands = useWifiCommands();
  const { session } = useSession();
  const { config } = useNetwork();
  const { resolvePath, getNode } = useFileSystem();

  const getUsers = useCallback((): readonly string[] => {
    if (session.machine === 'localhost') {
      return LOCAL_USERS;
    }
    const found = Object.values(config.machineConfigs)
      .flatMap((mc) => mc.machines)
      .find((m) => m.ip === session.machine);
    return found ? found.users.map((u) => u.username) : [];
  }, [session.machine, config.machineConfigs]);

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
    commands.set('resolve', createResolveCommand());
    commands.set('reset', createResetCommand({ getDatabase }));

    const suCommand = createSuCommand({ getUsers });
    commands.set('su', suCommand);

    commands.set(
      'node',
      createNodeCommand({
        resolvePath,
        getNode,
        getUserType: () => session.userType,
        getExecutionContext: () => resolvedExecutionContext,
      }),
    );

    fileSystemCommands.forEach((cmd, name) => commands.set(name, cmd));
    networkCommands.forEach((cmd, name) => commands.set(name, cmd));
    wifiCommands.forEach((cmd, name) => commands.set(name, cmd));

    const getAccessibleCommands = () => {
      const accessible = getAccessibleCommandNames(Array.from(commands.keys()), session.userType);
      return accessible
        .map((name) => commands.get(name))
        .filter((cmd): cmd is Command => cmd !== undefined);
    };

    const getCommandsMap = () => commands;

    const helpCommand = createHelpCommand(getAccessibleCommands);
    const manCommand = createManCommand(getCommandsMap);

    commands.set('help', helpCommand);
    commands.set('man', manCommand);

    const restrictedCommands = applyCommandRestrictions(commands, session.userType);

    const executionContext: Record<string, (...args: unknown[]) => unknown> = Object.fromEntries(
      Array.from(restrictedCommands.entries()).map(([name, cmd]) => [name, cmd.fn]),
    );

    resolvedExecutionContext = executionContext;

    const commandNames = getAccessibleCommandNames(Array.from(commands.keys()), session.userType);

    return { executionContext, commandNames };
  }, [fileSystemCommands, networkCommands, wifiCommands, getUsers, session.userType, resolvePath, getNode]);
};
