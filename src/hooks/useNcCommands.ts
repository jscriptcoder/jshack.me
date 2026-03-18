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
  createNcSshdCommand,
} from '../commands/nc/index';
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

    // sshd - start SSH server
    commands.set(
      'sshd',
      createNcSshdCommand({
        getMachine,
        getUserType,
        getMachineInfo,
        getNodeFromMachine,
        createFileOnMachine,
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
