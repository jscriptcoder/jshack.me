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
import {
  createDefaultSession,
  normalizeFtpSession,
  normalizeSession,
  normalizeSnapshot,
} from './sessionUtils';
import { getIdentity } from '../identity';
import { displayPromptHostname } from '../homeNetworks/homeNetworkHelpers';
import {
  createSession as createServerSession,
  endSession as endServerSession,
  listSessions as listServerSessions,
} from '../sessionRegistry/client';
import type { SessionSummary } from '../sessionRegistry/types';

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
  // Server-tracked session identifier (UUID from /api/sessions). null = the
  // implicit pre-push workstation state, never tracked server-side.
  readonly sessionId: string | null;
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
  // sessionId of THIS state when it was the current session (i.e., the value
  // current.sessionId held at the moment of being snapshotted). null if it
  // was the untracked default localhost.
  readonly sessionId: string | null;
};

// Destination state for a pushSession call — the new presence the user is
// transitioning into. pushSession atomically sends a createSession request,
// snapshots the prior current Session onto the stack, and switches the local
// current Session to this destination + the server-issued sessionId.
export type PushDestination = {
  readonly machine: string;
  readonly hostname?: string;
  readonly username: string;
  readonly userType: UserType;
  readonly currentPath: string;
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
  // Server-tracked session identifier for the FTP login. null means
  // either the createSession push hasn't resolved yet (race window
  // immediately after enterFtpMode) or the push failed. exitFtpMode
  // calls endSession only when this is non-null.
  readonly sessionId: string | null;
};

export type NcSession = {
  readonly targetIP: string;
  readonly targetPort: number;
  readonly service: string;
  readonly username: string;
  readonly userType: UserType;
  readonly currentPath: string;
  // Filesystem key for the target machine. Equals the target's
  // workstation_id when nc'ing into the player's own loopback (the
  // value of session.hostname); otherwise equals targetIP for remote
  // machines.
  readonly machineId: string;
  // Server-tracked session id for the nc backdoor connection. null = push
  // pending or failed. Same lifecycle as FtpSession.sessionId / etc.
  readonly sessionId: string | null;
};

export type MysqlSession = {
  readonly targetIP: string;
  readonly machineId: string;
  readonly username: string;
  readonly databaseName: string;
  // Server-tracked session id for the mysql login. null = push pending
  // or failed. Same lifecycle as FtpSession.sessionId.
  readonly sessionId: string | null;
};

export type RedisSession = {
  readonly targetIP: string;
  readonly machineId: string;
  // Server-tracked session id for the redis connection. Same lifecycle
  // as FtpSession.sessionId / MysqlSession.sessionId.
  readonly sessionId: string | null;
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
  // True between SessionProvider mount and the first listSessions resolve.
  // Consumers can use this to render a "restoring sessions…" indicator if
  // the brief delay is user-visible. False once rehydration completes
  // (success or failure — local state is left untouched on failure).
  readonly isRehydrating: boolean;
  // Player's workstation_id (suffixed hostname). Always defined — App.tsx
  // gates SessionProvider mount on hostname being computed. Storage keys,
  // Realtime channel names, and own-workstation comparisons all use this.
  readonly hostname: string;
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
  readonly pushSession: (reason: SessionReason, destination: PushDestination) => Promise<void>;
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

const getInitialState = (username: string, hostname: string): PersistedState => {
  const persisted = getCachedSessionState();
  if (persisted) {
    return {
      ...persisted,
      session: normalizeSession(persisted.session),
      sessionStack: persisted.sessionStack.map(normalizeSnapshot),
      ftpSession: persisted.ftpSession ? normalizeFtpSession(persisted.ftpSession) : null,
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
    session: createDefaultSession(username, hostname),
    sessionStack: [],
    ftpSession: null,
    ncSession: null,
    mysqlSession: null,
    redisSession: null,
  };
};

type SessionProviderProps = {
  readonly children: ReactNode;
  // Player's full machine name including the identity-derived suffix
  // (e.g., 'skylab-aabbccdd'). Computed once at game start by
  // computePlayerHostname; threaded through here. This value IS the
  // player's workstation_id — same string used as the storage key for
  // the player's filesystem (FileSystemContext.tsx), the patches
  // table machine_id, the patches:<id> Realtime channel name, and the
  // home_network_occupants.hostname column other players see. Required
  // (no default) because every storage operation depends on it; App.tsx
  // guards against rendering SessionProvider before hostname resolves.
  readonly hostname: string;
  readonly username: string;
};

// Lossy reconstruction: server stores machine_id + credentials but not
// hostname/currentPath/start_reason (those are client-side concerns we
// don't persist). On rehydration we synthesize them from what we have:
//   - currentPath: '/root' for root, '/home/<user>' otherwise
//   - hostname: undefined (UI falls back to machine for display)
//   - reason (snapshot only): default 'ssh' (cosmetic — affects exit msg)
const homePathFor = (s: SessionSummary): string =>
  s.credentials.userType === 'root' ? '/root' : `/home/${s.credentials.username}`;

const summaryToSession = (s: SessionSummary, theme: ThemeId): Session => ({
  username: s.credentials.username,
  userType: s.credentials.userType,
  machine: s.machine_id,
  currentPath: homePathFor(s),
  theme,
  sessionId: s.session_id,
});

const summaryToSnapshot = (s: SessionSummary, theme: ThemeId): SessionSnapshot => ({
  username: s.credentials.username,
  userType: s.credentials.userType,
  machine: s.machine_id,
  currentPath: homePathFor(s),
  theme,
  reason: 'ssh',
  sessionId: s.session_id,
});

export const SessionProvider = ({ children, hostname, username }: SessionProviderProps) => {
  const [initialState] = useState(() => getInitialState(username, hostname));
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
  const [isRehydrating, setIsRehydrating] = useState(true);
  // Create channel inside effect so StrictMode's cleanup + re-run cycle gets
  // a fresh (open) channel. The ref is updated so broadcast calls always use
  // the currently-active channel.
  const syncChannelRef = useRef<ReturnType<typeof createSyncChannel> | null>(null);
  // Stable refs for username and hostname — both are read by the
  // BroadcastChannel cross-tab WiFi listener, which is mounted once
  // and must always observe the latest values rather than what was
  // closed over at mount time.
  const usernameRef = useRef(username);
  usernameRef.current = username;
  const hostnameRef = useRef(hostname);
  hostnameRef.current = hostname;

  // Rehydrate session state from the server on mount. The server is the
  // truth on "what sessions does this player currently have?" — local
  // sessionStorage is just a UI cache. If the server says a session is
  // gone, we discard the local view of it. Empty server response = reset
  // to default localhost (overrides any stale sessionStorage).
  //
  // Lossy: see summaryToSession comment for what gets reconstructed vs
  // defaulted. Multi-tab edge case (multiple chains) is deferred — for
  // Phase 1+3 we assume single-tab single-chain.
  useEffect(() => {
    let cancelled = false;
    void listServerSessions(getIdentity())
      .then((sessions) => {
        if (cancelled) return;
        // Filter to shell-class kinds before chain reconstruction.
        // Protocol/transient sessions (FTP/mysql/redis/scp/snmp/effect_-
        // one_shot) live in their own client-side state fields and
        // don't belong on the shell stack — including them would put
        // the wrong machine as "current" and pollute the snapshot stack.
        const shellSessions = sessions.filter(
          (s) => s.kind === 'ssh' || s.kind === 'su' || s.kind === 'exploit',
        );
        if (shellSessions.length === 0) {
          // Server says no active SHELL sessions — reset to the default
          // workstation state, discarding any stale local stack from
          // sessionStorage. Note: the player may still have active
          // protocol sessions on the server (FTP/mysql/etc.); those are
          // restored elsewhere (or simply abandoned for now — see plan).
          setSessionStack([]);
          setSession((prev) => ({
            username,
            userType: 'user' as const,
            machine: hostname,
            hostname,
            currentPath: `/home/${username}`,
            theme: prev.theme,
            sessionId: null,
          }));
          return;
        }
        // Build the chain locally: bottom (untracked localhost), then a
        // snapshot per shell session except the newest, which becomes
        // the current Session. created_at ASC — server already orders,
        // defensive.
        const sortedSessions = [...shellSessions].sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        );
        setSession((prev) => {
          const newest = sortedSessions[sortedSessions.length - 1]!;
          const bottom: SessionSnapshot = {
            username,
            userType: 'user',
            machine: hostname,
            hostname,
            currentPath: `/home/${username}`,
            theme: prev.theme,
            reason: 'ssh',
            sessionId: null,
          };
          const stack: SessionSnapshot[] = [bottom];
          for (let i = 0; i < sortedSessions.length - 1; i++) {
            stack.push(summaryToSnapshot(sortedSessions[i]!, prev.theme));
          }
          setSessionStack(stack);
          return summaryToSession(newest, prev.theme);
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[session] rehydration failed:', error);
        // Leave local state untouched on failure — degraded experience but
        // not broken. Player can still see whatever sessionStorage restored.
      })
      .finally(() => {
        if (!cancelled) setIsRehydrating(false);
      });
    return () => {
      cancelled = true;
    };
    // Mount-only — explicit empty deps. username doesn't change in practice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to WiFi and theme changes from other tabs.
  // BroadcastChannel does not deliver messages to the posting tab, so no echo guard needed.
  useEffect(() => {
    const channel = createSyncChannel();
    syncChannelRef.current = channel;
    channel.onMessage((message: SyncMessage) => {
      if (message.type === 'wifi-changed') {
        setConnectedWifiState(message.connection);
        if (!message.connection) {
          // When another tab disconnects WiFi, reset this tab to its
          // own workstation too. We capture refs (username, hostname)
          // because this listener is mounted once and must always read
          // the latest values, not the values closed over at mount time.
          const u = usernameRef.current;
          const h = hostnameRef.current;
          setSession((prev) => ({
            username: u,
            userType: 'user' as const,
            machine: h,
            hostname: h,
            currentPath: prev.machine === h ? prev.currentPath : `/home/${u}`,
            theme: prev.theme,
            sessionId: null,
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

  // Sync hostname into session.hostname whenever it diverges from the
  // hostname prop while sitting on the player's own workstation. The
  // hostname prop is the already-suffixed full name
  // (e.g., 'skylab-aabbccdd') — computed once at game start, stable
  // across the session. The session.hostname dep is load-bearing: the
  // listSessions rehydration above replaces the whole session object
  // and may not carry hostname through, so we re-fire to put it back.
  // The functional setSession returns prev when the value already
  // matches, so this doesn't loop.
  useEffect(() => {
    if (session.machine === hostname) {
      setSession((prev) => (prev.hostname === hostname ? prev : { ...prev, hostname }));
    }
  }, [session.machine, session.hostname, hostname]);

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
    // Strip the identity-derived 8-hex suffix from the displayed
    // hostname — `alice@skylab>` reads better than
    // `alice@skylab-aabbccdd>`. Other surfaces (nmap output,
    // /etc/hostname, ssh banner, log lines) keep showing the full
    // hostname; the suffix only matters for storage uniqueness, not
    // for the prompt.
    const displayHost = displayPromptHostname(session.hostname ?? session.machine);
    return `${session.username}@${displayHost}>`;
  }, [
    session.username,
    session.machine,
    session.hostname,
    ftpSession,
    ncSession,
    mysqlSession,
    redisSession,
  ]);

  // Push: snapshot the current Session onto the stack, then create a server-
  // side session for the destination, then atomically switch local state. We
  // server-first to keep local state and server truth in sync — if the
  // server call fails, neither the stack nor the current Session is mutated,
  // and the error propagates to the caller.
  //
  // parent_session_id chains the hop: each push references the prior current
  // session's id (or undefined when leaving the untracked default localhost).
  // source_ip is the prior current's machine — denormalized so future
  // access.log realism doesn't have to walk the chain.
  const pushSession = useCallback(
    async (reason: SessionReason, destination: PushDestination): Promise<void> => {
      const snapshot: SessionSnapshot = {
        username: session.username,
        userType: session.userType,
        machine: session.machine,
        hostname: session.hostname,
        currentPath: session.currentPath,
        theme: session.theme,
        reason,
        sessionId: session.sessionId,
      };

      const newSessionId = await createServerSession(getIdentity(), {
        machine_id: destination.machine,
        credentials: {
          username: destination.username,
          userType: destination.userType,
        },
        ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
        source_ip: session.machine,
        // SessionReason and SessionKind happen to share the same
        // string values for shell-class kinds — pass through 1:1.
        // Protocol/transient sessions go through different code paths
        // (enterFtpMode, withTransientSession) and pass their kind
        // explicitly there.
        kind: reason,
      });

      setSessionStack((prev) => [...prev, snapshot]);
      setSession({
        machine: destination.machine,
        hostname: destination.hostname,
        username: destination.username,
        userType: destination.userType,
        currentPath: destination.currentPath,
        theme: session.theme,
        sessionId: newSessionId,
      });
    },
    [
      session.username,
      session.userType,
      session.machine,
      session.hostname,
      session.currentPath,
      session.theme,
      session.sessionId,
    ],
  );

  // popSession: end the current server-side session (if tracked), then
  // restore Session from the top stack snapshot. Fire-and-forget — local
  // state mutates synchronously regardless of server outcome. The current
  // session is always a leaf in the DB tree (its only descendant could be
  // the next push, which would be removed first), so no cascade is needed
  // here — Step 5's cascade only matters when ending an ancestor.
  const popSession = useCallback((): SessionSnapshot | null => {
    if (sessionStack.length === 0) return null;

    const snapshot = sessionStack[sessionStack.length - 1];
    if (!snapshot) return null;

    if (session.sessionId !== null) {
      void endServerSession(getIdentity(), {
        session_id: session.sessionId,
        reason: 'user_exit',
      }).catch((error) => {
        console.error('[session] popSession endSession failed:', error);
      });
    }

    setSessionStack((prev) => prev.slice(0, -1));
    setSession({
      username: snapshot.username,
      userType: snapshot.userType,
      machine: snapshot.machine,
      hostname: snapshot.hostname,
      currentPath: snapshot.currentPath,
      theme: snapshot.theme,
      sessionId: snapshot.sessionId,
    });
    return snapshot;
  }, [sessionStack, session.sessionId]);

  const canReturn = useCallback(() => sessionStack.length > 0, [sessionStack.length]);

  // Pushes a server session for the FTP login (kind='ftp'), backfilling
  // the resolved sessionId into local state. Local state is set
  // optimistically — the UI doesn't wait for the server. If the push
  // fails, we log and leave sessionId null; exitFtpMode will then skip
  // the endSession call (orphan tolerable, swept later).
  //
  // Why this matters for L1 patch validation: FTP `put` writes a patch
  // on `ftpSession.remoteMachine`. Without a session row on that
  // machine, /api/patches returns 403. The push here is what makes
  // those writes legal post-gate.
  const enterFtpMode = useCallback(
    (newFtpSession: FtpSession) => {
      // Optimistic local state.
      setFtpSession(newFtpSession);
      // Fire-and-forget server push. parent_session_id captures the
      // shell session the player is sitting in (null if untracked
      // localhost). source_ip is the machine they're FTP'ing FROM.
      void createServerSession(getIdentity(), {
        machine_id: newFtpSession.remoteMachine,
        credentials: {
          username: newFtpSession.remoteUsername,
          userType: newFtpSession.remoteUserType,
        },
        ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
        source_ip: session.machine,
        kind: 'ftp',
      })
        .then((sessionId) => {
          // Backfill the server-issued id into the FtpSession state.
          // Guard: state may have been cleared (exitFtpMode) before
          // the push resolved — in that case we silently drop.
          setFtpSession((prev) => (prev !== null ? { ...prev, sessionId } : prev));
        })
        .catch((error) => {
          console.error('[session] ftp createServerSession failed:', error);
        });
    },
    [session.sessionId, session.machine],
  );

  // Captures the current FtpSession, clears local state, and ends the
  // server session if one was successfully pushed. If the push hadn't
  // resolved yet (no sessionId), the row is orphaned — see
  // enterFtpMode comment.
  const exitFtpMode = useCallback((): FtpSession | null => {
    const current = ftpSession;
    setFtpSession(null);
    if (current?.sessionId) {
      void endServerSession(getIdentity(), {
        session_id: current.sessionId,
        reason: 'user_exit',
      }).catch((error) => {
        console.error('[session] ftp endServerSession failed:', error);
      });
    }
    return current;
  }, [ftpSession]);

  const updateFtpRemoteCwd = useCallback((cwd: string) => {
    setFtpSession((prev) => (prev ? { ...prev, remoteCwd: cwd } : null));
  }, []);

  const updateFtpOriginCwd = useCallback((cwd: string) => {
    setFtpSession((prev) => (prev ? { ...prev, originCwd: cwd } : null));
  }, []);

  const isInFtpMode = useCallback(() => ftpSession !== null, [ftpSession]);

  const enterNcMode = useCallback(
    (newNcSession: NcSession) => {
      // Optimistic local state.
      setNcSession(newNcSession);
      // Fire-and-forget server push. parent_session_id captures the
      // shell session the player is sitting in (null if untracked
      // localhost). source_ip is the machine they're nc'ing FROM.
      // Mirrors enterFtpMode — kept symmetrical so the four enter
      // helpers (ftp/nc/mysql/redis) can share extraction later.
      void createServerSession(getIdentity(), {
        machine_id: newNcSession.machineId,
        credentials: {
          username: newNcSession.username,
          userType: newNcSession.userType,
        },
        ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
        source_ip: session.machine,
        kind: 'nc',
      })
        .then((sessionId) => {
          // Backfill the server-issued id. Guard: state may have been
          // cleared (exitNcMode) before the push resolved — in that
          // case we silently drop.
          setNcSession((prev) => (prev !== null ? { ...prev, sessionId } : prev));
        })
        .catch((error) => {
          console.error('[session] nc createServerSession failed:', error);
        });
    },
    [session.sessionId, session.machine],
  );

  const exitNcMode = useCallback((): NcSession | null => {
    const current = ncSession;
    setNcSession(null);
    if (current?.sessionId) {
      void endServerSession(getIdentity(), {
        session_id: current.sessionId,
        reason: 'user_exit',
      }).catch((error) => {
        console.error('[session] nc endServerSession failed:', error);
      });
    }
    return current;
  }, [ncSession]);

  const isInNcMode = useCallback(() => ncSession !== null, [ncSession]);

  const updateNcCwd = useCallback((cwd: string) => {
    setNcSession((prev) => (prev ? { ...prev, currentPath: cwd } : null));
  }, []);

  // mysql credentials lack a userType field client-side (the game model
  // doesn't map mysql users to Unix users). For the L1 gate we just
  // need a session row to exist — the userType isn't checked. We default
  // to 'user'; the future L2 (permission walking) PR will need a real
  // mapping.
  const enterMysqlMode = useCallback(
    (newMysqlSession: MysqlSession) => {
      setMysqlSession(newMysqlSession);
      void createServerSession(getIdentity(), {
        machine_id: newMysqlSession.machineId,
        credentials: {
          username: newMysqlSession.username,
          userType: 'user',
        },
        ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
        source_ip: session.machine,
        kind: 'mysql',
      })
        .then((sessionId) => {
          setMysqlSession((prev) => (prev !== null ? { ...prev, sessionId } : prev));
        })
        .catch((error) => {
          console.error('[session] mysql createServerSession failed:', error);
        });
    },
    [session.sessionId, session.machine],
  );

  const exitMysqlMode = useCallback((): MysqlSession | null => {
    const current = mysqlSession;
    setMysqlSession(null);
    if (current?.sessionId) {
      void endServerSession(getIdentity(), {
        session_id: current.sessionId,
        reason: 'user_exit',
      }).catch((error) => {
        console.error('[session] mysql endServerSession failed:', error);
      });
    }
    return current;
  }, [mysqlSession]);

  const isInMysqlMode = useCallback(() => mysqlSession !== null, [mysqlSession]);

  // RedisSession has no username field — redis in this game is
  // password-only AUTH (newer ACL-with-username not modeled). For the
  // L1 gate we synthesize 'redis' as the username and default
  // userType: 'user'. Future L2 PR will need a real mapping if
  // permissions become enforced.
  const enterRedisMode = useCallback(
    (newRedisSession: RedisSession) => {
      setRedisSession(newRedisSession);
      void createServerSession(getIdentity(), {
        machine_id: newRedisSession.machineId,
        credentials: { username: 'redis', userType: 'user' },
        ...(session.sessionId !== null && { parent_session_id: session.sessionId }),
        source_ip: session.machine,
        kind: 'redis',
      })
        .then((sessionId) => {
          setRedisSession((prev) => (prev !== null ? { ...prev, sessionId } : prev));
        })
        .catch((error) => {
          console.error('[session] redis createServerSession failed:', error);
        });
    },
    [session.sessionId, session.machine],
  );

  const exitRedisMode = useCallback((): RedisSession | null => {
    const current = redisSession;
    setRedisSession(null);
    if (current?.sessionId) {
      void endServerSession(getIdentity(), {
        session_id: current.sessionId,
        reason: 'user_exit',
      }).catch((error) => {
        console.error('[session] redis endServerSession failed:', error);
      });
    }
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

  // Dynamic browser tab title so users can identify tabs at a glance.
  // Mirrors the prompt's suffix-stripped form so the tab title isn't
  // cluttered with the workstation_id suffix.
  useEffect(() => {
    const displayMachine = displayPromptHostname(session.hostname ?? session.machine);
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
  // Used by mission abort/complete to return to localhost regardless of SSH
  // nesting depth. Server-side: ends the OLDEST tracked session in the chain
  // (the root of the DB tree — descendants cascade-end via Step 5's logic).
  // Falls back to current.sessionId if no intermediate stack entry is tracked
  // (single-push case where stack only has the untracked bottom).
  const popAllSessions = useCallback(() => {
    if (sessionStack.length === 0) return;

    // Find the oldest tracked session above the bottom (which we keep). The
    // bottom is what we restore to — typically untracked localhost. The
    // chain root is the first tracked snapshot above it; if none, current
    // is the only tracked session.
    let rootToEnd: string | null = null;
    for (let i = 1; i < sessionStack.length; i++) {
      const id = sessionStack[i]?.sessionId;
      if (id) {
        rootToEnd = id;
        break;
      }
    }
    if (rootToEnd === null) rootToEnd = session.sessionId;

    if (rootToEnd !== null) {
      void endServerSession(getIdentity(), {
        session_id: rootToEnd,
        reason: 'pop_all',
      }).catch((error) => {
        console.error('[session] popAllSessions endSession failed:', error);
      });
    }

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
        hostname: bottom.hostname,
        currentPath: bottom.currentPath,
        theme: bottom.theme,
        sessionId: bottom.sessionId,
      });
    }
  }, [sessionStack, session.sessionId]);

  // Atomically resets to the player's own workstation with WiFi off.
  // Can be called while SSH'd into a remote machine — finds the
  // original workstation path from the bottom of the session stack
  // (the state before the first SSH), or uses the current path if
  // already on the player's workstation.
  const disconnectWifi = useCallback(() => {
    setConnectedWifiState(null);
    const defaultHome = `/home/${username}`;
    setSession((prev) => {
      const workstationPath =
        sessionStack.length > 0
          ? (sessionStack[0]?.currentPath ?? defaultHome)
          : prev.machine === hostname
            ? prev.currentPath
            : defaultHome;
      return {
        username,
        userType: 'user' as const,
        machine: hostname,
        hostname,
        currentPath: workstationPath,
        theme: prev.theme,
        sessionId: null,
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
  }, [sessionStack, username, hostname]);

  return (
    <SessionContext.Provider
      value={{
        session,
        isRehydrating,
        hostname,
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
