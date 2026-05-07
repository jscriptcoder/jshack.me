import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuthentication } from './useAuthentication';
import { md5 } from '../utils/md5';
import type { AsyncOutput } from '../components/Terminal/types';

const PASSWORD = 'secret123';
const PASSWORD_HASH = md5(PASSWORD);
const TARGET_IP = '10.0.0.5';

const makeRemoteUser = (
  overrides: {
    readonly username?: string;
    readonly password?: string;
    readonly userType?: 'root' | 'user' | 'guest';
  } = {},
) => ({
  username: overrides.username ?? 'bob',
  passwordHash: md5(overrides.password ?? PASSWORD),
  userType: overrides.userType ?? ('user' as const),
});

const makeOptions = () => ({
  addLine: vi.fn(),
  session: {
    username: 'alice',
    userType: 'user' as const,
    machine: '192.168.1.10',
    currentPath: '/home/alice',
  },
  getMachine: vi.fn((_ip: string) => ({ hostname: 'testbox', users: [] as readonly never[] })),
  findMachineUsers: vi.fn((_ip: string) => [] as ReturnType<typeof makeRemoteUser>[]),
  findMachineByIp: vi.fn((_ip: string) => undefined),
  readFile: vi.fn((_path: string, _userType: string) => null as string | null),
  resolveNat: vi.fn((ip: string, port: number) => ({ ip, port })),
  getDefaultHomePath: vi.fn((_ip: string, username: string) => `/home/${username}`),
  setUsername: vi.fn(),
  setMachine: vi.fn(),
  setCurrentPath: vi.fn(),
  pushSession: vi.fn().mockResolvedValue(undefined),
  enterFtpMode: vi.fn(),
  enterMysqlMode: vi.fn(),
  enterRedisMode: vi.fn(),
  readFileFromMachine: vi.fn((_op: { path: string }) => null as string | null),
  createFile: vi.fn(() => ({ allowed: true })),
  writeFile: vi.fn(() => ({ allowed: true })),
});

const makeAsyncOutput = (): AsyncOutput => ({
  __type: 'async',
  start: vi.fn(),
});

const computeFingerprint = (user: string, ip: string, passwordHash: string) =>
  md5(`${user}:${ip}:${passwordHash}`);

const makeKeyEntry = (user: string, ip: string, passwordHash: string) =>
  `${user}@${ip}:${computeFingerprint(user, ip, passwordHash)}`;

describe('useAuthentication', () => {
  describe('su (local user switch)', () => {
    it('switches user on correct password validated against /etc/passwd', () => {
      const opts = makeOptions();
      const rootUser = makeRemoteUser({ username: 'root', password: 'rootpass', userType: 'root' });
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `root:${md5('rootpass')}` : null,
      );
      opts.findMachineUsers.mockReturnValue([rootUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startPasswordPrompt('root'));
      expect(result.current.passwordMode).toBe(true);

      const clearInput = vi.fn();
      act(() => {
        result.current.handlePasswordSubmit('rootpass', clearInput);
      });

      expect(opts.setUsername).toHaveBeenCalledWith('root', 'root');
      expect(opts.setCurrentPath).toHaveBeenCalledWith('/root');
      expect(opts.addLine).toHaveBeenCalledWith('result', 'Switched to user: root');
      expect(result.current.passwordMode).toBe(false);
      expect(clearInput).toHaveBeenCalled();
    });

    it('rejects incorrect password', () => {
      const opts = makeOptions();
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `root:${md5('rootpass')}` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startPasswordPrompt('root'));
      act(() => {
        result.current.handlePasswordSubmit('wrong', vi.fn());
      });

      expect(opts.setUsername).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'su: Authentication failure');
      expect(result.current.passwordMode).toBe(false);
    });

    it('looks up user type from machine users list', () => {
      const opts = makeOptions();
      const adminUser = makeRemoteUser({
        username: 'admin',
        password: 'adminpass',
        userType: 'user',
      });
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `admin:${md5('adminpass')}` : null,
      );
      opts.findMachineUsers.mockReturnValue([adminUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startPasswordPrompt('admin'));
      act(() => {
        result.current.handlePasswordSubmit('adminpass', vi.fn());
      });

      expect(opts.setUsername).toHaveBeenCalledWith('admin', 'user');
      expect(opts.setCurrentPath).toHaveBeenCalledWith('/home/admin');
    });

    it('defaults to root type for root username when not in machine users', () => {
      const opts = makeOptions();
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `root:${md5('rootpass')}` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startPasswordPrompt('root'));
      act(() => {
        result.current.handlePasswordSubmit('rootpass', vi.fn());
      });

      expect(opts.setUsername).toHaveBeenCalledWith('root', 'root');
      expect(opts.setCurrentPath).toHaveBeenCalledWith('/root');
    });

    it('defaults to guest type for guest username when not in machine users', () => {
      const opts = makeOptions();
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `guest:${md5('guestpass')}` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startPasswordPrompt('guest'));
      act(() => {
        result.current.handlePasswordSubmit('guestpass', vi.fn());
      });

      expect(opts.setUsername).toHaveBeenCalledWith('guest', 'guest');
      expect(opts.setCurrentPath).toHaveBeenCalledWith('/home/guest');
    });

    it('calls onSuAuth with true on successful interactive auth', () => {
      const opts = makeOptions();
      const onSuAuth = vi.fn();
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `root:${md5('rootpass')}` : null,
      );
      opts.findMachineUsers.mockReturnValue([
        makeRemoteUser({ username: 'root', password: 'rootpass', userType: 'root' }),
      ]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSuAuth }));

      act(() => result.current.startPasswordPrompt('root'));
      act(() => result.current.handlePasswordSubmit('rootpass', vi.fn()));

      expect(onSuAuth).toHaveBeenCalledWith(true, 'root');
    });

    it('calls onSuAuth with false on failed interactive auth', () => {
      const opts = makeOptions();
      const onSuAuth = vi.fn();
      opts.readFile.mockImplementation((path: string) =>
        path === '/etc/passwd' ? `root:${md5('rootpass')}` : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSuAuth }));

      act(() => result.current.startPasswordPrompt('root'));
      act(() => result.current.handlePasswordSubmit('wrong', vi.fn()));

      expect(onSuAuth).toHaveBeenCalledWith(false, 'root');
    });
  });

  describe('SSH interactive authentication', () => {
    it('connects immediately when authorized key exists', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));

      expect(result.current.passwordMode).toBe(false);
      expect(opts.addLine).toHaveBeenCalledWith('result', 'Authenticated with saved key.');
      expect(opts.pushSession).toHaveBeenCalled();
      expect(opts.setUsername).toHaveBeenCalledWith('bob', 'user');
      expect(opts.setMachine).toHaveBeenCalledWith(TARGET_IP, 'testbox');
    });

    it('prompts for password when no authorized key', () => {
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));

      expect(result.current.passwordMode).toBe(true);
      expect(opts.addLine).toHaveBeenCalledWith('result', `bob@${TARGET_IP}'s password:`);
      expect(opts.pushSession).not.toHaveBeenCalled();
    });

    it('connects and saves key on correct password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.pushSession).toHaveBeenCalled();
      expect(opts.setUsername).toHaveBeenCalledWith('bob', 'user');
      expect(opts.setMachine).toHaveBeenCalledWith(TARGET_IP, 'testbox');
      expect(opts.createFile).toHaveBeenCalled();
      expect(result.current.passwordMode).toBe(false);
    });

    it('rejects incorrect SSH password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit('wrong', vi.fn());
      });

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
      expect(result.current.passwordMode).toBe(false);
    });

    it('reads /etc/passwd from the target — accepts a password that differs from the static users[].passwordHash (post password_reset)', () => {
      // After password_reset rolls a new credential it writes /etc/passwd
      // but doesn't update the static users[].passwordHash. SSH auth must
      // read /etc/passwd directly so the rolled password actually unlocks
      // the account; otherwise the player sees a fresh credential that
      // never works.
      const newPassword = 'pwned-9012-user';
      const newHash = md5(newPassword);
      // Static users carries the original (pre-reset) hash.
      const remoteUser = makeRemoteUser({ password: 'original-pre-reset' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${newHash}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(newPassword, vi.fn());
      });

      // /etc/passwd has the new hash → md5(newPassword) matches → auth succeeds
      // even though users[].passwordHash is stale.
      expect(opts.pushSession).toHaveBeenCalled();
      expect(opts.addLine).not.toHaveBeenCalledWith(
        'error',
        'Permission denied, please try again.',
      );
    });

    it('rejects SSH password when /etc/passwd is unreadable, even if it matches the cache', () => {
      // /etc/passwd is the sole source of truth — if the file is missing
      // (e.g., garbled to nothing, or the file was deleted), auth fails
      // regardless of what the static cache holds. Players who garble a
      // remote /etc/passwd should lock out password logins on that machine.
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockReturnValue(null);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });

    it('rejects SSH password when /etc/passwd is garbled and missing the target user', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? 'garbage with no colons or recognisable lines' : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });

    it('rejects SSH password when /etc/passwd has the user line but the hash field is empty', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? 'bob::1001:1001:bob:/home/bob:/bin/bash' : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });

    it('finds the correct user line in a multi-user /etc/passwd (parses on newline)', () => {
      // Production /etc/passwd has root + user + guest at minimum. The
      // parser must split on newlines so the per-user lookup picks the
      // right line; a wrong delimiter would treat the file as a single
      // blob and only the first user's hash would ever be considered.
      const remoteUser = makeRemoteUser({ username: 'bob', password: 'bob-pass' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd'
          ? [
              `root:${md5('root-pass')}:0:0:root:/root:/bin/bash`,
              `bob:${md5('bob-pass')}:1001:1001:bob:/home/bob:/bin/bash`,
              `guest:${md5('guest-pass')}:65534:65534:guest:/home/guest:/bin/bash`,
            ].join('\n')
          : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit('bob-pass', vi.fn());
      });

      expect(opts.pushSession).toHaveBeenCalled();
      expect(opts.addLine).not.toHaveBeenCalledWith(
        'error',
        'Permission denied, please try again.',
      );
    });

    it('rejects SSH password when /etc/passwd has a different hash than the input', () => {
      // The inverse of the post-password_reset acceptance test — the OLD
      // password should fail once /etc/passwd has been rotated. Cache hash
      // is no longer consulted as a fallback.
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd'
          ? `bob:${md5('something-else')}:1001:1001:bob:/home/bob:/bin/bash`
          : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });
  });

  describe('SSH inline authentication', () => {
    it('connects with authorized key without checking password', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'irrelevant',
        }),
      );

      expect(opts.addLine).toHaveBeenCalledWith('result', 'Authenticated with saved key.');
      expect(opts.pushSession).toHaveBeenCalled();
    });

    it('connects with correct password and saves key', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
        }),
      );

      expect(opts.pushSession).toHaveBeenCalled();
      expect(opts.setUsername).toHaveBeenCalledWith('bob', 'user');
      expect(opts.createFile).toHaveBeenCalled();
    });

    it('rejects incorrect password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'wrong',
        }),
      );

      expect(opts.pushSession).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });
  });

  describe('SSH auth logging', () => {
    it('calls onSshAuth on inline key auth', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'irrelevant',
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'publickey',
      });
    });

    it('calls onSshAuth on inline password success', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on inline password failure', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'wrong',
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on interactive key auth', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'publickey',
      });
    });

    it('calls onSshAuth on interactive password success', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => result.current.handlePasswordSubmit(PASSWORD, vi.fn()));

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on interactive password failure', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => result.current.handlePasswordSubmit('wrong', vi.fn()));

      expect(onSshAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });
  });

  describe('FTP interactive authentication', () => {
    it('prompts for username then password, enters FTP mode on success', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      expect(result.current.ftpUsernameMode).toBe(true);

      const clearInput = vi.fn();
      act(() => result.current.handleFtpUsernameSubmit('bob', clearInput));
      expect(result.current.ftpUsernameMode).toBe(false);
      expect(result.current.passwordMode).toBe(true);
      expect(clearInput).toHaveBeenCalled();

      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.enterFtpMode).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteMachine: TARGET_IP,
          remoteUsername: 'bob',
          remoteUserType: 'user',
          originMachine: '192.168.1.10',
          originUsername: 'alice',
        }),
      );
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
      expect(result.current.passwordMode).toBe(false);
    });

    it('rejects unknown FTP user at username step', () => {
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));

      const clearInput = vi.fn();
      act(() => result.current.handleFtpUsernameSubmit('nobody', clearInput));

      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
      expect(result.current.ftpUsernameMode).toBe(false);
      expect(result.current.passwordMode).toBe(false);
    });

    it('uses anonymous as default username when input is empty', () => {
      const anonUser = makeRemoteUser({ username: 'anonymous' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([anonUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('', vi.fn()));

      expect(opts.addLine).toHaveBeenCalledWith(
        'command',
        'anonymous',
        `Name (${TARGET_IP}:anonymous):`,
      );
      expect(result.current.passwordMode).toBe(true);
    });

    it('rejects incorrect FTP password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit('wrong', vi.fn());
      });

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('rejects FTP password when /etc/passwd is unreadable and virtual_users.conf is absent', () => {
      // Sabotage feature: garbling /etc/passwd locks out FTP system-credential
      // auth. With virtual_users.conf also absent, there is no overlay to fall
      // back on, so 530 is the only valid outcome.
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockReturnValue(null);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('rejects FTP password when /etc/passwd has no entry for the target user and virtual_users.conf is absent', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd'
          ? `alice:${md5('alice-pass')}:1000:1000:alice:/home/alice:/bin/bash`
          : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('rejects FTP password when /etc/passwd has the user with empty hash field', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? 'bob::1001:1001:bob:/home/bob:/bin/bash' : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('falls through to /etc/passwd when virtual_users.conf does not list the target user', () => {
      // Real vsftpd: virtual_users.conf is an overlay. Users not in it
      // authenticate against system credentials (PAM → /etc/passwd here).
      // Use a rolled password in /etc/passwd that DIFFERS from the static
      // cache so the test only passes when /etc/passwd is actually consulted.
      const rolledPass = 'rolled-after-reset';
      const remoteUser = makeRemoteUser({ password: 'cache-stale' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) => {
        if (op.path === '/etc/vsftpd/virtual_users.conf')
          return `alice:${md5('alice-virtual-pass')}`;
        if (op.path === '/etc/passwd')
          return `bob:${md5(rolledPass)}:1001:1001:bob:/home/bob:/bin/bash`;
        return null;
      });

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(rolledPass, vi.fn());
      });

      expect(opts.enterFtpMode).toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
    });

    it('virtual_users.conf hash overrides /etc/passwd when both list the user', () => {
      // The virtual password unlocks the account; the system password (from
      // /etc/passwd) does not, even though it would succeed in the absence
      // of the virtual_users.conf overlay.
      const virtualPass = 'virtual-pass';
      const systemPass = 'system-pass';
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) => {
        if (op.path === '/etc/vsftpd/virtual_users.conf') return `bob:${md5(virtualPass)}`;
        if (op.path === '/etc/passwd')
          return `bob:${md5(systemPass)}:1001:1001:bob:/home/bob:/bin/bash`;
        return null;
      });

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(systemPass, vi.fn());
      });

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('finds the correct FTP user line in a multi-user /etc/passwd (parses on newline)', () => {
      // Cache hash is stale; /etc/passwd carries the live one. Auth must
      // succeed against the live hash to prove /etc/passwd is read AND
      // parsed on newlines (not as a single blob).
      const livePass = 'live-bob-pass';
      const remoteUser = makeRemoteUser({ username: 'bob', password: 'cache-stale' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd'
          ? [
              `root:${md5('root-pass')}:0:0:root:/root:/bin/bash`,
              `bob:${md5(livePass)}:1001:1001:bob:/home/bob:/bin/bash`,
              `guest:${md5('guest-pass')}:65534:65534:guest:/home/guest:/bin/bash`,
            ].join('\n')
          : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => {
        result.current.handlePasswordSubmit(livePass, vi.fn());
      });

      expect(opts.enterFtpMode).toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
    });
  });

  describe('FTP inline authentication', () => {
    it('enters FTP mode with correct credentials', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', PASSWORD));

      expect(opts.enterFtpMode).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteMachine: TARGET_IP,
          remoteUsername: 'bob',
          remoteUserType: 'user',
        }),
      );
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
    });

    it('rejects unknown user', () => {
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'nobody', PASSWORD));

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('rejects incorrect password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', 'wrong'));

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('rejects when /etc/passwd is unreadable and virtual_users.conf is absent', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockReturnValue(null);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', PASSWORD));

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });

    it('falls through to /etc/passwd when virtual_users.conf does not list the target user', () => {
      const rolledPass = 'rolled-after-reset';
      const remoteUser = makeRemoteUser({ password: 'cache-stale' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) => {
        if (op.path === '/etc/vsftpd/virtual_users.conf')
          return `alice:${md5('alice-virtual-pass')}`;
        if (op.path === '/etc/passwd')
          return `bob:${md5(rolledPass)}:1001:1001:bob:/home/bob:/bin/bash`;
        return null;
      });

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', rolledPass));

      expect(opts.enterFtpMode).toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
    });

    it('accepts the virtual_users.conf password when it lists the target user', () => {
      const virtualPass = 'virtual-pass';
      const remoteUser = makeRemoteUser({ password: 'cache-stale' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) => {
        if (op.path === '/etc/vsftpd/virtual_users.conf') return `bob:${md5(virtualPass)}`;
        if (op.path === '/etc/passwd')
          return `bob:${md5('different-system-pass')}:1001:1001:bob:/home/bob:/bin/bash`;
        return null;
      });

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', virtualPass));

      expect(opts.enterFtpMode).toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('result', '230 Login successful.');
    });

    it('virtual_users.conf hash overrides /etc/passwd — system password is rejected', () => {
      const virtualPass = 'virtual-pass';
      const systemPass = 'system-pass';
      const remoteUser = makeRemoteUser({ password: 'cache-stale' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) => {
        if (op.path === '/etc/vsftpd/virtual_users.conf') return `bob:${md5(virtualPass)}`;
        if (op.path === '/etc/passwd')
          return `bob:${md5(systemPass)}:1001:1001:bob:/home/bob:/bin/bash`;
        return null;
      });

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', systemPass));

      expect(opts.enterFtpMode).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', '530 Login incorrect.');
    });
  });

  describe('FTP auth logging', () => {
    it('calls onFtpAuth on inline login success', () => {
      const remoteUser = makeRemoteUser();
      const onFtpAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', PASSWORD));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 21,
      });
    });

    it('calls onFtpAuth on inline user-not-found failure', () => {
      const onFtpAuth = vi.fn();
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'nobody', PASSWORD));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: false,
        user: 'nobody',
        targetIP: TARGET_IP,
        port: 21,
      });
    });

    it('calls onFtpAuth on inline wrong-password failure', () => {
      const remoteUser = makeRemoteUser();
      const onFtpAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.authenticateFtpInline(TARGET_IP, 'bob', 'wrong'));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 21,
      });
    });

    it('calls onFtpAuth on interactive login success', () => {
      const remoteUser = makeRemoteUser();
      const onFtpAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => result.current.handlePasswordSubmit(PASSWORD, vi.fn()));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 21,
      });
    });

    it('calls onFtpAuth on interactive username failure', () => {
      const onFtpAuth = vi.fn();
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('nobody', vi.fn()));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: false,
        user: 'nobody',
        targetIP: TARGET_IP,
        port: 21,
      });
    });

    it('calls onFtpAuth on interactive password failure', () => {
      const remoteUser = makeRemoteUser();
      const onFtpAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onFtpAuth }));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      act(() => result.current.handleFtpUsernameSubmit('bob', vi.fn()));
      act(() => result.current.handlePasswordSubmit('wrong', vi.fn()));

      expect(onFtpAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 21,
      });
    });
  });

  describe('SCP interactive authentication', () => {
    it('executes transfer immediately with authorized key', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const transfer = makeAsyncOutput();
      const performTransfer = vi.fn(() => transfer);

      const { result } = renderHook(() => useAuthentication(opts));

      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer,
        });
      });

      expect(output).toBe(transfer);
      expect(opts.addLine).toHaveBeenCalledWith('result', 'Authenticated with saved key.');
      expect(result.current.passwordMode).toBe(false);
    });

    it('prompts for password and executes transfer on success', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const transfer = makeAsyncOutput();
      const performTransfer = vi.fn(() => transfer);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => {
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer,
        });
      });
      expect(result.current.passwordMode).toBe(true);

      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(output).toBe(transfer);
      expect(performTransfer).toHaveBeenCalled();
      expect(result.current.passwordMode).toBe(false);
    });

    it('rejects incorrect SCP password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const performTransfer = vi.fn(() => makeAsyncOutput());

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => {
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer,
        });
      });
      act(() => {
        result.current.handlePasswordSubmit('wrong', vi.fn());
      });

      expect(performTransfer).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });

    it('reads /etc/passwd from the target — accepts a password that differs from the static users[].passwordHash (post password_reset)', () => {
      const newPassword = 'pwned-9012-user';
      const newHash = md5(newPassword);
      const remoteUser = makeRemoteUser({ password: 'original-pre-reset' });
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${newHash}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const transfer = makeAsyncOutput();
      const performTransfer = vi.fn(() => transfer);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => {
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer,
        });
      });
      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.handlePasswordSubmit(newPassword, vi.fn());
      });

      expect(output).toBe(transfer);
      expect(performTransfer).toHaveBeenCalled();
      expect(opts.addLine).not.toHaveBeenCalledWith(
        'error',
        'Permission denied, please try again.',
      );
    });

    it('rejects SCP password when /etc/passwd is unreadable, even if it matches the cache', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockReturnValue(null);

      const performTransfer = vi.fn(() => makeAsyncOutput());

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => {
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer,
        });
      });
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(performTransfer).not.toHaveBeenCalled();
      expect(opts.addLine).toHaveBeenCalledWith('error', 'Permission denied, please try again.');
    });
  });

  describe('SCP inline authentication', () => {
    it('executes transfer with authorized key', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const transfer = makeAsyncOutput();
      const performTransfer = vi.fn(() => transfer);

      const { result } = renderHook(() => useAuthentication(opts));

      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
          performTransfer,
        });
      });

      expect(output).toBe(transfer);
      expect(opts.addLine).toHaveBeenCalledWith('result', 'Authenticated with saved key.');
    });

    it('executes transfer with correct password and saves key', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const transfer = makeAsyncOutput();
      const performTransfer = vi.fn(() => transfer);

      const { result } = renderHook(() => useAuthentication(opts));

      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
          performTransfer,
        });
      });

      expect(output).toBe(transfer);
      expect(opts.createFile).toHaveBeenCalled();
    });

    it('returns undefined on incorrect password', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const performTransfer = vi.fn(() => makeAsyncOutput());

      const { result } = renderHook(() => useAuthentication(opts));

      let output: AsyncOutput | undefined;
      act(() => {
        output = result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'wrong',
          performTransfer,
        });
      });

      expect(output).toBeUndefined();
      expect(performTransfer).not.toHaveBeenCalled();
    });
  });

  describe('SCP auth logging', () => {
    it('calls onSshAuth on inline key auth for SCP', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'any',
          performTransfer: vi.fn(),
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'publickey',
      });
    });

    it('calls onSshAuth on inline password success for SCP', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
          performTransfer: vi.fn(),
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on inline password failure for SCP', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.authenticateScpInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: 'wrong',
          performTransfer: vi.fn(),
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on interactive key auth for SCP', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer: vi.fn(),
        }),
      );

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'publickey',
      });
    });

    it('calls onSshAuth on interactive password success for SCP', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFileFromMachine.mockImplementation((op: { path: string }) =>
        op.path === '/etc/passwd' ? `bob:${PASSWORD_HASH}:1001:1001:bob:/home/bob:/bin/bash` : null,
      );

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer: vi.fn(),
        }),
      );
      act(() => result.current.handlePasswordSubmit(PASSWORD, vi.fn()));

      expect(onSshAuth).toHaveBeenCalledWith({
        success: true,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });

    it('calls onSshAuth on interactive password failure for SCP', () => {
      const remoteUser = makeRemoteUser();
      const onSshAuth = vi.fn();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication({ ...opts, onSshAuth }));

      act(() =>
        result.current.startScpPrompt({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          performTransfer: vi.fn(),
        }),
      );
      act(() => result.current.handlePasswordSubmit('wrong', vi.fn()));

      expect(onSshAuth).toHaveBeenCalledWith({
        success: false,
        user: 'bob',
        targetIP: TARGET_IP,
        port: 22,
        method: 'password',
      });
    });
  });

  describe('SSH key persistence', () => {
    it('creates new key file when none exists', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
        }),
      );

      const expectedEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      expect(opts.createFile).toHaveBeenCalledWith('/home/alice/.ssh_keys', expectedEntry, 'user');
    });

    it('appends to existing key file with other entries', () => {
      const remoteUser = makeRemoteUser();
      const existingEntry = 'other@1.2.3.4:somefingerprint';
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? existingEntry : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
        }),
      );

      const expectedEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      expect(opts.writeFile).toHaveBeenCalledWith(
        '/home/alice/.ssh_keys',
        `${existingEntry}\n${expectedEntry}`,
        'user',
      );
    });

    it('skips writing when key already exists', () => {
      const remoteUser = makeRemoteUser();
      const keyEntry = makeKeyEntry('bob', TARGET_IP, PASSWORD_HASH);
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);
      opts.readFile.mockImplementation((path: string) =>
        path === '/home/alice/.ssh_keys' ? keyEntry : null,
      );

      const { result } = renderHook(() => useAuthentication(opts));

      // Key exists, so inline auth uses saved key — no write needed
      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: TARGET_IP,
          port: 22,
          password: PASSWORD,
        }),
      );

      expect(opts.createFile).not.toHaveBeenCalled();
      expect(opts.writeFile).not.toHaveBeenCalled();
    });
  });

  describe('NAT resolution', () => {
    it('resolves NAT before checking credentials', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.resolveNat.mockReturnValue({ ip: '10.0.0.99', port: 22 });
      opts.findMachineUsers.mockImplementation((ip: string) =>
        ip === '10.0.0.99' ? [remoteUser] : [],
      );

      const { result } = renderHook(() => useAuthentication(opts));

      act(() =>
        result.current.authenticateSshInline({
          user: 'bob',
          targetIP: '10.0.0.1',
          port: 22,
          password: PASSWORD,
        }),
      );

      expect(opts.resolveNat).toHaveBeenCalledWith('10.0.0.1', 22);
      expect(opts.pushSession).toHaveBeenCalled();
    });
  });

  describe('resetAuthState', () => {
    it('clears password and FTP username modes', () => {
      const opts = makeOptions();

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startFtpPrompt(TARGET_IP));
      expect(result.current.ftpUsernameMode).toBe(true);

      act(() => result.current.resetAuthState());

      expect(result.current.passwordMode).toBe(false);
      expect(result.current.ftpUsernameMode).toBe(false);
    });
  });

  describe('password masking', () => {
    it('displays masked password in terminal output', () => {
      const remoteUser = makeRemoteUser();
      const opts = makeOptions();
      opts.findMachineUsers.mockReturnValue([remoteUser]);

      const { result } = renderHook(() => useAuthentication(opts));

      act(() => result.current.startSshPrompt('bob', TARGET_IP, 22));
      act(() => {
        result.current.handlePasswordSubmit(PASSWORD, vi.fn());
      });

      expect(opts.addLine).toHaveBeenCalledWith(
        'command',
        '*'.repeat(PASSWORD.length),
        `bob@${TARGET_IP}'s password:`,
      );
    });
  });
});
