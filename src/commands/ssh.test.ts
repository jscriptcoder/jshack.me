import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput, SshPromptData } from '../components/Terminal/types';
import { createSshCommand } from './ssh';

// --- Factory Functions ---

const getMockRemoteMachine = (overrides?: Partial<RemoteMachine>): RemoteMachine => ({
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [{ port: 22, service: 'ssh', open: true }],
  users: [{ username: 'root', passwordHash: 'abc123', userType: 'root' }],
  ...overrides,
});

type SshContextConfig = {
  readonly machines?: readonly RemoteMachine[];
  readonly localIP?: string;
};

const createMockSshContext = (config: SshContextConfig = {}) => {
  const { machines = [], localIP = '192.168.1.100' } = config;

  return {
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => localIP,
  };
};

const isAsyncOutput = (value: unknown): value is AsyncOutput =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as AsyncOutput).__type === 'async';

const isSshPrompt = (value: unknown): value is SshPromptData =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as SshPromptData).__type === 'ssh_prompt';

// --- Tests ---

describe('ssh command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('error handling', () => {
    it('should throw error when no argument given', () => {
      const context = createMockSshContext();
      const ssh = createSshCommand(context);

      expect(() => ssh.fn()).toThrow('ssh: missing destination');
    });

    it('should throw error with invalid format (no @)', () => {
      const context = createMockSshContext();
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin')).toThrow("ssh: invalid destination: 'admin'");
    });

    it('should throw error when connecting to localhost IP', () => {
      const context = createMockSshContext({ localIP: '192.168.1.100' });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('user@192.168.1.100')).toThrow(
        'ssh: cannot connect to localhost via SSH',
      );
    });

    it('should throw error when connecting to 127.0.0.1', () => {
      const context = createMockSshContext();
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('user@127.0.0.1')).toThrow('ssh: cannot connect to localhost via SSH');
    });

    it('should throw error when connecting to localhost hostname', () => {
      const context = createMockSshContext();
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('user@localhost')).toThrow('ssh: cannot connect to localhost via SSH');
    });

    it('should throw error when machine does not exist', () => {
      const context = createMockSshContext({ machines: [] });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@10.0.0.1')).toThrow(
        'ssh: connect to host 10.0.0.1 port 22: Connection refused',
      );
    });

    it('should throw error when SSH port is not open', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 80, service: 'http', open: true }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@192.168.1.50')).toThrow(
        'ssh: connect to host 192.168.1.50 port 22: Connection refused',
      );
    });

    it('should throw error when SSH port exists but is closed', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: false }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@192.168.1.50')).toThrow(
        'ssh: connect to host 192.168.1.50 port 22: Connection refused',
      );
    });

    it('should throw error when user does not exist on remote machine', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'root', passwordHash: 'abc', userType: 'root' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('nobody@192.168.1.50')).toThrow(
        'ssh: nobody@192.168.1.50: Permission denied (publickey,password)',
      );
    });
  });

  describe('async output structure', () => {
    it('should return AsyncOutput object', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      const result = ssh.fn('admin@192.168.1.50');

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should have start function', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      const result = ssh.fn('admin@192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.start).toBe('function');
      }
    });

    it('should have cancel function', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      const result = ssh.fn('admin@192.168.1.50');

      if (isAsyncOutput(result)) {
        expect(typeof result.cancel).toBe('function');
      }
    });
  });

  describe('connection execution', () => {
    it('should output connecting message immediately', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      expect(lines[0]).toBe('Connecting to 192.168.1.50...');
    });

    it('should output SSH version after first delay', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Advance past max jitter range (SSH_CONNECT_DELAY_MS = 800)
      vi.advanceTimersByTime(1200);

      expect(lines.some((l) => l.includes('SSH-2.0-OpenSSH'))).toBe(true);
    });

    it('should output authenticating message after handshake delay', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );
      }

      // Fast-forward both delays (800 + 600 = 1400ms, ×1.5 for jitter)
      vi.advanceTimersByTime(2100);

      expect(lines.some((l) => l.includes('Authenticating as admin'))).toBe(true);
    });

    it('should complete with SSH prompt data for password mode', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      // Fast-forward to completion
      vi.advanceTimersByTime(2100);

      expect(isSshPrompt(followUp)).toBe(true);
      if (isSshPrompt(followUp)) {
        expect(followUp.targetUser).toBe('admin');
        expect(followUp.targetIP).toBe('192.168.1.50');
      }
    });

    it('should include correct user in SSH prompt', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [
              { username: 'root', passwordHash: 'abc', userType: 'root' },
              { username: 'guest', passwordHash: 'def', userType: 'guest' },
            ],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('root@192.168.1.50');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(2100);

      if (isSshPrompt(followUp)) {
        expect(followUp.targetUser).toBe('root');
      }
    });
  });

  describe('custom port parameter', () => {
    it('should connect on specified port', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 2222, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      const result = ssh.fn('admin@192.168.1.50', 2222);

      expect(isAsyncOutput(result)).toBe(true);
    });

    it('should refuse connection when specified port is closed', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [
              { port: 22, service: 'ssh', open: true },
              { port: 2222, service: 'ssh', open: false },
            ],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@192.168.1.50', 2222)).toThrow(
        'ssh: connect to host 192.168.1.50 port 2222: Connection refused',
      );
    });

    it('should refuse connection when specified port does not exist', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@192.168.1.50', 9999)).toThrow(
        'ssh: connect to host 192.168.1.50 port 9999: Connection refused',
      );
    });

    it('should throw error for invalid port value', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);

      expect(() => ssh.fn('admin@192.168.1.50', 'abc')).toThrow('ssh: invalid port');
    });

    it('should include specified port in SshPromptData', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 2222, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50', 2222);

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(2100);

      if (isSshPrompt(followUp)) {
        expect(followUp.targetPort).toBe(2222);
      }
    });

    it('should default to port 22 in SshPromptData when port not given', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      let followUp: unknown = null;
      if (isAsyncOutput(result)) {
        result.start(
          () => {},
          (data) => {
            followUp = data;
          },
        );
      }

      vi.advanceTimersByTime(2100);

      if (isSshPrompt(followUp)) {
        expect(followUp.targetPort).toBe(22);
      }
    });
  });

  describe('cancellation', () => {
    it('should cancel before SSH version output', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      const lines: string[] = [];
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {},
        );

        // Cancel before first delay completes
        vi.advanceTimersByTime(400);
        result.cancel?.();
        vi.advanceTimersByTime(3000);
      }

      // Should only have connecting message
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('Connecting to 192.168.1.50...');
    });

    it('should cancel before authentication prompt', () => {
      const context = createMockSshContext({
        machines: [
          getMockRemoteMachine({
            ip: '192.168.1.50',
            ports: [{ port: 22, service: 'ssh', open: true }],
            users: [{ username: 'admin', passwordHash: 'abc', userType: 'user' }],
          }),
        ],
      });
      const ssh = createSshCommand(context);
      const result = ssh.fn('admin@192.168.1.50');

      const lines: string[] = [];
      let completed = false;
      if (isAsyncOutput(result)) {
        result.start(
          (line) => lines.push(line),
          () => {
            completed = true;
          },
        );

        // Advance past first delay max jitter (800 × 1.25 = 1000), then cancel before auth
        vi.advanceTimersByTime(1001);
        result.cancel?.();
        vi.advanceTimersByTime(3000);
      }

      // Should have connecting and SSH version, but not authentication
      expect(lines.some((l) => l.includes('Authenticating'))).toBe(false);
      expect(completed).toBe(false);
    });
  });
});
