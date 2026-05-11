import { useState, useCallback } from 'react';
import type {
  AuthPushDestination,
  FtpSession,
  MysqlSession,
  RedisSession,
  SessionReason,
} from '../session/SessionContext';
import type { UserType } from '../session/types';
import type { RemoteMachine, RemoteUser } from '../network/types';
import { parseMysqlDatabase } from '../commands/mysql/types';
import { getEtcPasswdHash } from '../filesystem/etcPasswdHelpers';
import type { AsyncOutput } from '../components/Terminal/types';
import type { PermissionResult } from '../filesystem/types';
import type { SshAuthHandler } from '../logging/handlers/sshAuth';
import type { FtpAuthHandler } from '../logging/handlers/ftpAuth';
import type { MysqlAuthHandler } from '../logging/handlers/mysqlAuth';
import { md5 } from '../utils/md5';
import type { AuthCreateSessionResult } from '../sessionRegistry/client';
import type { AuthMethod } from '../sessionRegistry/types';

type AuthenticationOptions = {
  readonly addLine: (
    type: 'command' | 'result' | 'error' | 'banner',
    content: string,
    prompt?: string,
  ) => void;
  readonly session: {
    readonly username: string;
    readonly userType: UserType;
    readonly machine: string;
    readonly hostname?: string;
    readonly currentPath: string;
  };
  readonly getMachine: (
    ip: string,
  ) => { readonly hostname: string; readonly users: readonly RemoteUser[] } | undefined;
  readonly findMachineUsers: (ip: string) => readonly RemoteUser[];
  readonly findMachineByIp: (ip: string) => RemoteMachine | undefined;
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  // Maps a LAN IP to the canonical machine_id (workstation_id for
  // occupants, LAN IP otherwise). Cross-player auth flows must use this
  // before sending machine_id in an envelope — server stores B's
  // /etc/passwd under B's workstation_id, NOT B's LAN IP.
  readonly resolveTargetMachineId: (targetIp: string) => string;
  readonly getDefaultHomePath: (machineIp: string, username: string) => string;
  readonly setUsername: (username: string, userType: UserType) => void;
  readonly setMachine: (machine: string, hostname?: string) => void;
  readonly setCurrentPath: (path: string) => void;
  readonly pushSession: (
    reason: SessionReason,
    destination: {
      readonly machine: string;
      readonly hostname?: string;
      readonly username: string;
      readonly userType: UserType;
      readonly currentPath: string;
    },
  ) => Promise<void>;
  readonly pushAuthSession: (
    kind: 'ssh' | 'su',
    destination: AuthPushDestination,
    auth: AuthMethod,
  ) => Promise<AuthCreateSessionResult>;
  // FTP server-authoritative auth. Validates against /etc/vsftpd/
  // virtual_users.conf (overlay) + /etc/passwd (fallback) on the server,
  // returns the new sessionId + server-derived userType.
  readonly authCreateFtpSession: (
    destination: AuthPushDestination,
    auth: AuthMethod,
  ) => Promise<AuthCreateSessionResult>;
  // MySQL server-authoritative auth. Validates against
  // /var/lib/mysql/data.json. userType comes from the matching
  // credential entry's userType field (server-derived).
  readonly authCreateMysqlSession: (
    destination: AuthPushDestination,
    auth: AuthMethod,
  ) => Promise<AuthCreateSessionResult>;
  // Redis server-authoritative auth. Shared-secret; the helper
  // injects the sentinel `username:'redis'` so callers only supply
  // machine_id + the AUTH password.
  readonly authCreateRedisSession: (
    machineId: string,
    auth: AuthMethod,
  ) => Promise<AuthCreateSessionResult>;
  readonly enterFtpMode: (session: FtpSession) => void;
  readonly enterMysqlMode: (session: MysqlSession) => void;
  readonly enterRedisMode: (session: RedisSession) => void;
  readonly readFileFromMachine: (op: {
    readonly machineId: string;
    readonly path: string;
    readonly cwd: string;
    readonly userType: UserType;
  }) => string | null;
  readonly createFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly onSuAuth?: (success: boolean, targetUser: string) => void;
  readonly onSshAuth?: SshAuthHandler;
  readonly onFtpAuth?: FtpAuthHandler;
  readonly onMysqlAuth?: MysqlAuthHandler;
  readonly onRedisConnect?: (targetIP: string, port: number) => void;
  readonly onRedisAuth?: (success: boolean, targetIP: string, port: number) => void;
};

export const useAuthentication = ({
  addLine,
  session,
  getMachine,
  findMachineUsers,
  findMachineByIp,
  readFile,
  resolveNat,
  resolveTargetMachineId,
  getDefaultHomePath,
  pushAuthSession,
  authCreateFtpSession,
  authCreateMysqlSession,
  authCreateRedisSession,
  enterFtpMode,
  enterMysqlMode,
  enterRedisMode,
  readFileFromMachine,
  createFile,
  writeFile,
  onSuAuth,
  onSshAuth,
  onFtpAuth,
  onMysqlAuth,
  onRedisConnect,
  onRedisAuth,
}: AuthenticationOptions) => {
  const [passwordMode, setPasswordMode] = useState(false);
  const [targetUser, setTargetUser] = useState<string | null>(null);
  const [sshTargetIP, setSshTargetIP] = useState<string | null>(null);
  const [sshTargetPort, setSshTargetPort] = useState<number | null>(null);
  const [ftpTargetIP, setFtpTargetIP] = useState<string | null>(null);
  const [ftpUsernameMode, setFtpUsernameMode] = useState(false);
  const [scpTargetIP, setScpTargetIP] = useState<string | null>(null);
  const [scpTargetPort, setScpTargetPort] = useState<number | null>(null);
  const [scpPerformTransfer, setScpPerformTransfer] = useState<
    ((auth: AuthMethod) => AsyncOutput) | null
  >(null);
  const [mysqlTargetIP, setMysqlTargetIP] = useState<string | null>(null);

  const startPasswordPrompt = useCallback(
    (user: string) => {
      setTargetUser(user);
      setPasswordMode(true);
      addLine('result', 'Password:');
    },
    [addLine],
  );

  // Computes a fingerprint from the target's live /etc/passwd hash so that
  // entries in ~/.ssh_keys cannot be forged without read access to that file.
  // Returns null when the file is unreadable, the user is missing, or the
  // hash field is empty — keeping forgery resistance intact AND making
  // password_reset rotates invalidate previously-saved keys (the saved
  // fingerprint was computed against the pre-reset hash).
  const computeKeyFingerprint = useCallback(
    (targetUser: string, targetIP: string, port: number): string | null => {
      const resolvedIp = resolveNat(targetIP, port).ip;
      const passwdContent = readFileFromMachine({
        machineId: resolvedIp,
        path: '/etc/passwd',
        cwd: '/',
        userType: 'root',
      });
      const hash = getEtcPasswdHash(passwdContent, targetUser);
      if (hash === undefined) return null;
      return md5(`${targetUser}:${targetIP}:${hash}`);
    },
    [resolveNat, readFileFromMachine],
  );

  // hasAuthorizedKey was the local-validation gate for "do we have a
  // verified saved key?" Removed — saved-key validation is now
  // server-authoritative via authCreateSession's savedKey arm.
  // The client just reads the saved fingerprint via getSavedSshFingerprint
  // and sends it; the server validates against current /etc/passwd.

  // Persists a fingerprint-signed SSH key for the given target on the current
  // machine's filesystem. The fingerprint includes the password hash, so only
  // a successful authentication can produce a valid entry.
  const saveAuthorizedKey = useCallback(
    (targetUser: string, targetIP: string, port: number): void => {
      const fingerprint = computeKeyFingerprint(targetUser, targetIP, port);
      if (!fingerprint) return;

      const homePath = getDefaultHomePath(session.machine, session.username);
      const keysPath = `${homePath}/.ssh_keys`;
      const entry = `${targetUser}@${targetIP}:${fingerprint}`;
      const existing = readFile(keysPath, session.userType);

      if (existing !== null) {
        if (existing.split('\n').some((line) => line.trim() === entry)) return;
        const updated = existing ? `${existing}\n${entry}` : entry;
        writeFile(keysPath, updated, session.userType);
      } else {
        createFile(keysPath, entry, session.userType);
      }
    },
    [
      computeKeyFingerprint,
      getDefaultHomePath,
      readFile,
      writeFile,
      createFile,
      session.machine,
      session.username,
      session.userType,
    ],
  );

  // Reads the saved SSH key fingerprint for (user, targetIP) from the
  // current shell's ~/.ssh_keys, or null if no entry exists / the file
  // is unreadable. Used for the savedKey arm of authCreateSession —
  // the client passes the fingerprint as opaque proof; the server
  // validates against the live /etc/passwd hash.
  const getSavedSshFingerprint = useCallback(
    (user: string, targetIP: string): string | null => {
      const homePath = getDefaultHomePath(session.machine, session.username);
      const keysPath = `${homePath}/.ssh_keys`;
      const content = readFile(keysPath, session.userType);
      if (!content) return null;
      const prefix = `${user}@${targetIP}:`;
      const entry = content.split('\n').find((line) => line.trim().startsWith(prefix));
      if (!entry) return null;
      return entry.trim().slice(prefix.length);
    },
    [getDefaultHomePath, readFile, session.machine, session.username, session.userType],
  );

  // Server-authoritative SSH login. Calls authCreateSession via
  // pushAuthSession, which only commits local state (snapshot stack +
  // new Session) on
  // ok:true. On invalid_credentials, renders "Permission denied" and
  // leaves session unchanged. saveAuthorizedKey runs only on success
  // and only when computeKeyFingerprint can read /etc/passwd locally
  // (own-machine case); cross-player saves silently no-op until the
  // base-FS replication chunk lands.
  const loginSshWithAuth = useCallback(
    async (user: string, ip: string, port: number, auth: AuthMethod): Promise<void> => {
      const resolved = resolveNat(ip, port);
      const resolvedIp = resolved.ip;
      // Translate LAN IP → canonical machine_id. For cross-player
      // workstations, the server stores /etc/passwd under the
      // workstation_id (e.g., 'rocket-aabbccdd'), NOT the LAN IP.
      // For NPC home/world machines, this passes the LAN IP through
      // unchanged. See homeNetworkHelpers.targetMachineIdFor.
      const targetMachineId = resolveTargetMachineId(resolvedIp);
      const homePath = getDefaultHomePath(resolvedIp, user);
      const targetMachine = findMachineByIp(resolvedIp) ?? getMachine(ip);

      try {
        const result = await pushAuthSession(
          'ssh',
          {
            machine: targetMachineId,
            hostname: targetMachine?.hostname,
            username: user,
            currentPath: homePath,
          },
          auth,
        );

        if (result.ok) {
          saveAuthorizedKey(user, ip, port);
          addLine('result', `Connected to ${ip}`);
          addLine('result', `Welcome to ${targetMachine?.hostname ?? ip}!`);
          onSshAuth?.({
            success: true,
            user,
            targetIP: ip,
            port,
            method: auth.method === 'password' ? 'password' : 'publickey',
          });
        } else {
          addLine('error', `${user}@${ip}: Permission denied (publickey,password).`);
          onSshAuth?.({
            success: false,
            user,
            targetIP: ip,
            port,
            method: auth.method === 'password' ? 'password' : 'publickey',
          });
        }
      } catch (error) {
        console.error('[useAuthentication] loginSshWithAuth threw:', error);
        addLine('error', `${user}@${ip}: Permission denied (publickey,password).`);
      }
    },
    [
      pushAuthSession,
      resolveNat,
      resolveTargetMachineId,
      findMachineByIp,
      getDefaultHomePath,
      getMachine,
      addLine,
      onSshAuth,
      saveAuthorizedKey,
    ],
  );

  // Inline SSH auth: tries the saved-key arm first (if a fingerprint
  // exists locally), falls through to password-arm authCreateSession.
  // Both paths route through pushAuthSession — server validates against
  // the live /etc/passwd and only commits a session on success.
  // Returns Promise<void> so tests can await the full auth round-trip;
  // the live caller (Terminal.tsx) doesn't await — fire-and-forget UX.
  const authenticateSshInline = useCallback(
    async ({
      user,
      targetIP,
      port,
      password,
    }: {
      readonly user: string;
      readonly targetIP: string;
      readonly port: number;
      readonly password: string;
    }): Promise<void> => {
      const fingerprint = getSavedSshFingerprint(user, targetIP);
      const auth: AuthMethod =
        fingerprint !== null
          ? { method: 'savedKey', fingerprint, targetIp: targetIP }
          : { method: 'password', password };
      await loginSshWithAuth(user, targetIP, port, auth);
    },
    [getSavedSshFingerprint, loginSshWithAuth],
  );

  const startSshPrompt = useCallback(
    (user: string, targetIP: string, targetPort: number): void => {
      const fingerprint = getSavedSshFingerprint(user, targetIP);
      if (fingerprint !== null) {
        // Server validates the saved fingerprint against the current
        // /etc/passwd hash. password_reset / sabotage will return 401
        // and we render "Permission denied" — same as a wrong password.
        void loginSshWithAuth(user, targetIP, targetPort, {
          method: 'savedKey',
          fingerprint,
          targetIp: targetIP,
        });
        return;
      }

      setTargetUser(user);
      setSshTargetIP(targetIP);
      setSshTargetPort(targetPort);
      setPasswordMode(true);
      addLine('result', `${user}@${targetIP}'s password:`);
    },
    [getSavedSshFingerprint, loginSshWithAuth, addLine],
  );

  // Inline FTP auth: validates username + password and enters FTP mode
  // without interactive prompts (used by `ftp <host> <user> <pw>` from
  // scripts).
  //
  // Validation moved to the server. authCreateFtpSession reads
  // /etc/vsftpd/virtual_users.conf (overlay) + /etc/passwd (fallback)
  // from machine_filesystems and returns userType derived from
  // /etc/passwd. Pre-check `users.length === 0` skip mirrors the SSH
  // path: cross-player placeholders have empty users[], so we don't
  // pre-reject — the server is the authority.
  const authenticateFtpInline = useCallback(
    async (targetIP: string, username: string, password: string): Promise<void> => {
      const resolvedIp = resolveNat(targetIP, 21).ip;
      const machineId = resolveTargetMachineId(resolvedIp);
      const remoteHomePath = getDefaultHomePath(resolvedIp, username);

      const result = await authCreateFtpSession(
        {
          machine: machineId,
          username,
          currentPath: remoteHomePath,
        },
        { method: 'password', password },
      );

      if (!result.ok) {
        addLine('error', '530 Login incorrect.');
        onFtpAuth?.({ success: false, user: username, targetIP, port: 21 });
        return;
      }

      const newFtpSession: FtpSession = {
        // Canonical machine_id — workstation_id for cross-player FTP
        // targets, IP otherwise. Mirrors what authCreateFtpSession sent.
        // Downstream FS reads via getNodeFromMachine handle either
        // shape via occupantAwareReadNode. Using the canonical id
        // here is what lets the getBaseFs trigger fire when an FTP
        // session lands on a cross-player workstation.
        remoteMachine: machineId,
        remoteUsername: username,
        remoteUserType: result.userType,
        remoteCwd: remoteHomePath,
        originMachine: session.machine,
        originUsername: session.username,
        originUserType: session.userType,
        originCwd: session.currentPath,
        // Server-stamped — set immediately, no backfill.
        sessionId: result.session_id,
      };

      enterFtpMode(newFtpSession);
      addLine('result', '230 Login successful.');
      onFtpAuth?.({ success: true, user: username, targetIP, port: 21 });
    },
    [
      resolveNat,
      resolveTargetMachineId,
      authCreateFtpSession,
      addLine,
      getDefaultHomePath,
      session,
      enterFtpMode,
      onFtpAuth,
    ],
  );

  const startFtpPrompt = useCallback(
    (targetIP: string) => {
      setFtpTargetIP(targetIP);
      setFtpUsernameMode(true);
      addLine('result', `Name (${targetIP}:anonymous):`);
    },
    [addLine],
  );

  // Inline SCP auth: dispatches to performTransfer with an auth method
  // (saved-key fingerprint if present locally, else password). Server
  // validates inside withTransientAuthSession; the in-game UX surfaces
  // the result via the transfer animation's lines.
  const authenticateScpInline = useCallback(
    ({
      user,
      targetIP,
      port,
      password,
      performTransfer,
    }: {
      readonly user: string;
      readonly targetIP: string;
      readonly port: number;
      readonly password: string;
      readonly performTransfer: (auth: AuthMethod) => AsyncOutput;
    }): AsyncOutput | undefined => {
      const fingerprint = getSavedSshFingerprint(user, targetIP);
      const auth: AuthMethod =
        fingerprint !== null
          ? { method: 'savedKey', fingerprint, targetIp: targetIP }
          : { method: 'password', password };
      onSshAuth?.({
        success: true,
        user,
        targetIP,
        port,
        method: auth.method === 'password' ? 'password' : 'publickey',
      });
      return performTransfer(auth);
    },
    [getSavedSshFingerprint, onSshAuth],
  );

  const startScpPrompt = useCallback(
    ({
      user,
      targetIP,
      port,
      performTransfer,
    }: {
      readonly user: string;
      readonly targetIP: string;
      readonly port: number;
      readonly performTransfer: (auth: AuthMethod) => AsyncOutput;
    }): AsyncOutput | undefined => {
      const fingerprint = getSavedSshFingerprint(user, targetIP);
      if (fingerprint !== null) {
        onSshAuth?.({ success: true, user, targetIP, port, method: 'publickey' });
        return performTransfer({ method: 'savedKey', fingerprint, targetIp: targetIP });
      }

      setTargetUser(user);
      setScpTargetIP(targetIP);
      setScpTargetPort(port);
      // Wrap in thunk to avoid React treating the function as a state updater
      setScpPerformTransfer(() => performTransfer);
      setPasswordMode(true);
      addLine('result', `${user}@${targetIP}'s password:`);
      return undefined;
    },
    [getSavedSshFingerprint, addLine, onSshAuth],
  );

  // Server-authoritative MySQL auth. Validates against
  // /var/lib/mysql/data.json on the server (atomic with session
  // creation). userType comes from the matching credential entry —
  // server-derived, never trusted from client. Database name is read
  // from the local cache for the welcome banner; cross-player flows
  // may show an empty name until base FS replication populates it.
  const connectMysqlServer = useCallback(
    async (user: string, ip: string, password: string): Promise<boolean> => {
      const resolvedIp = resolveNat(ip, 3306).ip;
      const machineId = resolveTargetMachineId(resolvedIp);

      const result = await authCreateMysqlSession(
        { machine: machineId, username: user, currentPath: '/' },
        { method: 'password', password },
      );
      if (!result.ok) {
        return false;
      }

      // Local DB lookup for the welcome banner only — does not affect
      // auth. Falls back gracefully when the file isn't replicated
      // (cross-player flows).
      const dbJson = readFileFromMachine({
        machineId: resolvedIp,
        path: '/var/lib/mysql/data.json',
        cwd: '/',
        userType: 'root',
      });
      const db = dbJson ? parseMysqlDatabase(dbJson) : null;
      const databaseName = db?.name ?? '(unknown)';

      enterMysqlMode({
        targetIP: ip,
        // Canonical machine_id (workstation_id for cross-player MySQL
        // targets, IP otherwise). Required by the getBaseFs trigger;
        // downstream FS reads tolerate either via occupantAwareReadNode.
        machineId,
        username: user,
        databaseName,
        sessionId: result.session_id,
      });
      addLine(
        'result',
        `Welcome to the MySQL monitor. Server version: 8.0.36\n` +
          `Type 'help;' for help. Type exit or quit to leave.\n`,
      );
      return true;
    },
    [
      resolveNat,
      resolveTargetMachineId,
      authCreateMysqlSession,
      readFileFromMachine,
      addLine,
      enterMysqlMode,
    ],
  );

  // Inline MySQL auth (used by `mysql -u user -p<password>` from scripts).
  const authenticateMysqlInline = useCallback(
    async (user: string, targetIP: string, password: string): Promise<void> => {
      const ok = await connectMysqlServer(user, targetIP, password);
      if (ok) {
        onMysqlAuth?.({ success: true, user, targetIP, port: 3306 });
      } else {
        addLine(
          'error',
          `ERROR 1045 (28000): Access denied for user '${user}'@'${targetIP}' (using password: YES)`,
        );
        onMysqlAuth?.({ success: false, user, targetIP, port: 3306 });
      }
    },
    [connectMysqlServer, addLine, onMysqlAuth],
  );

  const startMysqlPrompt = useCallback(
    (user: string, targetIP: string) => {
      setTargetUser(user);
      setMysqlTargetIP(targetIP);
      setPasswordMode(true);
      addLine('result', `Enter password:`);
    },
    [addLine],
  );

  // Server-authoritative Redis auth. Two flows:
  //
  // 1. With inline password (`rediscli -h host -a password`): call
  //    authCreateRedisSession; on 201 enter redis mode at sessionId+
  //    userType='root'; on 401 show "ERR invalid password".
  //
  // 2. Without password: read the local conf to detect requirepass.
  //    If absent → no-auth Redis (sessionless mode locally — accept
  //    server's reluctance, but local model still allows a no-auth
  //    session with sentinel 'redis'/'guest' for L1 tracking — see
  //    note below). If present → emit NOAUTH banner; the user runs
  //    AUTH <pw> via the redis prompt and we route THAT through
  //    authCreateRedisSession on the AUTH command path.
  //
  // For now, the no-password / no-requirepass path is treated as
  // out-of-scope — Redis without auth doesn't go through this
  // endpoint. The user's flow always uses `-a` (authoritative path)
  // or types AUTH inside the redis prompt (handled separately).
  const connectRedis = useCallback(
    async (targetIP: string, password?: string): Promise<void> => {
      const resolvedIp = resolveNat(targetIP, 6379).ip;
      const machineId = resolveTargetMachineId(resolvedIp);
      onRedisConnect?.(targetIP, 6379);

      const confContent = readFileFromMachine({
        machineId: resolvedIp,
        path: '/etc/redis/redis.conf',
        cwd: '/',
        userType: 'root',
      });
      const requirepass =
        confContent
          ?.split('\n')
          .find((l) => l.startsWith('requirepass '))
          ?.slice('requirepass '.length)
          .trim() ?? null;

      // No requirepass detected locally — mirror real Redis: anyone
      // with network access is in at full privilege. Mint a session
      // anyway so SET/DEL writes pass L1's session gate. Server-side
      // (handleRedisAuth) accepts when the projected redis.conf has
      // no requirepass and ignores the supplied password — we send a
      // sentinel string just to satisfy the schema's min(1) constraint.
      if (!requirepass && !password) {
        const result = await authCreateRedisSession(machineId, {
          method: 'password',
          password: 'no-auth-required',
        });
        enterRedisMode({
          targetIP,
          machineId,
          sessionId: result.ok ? result.session_id : null,
        });
        return;
      }

      if (requirepass && !password) {
        // Open the local prompt with the standard NOAUTH message; the
        // user runs AUTH <pw> inside the prompt. AUTH inside the redis
        // prompt path will route through authCreateRedisSession when
        // wired in a follow-up; for now keep the local message and
        // sessionless connection.
        enterRedisMode({ targetIP, machineId, sessionId: null });
        addLine(
          'result',
          '(error) NOAUTH Authentication required.\nUse AUTH <password> to authenticate.',
        );
        return;
      }

      // Password provided — authenticate server-side.
      const result = await authCreateRedisSession(machineId, {
        method: 'password',
        password: password as string,
      });
      if (!result.ok) {
        addLine('error', '(error) ERR invalid password');
        onRedisAuth?.(false, targetIP, 6379);
        return;
      }

      enterRedisMode({
        targetIP,
        // Canonical machine_id (workstation_id for cross-player Redis
        // targets, IP otherwise). Same rationale as FTP / MySQL.
        machineId,
        sessionId: result.session_id,
      });
      addLine('result', 'OK');
      onRedisAuth?.(true, targetIP, 6379);
    },
    [
      resolveNat,
      resolveTargetMachineId,
      readFileFromMachine,
      authCreateRedisSession,
      addLine,
      enterRedisMode,
      onRedisConnect,
      onRedisAuth,
    ],
  );

  const resetAuthState = useCallback(() => {
    setPasswordMode(false);
    setTargetUser(null);
    setSshTargetIP(null);
    setSshTargetPort(null);
    setFtpTargetIP(null);
    setFtpUsernameMode(false);
    setScpTargetIP(null);
    setScpTargetPort(null);
    setScpPerformTransfer(null);
    setMysqlTargetIP(null);
  }, []);

  // Four-mode password validation: SCP/SSH (remote machine lookup), FTP (remote machine lookup),
  // or su (local /etc/passwd hash comparison). The mode is determined by which target IP
  // state is set when the password prompt was triggered.
  // For SCP/SSH/FTP, NAT is resolved first so credentials are checked against the actual
  // target machine, not the router's merged view (prevents router-only users from
  // authenticating on forwarded services).
  const validatePassword = useCallback(
    (password: string): boolean => {
      if (!targetUser) return false;

      // SSH/SCP/FTP/MySQL paths no longer go through validatePassword
      // — handlePasswordSubmit dispatches to authCreateSession-backed
      // helpers. validatePassword now serves only the su fallback path
      // (local-/etc/passwd hash compare).

      const passwdContent = readFile('/etc/passwd', 'root');
      if (!passwdContent) return false;

      const entry = passwdContent.split('\n').find((line) => line.split(':')[0] === targetUser);
      if (!entry) return false;

      const storedHash = entry.split(':')[1];
      if (!storedHash) return false;

      return storedHash === md5(password);
    },
    [targetUser, readFile],
  );

  const handleFtpUsernameSubmit = useCallback(
    (input: string, clearInput: () => void) => {
      if (!ftpTargetIP) return;

      const username = input.trim() || 'anonymous';
      addLine('command', username, `Name (${ftpTargetIP}:anonymous):`);

      const resolvedIp = resolveNat(ftpTargetIP, 21).ip;
      const users = findMachineUsers(resolvedIp);

      // Cross-player placeholder: occupant workstations land in
      // NetworkContext with users:[] (we never populated B's user list
      // on A's view). Skip the local pre-check in that case and let
      // the server be the authority on user existence — same pattern
      // as the SSH inline path. Without this skip, ANY username typed
      // against a cross-player FTP target bails here with "530 Login
      // incorrect" before the password is even prompted.
      if (users.length > 0) {
        const remoteUser = users.find((u) => u.username === username);
        if (!remoteUser) {
          addLine('error', '530 Login incorrect.');
          onFtpAuth?.({ success: false, user: username, targetIP: ftpTargetIP, port: 21 });
          setFtpTargetIP(null);
          setFtpUsernameMode(false);
          clearInput();
          return;
        }
      }

      addLine('result', '331 Please specify the password.');
      setTargetUser(username);
      setFtpUsernameMode(false);
      setPasswordMode(true);
      clearInput();
    },
    [ftpTargetIP, findMachineUsers, addLine, resolveNat, onFtpAuth],
  );

  // Returns an optional AsyncOutput for SCP transfer animation
  const handlePasswordSubmit = useCallback(
    (input: string, clearInput: () => void): AsyncOutput | undefined => {
      const maskedPassword = '*'.repeat(input.length);
      const promptLabel = mysqlTargetIP
        ? 'Enter password:'
        : scpTargetIP
          ? `${targetUser}@${scpTargetIP}'s password:`
          : ftpTargetIP
            ? 'Password:'
            : sshTargetIP
              ? `${targetUser}@${sshTargetIP}'s password:`
              : 'Password:';
      addLine('command', maskedPassword, promptLabel);

      let scpTransferAsync: AsyncOutput | undefined;

      // SSH: server-authoritative auth. Returned as AsyncOutput so the
      // Terminal hides
      // the prompt during the server round-trip — otherwise the prompt
      // reverts to the prior user/state for the ~100-300 ms gap and the
      // user sees nothing happen between password submit and the
      // "Connected" / "Permission denied" line.
      if (sshTargetIP && targetUser) {
        const user = targetUser;
        const ip = sshTargetIP;
        const port = sshTargetPort ?? 22;
        // Clear prompt state synchronously.
        setSshTargetIP(null);
        setSshTargetPort(null);
        setTargetUser(null);
        setPasswordMode(false);
        clearInput();
        return {
          __type: 'async',
          start: (onLine, onComplete) => {
            onLine(`Authenticating as ${user}...`);
            void loginSshWithAuth(user, ip, port, {
              method: 'password',
              password: input,
            }).finally(() => onComplete());
          },
        };
      }

      // SCP: server-authoritative auth via withTransientAuthSession.
      // The transfer animation runs first; auth happens at the
      // patch-fire point. saveAuthorizedKey runs only on success
      // (handled by performTransfer's then-branch when ok).
      if (scpTargetIP && scpPerformTransfer && targetUser) {
        const transfer = scpPerformTransfer;
        scpTransferAsync = transfer({ method: 'password', password: input });
        // Clear prompt state synchronously
        setTargetUser(null);
        setScpTargetIP(null);
        setScpTargetPort(null);
        setScpPerformTransfer(null);
        setPasswordMode(false);
        clearInput();
        return scpTransferAsync;
      }

      // FTP: server-authoritative auth via authCreateFtpSession. Returned
      // as AsyncOutput so the Terminal hides the prompt during the server
      // round-trip — same reasoning as the SSH path above.
      if (ftpTargetIP && targetUser) {
        const user = targetUser;
        const targetIp = ftpTargetIP;
        const resolvedIp = resolveNat(targetIp, 21).ip;
        const machineId = resolveTargetMachineId(resolvedIp);
        const remoteHomePath = getDefaultHomePath(resolvedIp, user);
        // Clear prompt state synchronously.
        setFtpTargetIP(null);
        setTargetUser(null);
        setPasswordMode(false);
        clearInput();
        return {
          __type: 'async',
          start: (onLine, onComplete) => {
            onLine(`Authenticating as ${user}...`);
            void authCreateFtpSession(
              {
                machine: machineId,
                username: user,
                currentPath: remoteHomePath,
              },
              { method: 'password', password: input },
            )
              .then((result) => {
                if (result.ok) {
                  enterFtpMode({
                    // Canonical machine_id, not the LAN IP — see the
                    // inline-auth path's comment for rationale.
                    remoteMachine: machineId,
                    remoteUsername: user,
                    remoteUserType: result.userType,
                    remoteCwd: remoteHomePath,
                    originMachine: session.machine,
                    originUsername: session.username,
                    originUserType: session.userType,
                    originCwd: session.currentPath,
                    sessionId: result.session_id,
                  });
                  addLine('result', '230 Login successful.');
                  onFtpAuth?.({ success: true, user, targetIP: targetIp, port: 21 });
                } else {
                  addLine('error', '530 Login incorrect.');
                  onFtpAuth?.({ success: false, user, targetIP: targetIp, port: 21 });
                }
              })
              .catch((error) => {
                console.error('[useAuthentication] ftp authCreateFtpSession threw:', error);
                addLine('error', '530 Login incorrect.');
                onFtpAuth?.({ success: false, user, targetIP: targetIp, port: 21 });
              })
              .finally(() => onComplete());
          },
        };
      }

      // MySQL: server-authoritative auth. connectMysqlServer calls
      // authCreateMysqlSession; on success it enters mysql mode
      // with sessionId set. Returned as AsyncOutput so the Terminal
      // hides the prompt during the server round-trip.
      if (mysqlTargetIP && targetUser) {
        const user = targetUser;
        const targetIp = mysqlTargetIP;
        // Clear prompt state synchronously.
        setMysqlTargetIP(null);
        setTargetUser(null);
        setPasswordMode(false);
        clearInput();
        return {
          __type: 'async',
          start: (onLine, onComplete) => {
            onLine(`Authenticating as ${user}...`);
            void connectMysqlServer(user, targetIp, input)
              .then((ok) => {
                if (ok) {
                  onMysqlAuth?.({ success: true, user, targetIP: targetIp, port: 3306 });
                } else {
                  addLine(
                    'error',
                    `ERROR 1045 (28000): Access denied for user '${user}'@'${targetIp}' (using password: YES)`,
                  );
                  onMysqlAuth?.({ success: false, user, targetIP: targetIp, port: 3306 });
                }
              })
              .catch((error) => {
                console.error('[useAuthentication] mysql connectMysqlServer threw:', error);
                addLine(
                  'error',
                  `ERROR 1045 (28000): Access denied for user '${user}'@'${targetIp}' (using password: YES)`,
                );
                onMysqlAuth?.({ success: false, user, targetIP: targetIp, port: 3306 });
              })
              .finally(() => onComplete());
          },
        };
      }

      // su: server-authoritative auth via pushAuthSession.
      // No prompt-state-specific machine_id (mysql/scp/ssh/ftp targets
      // would have been handled above) — su targets the CURRENT machine,
      // promoting (or sidegrading) to a different user on the same box.
      // Returned as AsyncOutput so the Terminal hides the prompt during
      // the server round-trip; otherwise the prompt momentarily reverts
      // to the prior user before the new session commits.
      if (targetUser && !mysqlTargetIP && !scpTargetIP && !ftpTargetIP && !ftpUsernameMode) {
        const user = targetUser;
        const homePath = getDefaultHomePath(session.machine, user);
        // Clear prompt state synchronously.
        setTargetUser(null);
        setPasswordMode(false);
        clearInput();
        return {
          __type: 'async',
          start: (onLine, onComplete) => {
            onLine(`Authenticating as ${user}...`);
            void pushAuthSession(
              'su',
              {
                machine: session.machine,
                hostname: session.hostname,
                username: user,
                currentPath: homePath,
              },
              { method: 'password', password: input },
            )
              .then((result) => {
                if (result.ok) {
                  addLine('result', `Switched to user: ${user}`);
                  onSuAuth?.(true, user);
                } else {
                  addLine('error', 'su: Authentication failure');
                  onSuAuth?.(false, user);
                }
              })
              .catch((error) => {
                console.error('[useAuthentication] su pushAuthSession threw:', error);
                addLine('error', 'su: Authentication failure');
                onSuAuth?.(false, user);
              })
              .finally(() => onComplete());
          },
        };
      }

      if (validatePassword(input)) {
        if (!targetUser) return undefined;
        // mysql / ftp / ssh / scp / su paths are handled above
        // (server-authoritative via authCreateSession-backed helpers).
        // validatePassword now only flags the su success path (handled
        // by the legacy fallback below — soon to be removed when
        // su's older path is fully retired).
      } else {
        if (scpTargetIP) {
          addLine('error', `Permission denied, please try again.`);
          if (targetUser)
            onSshAuth?.({
              success: false,
              user: targetUser,
              targetIP: scpTargetIP,
              port: scpTargetPort ?? 22,
              method: 'password',
            });
        } else if (sshTargetIP) {
          addLine('error', `Permission denied, please try again.`);
          if (targetUser)
            onSshAuth?.({
              success: false,
              user: targetUser,
              targetIP: sshTargetIP,
              port: sshTargetPort ?? 22,
              method: 'password',
            });
        }
        // su failure path is handled above by pushAuthSession's
        // ok:false branch. No fallback here.
      }

      setPasswordMode(false);
      setTargetUser(null);
      setSshTargetIP(null);
      setSshTargetPort(null);
      setFtpTargetIP(null);
      setScpTargetIP(null);
      setScpTargetPort(null);
      setScpPerformTransfer(null);
      setMysqlTargetIP(null);
      clearInput();

      return scpTransferAsync;
    },
    [
      targetUser,
      mysqlTargetIP,
      scpTargetIP,
      scpTargetPort,
      scpPerformTransfer,
      sshTargetIP,
      sshTargetPort,
      ftpTargetIP,
      ftpUsernameMode,
      validatePassword,
      connectMysqlServer,
      loginSshWithAuth,
      pushAuthSession,
      authCreateFtpSession,
      resolveNat,
      resolveTargetMachineId,
      session,
      enterFtpMode,
      addLine,
      getDefaultHomePath,
      onSuAuth,
      onSshAuth,
      onFtpAuth,
      onMysqlAuth,
    ],
  );

  return {
    passwordMode,
    ftpUsernameMode,
    handlePasswordSubmit,
    handleFtpUsernameSubmit,
    startPasswordPrompt,
    startSshPrompt,
    authenticateSshInline,
    startFtpPrompt,
    startScpPrompt,
    authenticateScpInline,
    authenticateFtpInline,
    startMysqlPrompt,
    authenticateMysqlInline,
    connectRedis,
    resetAuthState,
  };
};
