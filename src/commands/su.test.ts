import { describe, it, expect, vi } from 'vitest';
import { createSuCommand, type PasswordPromptData } from './su';
import { md5 } from '../utils/md5';
import type { UserType } from '../session/SessionContext';

// --- Factory Functions ---

type MockRemoteUser = {
  readonly username: string;
  readonly passwordHash: string;
  readonly userType: 'root' | 'user' | 'guest';
};

type SuContextConfig = {
  readonly users?: readonly string[];
  readonly passwdContent?: string | null;
  readonly machineUsers?: readonly MockRemoteUser[];
  readonly setUsername?: (username: string, userType: UserType) => void;
  readonly setCurrentPath?: (path: string) => void;
  readonly pushSession?: () => void;
  readonly onAuthResult?: (success: boolean, targetUser: string) => void;
};

const createMockSuContext = (config: SuContextConfig = {}) => {
  const {
    users = ['root', 'jshacker', 'guest'],
    passwdContent = null,
    machineUsers = [],
    setUsername = () => {},
    setCurrentPath = () => {},
    pushSession = () => {},
    onAuthResult,
  } = config;

  return {
    getUsers: () => users,
    readFile: () => passwdContent ?? null,
    findMachineUsers: () => machineUsers,
    setUsername,
    setCurrentPath,
    pushSession,
    onAuthResult,
  };
};

const isPasswordPromptData = (value: unknown): value is PasswordPromptData =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as PasswordPromptData).__type === 'password_prompt';

// --- Tests ---

describe('su command', () => {
  describe('successful user switch', () => {
    it('should return password prompt for valid user', () => {
      const context = createMockSuContext({
        users: ['root', 'admin'],
      });

      const su = createSuCommand(context);
      const result = su.fn('root');

      expect(isPasswordPromptData(result)).toBe(true);
      if (isPasswordPromptData(result)) {
        expect(result.__type).toBe('password_prompt');
        expect(result.targetUser).toBe('root');
      }
    });

    it('should accept any user from getUsers list', () => {
      const context = createMockSuContext({
        users: ['alice', 'bob', 'charlie'],
      });

      const su = createSuCommand(context);

      const result1 = su.fn('alice');
      const result2 = su.fn('bob');
      const result3 = su.fn('charlie');

      expect(isPasswordPromptData(result1)).toBe(true);
      expect(isPasswordPromptData(result2)).toBe(true);
      expect(isPasswordPromptData(result3)).toBe(true);
    });

    it('should set targetUser to requested username', () => {
      const context = createMockSuContext({
        users: ['testuser'],
      });

      const su = createSuCommand(context);
      const result = su.fn('testuser');

      if (isPasswordPromptData(result)) {
        expect(result.targetUser).toBe('testuser');
      }
    });
  });

  describe('error handling', () => {
    it('should throw error when no username given', () => {
      const context = createMockSuContext();
      const su = createSuCommand(context);

      expect(() => su.fn()).toThrow('su: missing username');
      expect(() => su.fn()).toThrow('Usage: su("username")');
    });

    it('should throw error when username is undefined', () => {
      const context = createMockSuContext();
      const su = createSuCommand(context);

      expect(() => su.fn(undefined)).toThrow('su: missing username');
    });

    it('should throw error for non-existent user', () => {
      const context = createMockSuContext({
        users: ['root', 'admin'],
      });

      const su = createSuCommand(context);

      expect(() => su.fn('nobody')).toThrow('su: user nobody does not exist');
    });

    it('should throw error when user list is empty', () => {
      const context = createMockSuContext({
        users: [],
      });

      const su = createSuCommand(context);

      expect(() => su.fn('root')).toThrow('su: user root does not exist');
    });
  });

  describe('dynamic user list', () => {
    it('should use users from context for localhost', () => {
      const context = createMockSuContext({
        users: ['root', 'jshacker', 'guest'],
      });

      const su = createSuCommand(context);

      expect(() => su.fn('jshacker')).not.toThrow();
      expect(() => su.fn('ftpuser')).toThrow('does not exist');
    });

    it('should use different users for remote machine', () => {
      const context = createMockSuContext({
        users: ['root', 'ftpuser'],
      });

      const su = createSuCommand(context);

      expect(() => su.fn('ftpuser')).not.toThrow();
      expect(() => su.fn('jshacker')).toThrow('does not exist');
    });
  });

  describe('programmatic authentication (with password)', () => {
    it('should return success message with correct password', () => {
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [{ username: 'root', passwordHash: md5('toor'), userType: 'root' }],
      });

      const su = createSuCommand(context);
      const result = su.fn('root', 'toor');

      expect(result).toBe('Switched to user: root');
    });

    it('should throw Authentication failure with wrong password', () => {
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
      });

      const su = createSuCommand(context);

      expect(() => su.fn('root', 'wrongpass')).toThrow('su: Authentication failure');
    });

    it('should call setUsername with correct userType from machineUsers', () => {
      const setUsername = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [{ username: 'root', passwordHash: md5('toor'), userType: 'root' }],
        setUsername,
      });

      const su = createSuCommand(context);
      su.fn('root', 'toor');

      expect(setUsername).toHaveBeenCalledWith('root', 'root');
    });

    it('should call setCurrentPath with /root for root user', () => {
      const setCurrentPath = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [{ username: 'root', passwordHash: md5('toor'), userType: 'root' }],
        setCurrentPath,
      });

      const su = createSuCommand(context);
      su.fn('root', 'toor');

      expect(setCurrentPath).toHaveBeenCalledWith('/root');
    });

    it('should call setCurrentPath with /home/username for non-root users', () => {
      const setCurrentPath = vi.fn();
      const context = createMockSuContext({
        users: ['guest'],
        passwdContent: `guest:${md5('guestpw')}`,
        machineUsers: [{ username: 'guest', passwordHash: md5('guestpw'), userType: 'guest' }],
        setCurrentPath,
      });

      const su = createSuCommand(context);
      su.fn('guest', 'guestpw');

      expect(setCurrentPath).toHaveBeenCalledWith('/home/guest');
    });

    it('should throw Authentication failure when /etc/passwd is unreadable', () => {
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: null,
      });

      const su = createSuCommand(context);

      expect(() => su.fn('root', 'toor')).toThrow('su: Authentication failure');
    });

    it('should still validate username exists before attempting auth', () => {
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
      });

      const su = createSuCommand(context);

      expect(() => su.fn('nobody', 'password')).toThrow('su: user nobody does not exist');
    });

    it('should fallback to name-based userType when user not in machineUsers', () => {
      const setUsername = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [],
        setUsername,
      });

      const su = createSuCommand(context);
      su.fn('root', 'toor');

      expect(setUsername).toHaveBeenCalledWith('root', 'root');
    });

    it('should fallback guest userType by name when not in machineUsers', () => {
      const setUsername = vi.fn();
      const context = createMockSuContext({
        users: ['guest'],
        passwdContent: `guest:${md5('pw')}`,
        machineUsers: [],
        setUsername,
      });

      const su = createSuCommand(context);
      su.fn('guest', 'pw');

      expect(setUsername).toHaveBeenCalledWith('guest', 'guest');
    });

    it('should fallback to user userType for unknown names not in machineUsers', () => {
      const setUsername = vi.fn();
      const context = createMockSuContext({
        users: ['alice'],
        passwdContent: `alice:${md5('pw')}`,
        machineUsers: [],
        setUsername,
      });

      const su = createSuCommand(context);
      su.fn('alice', 'pw');

      expect(setUsername).toHaveBeenCalledWith('alice', 'user');
    });

    it('should still return password prompt when no password given', () => {
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
      });

      const su = createSuCommand(context);
      const result = su.fn('root');

      expect(isPasswordPromptData(result)).toBe(true);
    });
  });

  describe('session stack (pushSession)', () => {
    it('should call pushSession before switching user with inline auth', () => {
      const callOrder: string[] = [];
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [{ username: 'root', passwordHash: md5('toor'), userType: 'root' }],
        pushSession: () => callOrder.push('push'),
        setUsername: () => callOrder.push('setUser'),
        setCurrentPath: () => callOrder.push('setPath'),
      });

      const su = createSuCommand(context);
      su.fn('root', 'toor');

      expect(callOrder).toEqual(['push', 'setUser', 'setPath']);
    });

    it('should not call pushSession on auth failure', () => {
      const pushSession = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        pushSession,
      });

      const su = createSuCommand(context);

      expect(() => su.fn('root', 'wrong')).toThrow('su: Authentication failure');
      expect(pushSession).not.toHaveBeenCalled();
    });

    it('should not call pushSession for interactive prompt path', () => {
      const pushSession = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        pushSession,
      });

      const su = createSuCommand(context);
      su.fn('root');

      expect(pushSession).not.toHaveBeenCalled();
    });
  });

  describe('auth logging callback', () => {
    it('should call onAuthResult with true on successful inline auth', () => {
      const onAuthResult = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        machineUsers: [{ username: 'root', passwordHash: md5('toor'), userType: 'root' }],
        onAuthResult,
      });

      const su = createSuCommand(context);
      su.fn('root', 'toor');

      expect(onAuthResult).toHaveBeenCalledWith(true, 'root');
    });

    it('should call onAuthResult with false on failed inline auth', () => {
      const onAuthResult = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        passwdContent: `root:${md5('toor')}`,
        onAuthResult,
      });

      const su = createSuCommand(context);

      expect(() => su.fn('root', 'wrong')).toThrow('su: Authentication failure');
      expect(onAuthResult).toHaveBeenCalledWith(false, 'root');
    });

    it('should not call onAuthResult for interactive prompt path', () => {
      const onAuthResult = vi.fn();
      const context = createMockSuContext({
        users: ['root'],
        onAuthResult,
      });

      const su = createSuCommand(context);
      su.fn('root');

      expect(onAuthResult).not.toHaveBeenCalled();
    });
  });
});
