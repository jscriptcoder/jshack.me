import { useState, useRef, useEffect, useCallback } from 'react';
import { TerminalOutput } from './TerminalOutput';
import { TerminalInput } from './TerminalInput';
import { NanoEditor } from './NanoEditor';
import { useCommandHistory } from '../../hooks/useCommandHistory';
import { useAutoComplete } from '../../hooks/useAutoComplete';
import { usePathCompletionAdapters } from '../../hooks/usePathCompletionAdapters';
import { useAuthentication } from '../../hooks/useAuthentication';
import { useVariables } from '../../hooks/useVariables';
import { useCommands } from '../../hooks/useCommands';
import { useFtpCommands } from '../../hooks/useFtpCommands';
import { useNcCommands } from '../../hooks/useNcCommands';
import { useSession } from '../../session/SessionContext';
import type { NcSession } from '../../session/SessionContext';
import { useFileSystem } from '../../filesystem/FileSystemContext';
import { useNetwork } from '../../network';
import type { OutputLine, AuthorData } from './types';
import {
  isAuthorData,
  isPasswordPrompt,
  isClearOutput,
  isExitOutput,
  isAsyncOutput,
  isSshPrompt,
  isScpPrompt,
  isFtpPrompt,
  isFtpQuit,
  isNcPrompt,
  isNcQuit,
  isNanoOpen,
} from './types';
import type { AsyncFollowUp } from './types';

const BANNER = `
     ██╗███████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗   ███╗   ███╗███████╗
     ██║██╔════╝██║  ██║██╔══██╗██╔════╝██║ ██╔╝   ████╗ ████║██╔════╝
     ██║███████╗███████║███████║██║     █████╔╝    ██╔████╔██║█████╗
██   ██║╚════██║██╔══██║██╔══██║██║     ██╔═██╗    ██║╚██╔╝██║██╔══╝
╚█████╔╝███████║██║  ██║██║  ██║╚██████╗██║  ██╗██╗██║ ╚═╝ ██║███████╗
 ╚════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝
                                                              v0.30.1

  Type help() for available commands
`;

const getInitialLines = (): readonly OutputLine[] => [{ id: 0, type: 'banner', content: BANNER }];

const KERNEL_PANIC_SCREEN = `
BIOS POST... OK
Booting from disk...

error: file '/boot/vmlinuz' not found.
GRUB error: no loaded kernel.

System halted.

---[ end Kernel panic - not syncing: Fatal exception ]---
`;

export const Terminal = () => {
  const [input, setInput] = useState('');
  const [asyncRunning, setAsyncRunning] = useState(false);
  const [editorState, setEditorState] = useState<{
    readonly filePath: string;
    readonly content: string;
    readonly isNewFile: boolean;
  } | null>(null);
  const [lines, setLines] = useState<readonly OutputLine[]>(getInitialLines);
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
    isMachineBricked,
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
  const { getMachine, findMachineUsers, resolveNat } = useNetwork();

  const activeCommandNames =
    isInFtpMode() && ftpCommands
      ? Array.from(ftpCommands.keys())
      : isInNcMode() && ncCommands
        ? Array.from(ncCommands.keys())
        : commandNames;
  const { getCompletions } = useAutoComplete(activeCommandNames, getVariableNames());

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

  const {
    passwordMode,
    ftpUsernameMode,
    handlePasswordSubmit,
    handleFtpUsernameSubmit,
    startPasswordPrompt,
    startSshPrompt,
    authenticateSshInline,
    startFtpPrompt,
    authenticateFtpInline,
    startScpPrompt,
    authenticateScpInline,
  } = useAuthentication({
    addLine,
    session,
    getMachine,
    readFile,
    resolveNat,
    getDefaultHomePath,
    setUsername,
    setMachine,
    setCurrentPath,
    pushSession,
    enterFtpMode,
    findMachineUsers,
    createFile,
    writeFile,
  });

  const { getPathCompletions } = usePathCompletionAdapters({
    ncSession,
    ftpSession,
    isInNcMode,
    isInFtpMode,
    userType: session.userType,
    listDirectory,
    getNode,
    resolvePath,
    listDirectoryFromMachine,
    getNodeFromMachine,
    resolvePathForMachine,
  });

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines, asyncRunning]);

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
            startPasswordPrompt(result.targetUser);
            return;
          }
          if (isAsyncOutput(result)) {
            if (result.clearScreen) {
              clearLines();
            }
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
                  if (followUp.password !== undefined) {
                    authenticateSshInline(
                      followUp.targetUser,
                      followUp.targetIP,
                      followUp.targetPort,
                      followUp.password,
                    );
                  } else {
                    startSshPrompt(followUp.targetUser, followUp.targetIP, followUp.targetPort);
                  }
                }

                if (isScpPrompt(followUp)) {
                  const transferAsync =
                    followUp.password !== undefined
                      ? authenticateScpInline(
                          followUp.targetUser,
                          followUp.targetIP,
                          followUp.targetPort,
                          followUp.password,
                          followUp.performTransfer,
                        )
                      : startScpPrompt(
                          followUp.targetUser,
                          followUp.targetIP,
                          followUp.targetPort,
                          followUp.performTransfer,
                        );
                  if (transferAsync) {
                    setAsyncRunning(true);
                    asyncCancelRef.current = transferAsync.cancel ?? null;
                    transferAsync.start(
                      (line: string) => addLine('result', line),
                      () => {
                        setAsyncRunning(false);
                        asyncCancelRef.current = null;
                      },
                    );
                  }
                }

                if (isFtpPrompt(followUp)) {
                  if (followUp.username !== undefined && followUp.password !== undefined) {
                    authenticateFtpInline(followUp.targetIP, followUp.username, followUp.password);
                  } else {
                    startFtpPrompt(followUp.targetIP);
                  }
                }

                if (isNcPrompt(followUp)) {
                  const newNcSession: NcSession = {
                    targetIP: resolveNat(followUp.targetIP, followUp.targetPort).ip,
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
      startPasswordPrompt,
      startSshPrompt,
      authenticateSshInline,
      startScpPrompt,
      authenticateScpInline,
      startFtpPrompt,
      authenticateFtpInline,
    ],
  );

  const clearInput = useCallback(() => setInput(''), []);

  const handleSubmit = useCallback(() => {
    if (ftpUsernameMode) {
      handleFtpUsernameSubmit(input, clearInput);
    } else if (passwordMode) {
      const scpAsync = handlePasswordSubmit(input, clearInput);
      if (scpAsync) {
        setAsyncRunning(true);
        asyncCancelRef.current = scpAsync.cancel ?? null;
        scpAsync.start(
          (line: string) => addLine('result', line),
          () => {
            setAsyncRunning(false);
            asyncCancelRef.current = null;
          },
        );
      }
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
    clearInput,
    addLine,
  ]);

  const handleHistoryUp = useCallback(() => {
    const cmd = navigateUp();
    if (cmd) setInput(cmd);
  }, [navigateUp]);

  const handleHistoryDown = useCallback(() => {
    const cmd = navigateDown();
    setInput(cmd);
  }, [navigateDown]);

  // Two-layer tab completion: path completion (inside string literals) takes priority,
  // then falls back to command/variable name completion
  const handleTab = useCallback(
    (cursorPosition: number) => {
      const pathResult = getPathCompletions(input, cursorPosition);
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
    [input, getPathCompletions, getCompletions, addLine],
  );

  const handleInputChange = useCallback((value: string) => {
    setInput(value);
  }, []);

  const handleTerminalClick = useCallback(() => {}, []);

  // Localhost bricked = frozen kernel panic screen (no input, no recovery except clearing data)
  if (isMachineBricked('localhost')) {
    return (
      <div
        className="flex flex-col h-screen font-mono text-sm"
        style={{ backgroundColor: 'var(--theme-bg)' }}
      >
        <pre className="p-4 whitespace-pre-wrap" style={{ color: 'var(--theme-text)' }}>
          {KERNEL_PANIC_SCREEN}
        </pre>
      </div>
    );
  }

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
