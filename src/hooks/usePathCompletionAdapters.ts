import { useCallback } from 'react';
import { usePathAutoComplete } from './usePathAutoComplete';
import type { UserType, FtpSession, NcSession } from '../session/SessionContext';
import type { FileNode } from '../filesystem/types';

type PathCompletionResult = {
  readonly matches: readonly string[];
  readonly displayText: string;
  readonly replacement: string;
  readonly newCursorPosition: number;
};

type PathCompletionAdaptersOptions = {
  readonly ncSession: NcSession | null;
  readonly ftpSession: FtpSession | null;
  readonly isInNcMode: () => boolean;
  readonly isInFtpMode: () => boolean;
  readonly userType: UserType;
  readonly listDirectory: (path: string, userType: UserType) => string[] | null;
  readonly getNode: (path: string) => FileNode | null;
  readonly resolvePath: (path: string) => string;
  readonly listDirectoryFromMachine: (
    machineIp: string,
    path: string,
    currentPath: string,
    userType: UserType,
  ) => string[] | null;
  readonly getNodeFromMachine: (
    machineIp: string,
    path: string,
    currentPath: string,
  ) => FileNode | null;
  readonly resolvePathForMachine: (path: string, currentPath: string) => string;
};

export const usePathCompletionAdapters = ({
  ncSession,
  ftpSession,
  isInNcMode,
  isInFtpMode,
  userType,
  listDirectory,
  getNode,
  resolvePath,
  listDirectoryFromMachine,
  getNodeFromMachine,
  resolvePathForMachine,
}: PathCompletionAdaptersOptions) => {
  // NC mode operates on a different machine — adapt machine-specific filesystem APIs
  // to match the usePathAutoComplete interface so path completion resolves correctly
  const ncListDirectory = useCallback(
    (path: string, ut: UserType): string[] | null =>
      ncSession
        ? listDirectoryFromMachine(ncSession.machineId, path, ncSession.currentPath, ut)
        : null,
    [ncSession, listDirectoryFromMachine],
  );
  const ncGetNode = useCallback(
    (path: string): FileNode | null =>
      ncSession ? getNodeFromMachine(ncSession.machineId, path, ncSession.currentPath) : null,
    [ncSession, getNodeFromMachine],
  );
  const ncResolvePath = useCallback(
    (path: string): string =>
      ncSession ? resolvePathForMachine(path, ncSession.currentPath) : path,
    [ncSession, resolvePathForMachine],
  );

  // FTP mode operates on two machines — remote adapters resolve against the FTP target
  const ftpRemoteListDirectory = useCallback(
    (path: string, ut: UserType): string[] | null =>
      ftpSession
        ? listDirectoryFromMachine(ftpSession.remoteMachine, path, ftpSession.remoteCwd, ut)
        : null,
    [ftpSession, listDirectoryFromMachine],
  );
  const ftpRemoteGetNode = useCallback(
    (path: string): FileNode | null =>
      ftpSession ? getNodeFromMachine(ftpSession.remoteMachine, path, ftpSession.remoteCwd) : null,
    [ftpSession, getNodeFromMachine],
  );
  const ftpRemoteResolvePath = useCallback(
    (path: string): string =>
      ftpSession ? resolvePathForMachine(path, ftpSession.remoteCwd) : path,
    [ftpSession, resolvePathForMachine],
  );
  // FTP local adapters resolve against the origin machine
  const ftpLocalListDirectory = useCallback(
    (path: string, ut: UserType): string[] | null =>
      ftpSession
        ? listDirectoryFromMachine(ftpSession.originMachine, path, ftpSession.originCwd, ut)
        : null,
    [ftpSession, listDirectoryFromMachine],
  );
  const ftpLocalGetNode = useCallback(
    (path: string): FileNode | null =>
      ftpSession ? getNodeFromMachine(ftpSession.originMachine, path, ftpSession.originCwd) : null,
    [ftpSession, getNodeFromMachine],
  );
  const ftpLocalResolvePath = useCallback(
    (path: string): string =>
      ftpSession ? resolvePathForMachine(path, ftpSession.originCwd) : path,
    [ftpSession, resolvePathForMachine],
  );

  const isNcActive = isInNcMode() && ncSession !== null;
  const { getPathCompletions: defaultPathCompletions } = usePathAutoComplete({
    listDirectory: isNcActive ? ncListDirectory : listDirectory,
    getNode: isNcActive ? ncGetNode : getNode,
    resolvePath: isNcActive ? ncResolvePath : resolvePath,
    userType: isNcActive ? ncSession.userType : userType,
  });

  const isFtpActive = isInFtpMode() && ftpSession !== null;
  const { getPathCompletions: ftpRemotePathCompletions } = usePathAutoComplete({
    listDirectory: isFtpActive ? ftpRemoteListDirectory : listDirectory,
    getNode: isFtpActive ? ftpRemoteGetNode : getNode,
    resolvePath: isFtpActive ? ftpRemoteResolvePath : resolvePath,
    userType: isFtpActive ? ftpSession.remoteUserType : userType,
  });
  const { getPathCompletions: ftpLocalPathCompletions } = usePathAutoComplete({
    listDirectory: isFtpActive ? ftpLocalListDirectory : listDirectory,
    getNode: isFtpActive ? ftpLocalGetNode : getNode,
    resolvePath: isFtpActive ? ftpLocalResolvePath : resolvePath,
    userType: isFtpActive ? ftpSession.originUserType : userType,
  });

  // Determines which path completion context to use in FTP mode by inspecting
  // the command name and argument position. Remote commands (cd, ls) and the
  // remote argument of get/put use the FTP target machine; local commands (lcd,
  // lls) and the local argument of get/put use the origin machine.
  const getFtpPathCompletions = useCallback(
    (currentInput: string, cursorPosition: number) => {
      const trimmed = currentInput.trimStart();
      const cmdMatch = trimmed.match(/^(\w+)\s*\(/);
      const cmd = cmdMatch?.[1] ?? '';

      // For get(remote, local) and put(local, remote), detect argument position
      // by counting commas before the cursor (outside of string literals)
      if (cmd === 'get' || cmd === 'put') {
        const parenIndex = currentInput.indexOf('(');
        let commaCount = 0;
        let inStr = false;
        let qChar = '';
        for (let i = parenIndex + 1; i < cursorPosition; i++) {
          const ch = currentInput[i];
          if (!inStr && (ch === "'" || ch === '"')) {
            inStr = true;
            qChar = ch;
          } else if (inStr && ch === qChar && currentInput[i - 1] !== '\\') {
            inStr = false;
          } else if (!inStr && ch === ',') {
            commaCount++;
          }
        }
        // get: arg0=remote, arg1=local; put: arg0=local, arg1=remote
        const useRemote = cmd === 'get' ? commaCount === 0 : commaCount > 0;
        return useRemote
          ? ftpRemotePathCompletions(currentInput, cursorPosition)
          : ftpLocalPathCompletions(currentInput, cursorPosition);
      }

      // Local commands use origin machine
      if (cmd === 'lcd' || cmd === 'lls') {
        return ftpLocalPathCompletions(currentInput, cursorPosition);
      }

      // Remote commands (cd, ls) and anything else use remote machine
      return ftpRemotePathCompletions(currentInput, cursorPosition);
    },
    [ftpRemotePathCompletions, ftpLocalPathCompletions],
  );

  const getPathCompletions = useCallback(
    (input: string, cursorPosition: number): PathCompletionResult | null => {
      if (isFtpActive) {
        return getFtpPathCompletions(input, cursorPosition);
      }
      return defaultPathCompletions(input, cursorPosition);
    },
    [isFtpActive, getFtpPathCompletions, defaultPathCompletions],
  );

  return { getPathCompletions };
};
