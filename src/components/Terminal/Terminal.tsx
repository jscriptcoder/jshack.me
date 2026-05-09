import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TerminalOutput } from './TerminalOutput';
import { TerminalInput } from './TerminalInput';
import { NanoEditor } from './NanoEditor';
import { useCommandHistory } from '../../hooks/useCommandHistory';
import { useAuthentication } from '../../hooks/useAuthentication';
import { useCommands } from '../../hooks/useCommands';
import { useFtpCommands } from '../../hooks/useFtpCommands';
import { useNcCommands } from '../../hooks/useNcCommands';
import { useMysqlCommands } from '../../hooks/useMysqlCommands';
import { useRedisCommands } from '../../hooks/useRedisCommands';
import { useSession } from '../../session/SessionContext';
import type { NcSession } from '../../session/SessionContext';
import { useHomeNetworks } from '../../homeNetworks/HomeNetworksContext';
import { targetMachineIdFor } from '../../homeNetworks/homeNetworkHelpers';
import { useFileSystem } from '../../filesystem/FileSystemContext';
import { appendToMachineLog } from '../../logging/appendToMachineLog';
import { formatSuSuccess, formatSuFailed } from '../../logging/formatters';
import { generatePid, resolveHostname } from '../../logging/utils';
import { createFtpAuthHandler } from '../../logging/handlers/ftpAuth';
import { createMysqlAuthHandler } from '../../logging/handlers/mysqlAuth';
import {
  createRedisAuthHandler,
  createRedisConnectHandler,
} from '../../logging/handlers/redisAuth';
import { createSshAuthHandler } from '../../logging/handlers/sshAuth';
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
  isExploitShell,
  isMysqlPrompt,
  isRedisPrompt,
  isNanoOpen,
} from './types';
import type { AsyncFollowUp } from './types';
import { tokenize, parse, execute, complete, type CompleteAdapter } from '../../shell';

const BANNER = `
     ██╗███████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗   ███╗   ███╗███████╗
     ██║██╔════╝██║  ██║██╔══██╗██╔════╝██║ ██╔╝   ████╗ ████║██╔════╝
     ██║███████╗███████║███████║██║     █████╔╝    ██╔████╔██║█████╗
██   ██║╚════██║██╔══██║██╔══██║██║     ██╔═██╗    ██║╚██╔╝██║██╔══╝
╚█████╔╝███████║██║  ██║██║  ██║╚██████╗██║  ██╗██╗██║ ╚═╝ ██║███████╗
 ╚════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝╚══════╝
                                                              v${__APP_VERSION__}

  Type help for available commands
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
  const {
    getPrompt,
    setUsername,
    setMachine,
    setCurrentPath,
    pushSession,
    pushAuthSession,
    authCreateFtpSession,
    authCreateMysqlSession,
    authCreateRedisSession,
    popSession,
    canReturn,
    session,
    ftpSession,
    ncSession,
    enterFtpMode,
    exitFtpMode,
    isInFtpMode,
    enterNcMode,
    exitNcMode,
    isInNcMode,
    authCreateNcSession,
    enterMysqlMode,
    exitMysqlMode,
    isInMysqlMode,
    enterRedisMode,
    exitRedisMode,
    isInRedisMode,
    redisSession,
    isMachineBricked,
    hostname: ownWorkstationId,
  } = useSession();
  const { activeNetwork, lanOccupants } = useHomeNetworks();

  // Maps a LAN IP to the canonical machine_id (workstation_id for
  // occupants, LAN IP for NPC/world/mission machines). Used by every
  // cross-player code path that constructs a machine_id from an IP the
  // user typed — auth envelopes (PR 2) and write-side patches alike.
  // Mirrors useNetworkCommands.resolveTargetMachineId.
  const resolveTargetMachineId = useCallback(
    (targetIp: string): string =>
      targetMachineIdFor(
        targetIp,
        lanOccupants,
        activeNetwork?.layers[0]?.subnet ?? null,
        activeNetwork?.localhostIp ?? null,
        ownWorkstationId,
      ),
    [activeNetwork, lanOccupants, ownWorkstationId],
  );
  const { commands, commandNames } = useCommands();
  const ftpCommands = useFtpCommands();
  const ncCommands = useNcCommands();
  const { mysqlExecute } = useMysqlCommands();
  const { redisExecute } = useRedisCommands();
  const {
    readFile,
    getNode,
    writeFile,
    createFile,
    getDefaultHomePath,
    listDirectory,
    resolvePath,
    readFileFromMachine,
    writeFileToMachine,
    createFileOnMachine,
    listDirectoryFromMachine,
    getNodeFromMachine,
    resolvePathForMachine,
  } = useFileSystem();
  const { getMachine, findMachineUsers, findMachineByIp, resolveNat, getLocalIP, getPublicIP } =
    useNetwork();

  const shellCompleteAdapter = useMemo<CompleteAdapter>(() => {
    // NC mode: complete paths against the remote target machine's filesystem.
    if (isInNcMode() && ncSession && ncCommands) {
      return {
        commandNames: Array.from(ncCommands.keys()),
        getCommand: (name) => ncCommands.get(name),
        listPath: (abs) =>
          listDirectoryFromMachine({
            machineId: ncSession.machineId,
            path: abs,
            cwd: '/',
            userType: ncSession.userType,
          }),
        isDirectory: (abs) =>
          getNodeFromMachine(ncSession.machineId, abs, '/')?.type === 'directory',
        resolvePath: (path) => resolvePathForMachine(path, ncSession.currentPath),
      };
    }

    // FTP mode: complete against the remote machine's filesystem. Local-facing
    // commands (lcd, lls, lpwd, put) would prefer origin, but the common case
    // (cd, ls, cat, get on remote) is served by remote — acceptable trade-off
    // without positional awareness in the completer.
    if (isInFtpMode() && ftpSession && ftpCommands) {
      return {
        commandNames: Array.from(ftpCommands.keys()),
        getCommand: (name) => ftpCommands.get(name),
        listPath: (abs) =>
          listDirectoryFromMachine({
            machineId: ftpSession.remoteMachine,
            path: abs,
            cwd: '/',
            userType: ftpSession.remoteUserType,
          }),
        isDirectory: (abs) =>
          getNodeFromMachine(ftpSession.remoteMachine, abs, '/')?.type === 'directory',
        resolvePath: (path) => resolvePathForMachine(path, ftpSession.remoteCwd),
      };
    }

    // Redis / MySQL: no path completion (those modes have no filesystem semantics).
    if (isInRedisMode() || isInMysqlMode()) {
      return {
        commandNames: [],
        getCommand: () => undefined,
        listPath: () => null,
        isDirectory: () => false,
        resolvePath: (p) => p,
      };
    }

    // Default shell mode: current session's filesystem.
    return {
      commandNames,
      getCommand: (name) => commands.get(name),
      listPath: (abs) => listDirectory(abs, session.userType),
      isDirectory: (abs) => getNode(abs)?.type === 'directory',
      resolvePath,
    };
  }, [
    commands,
    commandNames,
    ftpCommands,
    ncCommands,
    ftpSession,
    ncSession,
    isInFtpMode,
    isInNcMode,
    isInRedisMode,
    isInMysqlMode,
    listDirectory,
    listDirectoryFromMachine,
    getNode,
    getNodeFromMachine,
    resolvePath,
    resolvePathForMachine,
    session.userType,
  ]);

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

  // logFs auto-translates LAN IP → canonical machine_id on every
  // read/write/create, so auth log writes (sshAuth, ftpAuth, hydraLog,
  // etc.) handed an IP-form machineId route the patch under the
  // occupant's workstation_id. Without this wrap, cross-player auth
  // lines land at the LAN IP and are missed by B's subscription
  // (keyed by workstation_id) AND by B's own reads of /var/log/auth.log
  // (also keyed by workstation_id). Mirrors useNetworkCommands' wrap.
  const logFs = {
    readFileFromMachine: (op: Parameters<typeof readFileFromMachine>[0]) =>
      readFileFromMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    writeFileToMachine: (op: Parameters<typeof writeFileToMachine>[0]) =>
      writeFileToMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
    createFileOnMachine: (op: Parameters<typeof createFileOnMachine>[0]) =>
      createFileOnMachine({ ...op, machineId: resolveTargetMachineId(op.machineId) }),
  };

  // Hoisted so the AUTH-command branch below can fire it directly — the
  // inline-password path reaches it through onRedisAuth on useAuthentication,
  // but `AUTH <pw>` typed at the redis prompt is handled by useRedisCommands
  // and the result lands back in this component.
  const onRedisAuthHandler = createRedisAuthHandler({
    sessionMachine: session.machine,
    ownWorkstationId,
    getLocalIP,
    getPublicIP,
    resolveNat,
    logFs,
  });

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
    startMysqlPrompt,
    authenticateMysqlInline,
    connectRedis,
  } = useAuthentication({
    addLine,
    session,
    getMachine,
    readFile,
    resolveNat,
    resolveTargetMachineId,
    getDefaultHomePath,
    setUsername,
    setMachine,
    setCurrentPath,
    pushSession,
    pushAuthSession,
    authCreateFtpSession,
    authCreateMysqlSession,
    authCreateRedisSession,
    enterFtpMode,
    enterMysqlMode,
    enterRedisMode,
    readFileFromMachine,
    findMachineUsers,
    findMachineByIp,
    createFile,
    writeFile,
    onSuAuth: (success, targetUser) => {
      const hostname = resolveHostname(session.machine, getMachine);
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
    onSshAuth: createSshAuthHandler({
      sessionMachine: session.machine,
      ownWorkstationId,
      getLocalIP,
      getPublicIP,
      resolveNat,
      getMachine,
      logFs,
    }),
    onFtpAuth: createFtpAuthHandler({
      sessionMachine: session.machine,
      ownWorkstationId,
      getLocalIP,
      getPublicIP,
      resolveNat,
      logFs,
    }),
    onMysqlAuth: createMysqlAuthHandler({
      sessionMachine: session.machine,
      ownWorkstationId,
      getLocalIP,
      getPublicIP,
      resolveNat,
      readFileFromMachine,
      logFs,
    }),
    onRedisConnect: createRedisConnectHandler({
      sessionMachine: session.machine,
      ownWorkstationId,
      getLocalIP,
      getPublicIP,
      resolveNat,
      logFs,
    }),
    onRedisAuth: onRedisAuthHandler,
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
        // Redis mode: raw Redis command input, bypass the shell parser.
        if (isInRedisMode() && redisExecute) {
          const redisTargetIP = redisSession?.targetIP ?? null;
          const result = redisExecute(trimmedCommand);
          if (result.type === 'quit') {
            exitRedisMode();
            addLine('result', 'OK');
            return;
          }
          if (result.type === 'auth_success') {
            addLine('result', 'OK');
            if (redisTargetIP) onRedisAuthHandler(true, redisTargetIP, 6379);
            return;
          }
          if (result.type === 'auth_failed') {
            addLine('result', result.text);
            if (redisTargetIP) onRedisAuthHandler(false, redisTargetIP, 6379);
            return;
          }
          if (result.text) {
            addLine('result', result.text);
          }
          return;
        }

        // MySQL mode: raw SQL input, bypass the shell parser.
        if (isInMysqlMode() && mysqlExecute) {
          const result = mysqlExecute(trimmedCommand);
          if (result.type === 'quit') {
            exitMysqlMode();
            addLine('result', 'Bye');
            return;
          }
          if (result.text) {
            addLine('result', result.text);
          }
          return;
        }

        // In FTP or NC mode, only that mode's command set is visible to the shell.
        const activeCommands =
          isInFtpMode() && ftpCommands
            ? ftpCommands
            : isInNcMode() && ncCommands
              ? ncCommands
              : commands;

        const redirectWriter = (path: string, content: string): void => {
          const resolved = resolvePath(path);
          const existing = getNode(resolved);
          const outcome = existing
            ? writeFile(path, content, session.userType)
            : createFile(path, content, session.userType);
          if (!outcome.allowed) {
            throw new Error(`bash: ${path}: ${outcome.error ?? 'write failed'}`);
          }
        };

        const result = execute(parse(tokenize(trimmedCommand)), activeCommands, {
          redirectWriter,
        });

        if (result !== undefined) {
          if (isClearOutput(result)) {
            clearLines();
            return;
          }
          if (isExitOutput(result)) {
            if (!canReturn()) {
              addLine('error', 'exit: no active session to return to');
              return;
            }
            const snapshot = popSession();
            if (snapshot) {
              addLine('result', snapshot.reason === 'su' ? 'logout' : 'Connection closed.');
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

            try {
              result.start(
                (line: string) => {
                  addLine('result', line);
                },
                (followUp?: AsyncFollowUp) => {
                  setAsyncRunning(false);
                  asyncCancelRef.current = null;

                  if (isSshPrompt(followUp)) {
                    if (followUp.password !== undefined) {
                      authenticateSshInline({
                        user: followUp.targetUser,
                        targetIP: followUp.targetIP,
                        port: followUp.targetPort,
                        password: followUp.password,
                      });
                    } else {
                      startSshPrompt(followUp.targetUser, followUp.targetIP, followUp.targetPort);
                    }
                  }

                  if (isScpPrompt(followUp)) {
                    const transferAsync =
                      followUp.password !== undefined
                        ? authenticateScpInline({
                            user: followUp.targetUser,
                            targetIP: followUp.targetIP,
                            port: followUp.targetPort,
                            password: followUp.password,
                            performTransfer: followUp.performTransfer,
                          })
                        : startScpPrompt({
                            user: followUp.targetUser,
                            targetIP: followUp.targetIP,
                            port: followUp.targetPort,
                            performTransfer: followUp.performTransfer,
                          });
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
                      authenticateFtpInline(
                        followUp.targetIP,
                        followUp.username,
                        followUp.password,
                      );
                    } else {
                      startFtpPrompt(followUp.targetIP);
                    }
                  }

                  if (isMysqlPrompt(followUp)) {
                    if (followUp.password !== undefined) {
                      authenticateMysqlInline(
                        followUp.username,
                        followUp.targetIP,
                        followUp.password,
                      );
                    } else {
                      startMysqlPrompt(followUp.username, followUp.targetIP);
                    }
                  }

                  if (isRedisPrompt(followUp)) {
                    connectRedis(followUp.targetIP, followUp.password);
                  }

                  if (isExploitShell(followUp)) {
                    const resolvedIP = resolveNat(followUp.targetIP, followUp.targetPort).ip;
                    const targetMachine = findMachineByIp(resolvedIP);
                    // Fire-and-forget pushSession; optimistic local update via
                    // setX so the prompt swaps immediately on exploit success.
                    void pushSession('exploit', {
                      machine: resolvedIP,
                      hostname: targetMachine?.hostname,
                      username: followUp.username,
                      userType: followUp.userType,
                      currentPath: followUp.homePath,
                    }).catch((error) => {
                      console.error('[Terminal] pushSession exploit failed:', error);
                    });
                    setUsername(followUp.username, followUp.userType);
                    setMachine(resolvedIP, targetMachine?.hostname);
                    setCurrentPath(followUp.homePath);
                  }

                  if (isNcPrompt(followUp)) {
                    const resolvedIP = resolveNat(followUp.targetIP, followUp.targetPort).ip;
                    if (followUp.proof === 'pidfile') {
                      // PR 5 — server reads /var/run/nc-<port>.pid and
                      // derives credentials. Local guess values on
                      // followUp (username/userType/homePath) are ignored;
                      // the server's parse is authoritative.
                      //
                      // machineId must be the canonical storage key:
                      // the workstation_id for cross-player targets,
                      // the LAN IP for NPC machines. resolveTargetMachineId
                      // mirrors the same translation every other auth
                      // path uses (PRs 2-4); without it, cross-player
                      // pidfiles 401 because the patch row is keyed by
                      // workstation_id, not by LAN IP.
                      authCreateNcSession({
                        machineId: resolveTargetMachineId(resolvedIP),
                        targetIP: resolvedIP,
                        targetPort: followUp.targetPort,
                        service: followUp.service,
                        port: followUp.targetPort,
                      })
                        .then((authResult) => {
                          if (!authResult.ok) {
                            addLine('error', `nc: connection refused (${authResult.reason})`);
                          }
                        })
                        .catch((error: unknown) => {
                          const message = error instanceof Error ? error.message : String(error);
                          addLine('error', `nc: ${message}`);
                        });
                    } else {
                      // proof === 'effect' — msfconsole shell_limited.
                      // Forge bypass remains until PR 7 closes the
                      // effect-grant gap.
                      const newNcSession: NcSession = {
                        targetIP: resolvedIP,
                        targetPort: followUp.targetPort,
                        service: followUp.service,
                        username: followUp.username,
                        userType: followUp.userType,
                        currentPath: followUp.homePath,
                        machineId: resolvedIP,
                        sessionId: null,
                      };
                      enterNcMode(newNcSession);
                    }
                  }
                },
              );
            } catch (startError) {
              setAsyncRunning(false);
              asyncCancelRef.current = null;
              throw startError;
            }
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
      getPrompt,
      commands,
      canReturn,
      popSession,
      pushSession,
      findMachineByIp,
      setUsername,
      setMachine,
      setCurrentPath,
      isInMysqlMode,
      mysqlExecute,
      exitMysqlMode,
      isInFtpMode,
      ftpCommands,
      exitFtpMode,
      isInNcMode,
      ncCommands,
      exitNcMode,
      enterNcMode,
      authCreateNcSession,
      resolveTargetMachineId,
      getNode,
      readFile,
      resolvePath,
      writeFile,
      createFile,
      session.userType,
      resolveNat,
      startPasswordPrompt,
      startSshPrompt,
      authenticateSshInline,
      startScpPrompt,
      authenticateScpInline,
      startFtpPrompt,
      authenticateFtpInline,
      startMysqlPrompt,
      authenticateMysqlInline,
      isInRedisMode,
      redisExecute,
      redisSession,
      onRedisAuthHandler,
      exitRedisMode,
      connectRedis,
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

  // Tokenizer-driven completion: classifies the cursor as command / path / flag position,
  // then dispatches to the appropriate source (command registry / filesystem / command.manual).
  const handleTab = useCallback(
    (cursorPosition: number) => {
      const outcome = complete(input, cursorPosition, shellCompleteAdapter);
      if (outcome.matches.length === 0) return;

      if (outcome.replacement !== input) {
        setInput(outcome.replacement);
        requestAnimationFrame(() => {
          terminalInputRef.current?.setSelectionRange(
            outcome.newCursorPosition,
            outcome.newCursorPosition,
          );
        });
      }
      if (outcome.matches.length > 1) {
        addLine('result', outcome.displayText);
      }
    },
    [input, shellCompleteAdapter, addLine],
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
