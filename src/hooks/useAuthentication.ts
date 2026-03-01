import { useState, useCallback } from 'react';
import type { UserType, FtpSession } from '../session/SessionContext';
import type { RemoteUser } from '../network/types';
import { md5 } from '../utils/md5';

type MachineNetworkConfig = {
  readonly machines: readonly { readonly ip: string; readonly users: readonly RemoteUser[] }[];
};

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
  readonly readFile: (path: string, userType: UserType) => string | null;
  readonly resolveNat: (ip: string) => string;
  readonly getDefaultHomePath: (machineIp: string, username: string) => string;
  readonly setUsername: (username: string, userType: UserType) => void;
  readonly setMachine: (machine: string) => void;
  readonly setCurrentPath: (path: string) => void;
  readonly pushSession: () => void;
  readonly enterFtpMode: (session: FtpSession) => void;
  readonly machineConfigs: Readonly<Record<string, MachineNetworkConfig>>;
};

export const useAuthentication = ({
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
  machineConfigs,
}: AuthenticationOptions) => {
  const [passwordMode, setPasswordMode] = useState(false);
  const [targetUser, setTargetUser] = useState<string | null>(null);
  const [sshTargetIP, setSshTargetIP] = useState<string | null>(null);
  const [ftpTargetIP, setFtpTargetIP] = useState<string | null>(null);
  const [ftpUsernameMode, setFtpUsernameMode] = useState(false);

  const startPasswordPrompt = useCallback(
    (user: string) => {
      setTargetUser(user);
      setPasswordMode(true);
      addLine('result', 'Password:');
    },
    [addLine],
  );

  const startSshPrompt = useCallback(
    (user: string, targetIP: string) => {
      setTargetUser(user);
      setSshTargetIP(targetIP);
      setPasswordMode(true);
      addLine('result', `${user}@${targetIP}'s password:`);
    },
    [addLine],
  );

  const startFtpPrompt = useCallback(
    (targetIP: string) => {
      setFtpTargetIP(targetIP);
      setFtpUsernameMode(true);
      addLine('result', `Name (${targetIP}:anonymous):`);
    },
    [addLine],
  );

  const resetAuthState = useCallback(() => {
    setPasswordMode(false);
    setTargetUser(null);
    setSshTargetIP(null);
    setFtpTargetIP(null);
    setFtpUsernameMode(false);
  }, []);

  // Three-mode password validation: SSH (remote machine lookup), FTP (remote machine lookup),
  // or su (local /etc/passwd hash comparison). The mode is determined by which target IP
  // state is set when the password prompt was triggered.
  const validatePassword = useCallback(
    (password: string): boolean => {
      if (!targetUser) return false;

      if (sshTargetIP) {
        const machine = getMachine(sshTargetIP);
        if (!machine) return false;

        const remoteUser = machine.users.find((u) => u.username === targetUser);
        if (!remoteUser) return false;

        const inputHash = md5(password);
        return remoteUser.passwordHash === inputHash;
      }

      if (ftpTargetIP) {
        const machine = getMachine(ftpTargetIP);
        if (!machine) return false;

        const remoteUser = machine.users.find((u) => u.username === targetUser);
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
    [targetUser, sshTargetIP, ftpTargetIP, readFile, getMachine],
  );

  const handleFtpUsernameSubmit = useCallback(
    (input: string, clearInput: () => void) => {
      if (!ftpTargetIP) return;

      const username = input.trim() || 'anonymous';
      addLine('command', username, `Name (${ftpTargetIP}:anonymous):`);

      const machine = getMachine(ftpTargetIP);
      if (!machine) {
        addLine('error', '530 Login incorrect.');
        setFtpTargetIP(null);
        setFtpUsernameMode(false);
        clearInput();
        return;
      }

      const remoteUser = machine.users.find((u) => u.username === username);
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
    [ftpTargetIP, getMachine, addLine],
  );

  const handlePasswordSubmit = useCallback(
    (input: string, clearInput: () => void) => {
      const maskedPassword = '*'.repeat(input.length);
      const promptLabel = ftpTargetIP
        ? 'Password:'
        : sshTargetIP
          ? `${targetUser}@${sshTargetIP}'s password:`
          : 'Password:';
      addLine('command', maskedPassword, promptLabel);

      if (validatePassword(input)) {
        if (!targetUser) return;

        if (ftpTargetIP) {
          const machine = getMachine(ftpTargetIP);
          const remoteUser = machine?.users.find((u) => u.username === targetUser);
          const userType: UserType = remoteUser?.userType ?? 'user';
          const remoteHomePath = targetUser === 'root' ? '/root' : `/home/${targetUser}`;

          const newFtpSession: FtpSession = {
            remoteMachine: resolveNat(ftpTargetIP),
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
          // Save current session state before switching to remote machine
          pushSession();

          // NAT resolution: if connecting to a router's public IP with port forwarding,
          // resolve to the internal entry machine IP
          const resolvedIp = resolveNat(sshTargetIP);
          const machine = getMachine(sshTargetIP);
          const remoteUser = machine?.users.find((u) => u.username === targetUser);
          const userType: UserType = remoteUser?.userType ?? 'user';
          const homePath = getDefaultHomePath(resolvedIp, targetUser);

          setUsername(targetUser, userType);
          setMachine(resolvedIp);
          setCurrentPath(homePath);
          addLine('result', `Connected to ${sshTargetIP}`);
          addLine('result', `Welcome to ${machine?.hostname ?? sshTargetIP}!`);
        } else {
          // su (local user switch) — look up user type from the machine's user list.
          // Searches both the direct machine config and the network-wide machine list
          // because mission-generated machines may not appear in the direct config.
          const machine = getMachine(session.machine);
          const machineUser =
            machine?.users.find((u) => u.username === targetUser) ??
            Object.values(machineConfigs)
              .flatMap((mc) => mc.machines)
              .find((m) => m.ip === session.machine)
              ?.users.find((u) => u.username === targetUser);
          const userType: UserType =
            machineUser?.userType ??
            (targetUser === 'root' ? 'root' : targetUser === 'guest' ? 'guest' : 'user');
          const homePath = userType === 'root' ? '/root' : `/home/${targetUser}`;

          setUsername(targetUser, userType);
          setCurrentPath(homePath);
          addLine('result', `Switched to user: ${targetUser}`);
        }
      } else {
        if (ftpTargetIP) {
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
      setFtpTargetIP(null);
      clearInput();
    },
    [
      targetUser,
      sshTargetIP,
      ftpTargetIP,
      validatePassword,
      setUsername,
      setMachine,
      setCurrentPath,
      pushSession,
      session,
      getMachine,
      machineConfigs,
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
    resetAuthState,
  };
};
