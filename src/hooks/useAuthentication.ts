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
  const [scpPerformTransfer, setScpPerformTransfer] = useState<(() => AsyncOutput) | null>(null);

  const startPasswordPrompt = useCallback(
    (user: string) => {
      setTargetUser(user);
      setPasswordMode(true);
      addLine('result', 'Password:');
    },
    [addLine],
  );

  // Checks whether the current user has an SSH key stored for the given target
  const hasAuthorizedKey = useCallback(
    (targetUser: string, targetIP: string): boolean => {
      const homePath = getDefaultHomePath(session.machine, session.username);
      const keysPath = `${homePath}/.ssh_keys`;
      const content = readFile(keysPath, session.userType);
      if (!content) return false;
      const entry = `${targetUser}@${targetIP}`;
      return content.split('\n').some((line) => line.trim() === entry);
    },
    [getDefaultHomePath, readFile, session.machine, session.username, session.userType],
  );

  // Persists an SSH key for the given target on the current machine's filesystem
  const saveAuthorizedKey = useCallback(
    (targetUser: string, targetIP: string): void => {
      const homePath = getDefaultHomePath(session.machine, session.username);
      const keysPath = `${homePath}/.ssh_keys`;
      const entry = `${targetUser}@${targetIP}`;
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

  const startSshPrompt = useCallback(
    (user: string, targetIP: string, targetPort: number) => {
      if (hasAuthorizedKey(user, targetIP)) {
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

  const startFtpPrompt = useCallback(
    (targetIP: string) => {
      setFtpTargetIP(targetIP);
      setFtpUsernameMode(true);
      addLine('result', `Name (${targetIP}:anonymous):`);
    },
    [addLine],
  );

  const startScpPrompt = useCallback(
    (user: string, ip: string, performTransfer: () => AsyncOutput): AsyncOutput | undefined => {
      if (hasAuthorizedKey(user, ip)) {
        addLine('result', 'Authenticated with saved key.');
        return performTransfer();
      }

      setTargetUser(user);
      setScpTargetIP(ip);
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
        const resolvedIp = resolveNat(scpTargetIP, 22).ip;
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
          saveAuthorizedKey(targetUser, scpTargetIP);
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
          saveAuthorizedKey(targetUser, sshTargetIP);
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
      setScpPerformTransfer(null);
      clearInput();

      return scpTransferAsync;
    },
    [
      targetUser,
      scpTargetIP,
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
    startFtpPrompt,
    startScpPrompt,
    resetAuthState,
  };
};
