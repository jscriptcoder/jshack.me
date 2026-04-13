import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { WifiConnection } from '../network/wifiTypes';
import {
  getCachedSessionState,
  getCachedWifiState,
  getCachedBrickedMachines,
  getDatabase,
} from '../utils/storageCache';
import { saveSessionToTab, saveWifiState, saveBrickedMachines } from '../utils/storage';
import { THEMES } from '../theme/themes';
import type { ThemeId } from '../theme/themes';
import { applyTheme } from '../theme/applyTheme';
import { createSyncChannel, type SyncMessage } from '../utils/crossTabSync';
import { createDefaultSession, normalizeSession, normalizeSnapshot } from './sessionUtils';

// Re-export for backward compatibility — consumed by storage.ts
export { isValidPersistedState } from './sessionUtils';

export type UserType = 'root' | 'user' | 'guest';

export type Session = {
  readonly username: string;
  readonly userType: UserType;
  readonly machine: string;
  readonly hostname?: string;
  readonly currentPath: string;
  readonly theme: ThemeId;
};

export type SessionReason = 'ssh' | 'su' | 'exploit';

export type SessionSnapshot = {
  readonly username: string;
  readonly userType: UserType;
  readonly machine: string;
  readonly hostname?: string;
  readonly currentPath: string;
  readonly theme: ThemeId;
  readonly reason: SessionReason;
};

export type FtpSession = {
  readonly remoteMachine: string;
  readonly remoteUsername: string;
  readonly remoteUserType: UserType;
  readonly remoteCwd: string;
  readonly originMachine: string;
  readonly originUsername: string;
  readonly originUserType: UserType;
  readonly originCwd: string;
};

export type NcSession = {
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: UserType;
  readonly currentPath: string;
  // Filesystem key for the target machine. Usually equals targetIP, but
  // localhost uses "localhost" as its filesystem key rather than its network IP.
  readonly machineId: string;
};

export type MysqlSession = {
  readonly targetIP: string;
  readonly machineId: string;
  readonly username: string;
  readonly databaseName: string;
};

export type RedisSession = {
  readonly targetIP: string;
  readonly machineId: string;
};

export type PersistedState = {
  readonly session: Session;
  readonly sessionStack: readonly SessionSnapshot[];
  readonly ftpSession: FtpSession | null;
  readonly ncSession: NcSession | null;
  readonly mysqlSession: MysqlSession | null;
  readonly redisSession: RedisSession | null;
};

type SessionContextValue = {
  readonly session: Session;
  readonly workstationName: string | undefined;
  readonly connectedWifi: WifiConnection | null;
  readonly wifiConnected: boolean;
  readonly sessionStack: readonly SessionSnapshot[];
  readonly ftpSession: FtpSession | null;
  readonly ncSession: NcSession | null;
  readonly mysqlSession: MysqlSession | null;
  readonly redisSession: RedisSession | null;
  readonly setUsername: (username: string, userType?: UserType) => void;
  readonly setMachine: (machine: string, hostname?: string) => void;
  readonly setCurrentPath: (path: string) => void;
  readonly getPrompt: () => string;
  readonly pushSession: (reason: SessionReason) => void;
  readonly popSession: () => SessionSnapshot | null;
  readonly canReturn: () => boolean;
  readonly enterFtpMode: (ftpSession: FtpSession) => void;
  readonly exitFtpMode: () => FtpSession | null;
  readonly updateFtpRemoteCwd: (cwd: string) => void;
  readonly updateFtpOriginCwd: (cwd: string) => void;
  readonly isInFtpMode: () => boolean;
  readonly enterNcMode: (ncSession: NcSession) => void;
  readonly exitNcMode: () => NcSession | null;
  readonly isInNcMode: () => boolean;
  readonly updateNcCwd: (cwd: string) => void;
  readonly enterMysqlMode: (mysqlSession: MysqlSession) => void;
  readonly exitMysqlMode: () => MysqlSession | null;
  readonly isInMysqlMode: () => boolean;
  readonly enterRedisMode: (redisSession: RedisSession) => void;
  readonly exitRedisMode: () => RedisSession | null;
  readonly isInRedisMode: () => boolean;
  readonly setWifiConnected: (connection: WifiConnection | null) => void;
  readonly disconnectWifi: () => void;
  readonly popAllSessions: () => void;
  readonly setTheme: (theme: ThemeId) => void;
  readonly markMachineBricked: (machine: string) => void;
  readonly isMachineBricked: (machine: string) => boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

const getInitialState = (username: string): PersistedState => {
  const persisted = getCachedSessionState();
  if (persisted) {
    return {
      ...persisted,
      session: normalizeSession(persisted.session),
      sessionStack: persisted.sessionStack.map(normalizeSnapshot),
      ncSession: persisted.ncSession
        ? {
            ...persisted.ncSession,
            machineId: persisted.ncSession.machineId ?? persisted.ncSession.targetIP,
          }
        : null,
      // Interactive service sessions don't survive page reloads — the connection
      // is lost on refresh, so always start with no active service session.
      mysqlSession: null,
      redisSession: null,
    };
  }
  return {
    session: createDefaultSession(username),
    sessionStack: [],
    ftpSession: null,
    ncSession: null,
    mysqlSession: null,
    redisSession: null,
  };
};

type SessionProviderProps = {
  readonly children: ReactNode;
  readonly workstationName?: string;
  readonly username: string;
};

export const SessionProvider = ({ children, workstationName, username }: SessionProviderProps) => {
  const [initialState] = useState(() => getInitialState(username));
  const [session, setSession] = useState<Session>(initialState.session);
  const [connectedWifi, setConnectedWifiState] = useState<WifiConnection | null>(
    getCachedWifiState,
  );
  const wifiConnected = connectedWifi !== null;
  const [sessionStack, setSessionStack] = useState<readonly SessionSnapshot[]>(
    initialState.sessionStack,
  );
  const [ftpSession, setFtpSession] = useState<FtpSession | null>(initialState.ftpSession);
  const [ncSession, setNcSession] = useState<NcSession | null>(initialState.ncSession);
  const [mysqlSession, setMysqlSession] = useState<MysqlSession | null>(initialState.mysqlSession);
  const [redisSession, setRedisSession] = useState<RedisSession | null>(initialState.redisSession);
  const [brickedMachines, setBrickedMachines] = useState<ReadonlySet<string>>(
    () => new Set(getCachedBrickedMachines()),
  );
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcast calls always use
  // the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);
  // Stable ref for username — avoids re-creating the BroadcastChannel effect
  const usernameRef = useRef(username);
  usernameRef.current = username;

  // Subscribe to WiFi and theme changes from other tabs.
  // BroadcastChannel does not deliver messages to the posting tab, so no echo guard needed.
  useEffect(() => {
    const channel = createSyncChannel();
    syncChannelRef.current = channel;
    channel.onMessage((message: SyncMessage) => {
      if (message.type === 'wifi-changed') {
        setConnectedWifiState(message.connection);
        if (!message.connection) {
          // When another tab disconnects WiFi, reset this tab to localhost too
          const u = usernameRef.current;
          setSession((prev) => ({
            username: u,
            userType: 'user' as const,
            machine: 'localhost',
            currentPath: prev.machine === 'localhost' ? prev.currentPath : `/home/${u}`,
            theme: prev.theme,
          }));
          setSessionStack([]);
          setFtpSession(null);
          setNcSession(null);
          setMysqlSession(null);
          setRedisSession(null);
        }
      }
      if (message.type === 'theme-changed') {
        setSession((prev) => ({ ...prev, theme: message.theme }));
      }
      if (message.type === 'bricked-changed') {
        setBrickedMachines((prev) => new Set([...prev, message.machine]));
      }
    });
    return () => channel.close();
  }, []);

  // Sync workstationName into session.hostname when on localhost.
  // Handles all reset paths (WiFi disconnect, session pop, initial load).
  useEffect(() => {
    if (
      session.machine === 'localhost' &&
      workstationName &&
      session.hostname !== workstationName
    ) {
      setSession((prev) => ({ ...prev, hostname: workstationName }));
    }
  }, [session.machine, session.hostname, workstationName]);

  // Session state persists to sessionStorage (per-tab)
  useEffect(() => {
    saveSessionToTab({ session, sessionStack, ftpSession, ncSession, mysqlSession, redisSession });
  }, [session, sessionStack, ftpSession, ncSession, mysqlSession, redisSession]);

  const setUsername = useCallback((username: string, userType: UserType = 'user') => {
    setSession((prev) => ({ ...prev, username, userType }));
  }, []);

  const setMachine = useCallback((machine: string, hostname?: string) => {
    setSession((prev) => ({ ...prev, machine, hostname }));
  }, []);

  const setCurrentPath = useCallback((currentPath: string) => {
    setSession((prev) => ({ ...prev, currentPath }));
  }, []);

  const getPrompt = useCallback(() => {
    if (redisSession) return 'redis>';
    if (mysqlSession) return 'mysql>';
    if (ftpSession) return 'ftp>';
    if (ncSession) return '$';
    return `${session.username}@${session.hostname ?? session.machine}>`;
  }, [
    session.username,
    session.machine,
    session.hostname,
    ftpSession,
    ncSession,
    mysqlSession,
    redisSession,
  ]);

  const pushSession = useCallback(
    (reason: SessionReason) => {
      const snapshot: SessionSnapshot = {
        username: session.username,
        userType: session.userType,
        machine: session.machine,
        hostname: session.hostname,
        currentPath: session.currentPath,
        theme: session.theme,
        reason,
      };
      setSessionStack((prev) => [...prev, snapshot]);
    },
    [
      session.username,
      session.userType,
      session.machine,
      session.hostname,
      session.currentPath,
      session.theme,
    ],
  );

  const popSession = useCallback((): SessionSnapshot | null => {
    if (sessionStack.length === 0) return null;

    const snapshot = sessionStack[sessionStack.length - 1];
    setSessionStack((prev) => prev.slice(0, -1));
    setSession({
      username: snapshot.username,
      userType: snapshot.userType,
      machine: snapshot.machine,
      hostname: snapshot.hostname,
      currentPath: snapshot.currentPath,
      theme: snapshot.theme,
    });
    return snapshot;
  }, [sessionStack]);

  const canReturn = useCallback(() => sessionStack.length > 0, [sessionStack.length]);

  const enterFtpMode = useCallback((newFtpSession: FtpSession) => {
    setFtpSession(newFtpSession);
  }, []);

  const exitFtpMode = useCallback((): FtpSession | null => {
    const current = ftpSession;
    setFtpSession(null);
    return current;
  }, [ftpSession]);

  const updateFtpRemoteCwd = useCallback((cwd: string) => {
    setFtpSession((prev) => (prev ? { ...prev, remoteCwd: cwd } : null));
  }, []);

  const updateFtpOriginCwd = useCallback((cwd: string) => {
    setFtpSession((prev) => (prev ? { ...prev, originCwd: cwd } : null));
  }, []);

  const isInFtpMode = useCallback(() => ftpSession !== null, [ftpSession]);

  const enterNcMode = useCallback((newNcSession: NcSession) => {
    setNcSession(newNcSession);
  }, []);

  const exitNcMode = useCallback((): NcSession | null => {
    const current = ncSession;
    setNcSession(null);
    return current;
  }, [ncSession]);

  const isInNcMode = useCallback(() => ncSession !== null, [ncSession]);

  const updateNcCwd = useCallback((cwd: string) => {
    setNcSession((prev) => (prev ? { ...prev, currentPath: cwd } : null));
  }, []);

  const enterMysqlMode = useCallback((newMysqlSession: MysqlSession) => {
    setMysqlSession(newMysqlSession);
  }, []);

  const exitMysqlMode = useCallback((): MysqlSession | null => {
    const current = mysqlSession;
    setMysqlSession(null);
    return current;
  }, [mysqlSession]);

  const isInMysqlMode = useCallback(() => mysqlSession !== null, [mysqlSession]);

  const enterRedisMode = useCallback((newRedisSession: RedisSession) => {
    setRedisSession(newRedisSession);
  }, []);

  const exitRedisMode = useCallback((): RedisSession | null => {
    const current = redisSession;
    setRedisSession(null);
    return current;
  }, [redisSession]);

  const isInRedisMode = useCallback(() => redisSession !== null, [redisSession]);

  const setWifiConnected = useCallback((connection: WifiConnection | null) => {
    setConnectedWifiState(connection);
    // WiFi state is shared across tabs — persist to IndexedDB
    const db = getDatabase();
    if (db) {
      saveWifiState(db, connection);
    }
    syncChannelRef.current?.broadcast({ type: 'wifi-changed', connection });
  }, []);

  const markMachineBricked = useCallback((machine: string) => {
    setBrickedMachines((prev) => {
      if (prev.has(machine)) return prev;
      const updated = new Set([...prev, machine]);
      // Persist to IndexedDB (shared across tabs)
      const db = getDatabase();
      if (db) {
        saveBrickedMachines(db, [...updated]);
      }
      syncChannelRef.current?.broadcast({ type: 'bricked-changed', machine });
      return updated;
    });
  }, []);

  const isMachineBricked = useCallback(
    (machine: string) => brickedMachines.has(machine),
    [brickedMachines],
  );

  const setTheme = useCallback((theme: ThemeId) => {
    setSession((prev) => ({ ...prev, theme }));
    syncChannelRef.current?.broadcast({ type: 'theme-changed', theme });
  }, []);

  useEffect(() => {
    applyTheme(THEMES[session.theme]);
  }, [session.theme]);

  // Dynamic browser tab title so users can identify tabs at a glance
  useEffect(() => {
    const displayMachine = session.hostname ?? session.machine;
    const modeLabels: readonly (readonly [unknown, string])[] = [
      [redisSession, 'redis>'],
      [mysqlSession, 'mysql>'],
      [ftpSession, 'ftp>'],
      [ncSession, 'nc shell'],
    ];
    const modeLabel = modeLabels.find(([session]) => session !== null)?.[1];
    const title = modeLabel
      ? `${modeLabel} \u2014 JSHACK.ME`
      : `${session.username}@${displayMachine} \u2014 JSHACK.ME`;
    document.title = title;
  }, [
    session.username,
    session.machine,
    session.hostname,
    ftpSession,
    ncSession,
    mysqlSession,
    redisSession,
  ]);

  // Resets to the bottom of the session stack (the original state before any SSH).
  // Used by mission abort to return to localhost regardless of SSH nesting depth.
  const popAllSessions = useCallback(() => {
    if (sessionStack.length === 0) return;
    const bottom = sessionStack[0];
    setSessionStack([]);
    setFtpSession(null);
    setNcSession(null);
    setMysqlSession(null);
    setRedisSession(null);
    if (bottom) {
      setSession({
        username: bottom.username,
        userType: bottom.userType,
        machine: bottom.machine,
        currentPath: bottom.currentPath,
        theme: bottom.theme,
      });
    }
  }, [sessionStack]);

  // Atomically resets to localhost with WiFi off. Can be called while SSH'd into a remote
  // machine — finds the original localhost path from the bottom of the session stack
  // (the state before the first SSH), or uses the current path if already on localhost.
  const disconnectWifi = useCallback(() => {
    setConnectedWifiState(null);
    const defaultHome = `/home/${username}`;
    setSession((prev) => {
      const localhostPath =
        sessionStack.length > 0
          ? (sessionStack[0]?.currentPath ?? defaultHome)
          : prev.machine === 'localhost'
            ? prev.currentPath
            : defaultHome;
      return {
        username,
        userType: 'user' as const,
        machine: 'localhost',
        currentPath: localhostPath,
        theme: prev.theme,
      };
    });
    setSessionStack([]);
    setFtpSession(null);
    setNcSession(null);
    setMysqlSession(null);
    setRedisSession(null);
    // WiFi state is shared across tabs — persist to IndexedDB
    const db = getDatabase();
    if (db) {
      saveWifiState(db, null);
    }
    syncChannelRef.current?.broadcast({ type: 'wifi-changed', connection: null });
  }, [sessionStack, username]);

  return (
    <SessionContext.Provider
      value={{
        session,
        workstationName,
        connectedWifi,
        wifiConnected,
        sessionStack,
        ftpSession,
        ncSession,
        mysqlSession,
        redisSession,
        setUsername,
        setMachine,
        setCurrentPath,
        getPrompt,
        pushSession,
        popSession,
        canReturn,
        enterFtpMode,
        exitFtpMode,
        updateFtpRemoteCwd,
        updateFtpOriginCwd,
        isInFtpMode,
        enterNcMode,
        exitNcMode,
        isInNcMode,
        updateNcCwd,
        enterMysqlMode,
        exitMysqlMode,
        isInMysqlMode,
        enterRedisMode,
        exitRedisMode,
        isInRedisMode,
        setWifiConnected,
        disconnectWifi,
        popAllSessions,
        setTheme,
        markMachineBricked,
        isMachineBricked,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = (): SessionContextValue => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
