import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { getCachedSessionState, getDatabase } from '../utils/storageCache';
import { saveSessionState } from '../utils/storage';

export type UserType = 'root' | 'user' | 'guest';

export type Session = {
  readonly username: string;
  readonly userType: UserType;
  readonly machine: string;
  readonly currentPath: string;
  readonly wifiConnected: boolean;
};

export type SessionSnapshot = {
  readonly username: string;
  readonly userType: UserType;
  readonly machine: string;
  readonly currentPath: string;
  readonly wifiConnected: boolean;
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
};

export type PersistedState = {
  readonly session: Session;
  readonly sessionStack: readonly SessionSnapshot[];
  readonly ftpSession: FtpSession | null;
  readonly ncSession: NcSession | null;
};

const isValidUserType = (value: unknown): value is UserType =>
  value === 'root' || value === 'user' || value === 'guest';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

const isValidSession = (value: unknown): value is Session => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.username === 'string' &&
    typeof obj.machine === 'string' &&
    typeof obj.currentPath === 'string' &&
    isValidUserType(obj.userType) &&
    (obj.wifiConnected === undefined || typeof obj.wifiConnected === 'boolean')
  );
};

const isValidSessionSnapshot = (value: unknown): value is SessionSnapshot => isValidSession(value);

const isValidFtpSession = (value: unknown): value is FtpSession => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.remoteMachine === 'string' &&
    typeof obj.remoteUsername === 'string' &&
    typeof obj.remoteCwd === 'string' &&
    typeof obj.originMachine === 'string' &&
    typeof obj.originUsername === 'string' &&
    typeof obj.originCwd === 'string' &&
    isValidUserType(obj.remoteUserType) &&
    isValidUserType(obj.originUserType)
  );
};

const isValidNcSession = (value: unknown): value is NcSession => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    typeof obj.targetIP === 'string' &&
    typeof obj.targetPort === 'number' &&
    typeof obj.service === 'string' &&
    typeof obj.username === 'string' &&
    typeof obj.currentPath === 'string' &&
    isValidUserType(obj.userType)
  );
};

export const isValidPersistedState = (value: unknown): value is PersistedState => {
  const obj = asRecord(value);
  if (!obj) return false;
  return (
    isValidSession(obj.session) &&
    Array.isArray(obj.sessionStack) &&
    (obj.sessionStack as unknown[]).every(isValidSessionSnapshot) &&
    (obj.ftpSession === null || isValidFtpSession(obj.ftpSession)) &&
    // ncSession was added after v0 — old persisted data may have it as undefined (missing key)
    (obj.ncSession === null || obj.ncSession === undefined || isValidNcSession(obj.ncSession))
  );
};

type SessionContextValue = {
  readonly session: Session;
  readonly sessionStack: readonly SessionSnapshot[];
  readonly ftpSession: FtpSession | null;
  readonly ncSession: NcSession | null;
  readonly setUsername: (username: string, userType?: UserType) => void;
  readonly setMachine: (machine: string) => void;
  readonly setCurrentPath: (path: string) => void;
  readonly getPrompt: () => string;
  readonly pushSession: () => void;
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
  readonly setWifiConnected: (connected: boolean) => void;
};

const defaultSession: Session = {
  username: 'jshacker',
  userType: 'user',
  machine: 'localhost',
  currentPath: '/home/jshacker',
  wifiConnected: false,
};

const SessionContext = createContext<SessionContextValue | null>(null);

const normalizeSession = (session: Session): Session => ({
  ...session,
  wifiConnected: session.wifiConnected ?? false,
});

const getInitialState = (): PersistedState => {
  const persisted = getCachedSessionState();
  if (persisted) {
    return {
      ...persisted,
      session: normalizeSession(persisted.session),
      sessionStack: persisted.sessionStack.map(normalizeSnapshot),
      ncSession: persisted.ncSession ?? null,
    };
  }
  return {
    session: defaultSession,
    sessionStack: [],
    ftpSession: null,
    ncSession: null,
  };
};

const normalizeSnapshot = (snapshot: SessionSnapshot): SessionSnapshot => ({
  ...snapshot,
  wifiConnected: snapshot.wifiConnected ?? false,
});

export const SessionProvider = ({ children }: { children: ReactNode }) => {
  const [initialState] = useState(getInitialState);
  const [session, setSession] = useState<Session>(initialState.session);
  const [sessionStack, setSessionStack] = useState<readonly SessionSnapshot[]>(
    initialState.sessionStack,
  );
  const [ftpSession, setFtpSession] = useState<FtpSession | null>(initialState.ftpSession);
  const [ncSession, setNcSession] = useState<NcSession | null>(initialState.ncSession);

  useEffect(() => {
    const db = getDatabase();
    if (db) {
      saveSessionState(db, { session, sessionStack, ftpSession, ncSession });
    }
  }, [session, sessionStack, ftpSession, ncSession]);

  const setUsername = useCallback((username: string, userType: UserType = 'user') => {
    setSession((prev) => ({ ...prev, username, userType }));
  }, []);

  const setMachine = useCallback((machine: string) => {
    setSession((prev) => ({ ...prev, machine }));
  }, []);

  const setCurrentPath = useCallback((currentPath: string) => {
    setSession((prev) => ({ ...prev, currentPath }));
  }, []);

  const getPrompt = useCallback(() => {
    if (ftpSession) return 'ftp>';
    if (ncSession) return '$';
    return `${session.username}@${session.machine}>`;
  }, [session.username, session.machine, ftpSession, ncSession]);

  const pushSession = useCallback(() => {
    const snapshot: SessionSnapshot = {
      username: session.username,
      userType: session.userType,
      machine: session.machine,
      currentPath: session.currentPath,
      wifiConnected: session.wifiConnected,
    };
    setSessionStack((prev) => [...prev, snapshot]);
  }, [session.username, session.userType, session.machine, session.currentPath, session.wifiConnected]);

  const popSession = useCallback((): SessionSnapshot | null => {
    if (sessionStack.length === 0) return null;

    const snapshot = sessionStack[sessionStack.length - 1];
    setSessionStack((prev) => prev.slice(0, -1));
    setSession({
      username: snapshot.username,
      userType: snapshot.userType,
      machine: snapshot.machine,
      currentPath: snapshot.currentPath,
      wifiConnected: snapshot.wifiConnected,
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

  const setWifiConnected = useCallback((connected: boolean) => {
    setSession((prev) => ({ ...prev, wifiConnected: connected }));
  }, []);

  return (
    <SessionContext.Provider
      value={{
        session,
        sessionStack,
        ftpSession,
        ncSession,
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
        setWifiConnected,
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
