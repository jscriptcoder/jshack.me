import { useState, useCallback } from 'react';
import type { UserType, FtpSession } from '../session/SessionContext';
import type { RemoteUser } from '../network/types';
import type { AsyncOutput } from '../components/Terminal/types';
import type { PermissionResult } from '../filesystem/types';
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
    readonly currentPath: string;
  };
  readonly getMachine: (
    ip: string,
  ) => { readonly hostname: string; readonly users: readonly RemoteUser[] } | undefined;
  readonly findMachineUsers: (ip: string) => readonly RemoteUser[];
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly getDefaultHomePath: (machineIp: string, username: string) => string;
  readonly setUsername: (username: string, userType: UserType) => void;
  readonly setMachine: (machine: string) => void;
  readonly setCurrentPath: (path: string) => void;
  readonly pushSession: () => void;
  readonly enterFtpMode: (session: FtpSession) => void;
  readonly createFile: (path: string, content: string, userType: UserType) => PermissionResult;
  readonly writeFile: (path: string, content: string, userType: UserType) => PermissionResult;
};

export const useAuthentication = ({
  addLine,
  session,
  getMachine,
  findMachineUsers,
  readFile,
  resolveNat,
  getDefaultHomePath,
  setUsername,
  setMachine,
  setCurrentPath,
  pushSession,
  enterFtpMode,
  createFile,
  writeFile,
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

  // Shared SSH session setup: pushes session stack and switches to remote machine
  const connectSsh = useCallback(
    (user: string, ip: string, port: number) => {
      pushSession();

      const resolved = resolveNat(ip, port);
      const resolvedIp = resolved.ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === user);
      const userType: UserType = remoteUser?.userType ?? 'user';
      const homePath = getDefaultHomePath(resolvedIp, user);
      const machine = getMachine(ip);

      setUsername(user, userType);
      setMachine(resolvedIp);
      setCurrentPath(homePath);
      addLine('result', `Connected to ${ip}`);
      addLine('result', `Welcome to ${machine?.hostname ?? ip}!`);
    },
    [
      pushSession,
      resolveNat,
      findMachineUsers,
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
    (user: string, ip: string, port: number, password: string): boolean => {
      const resolvedIp = resolveNat(ip, port).ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === user);
      if (!remoteUser) return false;
      return remoteUser.passwordHash === md5(password);
    },
    [resolveNat, findMachineUsers],
  );

  // Inline SSH auth: validates password, saves key, and connects without interactive prompt
  const authenticateSshInline = useCallback(
    (user: string, targetIP: string, targetPort: number, password: string) => {
      if (hasAuthorizedKey(user, targetIP, targetPort)) {
        addLine('result', 'Authenticated with saved key.');
        connectSsh(user, targetIP, targetPort);
        return;
      }

      if (validateRemotePassword(user, targetIP, targetPort, password)) {
        saveAuthorizedKey(user, targetIP, targetPort);
        connectSsh(user, targetIP, targetPort);
      } else {
        addLine('error', 'Permission denied, please try again.');
      }
    },
    [hasAuthorizedKey, validateRemotePassword, addLine, connectSsh, saveAuthorizedKey],
  );

  const startSshPrompt = useCallback(
    (user: string, targetIP: string, targetPort: number) => {
      if (hasAuthorizedKey(user, targetIP, targetPort)) {
        addLine('result', 'Authenticated with saved key.');
        connectSsh(user, targetIP, targetPort);
        return;
      }

      setTargetUser(user);
      setSshTargetIP(targetIP);
      setSshTargetPort(targetPort);
      setPasswordMode(true);
      addLine('result', `${user}@${targetIP}'s password:`);
    },
    [hasAuthorizedKey, addLine, connectSsh],
  );

  // Inline FTP auth: validates username + password and enters FTP mode without interactive prompts
  const authenticateFtpInline = useCallback(
    (targetIP: string, username: string, password: string) => {
      const resolvedIp = resolveNat(targetIP, 21).ip;
      const users = findMachineUsers(resolvedIp);
      const remoteUser = users.find((u) => u.username === username);

      if (!remoteUser) {
        addLine('error', '530 Login incorrect.');
        return;
      }

      if (remoteUser.passwordHash !== md5(password)) {
        addLine('error', '530 Login incorrect.');
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
      };

      enterFtpMode(newFtpSession);
      addLine('result', '230 Login successful.');
    },
    [resolveNat, findMachineUsers, addLine, getDefaultHomePath, session, enterFtpMode],
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
    (
      user: string,
      ip: string,
      port: number,
      password: string,
      performTransfer: () => AsyncOutput,
    ): AsyncOutput | undefined => {
      if (hasAuthorizedKey(user, ip, port)) {
        addLine('result', 'Authenticated with saved key.');
        return performTransfer();
      }

      if (validateRemotePassword(user, ip, port, password)) {
        saveAuthorizedKey(user, ip, port);
        return performTransfer();
      } else {
        addLine('error', 'Permission denied, please try again.');
        return undefined;
      }
    },
    [hasAuthorizedKey, validateRemotePassword, addLine, saveAuthorizedKey],
  );

  const startScpPrompt = useCallback(
    (
      user: string,
      ip: string,
      port: number,
      performTransfer: () => AsyncOutput,
    ): AsyncOutput | undefined => {
      if (hasAuthorizedKey(user, ip, port)) {
        addLine('result', 'Authenticated with saved key.');
        return performTransfer();
      }

      setTargetUser(user);
      setScpTargetIP(ip);
      setScpTargetPort(port);
      // Wrap in thunk to avoid React treating the function as a state updater
      setScpPerformTransfer(() => performTransfer);
      setPasswordMode(true);
      addLine('result', `${user}@${ip}'s password:`);
      return undefined;
    },
    [hasAuthorizedKey, addLine],
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

      if (scpTargetIP) {
        const resolvedIp = resolveNat(scpTargetIP, scpTargetPort ?? 22).ip;
        const users = findMachineUsers(resolvedIp);

        const remoteUser = users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);
        return remoteUser.passwordHash === inputHash;
      }

      if (sshTargetIP) {
        const resolvedIp = resolveNat(sshTargetIP, sshTargetPort ?? 22).ip;
        const users = findMachineUsers(resolvedIp);

        const remoteUser = users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);
        return remoteUser.passwordHash === inputHash;
      }

      if (ftpTargetIP) {
        const resolvedIp = resolveNat(ftpTargetIP, 21).ip;
        const users = findMachineUsers(resolvedIp);

        const remoteUser = users.find((u) => u.username === targetUser);
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
    [
      targetUser,
      scpTargetIP,
      scpTargetPort,
      sshTargetIP,
      sshTargetPort,
      ftpTargetIP,
      readFile,
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
    [ftpTargetIP, findMachineUsers, addLine, resolveNat],
  );

  // Returns an optional AsyncOutput for SCP transfer animation
  const handlePasswordSubmit = useCallback(
    (input: string, clearInput: () => void): AsyncOutput | undefined => {
      const maskedPassword = '*'.repeat(input.length);
      const promptLabel = scpTargetIP
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

        if (scpTargetIP) {
          saveAuthorizedKey(targetUser, scpTargetIP, scpTargetPort ?? 22);
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
          };

          enterFtpMode(newFtpSession);
          addLine('result', '230 Login successful.');
        } else if (sshTargetIP) {
          saveAuthorizedKey(targetUser, sshTargetIP, sshTargetPort ?? 22);
          connectSsh(targetUser, sshTargetIP, sshTargetPort ?? 22);
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

          setUsername(targetUser, userType);
          setCurrentPath(homePath);
          addLine('result', `Switched to user: ${targetUser}`);
        }
      } else {
        if (scpTargetIP) {
          addLine('error', `Permission denied, please try again.`);
        } else if (ftpTargetIP) {
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
      setSshTargetPort(null);
      setFtpTargetIP(null);
      setScpTargetIP(null);
      setScpTargetPort(null);
      setScpPerformTransfer(null);
      clearInput();

      return scpTransferAsync;
    },
    [
      targetUser,
      scpTargetIP,
      scpTargetPort,
      scpPerformTransfer,
      sshTargetIP,
      sshTargetPort,
      ftpTargetIP,
      validatePassword,
      saveAuthorizedKey,
      connectSsh,
      setUsername,
      setCurrentPath,
      session,
      findMachineUsers,
      enterFtpMode,
      addLine,
      getDefaultHomePath,
      resolveNat,
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
    resetAuthState,
  };
};
