import { useMemo } from 'react';
import { useFileSystem } from '../filesystem';
import { useSession } from '../session/SessionContext';
import {
  createFtpPwdCommand,
  createFtpLpwdCommand,
  createFtpCdCommand,
  createFtpLcdCommand,
  createFtpLsCommand,
  createFtpLlsCommand,
  createFtpGetCommand,
  createFtpPutCommand,
  ftpQuitCommand,
  ftpByeCommand,
  ftpHelpCommand,
} from '../commands/ftp/index';
import type { Command } from '../components/Terminal/types';
import type { MachineId } from '../filesystem/machineFileSystems';

export const useFtpCommands = (): Map<string, Command> | null => {
  const { ftpSession, updateFtpRemoteCwd, updateFtpOriginCwd } = useSession();

  const {
    resolvePathForMachine,
    getNodeFromMachine,
    listDirectoryFromMachine,
    readFileFromMachine,
    writeFileToMachine,
    createFileOnMachine,
    canTraverseOnMachine,
  } = useFileSystem();

  return useMemo(() => {
    if (!ftpSession) return null;

    const commands = new Map<string, Command>();

    // Context getters
    const getRemoteMachine = () => ftpSession.remoteMachine as MachineId;
    const getRemoteCwd = () => ftpSession.remoteCwd;
    const getRemoteUserType = () => ftpSession.remoteUserType;
    const getOriginMachine = () => ftpSession.originMachine as MachineId;
    const getOriginCwd = () => ftpSession.originCwd;
    const getOriginUserType = () => ftpSession.originUserType;

    // pwd - remote working directory
    commands.set('pwd', createFtpPwdCommand({ getRemoteCwd }));

    // lpwd - local working directory
    commands.set('lpwd', createFtpLpwdCommand({ getOriginCwd }));

    // cd - change remote directory
    commands.set(
      'cd',
      createFtpCdCommand({
        getRemoteMachine,
        getRemoteCwd,
        getRemoteUserType,
        setRemoteCwd: updateFtpRemoteCwd,
        resolvePathForMachine,
        getNodeFromMachine,
        canTraverseOnMachine,
      }),
    );

    // lcd - change local directory
    commands.set(
      'lcd',
      createFtpLcdCommand({
        getOriginMachine,
        getOriginCwd,
        getOriginUserType,
        setOriginCwd: updateFtpOriginCwd,
        resolvePathForMachine,
        getNodeFromMachine,
        canTraverseOnMachine,
      }),
    );

    // ls - list remote directory
    commands.set(
      'ls',
      createFtpLsCommand({
        getRemoteMachine,
        getRemoteCwd,
        getRemoteUserType,
        resolvePathForMachine,
        getNodeFromMachine,
        listDirectoryFromMachine,
        canTraverseOnMachine,
      }),
    );

    // lls - list local directory
    commands.set(
      'lls',
      createFtpLlsCommand({
        getOriginMachine,
        getOriginCwd,
        getOriginUserType,
        resolvePathForMachine,
        getNodeFromMachine,
        listDirectoryFromMachine,
        canTraverseOnMachine,
      }),
    );

    // get - download file
    commands.set(
      'get',
      createFtpGetCommand({
        getRemoteMachine,
        getRemoteCwd,
        getRemoteUserType,
        getOriginMachine,
        getOriginCwd,
        getOriginUserType,
        resolvePathForMachine,
        getNodeFromMachine,
        readFileFromMachine,
        writeFileToMachine,
        createFileOnMachine,
      }),
    );

    // put - upload file
    commands.set(
      'put',
      createFtpPutCommand({
        getRemoteMachine,
        getRemoteCwd,
        getRemoteUserType,
        getOriginMachine,
        getOriginCwd,
        getOriginUserType,
        resolvePathForMachine,
        getNodeFromMachine,
        readFileFromMachine,
        writeFileToMachine,
        createFileOnMachine,
      }),
    );

    // help - show available commands
    commands.set('help', ftpHelpCommand);

    // quit and bye - exit FTP mode
    commands.set('quit', ftpQuitCommand);
    commands.set('bye', ftpByeCommand);

    return commands;
  }, [
    ftpSession,
    updateFtpRemoteCwd,
    updateFtpOriginCwd,
    resolvePathForMachine,
    getNodeFromMachine,
    listDirectoryFromMachine,
    readFileFromMachine,
    writeFileToMachine,
    createFileOnMachine,
    canTraverseOnMachine,
  ]);
};
