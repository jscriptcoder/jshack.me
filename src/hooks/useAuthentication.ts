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
import { parseVirtualUsersConf } from '../generation/ftpCredentials';
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
  getDefaultHomePath,
  pushAuthSession,
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
  // verified saved key?" Removed in PR 2 step 8 — saved-key validation
  // is now server-authoritative via authCreateSession's savedKey arm.
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

  // Server-authoritative SSH login (PR 2 step 7 of plans/cross-player-
  // base-fs-replication.md). Calls authCreateSession via pushAuthSession,
  // which only commits local state (snapshot stack + new Session) on
  // ok:true. On invalid_credentials, renders "Permission denied" and
  // leaves session unchanged. saveAuthorizedKey runs only on success
  // and only when computeKeyFingerprint can read /etc/passwd locally
  // (own-machine case); cross-player saves silently no-op until the
  // base-FS replication chunk lands.
  const loginSshWithAuth = useCallback(
    async (user: string, ip: string, port: number, auth: AuthMethod): Promise<void> => {
      const resolved = resolveNat(ip, port);
      const resolvedIp = resolved.ip;
      const homePath = getDefaultHomePath(resolvedIp, user);
      const targetMachine = findMachineByIp(resolvedIp) ?? getMachine(ip);

      try {
        const result = await pushAuthSession(
          'ssh',
          {
            machine: resolvedIp,
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

  // Inline FTP auth: validates username + password and enters FTP mode without interactive prompts.
  // Real vsftpd model: virtual_users.conf is an overlay — when it lists the
  // user, that hash wins. Otherwise, system credentials apply (PAM →
  // /etc/passwd here). No fallback to the static users[].passwordHash cache:
  // /etc/passwd is the source of truth so password_reset rotates work and
  // garbling /etc/passwd locks out logins (sabotage gameplay).
  const authenticateFtpInline = useCallback(
    (targetIP: string, username: string, password: string) => {
      const resolvedIp = resolveNat(targetIP, 21).ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === username);

      if (!remoteUser) {
        addLine('error', '530 Login incorrect.');
        onFtpAuth?.({ success: false, user: username, targetIP, port: 21 });
        return;
      }

      const inputHash = md5(password);

      const virtualUsersContent = readFileFromMachine({
        machineId: resolvedIp,
        path: '/etc/vsftpd/virtual_users.conf',
        cwd: '/',
        userType: 'root',
      });
      const virtualUserHash = virtualUsersContent
        ? parseVirtualUsersConf(virtualUsersContent).find((u) => u.username === username)
            ?.passwordHash
        : undefined;

      let ok: boolean;
      if (virtualUserHash !== undefined) {
        ok = virtualUserHash === inputHash;
      } else {
        const passwdContent = readFileFromMachine({
          machineId: resolvedIp,
          path: '/etc/passwd',
          cwd: '/',
          userType: 'root',
        });
        ok = getEtcPasswdHash(passwdContent, username) === inputHash;
      }

      if (!ok) {
        addLine('error', '530 Login incorrect.');
        onFtpAuth?.({ success: false, user: username, targetIP, port: 21 });
        return;
      }

      const userType: UserType = remoteUser.userType;
      const remoteHomePath = getDefaultHomePath(resolvedIp, username);

      const newFtpSession: FtpSession = {
        remoteMachine: resolvedIp,
        remoteUsername: username,
        remoteUserType: userType,
        remoteCwd: remoteHomePath,
        originMachine: session.machine,
        originUsername: session.username,
        originUserType: session.userType,
        originCwd: session.currentPath,
        // Backfilled by enterFtpMode after the server push resolves.
        sessionId: null,
      };

      enterFtpMode(newFtpSession);
      addLine('result', '230 Login successful.');
      onFtpAuth?.({ success: true, user: username, targetIP, port: 21 });
    },
    [
      resolveNat,
      findMachineUsers,
      readFileFromMachine,
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
  // PR 2 step 8 of plans/cross-player-base-fs-replication.md.
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

  // Shared MySQL connection setup: validates the database file exists and enters mysql mode
  const connectMysql = useCallback(
    (user: string, ip: string) => {
      const resolvedIp = resolveNat(ip, 3306).ip;
      const dbJson = readFileFromMachine({
        machineId: resolvedIp,
        path: '/var/lib/mysql/data.json',
        cwd: '/',
        userType: 'root',
      });
      if (!dbJson) {
        addLine('error', `ERROR 1049 (42000): Unknown database on '${ip}'`);
        return;
      }
      const db = parseMysqlDatabase(dbJson);
      if (!db) {
        addLine('error', `ERROR 1049 (42000): Unknown database on '${ip}'`);
        return;
      }
      const newMysqlSession: MysqlSession = {
        targetIP: ip,
        machineId: resolvedIp,
        username: user,
        databaseName: db.name,
        // Backfilled by enterMysqlMode after the server push resolves.
        sessionId: null,
      };
      enterMysqlMode(newMysqlSession);
      addLine(
        'result',
        `Welcome to the MySQL monitor. Server version: 8.0.36\n` +
          `Type 'help;' for help. Type exit or quit to leave.\n`,
      );
    },
    [resolveNat, readFileFromMachine, addLine, enterMysqlMode],
  );

  // Validates a MySQL user's password against the database's own credential list
  const validateMysqlPassword = useCallback(
    (user: string, ip: string, password: string): boolean => {
      const resolvedIp = resolveNat(ip, 3306).ip;
      const dbJson = readFileFromMachine({
        machineId: resolvedIp,
        path: '/var/lib/mysql/data.json',
        cwd: '/',
        userType: 'root',
      });
      if (!dbJson) return false;
      const db = parseMysqlDatabase(dbJson);
      if (!db?.credentials) return false;
      const mysqlUser = db.credentials.find((c) => c.username === user);
      if (!mysqlUser) return false;
      return mysqlUser.passwordHash === md5(password);
    },
    [resolveNat, readFileFromMachine],
  );

  // Inline MySQL auth: validates password against DB credentials and enters mysql mode
  const authenticateMysqlInline = useCallback(
    (user: string, targetIP: string, password: string) => {
      if (validateMysqlPassword(user, targetIP, password)) {
        connectMysql(user, targetIP);
        onMysqlAuth?.({ success: true, user, targetIP, port: 3306 });
      } else {
        addLine(
          'error',
          `ERROR 1045 (28000): Access denied for user '${user}'@'${targetIP}' (using password: YES)`,
        );
        onMysqlAuth?.({ success: false, user, targetIP, port: 3306 });
      }
    },
    [validateMysqlPassword, connectMysql, addLine, onMysqlAuth],
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

  // Redis connection: no password check at connect time — auth handled in prompt via AUTH command.
  // If inline password provided, it's passed to the session for auto-AUTH on first command.
  const connectRedis = useCallback(
    (targetIP: string, password?: string) => {
      const resolvedIp = resolveNat(targetIP, 6379).ip;
      const newRedisSession: RedisSession = {
        targetIP,
        machineId: resolvedIp,
        // Backfilled by enterRedisMode after the server push resolves.
        sessionId: null,
      };
      enterRedisMode(newRedisSession);
      // Socket established — write the connect line regardless of how AUTH
      // resolves below. Real Redis logs connect and auth as separate events.
      onRedisConnect?.(targetIP, 6379);

      // Read config to check if auth is required
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

      if (requirepass && !password) {
        addLine(
          'result',
          '(error) NOAUTH Authentication required.\nUse AUTH <password> to authenticate.',
        );
      } else if (requirepass && password) {
        if (password === requirepass) {
          addLine('result', 'OK');
          onRedisAuth?.(true, targetIP, 6379);
        } else {
          addLine('error', '(error) ERR invalid password');
          onRedisAuth?.(false, targetIP, 6379);
        }
      }
    },
    [resolveNat, readFileFromMachine, addLine, enterRedisMode, onRedisConnect, onRedisAuth],
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

      if (mysqlTargetIP) {
        return validateMysqlPassword(targetUser, mysqlTargetIP, password);
      }

      // SSH/SCP auth: /etc/passwd is the sole source of truth. No fallback
      // to the static users[].passwordHash cache — that cache is captured
      // at machine generation and drifts on any /etc/passwd mutation
      // (password_reset CVE, manual edits). Reading from /etc/passwd
      // makes both the post-reset credential AND deliberate sabotage work
      // end-to-end: garbling /etc/passwd locks out password logins, which
      // is the gameplay-meaningful outcome.
      const validateAgainstEtcPasswd = (resolvedIp: string): boolean => {
        const passwdContent = readFileFromMachine({
          machineId: resolvedIp,
          path: '/etc/passwd',
          cwd: '/',
          userType: 'root',
        });
        const storedHash = getEtcPasswdHash(passwdContent, targetUser);
        return storedHash !== undefined && storedHash === md5(password);
      };

      // SSH and SCP paths no longer go through validatePassword —
      // handlePasswordSubmit dispatches to loginSshWithAuth (PR 2 step 7)
      // and to scpPerformTransfer with auth method (PR 2 step 8). Both
      // route through authCreateSession (server-authoritative). Once
      // FTP / MySQL / Redis migrate in PRs 3-4, validatePassword shrinks
      // to the su-only path.

      if (ftpTargetIP) {
        const resolvedIp = resolveNat(ftpTargetIP, 21).ip;
        const users = findMachineUsers(resolvedIp);
        const remoteUser = users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        // Real vsftpd model: virtual_users.conf is an overlay — when it
        // lists the user, that hash wins. Otherwise authentication falls
        // through to system credentials via /etc/passwd. No cache fallback;
        // see validateAgainstEtcPasswd for the rationale.
        const virtualUsersContent = readFileFromMachine({
          machineId: resolvedIp,
          path: '/etc/vsftpd/virtual_users.conf',
          cwd: '/',
          userType: 'root',
        });
        const virtualUserHash = virtualUsersContent
          ? parseVirtualUsersConf(virtualUsersContent).find((u) => u.username === targetUser)
              ?.passwordHash
          : undefined;

        if (virtualUserHash !== undefined) {
          return virtualUserHash === md5(password);
        }
        return validateAgainstEtcPasswd(resolvedIp);
      }

      const passwdContent = readFile('/etc/passwd', 'root');
      if (!passwdContent) return false;

      const entry = passwdContent.split('\n').find((line) => line.split(':')[0] === targetUser);
      if (!entry) return false;

      const storedHash = entry.split(':')[1];
      if (!storedHash) return false;

      return storedHash === md5(password);
    },
    [
      targetUser,
      mysqlTargetIP,
      validateMysqlPassword,
      ftpTargetIP,
      readFile,
      readFileFromMachine,
      findMachineUsers,
      resolveNat,
    ],
  );

  const handleFtpUsernameSubmit = useCallback(
    (input: string, clearInput: () => void) => {
      if (!ftpTargetIP) return;

      const username = input.trim() || 'anonymous';
      addLine('command', username, `Name (${ftpTargetIP}:anonymous):`);

      const resolvedIp = resolveNat(ftpTargetIP, 21).ip;
      const users = findMachineUsers(resolvedIp);

      const remoteUser = users.find((u) => u.username === username);
      if (!remoteUser) {
        addLine('error', '530 Login incorrect.');
        onFtpAuth?.({ success: false, user: username, targetIP: ftpTargetIP, port: 21 });
        setFtpTargetIP(null);
        setFtpUsernameMode(false);
        clearInput();
        return;
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

      // SSH: server-authoritative auth (PR 2 of plans/cross-player-base-fs-
      // replication.md). Returned as AsyncOutput so the Terminal hides
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

      // SCP: server-authoritative auth via withTransientAuthSession (PR 2
      // step 8). The transfer animation runs first; auth happens at the
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

      // su: server-authoritative auth via pushAuthSession (PR 2 step 9).
      // No prompt-state-specific machine_id (mysql/scp/ssh/ftp targets
      // would have been handled above) — su targets the CURRENT machine,
      // promoting (or sidegrading) to a different user on the same box.
      // Returned as AsyncOutput so the Terminal hides the prompt during
      // the server round-trip; otherwise the prompt momentarily reverts
      // to the prior user before the new session commits.
      if (
        targetUser &&
        !mysqlTargetIP &&
        !scpTargetIP &&
        !ftpTargetIP &&
        !ftpUsernameMode
      ) {
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

        if (mysqlTargetIP) {
          connectMysql(targetUser, mysqlTargetIP);
          onMysqlAuth?.({
            success: true,
            user: targetUser,
            targetIP: mysqlTargetIP,
            port: 3306,
          });
        } else if (ftpTargetIP) {
          const resolvedFtpIp = resolveNat(ftpTargetIP, 21).ip;
          const users = findMachineUsers(resolvedFtpIp);
          const remoteUser = users.find((u) => u.username === targetUser);
          const userType: UserType = remoteUser?.userType ?? 'user';
          const remoteHomePath = getDefaultHomePath(resolvedFtpIp, targetUser);

          const newFtpSession: FtpSession = {
            remoteMachine: resolvedFtpIp,
            remoteUsername: targetUser,
            remoteUserType: userType,
            remoteCwd: remoteHomePath,
            originMachine: session.machine,
            originUsername: session.username,
            originUserType: session.userType,
            originCwd: session.currentPath,
            // Backfilled by enterFtpMode after the server push resolves.
            sessionId: null,
          };

          enterFtpMode(newFtpSession);
          addLine('result', '230 Login successful.');
          onFtpAuth?.({
            success: true,
            user: targetUser,
            targetIP: ftpTargetIP,
            port: 21,
          });
        }
        // su path is handled above (server-authoritative via pushAuthSession,
        // PR 2 step 9). It bypasses validatePassword entirely.
      } else {
        if (mysqlTargetIP) {
          addLine(
            'error',
            `ERROR 1045 (28000): Access denied for user '${targetUser}'@'${mysqlTargetIP}' (using password: YES)`,
          );
          if (targetUser) {
            onMysqlAuth?.({
              success: false,
              user: targetUser,
              targetIP: mysqlTargetIP,
              port: 3306,
            });
          }
        } else if (scpTargetIP) {
          addLine('error', `Permission denied, please try again.`);
          if (targetUser)
            onSshAuth?.({
              success: false,
              user: targetUser,
              targetIP: scpTargetIP,
              port: scpTargetPort ?? 22,
              method: 'password',
            });
        } else if (ftpTargetIP) {
          addLine('error', '530 Login incorrect.');
          if (targetUser) {
            onFtpAuth?.({
              success: false,
              user: targetUser,
              targetIP: ftpTargetIP,
              port: 21,
            });
          }
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
        // ok:false branch (PR 2 step 9). No fallback here.
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
      connectMysql,
      loginSshWithAuth,
      pushAuthSession,
      session,
      findMachineUsers,
      enterFtpMode,
      addLine,
      getDefaultHomePath,
      resolveNat,
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
