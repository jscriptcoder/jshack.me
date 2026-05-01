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
} from '../commands/nc/index';
import type { Command } from '../components/Terminal/types';
import type { MachineId } from '../filesystem/machineFileSystems';

export const useNcCommands = (): Map<string, Command> | null => {
  const { ncSession, updateNcCwd } = useSession();

  const { resolvePathForMachine, getNodeFromMachine, canTraverseOnMachine } = useFileSystem();

  return useMemo(() => {
    if (!ncSession) return null;

    const commands = new Map<string, Command>();

    // Context getters
    const getMachine = (): MachineId => ncSession.machineId;
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

    // help - show available commands
    commands.set('help', ncHelpCommand);

    // exit - close connection
    commands.set('exit', ncExitCommand);

    return commands;
  }, [ncSession, updateNcCwd, resolvePathForMachine, getNodeFromMachine, canTraverseOnMachine]);
};
