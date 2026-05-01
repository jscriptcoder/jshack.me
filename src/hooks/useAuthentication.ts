import { useState, useCallback } from 'react';
import type {
  UserType,
  FtpSession,
  MysqlSession,
  RedisSession,
  SessionReason,
} from '../session/SessionContext';
import type { RemoteMachine, RemoteUser } from '../network/types';
import { parseMysqlDatabase } from '../commands/mysql/types';
import { parseVirtualUsersConf } from '../generation/ftpCredentials';
import type { AsyncOutput } from '../components/Terminal/types';
import type { PermissionResult } from '../filesystem/types';
import type { SshAuthHandler } from '../logging/handlers/sshAuth';
import type { FtpAuthHandler } from '../logging/handlers/ftpAuth';
import type { MysqlAuthHandler } from '../logging/handlers/mysqlAuth';
import { md5 } from '../utils/md5';

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
  setUsername,
  setMachine,
  setCurrentPath,
  pushSession,
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
  const [scpPerformTransfer, setScpPerformTransfer] = useState<(() => AsyncOutput) | null>(null);
  const [mysqlTargetIP, setMysqlTargetIP] = useState<string | null>(null);

  const startPasswordPrompt = useCallback(
    (user: string) => {
      setTargetUser(user);
      setPasswordMode(true);
      addLine('result', 'Password:');
    },
    [addLine],
  );

  // Computes a fingerprint from the target's password hash so that entries in
  // ~/.ssh_keys cannot be forged without knowing the credential. Returns null
  // when the target user cannot be resolved (machine or user not found).
  const computeKeyFingerprint = useCallback(
    (targetUser: string, targetIP: string, port: number): string | null => {
      const resolvedIp = resolveNat(targetIP, port).ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === targetUser);
      if (!remoteUser) return null;
      return md5(`${targetUser}:${targetIP}:${remoteUser.passwordHash}`);
    },
    [resolveNat, findMachineUsers],
  );

  // Checks whether the current user has a verified SSH key for the given target.
  // The stored fingerprint is recomputed from the remote user's password hash,
  // so manually created entries without the correct fingerprint are rejected.
  const hasAuthorizedKey = useCallback(
    (targetUser: string, targetIP: string, port: number): boolean => {
      const homePath = getDefaultHomePath(session.machine, session.username);
      const keysPath = `${homePath}/.ssh_keys`;
      const content = readFile(keysPath, session.userType);
      if (!content) return false;

      const fingerprint = computeKeyFingerprint(targetUser, targetIP, port);
      if (!fingerprint) return false;

      const expectedEntry = `${targetUser}@${targetIP}:${fingerprint}`;
      return content.split('\n').some((line) => line.trim() === expectedEntry);
    },
    [
      getDefaultHomePath,
      readFile,
      computeKeyFingerprint,
      session.machine,
      session.username,
      session.userType,
    ],
  );

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

  // Shared SSH session setup: optimistically updates local state via the
  // sync setX setters (immediate UI feedback), and fires-and-forgets a
  // server-side session-create. When the server returns, pushSession
  // atomically pushes the prior snapshot to the stack and re-sets Session
  // with the same destination plus the server-issued sessionId.
  //
  // The redundant setSession-via-pushSession is intentional — it's the only
  // way to attach the sessionId without a follow-up setter, and the values
  // overwritten match exactly what the optimistic setters wrote.
  const connectSsh = useCallback(
    (user: string, ip: string, port: number) => {
      const resolved = resolveNat(ip, port);
      const resolvedIp = resolved.ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === user);
      const userType: UserType = remoteUser?.userType ?? 'user';
      const homePath = getDefaultHomePath(resolvedIp, user);
      // When NAT-forwarded, resolve hostname from the actual target machine (behind gateway),
      // not the gateway itself. findMachineByIp searches across all network configs.
      const targetMachine = findMachineByIp(resolvedIp) ?? getMachine(ip);

      void pushSession('ssh', {
        machine: resolvedIp,
        hostname: targetMachine?.hostname,
        username: user,
        userType,
        currentPath: homePath,
      }).catch((error) => {
        console.error('[useAuthentication] pushSession ssh failed:', error);
      });
      // Optimistic local update — keeps the prompt snappy during the server
      // round-trip. pushSession overwrites these with the same values + sessionId
      // when it resolves.
      setUsername(user, userType);
      setMachine(resolvedIp, targetMachine?.hostname);
      setCurrentPath(homePath);
      addLine('result', `Connected to ${ip}`);
      addLine('result', `Welcome to ${targetMachine?.hostname ?? ip}!`);
    },
    [
      pushSession,
      resolveNat,
      findMachineUsers,
      findMachineByIp,
      getDefaultHomePath,
      getMachine,
      setUsername,
      setMachine,
      setCurrentPath,
      addLine,
    ],
  );

  // Validates a remote user's password against their stored hash
  const validateRemotePassword = useCallback(
    ({
      user,
      targetIP,
      port,
      password,
    }: {
      readonly user: string;
      readonly targetIP: string;
      readonly port: number;
      readonly password: string;
    }): boolean => {
      const resolvedIp = resolveNat(targetIP, port).ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === user);
      if (!remoteUser) return false;
      return remoteUser.passwordHash === md5(password);
    },
    [resolveNat, findMachineUsers],
  );

  // Inline SSH auth: validates password, saves key, and connects without interactive prompt
  const authenticateSshInline = useCallback(
    ({
      user,
      targetIP,
      port,
      password,
    }: {
      readonly user: string;
      readonly targetIP: string;
      readonly port: number;
      readonly password: string;
    }) => {
      if (hasAuthorizedKey(user, targetIP, port)) {
        addLine('result', 'Authenticated with saved key.');
        connectSsh(user, targetIP, port);
        onSshAuth?.({ success: true, user, targetIP, port, method: 'publickey' });
        return;
      }

      if (validateRemotePassword({ user, targetIP, port, password })) {
        saveAuthorizedKey(user, targetIP, port);
        connectSsh(user, targetIP, port);
        onSshAuth?.({ success: true, user, targetIP, port, method: 'password' });
      } else {
        addLine('error', 'Permission denied, please try again.');
        onSshAuth?.({ success: false, user, targetIP, port, method: 'password' });
      }
    },
    [hasAuthorizedKey, validateRemotePassword, addLine, connectSsh, saveAuthorizedKey, onSshAuth],
  );

  const startSshPrompt = useCallback(
    (user: string, targetIP: string, targetPort: number) => {
      if (hasAuthorizedKey(user, targetIP, targetPort)) {
        addLine('result', 'Authenticated with saved key.');
        connectSsh(user, targetIP, targetPort);
        onSshAuth?.({
          success: true,
          user,
          targetIP,
          port: targetPort,
          method: 'publickey',
        });
        return;
      }

      setTargetUser(user);
      setSshTargetIP(targetIP);
      setSshTargetPort(targetPort);
      setPasswordMode(true);
      addLine('result', `${user}@${targetIP}'s password:`);
    },
    [hasAuthorizedKey, addLine, connectSsh, onSshAuth],
  );

  // Inline FTP auth: validates username + password and enters FTP mode without interactive prompts.
  // Checks virtual user credentials (/etc/vsftpd/virtual_users.conf) first if present,
  // falls back to system user credentials.
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

      // Check virtual users first (FTP-entry machines and ~40% of FTP-open machines)
      const virtualUsersContent = readFileFromMachine({
        machineId: resolvedIp,
        path: '/etc/vsftpd/virtual_users.conf',
        cwd: '/',
        userType: 'root',
      });
      const expectedHash = virtualUsersContent
        ? (parseVirtualUsersConf(virtualUsersContent).find((u) => u.username === username)
            ?.passwordHash ?? remoteUser.passwordHash)
        : remoteUser.passwordHash;

      if (expectedHash !== md5(password)) {
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

  // Inline SCP auth: validates password, saves key, and returns transfer AsyncOutput (or undefined on failure)
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
      readonly performTransfer: () => AsyncOutput;
    }): AsyncOutput | undefined => {
      if (hasAuthorizedKey(user, targetIP, port)) {
        addLine('result', 'Authenticated with saved key.');
        onSshAuth?.({ success: true, user, targetIP, port, method: 'publickey' });
        return performTransfer();
      }

      if (validateRemotePassword({ user, targetIP, port, password })) {
        saveAuthorizedKey(user, targetIP, port);
        onSshAuth?.({ success: true, user, targetIP, port, method: 'password' });
        return performTransfer();
      } else {
        addLine('error', 'Permission denied, please try again.');
        onSshAuth?.({ success: false, user, targetIP, port, method: 'password' });
        return undefined;
      }
    },
    [hasAuthorizedKey, validateRemotePassword, addLine, saveAuthorizedKey, onSshAuth],
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
      readonly performTransfer: () => AsyncOutput;
    }): AsyncOutput | undefined => {
      if (hasAuthorizedKey(user, targetIP, port)) {
        addLine('result', 'Authenticated with saved key.');
        onSshAuth?.({ success: true, user, targetIP, port, method: 'publickey' });
        return performTransfer();
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
    [hasAuthorizedKey, addLine, onSshAuth],
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

      // SSH/SCP auth: read /etc/passwd from the resolved target instead of
      // the static users[].passwordHash. The static list is captured at
      // mission generation; password_reset (and any other write that
      // mutates /etc/passwd) doesn't update it. Reading /etc/passwd makes
      // the rolled credential actually unlock the account.
      //
      // Falls back to users[].passwordHash if /etc/passwd is missing or
      // doesn't have a row for the target user — defensive, the file
      // should always exist on a generated machine.
      const validateAgainstEtcPasswd = (resolvedIp: string): boolean => {
        const users = findMachineUsers(resolvedIp);
        const remoteUser = users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);

        const passwdContent = readFileFromMachine({
          machineId: resolvedIp,
          path: '/etc/passwd',
          cwd: '/',
          userType: 'root',
        });
        if (passwdContent) {
          const entry = passwdContent.split('\n').find((line) => line.split(':')[0] === targetUser);
          const storedHash = entry?.split(':')[1];
          if (storedHash) return storedHash === inputHash;
        }
        return remoteUser.passwordHash === inputHash;
      };

      if (scpTargetIP) {
        return validateAgainstEtcPasswd(resolveNat(scpTargetIP, scpTargetPort ?? 22).ip);
      }

      if (sshTargetIP) {
        return validateAgainstEtcPasswd(resolveNat(sshTargetIP, sshTargetPort ?? 22).ip);
      }

      if (ftpTargetIP) {
        const resolvedIp = resolveNat(ftpTargetIP, 21).ip;
        const users = findMachineUsers(resolvedIp);

        const remoteUser = users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        // Check virtual users first (FTP-entry machines and ~40% of FTP-open machines)
        const virtualUsersContent = readFileFromMachine({
          machineId: resolvedIp,
          path: '/etc/vsftpd/virtual_users.conf',
          cwd: '/',
          userType: 'root',
        });
        const expectedHash = virtualUsersContent
          ? (parseVirtualUsersConf(virtualUsersContent).find((u) => u.username === targetUser)
              ?.passwordHash ?? remoteUser.passwordHash)
          : remoteUser.passwordHash;

        const inputHash = md5(password);
        return expectedHash === inputHash;
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
      scpTargetIP,
      scpTargetPort,
      sshTargetIP,
      sshTargetPort,
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
        } else if (scpTargetIP) {
          saveAuthorizedKey(targetUser, scpTargetIP, scpTargetPort ?? 22);
          onSshAuth?.({
            success: true,
            user: targetUser,
            targetIP: scpTargetIP,
            port: scpTargetPort ?? 22,
            method: 'password',
          });
          if (scpPerformTransfer) {
            scpTransferAsync = scpPerformTransfer();
          }
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
        } else if (sshTargetIP) {
          saveAuthorizedKey(targetUser, sshTargetIP, sshTargetPort ?? 22);
          connectSsh(targetUser, sshTargetIP, sshTargetPort ?? 22);
          onSshAuth?.({
            success: true,
            user: targetUser,
            targetIP: sshTargetIP,
            port: sshTargetPort ?? 22,
            method: 'password',
          });
        } else {
          // su (local user switch) — look up user type from the machine's user list.
          // findMachineUsers checks both the current network view and all mission
          // network configs (needed for mission-generated machines).
          const users = findMachineUsers(session.machine);
          const machineUser = users?.find((u) => u.username === targetUser);
          const userType: UserType =
            machineUser?.userType ??
            (targetUser === 'root' ? 'root' : targetUser === 'guest' ? 'guest' : 'user');
          const homePath = userType === 'root' ? '/root' : `/home/${targetUser}`;

          // Fire-and-forget pushSession (server-side session record); local
          // state updated optimistically below for snappy prompt response.
          void pushSession('su', {
            machine: session.machine,
            hostname: session.hostname,
            username: targetUser,
            userType,
            currentPath: homePath,
          }).catch((error) => {
            console.error('[useAuthentication] pushSession su failed:', error);
          });
          setUsername(targetUser, userType);
          setCurrentPath(homePath);
          addLine('result', `Switched to user: ${targetUser}`);
          onSuAuth?.(true, targetUser);
        }
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
        } else {
          addLine('error', 'su: Authentication failure');
          if (targetUser) onSuAuth?.(false, targetUser);
        }
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
      validatePassword,
      saveAuthorizedKey,
      connectMysql,
      connectSsh,
      pushSession,
      setUsername,
      setCurrentPath,
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
