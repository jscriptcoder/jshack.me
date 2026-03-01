import { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalOutput } from './TerminalOutput';
import { TerminalInput } from './TerminalInput';
import { NanoEditor } from './NanoEditor';
import { useCommandHistory } from '../../hooks/useCommandHistory';
import { useAutoComplete } from '../../hooks/useAutoComplete';
import { usePathAutoComplete } from '../../hooks/usePathAutoComplete';
import { useVariables } from '../../hooks/useVariables';
import { useCommands } from '../../hooks/useCommands';
import { useFtpCommands } from '../../hooks/useFtpCommands';
import { useNcCommands } from '../../hooks/useNcCommands';
import { useSession } from '../../session/SessionContext';
import type { FtpSession, NcSession } from '../../session/SessionContext';
import { useFileSystem } from '../../filesystem/FileSystemContext';
import type { FileNode } from '../../filesystem/types';
import { useNetwork } from '../../network';
import { md5 } from '../../utils/md5';
import type { OutputLine, AuthorData } from './types';
import {
  isAuthorData,
  isPasswordPrompt,
  isClearOutput,
  isExitOutput,
  isAsyncOutput,
  isSshPrompt,
  isFtpPrompt,
  isFtpQuit,
  isNcPrompt,
  isNcQuit,
  isNanoOpen,
} from './types';
import type { AsyncFollowUp } from './types';
import type { UserType } from '../../session/SessionContext';

const BANNER = `
     ██╗███████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗   ███╗   ███╗███████╗
     ██║██╔════╝██║  ██║██╔══██╗██╔════╝██║ ██╔╝   ████╗ ████║██╔════╝
     ██║███████╗███████║███████║██║     █████╔╝    ██╔████╔██║█████╗
██   ██║╚════██║██╔══██║██╔══██║██║     ██╔═██╗    ██║╚██╔╝██║██╔══╝
╚█████╔╝███████║██║  ██║██║  ██║╚██████╗██║  ██╗██╗██║ ╚═╝ ██║███████╗
 ╚════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝
                                                              v0.8.1

  Type help() for available commands
`;

const getInitialLines = (): readonly OutputLine[] => [{ id: 0, type: 'banner', content: BANNER }];

export const Terminal = () => {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<readonly OutputLine[]>(getInitialLines);
  const [passwordMode, setPasswordMode] = useState(false);
  const [targetUser, setTargetUser] = useState<string | null>(null);
  const [sshTargetIP, setSshTargetIP] = useState<string | null>(null);
  const [ftpTargetIP, setFtpTargetIP] = useState<string | null>(null);
  const [ftpUsernameMode, setFtpUsernameMode] = useState(false);
  const [asyncRunning, setAsyncRunning] = useState(false);
  const [editorState, setEditorState] = useState<{
    readonly filePath: string;
    readonly content: string;
    readonly isNewFile: boolean;
  } | null>(null);
  const lineIdRef = useRef(1);
  const outputRef = useRef<HTMLDivElement>(null);
  const asyncCancelRef = useRef<(() => void) | null>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);

  const { addCommand, navigateUp, navigateDown, resetNavigation } = useCommandHistory();
  const { getVariables, getVariableNames, handleVariableOperation } = useVariables();
  const {
    getPrompt,
    setUsername,
    setMachine,
    setCurrentPath,
    pushSession,
    popSession,
    canReturn,
    session,
    ncSession,
    ftpSession,
    enterFtpMode,
    exitFtpMode,
    isInFtpMode,
    enterNcMode,
    exitNcMode,
    isInNcMode,
  } = useSession();
  const { executionContext, commandNames } = useCommands();
  const ftpCommands = useFtpCommands();
  const ncCommands = useNcCommands();
  const {
    readFile,
    getNode,
    writeFile,
    createFile,
    getDefaultHomePath,
    listDirectory,
    resolvePath,
    resolvePathForMachine,
    getNodeFromMachine,
    listDirectoryFromMachine,
  } = useFileSystem();
  const { getMachine, config: networkConfig, resolveNat } = useNetwork();

  const activeCommandNames =
    isInFtpMode() && ftpCommands
      ? Array.from(ftpCommands.keys())
      : isInNcMode() && ncCommands
        ? Array.from(ncCommands.keys())
        : commandNames;
  const { getCompletions } = useAutoComplete(activeCommandNames, getVariableNames());

  // NC mode operates on a different machine — adapt machine-specific filesystem APIs
  // to match the usePathAutoComplete interface so path completion resolves correctly
  const ncListDirectory = useCallback(
    (path: string, userType: UserType): string[] | null =>
      ncSession
        ? listDirectoryFromMachine(ncSession.targetIP, path, ncSession.currentPath, userType)
        : null,
    [ncSession, listDirectoryFromMachine],
  );
  const ncGetNode = useCallback(
    (path: string): FileNode | null =>
      ncSession ? getNodeFromMachine(ncSession.targetIP, path, ncSession.currentPath) : null,
    [ncSession, getNodeFromMachine],
  );
  const ncResolvePath = useCallback(
    (path: string): string =>
      ncSession ? resolvePathForMachine(path, ncSession.currentPath) : path,
    [ncSession, resolvePathForMachine],
  );

  // FTP mode operates on two machines — remote adapters resolve against the FTP target
  const ftpRemoteListDirectory = useCallback(
    (path: string, userType: UserType): string[] | null =>
      ftpSession
        ? listDirectoryFromMachine(ftpSession.remoteMachine, path, ftpSession.remoteCwd, userType)
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
    (path: string, userType: UserType): string[] | null =>
      ftpSession
        ? listDirectoryFromMachine(ftpSession.originMachine, path, ftpSession.originCwd, userType)
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
  const { getPathCompletions } = usePathAutoComplete({
    listDirectory: isNcActive ? ncListDirectory : listDirectory,
    getNode: isNcActive ? ncGetNode : getNode,
    resolvePath: isNcActive ? ncResolvePath : resolvePath,
    userType: isNcActive ? ncSession.userType : session.userType,
  });
  const isFtpActive = isInFtpMode() && ftpSession !== null;
  const { getPathCompletions: getFtpRemotePathCompletions } = usePathAutoComplete({
    listDirectory: isFtpActive ? ftpRemoteListDirectory : listDirectory,
    getNode: isFtpActive ? ftpRemoteGetNode : getNode,
    resolvePath: isFtpActive ? ftpRemoteResolvePath : resolvePath,
    userType: isFtpActive ? ftpSession.remoteUserType : session.userType,
  });
  const { getPathCompletions: getFtpLocalPathCompletions } = usePathAutoComplete({
    listDirectory: isFtpActive ? ftpLocalListDirectory : listDirectory,
    getNode: isFtpActive ? ftpLocalGetNode : getNode,
    resolvePath: isFtpActive ? ftpLocalResolvePath : resolvePath,
    userType: isFtpActive ? ftpSession.originUserType : session.userType,
  });

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines, asyncRunning]);

  const addLine = useCallback(
    (type: 'command' | 'result' | 'error' | 'banner', content: string, prompt?: string) => {
      setLines((prev) => [...prev, { id: lineIdRef.current++, type, content, prompt }]);
    },
    [],
  );

  const addAuthorLine = useCallback((content: AuthorData) => {
    setLines((prev) => [...prev, { id: lineIdRef.current++, type: 'author' as const, content }]);
  }, []);

  const clearLines = useCallback(() => {
    setLines([]);
  }, []);

  const executeCommand = useCallback(
    (command: string) => {
      const trimmedCommand = command.trim();
      if (!trimmedCommand) return;

      addLine('command', trimmedCommand, getPrompt());
      addCommand(trimmedCommand);

      try {
        const variableResult = handleVariableOperation(trimmedCommand, executionContext);

        if (variableResult !== null) {
          if (!variableResult.success) {
            addLine('error', `Error: ${variableResult.error}`);
          } else if (variableResult.value !== undefined) {
            const resultStr =
              typeof variableResult.value === 'string'
                ? variableResult.value
                : JSON.stringify(variableResult.value, null, 2);
            addLine('result', resultStr);
          }
          return;
        }

        // When in FTP or NC mode, swap the execution context so only that mode's
        // commands are available (e.g., ftp> pwd, ls, get instead of normal commands)
        const activeContext =
          isInFtpMode() && ftpCommands
            ? Object.fromEntries(Array.from(ftpCommands.entries()).map(([k, v]) => [k, v.fn]))
            : isInNcMode() && ncCommands
              ? Object.fromEntries(Array.from(ncCommands.entries()).map(([k, v]) => [k, v.fn]))
              : executionContext;

        const variables = getVariables();
        const context = { ...activeContext, ...variables };

        const contextKeys = Object.keys(context);
        const contextValues = Object.values(context);

        // Commands are injected as local variables so users type e.g. help() not commands.help()
        const fn = new Function(...contextKeys, `return ${trimmedCommand}`);
        const result = fn(...contextValues);

        if (result !== undefined) {
          if (isClearOutput(result)) {
            clearLines();
            return;
          }
          if (isExitOutput(result)) {
            if (!canReturn()) {
              addLine('error', 'exit: not connected to a remote machine');
              return;
            }
            const snapshot = popSession();
            if (snapshot) {
              addLine('result', 'Connection closed.');
            }
            return;
          }
          if (isFtpQuit(result)) {
            const ftpSession = exitFtpMode();
            if (ftpSession) {
              addLine('result', '221 Goodbye.');
            }
            return;
          }
          if (isNcQuit(result)) {
            const ncSession = exitNcMode();
            if (ncSession) {
              addLine('result', 'Connection closed.');
            }
            return;
          }
          if (isAuthorData(result)) {
            addAuthorLine(result);
            return;
          }
          if (isPasswordPrompt(result)) {
            setTargetUser(result.targetUser);
            setPasswordMode(true);
            addLine('result', 'Password:');
            return;
          }
          if (isAsyncOutput(result)) {
            setAsyncRunning(true);
            asyncCancelRef.current = result.cancel ?? null;

            result.start(
              (line: string) => {
                addLine('result', line);
              },
              (followUp?: AsyncFollowUp) => {
                setAsyncRunning(false);
                asyncCancelRef.current = null;

                if (isSshPrompt(followUp)) {
                  setTargetUser(followUp.targetUser);
                  setSshTargetIP(followUp.targetIP);
                  setPasswordMode(true);
                  addLine('result', `${followUp.targetUser}@${followUp.targetIP}'s password:`);
                }

                if (isFtpPrompt(followUp)) {
                  setFtpTargetIP(followUp.targetIP);
                  setFtpUsernameMode(true);
                  addLine('result', `Name (${followUp.targetIP}:anonymous):`);
                }

                if (isNcPrompt(followUp)) {
                  const newNcSession: NcSession = {
                    targetIP: resolveNat(followUp.targetIP),
                    targetPort: followUp.targetPort,
                    service: followUp.service,
                    username: followUp.username,
                    userType: followUp.userType,
                    currentPath: followUp.homePath,
                  };
                  enterNcMode(newNcSession);
                }
              },
            );
            return;
          }
          if (isNanoOpen(result)) {
            const node = getNode(result.filePath);
            const fileContent = node ? (readFile(result.filePath, session.userType) ?? '') : '';
            setEditorState({
              filePath: result.filePath,
              content: fileContent,
              isNewFile: node === null,
            });
            return;
          }
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          addLine('result', resultStr);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        addLine('error', `Error: ${errorMessage}`);
      }
    },
    [
      addCommand,
      addLine,
      addAuthorLine,
      clearLines,
      handleVariableOperation,
      getVariables,
      getPrompt,
      executionContext,
      canReturn,
      popSession,
      isInFtpMode,
      ftpCommands,
      exitFtpMode,
      isInNcMode,
      ncCommands,
      exitNcMode,
      enterNcMode,
      getNode,
      readFile,
      session.userType,
      resolveNat,
    ],
  );

  // Three-mode password validation: SSH (remote machine lookup), FTP (remote machine lookup),
  // or su (local /etc/passwd hash comparison). The mode is determined by which target IP
  // state is set when the password prompt was triggered.
  const validatePassword = useCallback(
    (password: string): boolean => {
      if (!targetUser) return false;

      if (sshTargetIP) {
        const machine = getMachine(sshTargetIP);
        if (!machine) return false;

        const remoteUser = machine.users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);
        return remoteUser.passwordHash === inputHash;
      }

      if (ftpTargetIP) {
        const machine = getMachine(ftpTargetIP);
        if (!machine) return false;

        const remoteUser = machine.users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);
        return remoteUser.passwordHash === inputHash;
      }

      const passwdContent = readFile('/etc/passwd', 'root');
      if (!passwdContent) return false;

      const entry = passwdContent.split('\n').find((line) => line.split(':')[0] === targetUser);
      if (!entry) return false;

      const storedHash = entry.split(':')[1];
      if (!storedHash) return false;

      return storedHash === md5(password);
    },
    [targetUser, sshTargetIP, ftpTargetIP, readFile, getMachine],
  );

  const handleFtpUsernameSubmit = useCallback(() => {
    if (!ftpTargetIP) return;

    const username = input.trim() || 'anonymous';
    addLine('command', username, `Name (${ftpTargetIP}:anonymous):`);

    const machine = getMachine(ftpTargetIP);
    if (!machine) {
      addLine('error', '530 Login incorrect.');
      setFtpTargetIP(null);
      setFtpUsernameMode(false);
      setInput('');
      return;
    }

    const remoteUser = machine.users.find((u) => u.username === username);
    if (!remoteUser) {
      addLine('error', '530 Login incorrect.');
      setFtpTargetIP(null);
      setFtpUsernameMode(false);
      setInput('');
      return;
    }

    addLine('result', '331 Please specify the password.');
    setTargetUser(username);
    setFtpUsernameMode(false);
    setPasswordMode(true);
    setInput('');
  }, [input, ftpTargetIP, getMachine, addLine]);

  const handlePasswordSubmit = useCallback(() => {
    const maskedPassword = '*'.repeat(input.length);
    const promptLabel = ftpTargetIP
      ? 'Password:'
      : sshTargetIP
        ? `${targetUser}@${sshTargetIP}'s password:`
        : 'Password:';
    addLine('command', maskedPassword, promptLabel);

    if (validatePassword(input)) {
      if (!targetUser) return;

      if (ftpTargetIP) {
        const machine = getMachine(ftpTargetIP);
        const remoteUser = machine?.users.find((u) => u.username === targetUser);
        const userType: UserType = remoteUser?.userType ?? 'user';
        const remoteHomePath = targetUser === 'root' ? '/root' : `/home/${targetUser}`;

        const newFtpSession: FtpSession = {
          remoteMachine: resolveNat(ftpTargetIP),
          remoteUsername: targetUser,
          remoteUserType: userType,
          remoteCwd: remoteHomePath,
          originMachine: session.machine,
          originUsername: session.username,
          originUserType: session.userType,
          originCwd: session.currentPath,
        };

        enterFtpMode(newFtpSession);
        addLine('result', '230 Login successful.');
      } else if (sshTargetIP) {
        // Save current session state before switching to remote machine
        pushSession();

        // NAT resolution: if connecting to a router's public IP with port forwarding,
        // resolve to the internal entry machine IP
        const resolvedIp = resolveNat(sshTargetIP);
        const machine = getMachine(sshTargetIP);
        const remoteUser = machine?.users.find((u) => u.username === targetUser);
        const userType: UserType = remoteUser?.userType ?? 'user';
        const homePath = getDefaultHomePath(resolvedIp, targetUser);

        setUsername(targetUser, userType);
        setMachine(resolvedIp);
        setCurrentPath(homePath);
        addLine('result', `Connected to ${sshTargetIP}`);
        addLine('result', `Welcome to ${machine?.hostname ?? sshTargetIP}!`);
      } else {
        // su (local user switch) — look up user type from the machine's user list.
        // Searches both the direct machine config and the network-wide machine list
        // because mission-generated machines may not appear in the direct config.
        const machine = getMachine(session.machine);
        const machineUser =
          machine?.users.find((u) => u.username === targetUser) ??
          Object.values(networkConfig.machineConfigs)
            .flatMap((mc) => mc.machines)
            .find((m) => m.ip === session.machine)
            ?.users.find((u) => u.username === targetUser);
        const userType: UserType =
          machineUser?.userType ??
          (targetUser === 'root' ? 'root' : targetUser === 'guest' ? 'guest' : 'user');
        const homePath = userType === 'root' ? '/root' : `/home/${targetUser}`;

        setUsername(targetUser, userType);
        setCurrentPath(homePath);
        addLine('result', `Switched to user: ${targetUser}`);
      }
    } else {
      if (ftpTargetIP) {
        addLine('error', '530 Login incorrect.');
      } else if (sshTargetIP) {
        addLine('error', `Permission denied, please try again.`);
      } else {
        addLine('error', 'su: Authentication failure');
      }
    }

    setPasswordMode(false);
    setTargetUser(null);
    setSshTargetIP(null);
    setFtpTargetIP(null);
    setInput('');
  }, [
    input,
    targetUser,
    sshTargetIP,
    ftpTargetIP,
    validatePassword,
    setUsername,
    setMachine,
    setCurrentPath,
    pushSession,
    session,
    getMachine,
    networkConfig.machineConfigs,
    enterFtpMode,
    addLine,
    getDefaultHomePath,
    resolveNat,
  ]);

  const handleSubmit = useCallback(() => {
    if (ftpUsernameMode) {
      handleFtpUsernameSubmit();
    } else if (passwordMode) {
      handlePasswordSubmit();
    } else {
      executeCommand(input);
      setInput('');
    }
    resetNavigation();
  }, [
    input,
    passwordMode,
    ftpUsernameMode,
    executeCommand,
    handlePasswordSubmit,
    handleFtpUsernameSubmit,
    resetNavigation,
  ]);

  const handleHistoryUp = useCallback(() => {
    const cmd = navigateUp();
    if (cmd) setInput(cmd);
  }, [navigateUp]);

  const handleHistoryDown = useCallback(() => {
    const cmd = navigateDown();
    setInput(cmd);
  }, [navigateDown]);

  // Determines which path completion context to use in FTP mode by inspecting
  // the command name and argument position. Remote commands (cd, ls) and the
  // remote argument of get/put use the FTP target machine; local commands (lcd,
  // lls) and the local argument of get/put use the origin machine.
  const getFtpPathCompletions = useCallback(
    (currentInput: string, cursorPosition: number) => {
      const trimmed = currentInput.trimStart();
      // Detect which FTP command is being typed
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
          ? getFtpRemotePathCompletions(currentInput, cursorPosition)
          : getFtpLocalPathCompletions(currentInput, cursorPosition);
      }

      // Local commands use origin machine
      if (cmd === 'lcd' || cmd === 'lls') {
        return getFtpLocalPathCompletions(currentInput, cursorPosition);
      }

      // Remote commands (cd, ls) and anything else use remote machine
      return getFtpRemotePathCompletions(currentInput, cursorPosition);
    },
    [getFtpRemotePathCompletions, getFtpLocalPathCompletions],
  );

  // Two-layer tab completion: path completion (inside string literals) takes priority,
  // then falls back to command/variable name completion
  const handleTab = useCallback(
    (cursorPosition: number) => {
      const pathResult = isFtpActive
        ? getFtpPathCompletions(input, cursorPosition)
        : getPathCompletions(input, cursorPosition);
      if (pathResult) {
        if (pathResult.replacement !== input) {
          setInput(pathResult.replacement);
          // Defer cursor repositioning until after React re-renders with new value
          requestAnimationFrame(() => {
            terminalInputRef.current?.setSelectionRange(
              pathResult.newCursorPosition,
              pathResult.newCursorPosition,
            );
          });
        }
        if (pathResult.matches.length > 1) {
          addLine('result', pathResult.displayText);
        }
        return;
      }

      const { matches, displayText, commonPrefix } = getCompletions(input);
      if (matches.length === 1) {
        setInput(matches[0].display);
      } else if (matches.length > 1) {
        if (commonPrefix.length > input.trim().length) {
          setInput(commonPrefix);
        }
        addLine('result', displayText);
      }
    },
    [input, isFtpActive, getFtpPathCompletions, getPathCompletions, getCompletions, addLine],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleTerminalClick = useCallback(() => {}, []);

  return (
    <div
      className="flex flex-col h-screen font-mono text-sm"
      style={{ backgroundColor: 'var(--theme-bg)' }}
      onClick={handleTerminalClick}
    >
      <div ref={outputRef} className="flex-1 overflow-y-auto">
        <TerminalOutput lines={lines} />
      </div>
      {!asyncRunning && (
        <TerminalInput
          value={input}
          onChange={handleInputChange}
          onSubmit={handleSubmit}
          onHistoryUp={handleHistoryUp}
          onHistoryDown={handleHistoryDown}
          onTab={handleTab}
          promptMode={passwordMode ? 'password' : ftpUsernameMode ? 'username' : undefined}
          externalInputRef={terminalInputRef}
        />
      )}
      {editorState && (
        <NanoEditor
          filePath={editorState.filePath}
          initialContent={editorState.content}
          isNewFile={editorState.isNewFile}
          onSave={(content) => writeFile(editorState.filePath, content, session.userType)}
          onCreate={(content) => createFile(editorState.filePath, content, session.userType)}
          onClose={() => {
            setEditorState(null);
            // Defer focus until after React unmounts the NanoEditor overlay,
            // otherwise the input element may not be interactive yet
            setTimeout(() => terminalInputRef.current?.focus(), 0);
          }}
        />
      )}
    </div>
  );
};
