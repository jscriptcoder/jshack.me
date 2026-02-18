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
                                                              v0.1.0

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
  const { readFile, getNode, writeFile, createFile, getDefaultHomePath, listDirectory, resolvePath } =
    useFileSystem();
  const { getMachine, config: networkConfig } = useNetwork();

  const activeCommandNames =
    isInFtpMode() && ftpCommands
      ? Array.from(ftpCommands.keys())
      : isInNcMode() && ncCommands
        ? Array.from(ncCommands.keys())
        : commandNames;
  const { getCompletions } = useAutoComplete(activeCommandNames, getVariableNames());
  const { getPathCompletions } = usePathAutoComplete({
    listDirectory,
    getNode,
    resolvePath,
    userType: session.userType,
  });

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

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
                    targetIP: followUp.targetIP,
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
    ],
  );

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
          remoteMachine: ftpTargetIP,
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
        pushSession();

        const machine = getMachine(sshTargetIP);
        const remoteUser = machine?.users.find((u) => u.username === targetUser);
        const userType: UserType = remoteUser?.userType ?? 'user';
        const homePath = getDefaultHomePath(sshTargetIP, targetUser);

        setUsername(targetUser, userType);
        setMachine(sshTargetIP);
        setCurrentPath(homePath);
        addLine('result', `Connected to ${sshTargetIP}`);
        addLine('result', `Welcome to ${machine?.hostname ?? sshTargetIP}!`);
      } else {
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

  const handleTab = useCallback(
    (cursorPosition: number) => {
      const pathResult = getPathCompletions(input, cursorPosition);
      if (pathResult) {
        if (pathResult.replacement !== input) {
          setInput(pathResult.replacement);
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
    [input, getPathCompletions, getCompletions, addLine],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleTerminalClick = useCallback(() => {}, []);

  return (
    <div
      className="flex flex-col h-screen bg-black font-mono text-sm"
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
