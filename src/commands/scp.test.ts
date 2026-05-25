import { describe, it, expect, vi } from 'vitest';
import type { FileNode, FilePermissions, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';
import type { RemoteMachine } from '../network/types';
import type { AsyncOutput, AsyncFollowUp, ScpPromptData } from '../components/Terminal/types';
import { createScpCommand } from './scp';

const mkFile = (
  name: string,
  content: string,
  owner: UserType = 'root',
  permissions: FilePermissions = {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions,
  content,
});

const mkDir = (name: string, children: Record<string, FileNode> = {}): FileNode => ({
  name,
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children,
});

const remoteMachine: RemoteMachine = {
  ip: '192.168.1.50',
  hostname: 'fileserver',
  ports: [
    { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
    { port: 21, service: 'ftp', serviceVersion: 'latest', open: true },
  ],
  users: [
    { username: 'root', userType: 'root' },
    { username: 'ftpuser', userType: 'user' },
    { username: 'guest', userType: 'guest' },
  ],
};

const noSshMachine: RemoteMachine = {
  ip: '10.0.0.5',
  hostname: 'nossh',
  ports: [{ port: 80, service: 'http', serviceVersion: 'latest', open: true }],
  users: [{ username: 'guest', userType: 'guest' }],
};

type MockFs = Readonly<Record<string, FileNode | null>>;

const createContext = (
  overrides: {
    readonly localFs?: MockFs;
    readonly remoteFs?: MockFs;
    readonly machines?: readonly RemoteMachine[];
    readonly currentMachine?: string;
    readonly currentPath?: string;
    readonly createdFiles?: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[];
    readonly resolveNat?: (
      ip: string,
      port: number,
    ) => { readonly ip: string; readonly port: number };
  } = {},
) => {
  const localFs: MockFs = overrides.localFs ?? {
    '/usr/bin/nmap': mkFile('nmap', '\x7fELF'),
  };
  const remoteFs: MockFs = overrides.remoteFs ?? {};
  const machines = overrides.machines ?? [remoteMachine];
  const currentMachine = overrides.currentMachine ?? 'localhost';
  const currentPath = overrides.currentPath ?? '/root';
  const createdFiles = overrides.createdFiles ?? [];

  const resolveNat = overrides.resolveNat ?? ((ip: string, port: number) => ({ ip, port }));

  return createScpCommand({
    getMachine: (ip: string) => machines.find((m) => m.ip === ip),
    getLocalIP: () => '192.168.1.100',
    getCurrentMachine: () => currentMachine,
    getCurrentPath: () => currentPath,
    resolvePath: (path: string) => {
      if (path.startsWith('/')) return path;
      return currentPath === '/' ? `/${path}` : `${currentPath}/${path}`;
    },
    getNode: (path: string) => localFs[path] ?? null,
    getNodeFromMachine: (_machineId: string, path: string) => remoteFs[path] ?? null,
    createFileOnMachine: ({
      machineId,
      path,
      content,
      permissions,
    }: {
      readonly machineId: string;
      readonly path: string;
      readonly content: string;
      readonly permissions?: FilePermissions;
    }): PermissionResult => {
      createdFiles.push({ machineId, path, content, permissions });
      return { allowed: true };
    },
    resolveNat,
  });
};

const isScpPrompt = (value: unknown): value is ScpPromptData =>
  typeof value === 'object' &&
  value !== null &&
  '__type' in value &&
  (value as ScpPromptData).__type === 'scp_prompt';

// Runs an AsyncOutput to completion with fake timers, returning the ScpPromptData follow-up
const runAsync = (
  output: AsyncOutput,
): { readonly lines: readonly string[]; readonly followUp: ScpPromptData | undefined } => {
  const lines: string[] = [];
  let followUp: ScpPromptData | undefined;
  output.start(
    (line) => lines.push(line),
    (f?: AsyncFollowUp) => {
      if (isScpPrompt(f)) followUp = f;
    },
  );
  vi.runAllTimers();
  return { lines, followUp };
};

describe('scp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transfers file to remote machine', () => {
    const createdFiles: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[] = [];
    const scp = createContext({ createdFiles });
    const result = scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap') as AsyncOutput;

    expect(result.__type).toBe('async');
    const { followUp } = runAsync(result);

    expect(followUp).toBeDefined();
    expect(followUp?.targetUser).toBe('guest');
    expect(followUp?.targetIP).toBe('192.168.1.50');

    // Simulate successful password → perform the transfer (second async phase)
    const transferAsync = followUp!.performTransfer({ method: 'password', password: 'pw' });
    expect(transferAsync.__type).toBe('async');
    const transferLines = runAsync(transferAsync);

    expect(transferLines.lines.some((l) => l.includes('nmap'))).toBe(true);
    expect(transferLines.lines.some((l) => l.includes('100%'))).toBe(true);
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0]?.machineId).toBe('192.168.1.50');
    expect(createdFiles[0]?.path).toBe('/home/guest/nmap');
  });

  it('preserves source file permissions', () => {
    const customPerms: FilePermissions = {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'guest'],
    };
    const createdFiles: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[] = [];
    const scp = createContext({
      localFs: {
        '/usr/bin/nmap': mkFile('nmap', '\x7fELF', 'root', customPerms),
      },
      createdFiles,
    });
    const result = scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap') as AsyncOutput;
    const { followUp } = runAsync(result);
    const transferAsync = followUp!.performTransfer({ method: 'password', password: 'pw' });
    runAsync(transferAsync);

    expect(createdFiles[0]?.permissions).toEqual(customPerms);
  });

  it('appends source filename when destination is a directory', () => {
    const createdFiles: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[] = [];
    const scp = createContext({
      remoteFs: { '/home/guest': mkDir('guest') },
      createdFiles,
    });
    const result = scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest') as AsyncOutput;
    const { followUp } = runAsync(result);
    const transferAsync = followUp!.performTransfer({ method: 'password', password: 'pw' });
    runAsync(transferAsync);

    expect(createdFiles[0]?.path).toBe('/home/guest/nmap');
  });

  it('throws when source file does not exist', () => {
    const scp = createContext({ localFs: {} });
    expect(() => scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap')).toThrow(
      'No such file',
    );
  });

  it('throws when target machine has no SSH port', () => {
    const scp = createContext({ machines: [noSshMachine] });
    expect(() => scp.fn('/usr/bin/nmap', 'guest@10.0.0.5:/home/guest/nmap')).toThrow(
      'Connection refused',
    );
  });

  it('throws when target user does not exist', () => {
    const scp = createContext();
    expect(() => scp.fn('/usr/bin/nmap', 'nobody@192.168.1.50:/home/nobody/nmap')).toThrow(
      'Permission denied',
    );
  });

  it('throws when target machine is unknown', () => {
    const scp = createContext({ machines: [] });
    expect(() => scp.fn('/usr/bin/nmap', 'guest@10.99.99.99:/tmp/nmap')).toThrow(
      'Connection refused',
    );
  });

  it('throws with missing arguments', () => {
    const scp = createContext();
    expect(() => scp.fn()).toThrow('missing operand');
    expect(() => scp.fn('/usr/bin/nmap')).toThrow('missing operand');
  });

  it('throws with invalid destination format', () => {
    const scp = createContext();
    expect(() => scp.fn('/usr/bin/nmap', '/some/local/path')).toThrow('invalid destination');
  });

  it('throws when source is a directory', () => {
    const scp = createContext({
      localFs: {
        '/home': mkDir('home'),
      },
    });
    expect(() => scp.fn('/home', 'guest@192.168.1.50:/tmp/home')).toThrow('Is a directory');
  });

  it('throws when trying to scp to localhost', () => {
    const scp = createContext();
    expect(() => scp.fn('/usr/bin/nmap', 'guest@192.168.1.100:/tmp/nmap')).toThrow(
      'cannot copy to localhost',
    );
  });

  it('uses explicit port for NAT resolution when provided', () => {
    const routerMachine: RemoteMachine = {
      ip: '185.13.117.85',
      hostname: 'router01',
      ports: [
        { port: 22, service: 'ssh', serviceVersion: 'latest', open: true },
        { port: 25, service: 'smtp', serviceVersion: 'latest', open: true },
      ],
      users: [
        { username: 'guest', userType: 'guest' },
        { username: 'root', userType: 'root' },
      ],
    };
    const createdFiles: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[] = [];
    const scp = createContext({
      machines: [routerMachine],
      createdFiles,
      resolveNat: (ip, port) =>
        ip === '185.13.117.85' && port === 25 ? { ip: '10.0.0.10', port: 22 } : { ip, port },
    });
    const result = scp.fn('/usr/bin/nmap', 'guest@185.13.117.85:/home/guest', 25) as AsyncOutput;
    const { followUp } = runAsync(result);

    expect(followUp?.targetPort).toBe(25);

    const transferAsync = followUp!.performTransfer({ method: 'password', password: 'pw' });
    runAsync(transferAsync);

    // File is created on the internal machine behind port 25, not the router
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0]?.machineId).toBe('10.0.0.10');
  });

  it('throws when explicit port is not open', () => {
    const scp = createContext();
    expect(() => scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap', 9999)).toThrow(
      'Connection refused',
    );
  });

  it('throws when explicit port is invalid', () => {
    const scp = createContext();
    expect(() => scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap', 0)).toThrow(
      'invalid port',
    );
    expect(() => scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap', 99999)).toThrow(
      'invalid port',
    );
  });

  it('resolves NAT to write file on internal machine', () => {
    const routerMachine: RemoteMachine = {
      ip: '45.33.100.1',
      hostname: 'router01',
      ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
      users: [{ username: 'guest', userType: 'guest' }],
    };
    const createdFiles: {
      machineId: string;
      path: string;
      content: string;
      permissions?: FilePermissions;
    }[] = [];
    const scp = createContext({
      machines: [routerMachine],
      createdFiles,
      resolveNat: (ip, port) =>
        ip === '45.33.100.1' && port === 22 ? { ip: '10.0.0.10', port: 22 } : { ip, port },
    });
    const result = scp.fn('/usr/bin/nmap', 'guest@45.33.100.1:/tmp/nmap') as AsyncOutput;
    const { followUp } = runAsync(result);

    // Follow-up still shows the public IP for display
    expect(followUp?.targetIP).toBe('45.33.100.1');

    const transferAsync = followUp!.performTransfer({ method: 'password', password: 'pw' });
    runAsync(transferAsync);

    // File is created on the internal machine, not the router
    expect(createdFiles).toHaveLength(1);
    expect(createdFiles[0]?.machineId).toBe('10.0.0.10');
  });

  describe('programmatic authentication (with password)', () => {
    it('should include password in ScpPromptData when 3rd arg is string', () => {
      const scp = createContext();
      const result = scp.fn(
        '/usr/bin/nmap',
        'guest@192.168.1.50:/home/guest/nmap',
        'secret',
      ) as AsyncOutput;
      const { followUp } = runAsync(result);

      expect(followUp).toBeDefined();
      expect(followUp?.targetUser).toBe('guest');
      expect((followUp as ScpPromptData & { readonly password?: string }).password).toBe('secret');
    });

    it('should include password in ScpPromptData when 4th arg after port', () => {
      const scp = createContext();
      const result = scp.fn(
        '/usr/bin/nmap',
        'guest@192.168.1.50:/home/guest/nmap',
        22,
        'secret',
      ) as AsyncOutput;
      const { followUp } = runAsync(result);

      expect(followUp).toBeDefined();
      expect(followUp?.targetPort).toBe(22);
      expect((followUp as ScpPromptData & { readonly password?: string }).password).toBe('secret');
    });

    it('should auto-detect port when 3rd arg is password string', () => {
      const scp = createContext();
      const result = scp.fn(
        '/usr/bin/nmap',
        'guest@192.168.1.50:/home/guest/nmap',
        'secret',
      ) as AsyncOutput;
      const { followUp } = runAsync(result);

      expect(followUp?.targetPort).toBe(22);
    });

    it('should not include password when no password given', () => {
      const scp = createContext();
      const result = scp.fn('/usr/bin/nmap', 'guest@192.168.1.50:/home/guest/nmap') as AsyncOutput;
      const { followUp } = runAsync(result);

      expect(followUp).toBeDefined();
      expect((followUp as ScpPromptData & { readonly password?: string }).password).toBeUndefined();
    });

    it('should not include password when only port is given', () => {
      const scp = createContext();
      const result = scp.fn(
        '/usr/bin/nmap',
        'guest@192.168.1.50:/home/guest/nmap',
        22,
      ) as AsyncOutput;
      const { followUp } = runAsync(result);

      expect(followUp).toBeDefined();
      expect((followUp as ScpPromptData & { readonly password?: string }).password).toBeUndefined();
    });
  });

  describe('cross-LAN async pre-resolve', () => {
    // Mirrors ssh.ts's findMachineByIpAsync fallback. When the player
    // types `scp <local> <user>@<foreign public IP>:<path>` to copy to
    // another player's workstation via NAT-forward, the command awaits
    // findMachineByIpAsync to materialize the foreign network before
    // validating the port + user and dispatching the SCP prompt.

    const createForeignContext = (
      foreignMachine: RemoteMachine | undefined,
      overrides: { readonly createdFiles?: Parameters<typeof createContext>[0] } = {},
    ) => {
      const findMachineByIpAsync = vi.fn(async (ip: string) =>
        foreignMachine && foreignMachine.ip === ip ? foreignMachine : undefined,
      );
      const machines = foreignMachine ? [foreignMachine] : [];
      const localFs = { '/usr/bin/nmap': mkFile('nmap', '\x7fELF') };

      const cmd = createScpCommand({
        getMachine: () => undefined,
        findMachineByIpAsync,
        getLocalIP: () => '192.168.1.100',
        getCurrentMachine: () => 'localhost',
        getCurrentPath: () => '/root',
        resolvePath: (path: string) => (path.startsWith('/') ? path : `/root/${path}`),
        getNode: (path: string) => localFs[path as keyof typeof localFs] ?? null,
        getNodeFromMachine: () => null,
        createFileOnMachine: ({
          machineId,
          path,
          content,
          permissions,
        }: {
          readonly machineId: string;
          readonly path: string;
          readonly content: string;
          readonly permissions?: FilePermissions;
        }): PermissionResult => {
          overrides.createdFiles?.createdFiles?.push({ machineId, path, content, permissions });
          return { allowed: true };
        },
        resolveNat: (ip: string, port: number) => ({ ip, port }),
      });

      return { cmd, findMachineByIpAsync, machines };
    };

    // Async variant of runAsync — drains both microtasks (Promise
    // resolutions) and timers. Required for the async-pre-resolve path
    // because findMachineByIpAsync is awaited via Promise inside start().
    const runAsyncAwait = async (
      output: AsyncOutput,
    ): Promise<{
      readonly lines: readonly string[];
      readonly followUp: ScpPromptData | undefined;
    }> => {
      const lines: string[] = [];
      let followUp: ScpPromptData | undefined;
      output.start(
        (line) => lines.push(line),
        (f?: AsyncFollowUp) => {
          if (isScpPrompt(f)) followUp = f;
        },
      );
      await vi.runAllTimersAsync();
      return { lines, followUp };
    };

    it('falls back to findMachineByIpAsync when sync getMachine misses', async () => {
      const foreignMachine: RemoteMachine = {
        ip: '203.0.113.42',
        hostname: 'foreign-router',
        ports: [
          {
            port: 2222,
            service: 'ssh',
            serviceVersion: 'latest',
            open: true,
            // Forwarded port - simulates B's iptables forward
            forwarded: true,
          },
        ],
        // Foreign router merged view excludes occupant users by design.
        users: [],
      };
      const { cmd, findMachineByIpAsync } = createForeignContext(foreignMachine);

      const result = cmd.fn('/usr/bin/nmap', 'guest@203.0.113.42:/tmp/nmap', 2222) as AsyncOutput;
      expect(result.__type).toBe('async');

      const { followUp } = await runAsyncAwait(result);

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.42');
      expect(followUp).toBeDefined();
      expect(followUp?.targetUser).toBe('guest');
      expect(followUp?.targetIP).toBe('203.0.113.42');
      expect(followUp?.targetPort).toBe(2222);
    });

    it('skips user pre-check for forwarded ports — cross-LAN bellwether', async () => {
      // Critical: the merged router view excludes the forwarded target's
      // users (anti-leak), so the local pre-check would spuriously fail.
      // Server's authCreateSession is authority for user existence.
      const foreignMachine: RemoteMachine = {
        ip: '203.0.113.42',
        hostname: 'foreign-router',
        ports: [
          {
            port: 2222,
            service: 'ssh',
            serviceVersion: 'latest',
            open: true,
            forwarded: true,
          },
        ],
        users: [], // No users on the merged view — would normally throw
      };
      const { cmd } = createForeignContext(foreignMachine);

      const result = cmd.fn('/usr/bin/nmap', 'alice@203.0.113.42:/tmp/nmap', 2222) as AsyncOutput;

      const { followUp } = await runAsyncAwait(result);

      // Despite empty users + 'alice' not in machine.users, the prompt
      // still fires because targetPort.forwarded === true.
      expect(followUp).toBeDefined();
      expect(followUp?.targetUser).toBe('alice');
    });

    it('emits Connection refused via onLine when async resolver returns undefined', async () => {
      const { cmd, findMachineByIpAsync } = createForeignContext(undefined);

      const result = cmd.fn('/usr/bin/nmap', 'guest@203.0.113.99:/tmp/nmap', 2222) as AsyncOutput;
      const { lines } = await runAsyncAwait(result);

      expect(findMachineByIpAsync).toHaveBeenCalledWith('203.0.113.99');
      expect(lines.some((l) => l.includes('Connection refused'))).toBe(true);
    });

    it('does NOT call findMachineByIpAsync when sync getMachine hits', () => {
      const findMachineByIpAsync = vi.fn(async () => undefined);
      const cmd = createScpCommand({
        getMachine: () => remoteMachine,
        findMachineByIpAsync,
        getLocalIP: () => '192.168.1.100',
        getCurrentMachine: () => 'localhost',
        getCurrentPath: () => '/root',
        resolvePath: (path: string) => (path.startsWith('/') ? path : `/root/${path}`),
        getNode: () => mkFile('nmap', '\x7fELF'),
        getNodeFromMachine: () => null,
        createFileOnMachine: () => ({ allowed: true }),
        resolveNat: (ip: string, port: number) => ({ ip, port }),
      });

      cmd.fn('/usr/bin/nmap', 'guest@192.168.1.50:/tmp/nmap');

      expect(findMachineByIpAsync).not.toHaveBeenCalled();
    });

    it('throws synchronously on sync miss when findMachineByIpAsync is omitted (legacy)', () => {
      const scp = createContext({ machines: [] });
      expect(() => scp.fn('/usr/bin/nmap', 'guest@10.0.0.1:/tmp/nmap')).toThrow(
        'Connection refused',
      );
    });

    it('still enforces user pre-check on non-forwarded ports', () => {
      // Regression guard: the forwarded-port skip MUST NOT bypass the
      // pre-check for normal LAN-internal targets. machine.users.find
      // returning undefined still throws Permission denied for non-
      // forwarded ports.
      const lanMachine: RemoteMachine = {
        ip: '192.168.1.50',
        hostname: 'lan-server',
        ports: [{ port: 22, service: 'ssh', serviceVersion: 'latest', open: true }],
        users: [{ username: 'root', userType: 'root' }],
      };
      const cmd = createScpCommand({
        getMachine: () => lanMachine,
        findMachineByIpAsync: vi.fn(async () => undefined),
        getLocalIP: () => '192.168.1.100',
        getCurrentMachine: () => 'localhost',
        getCurrentPath: () => '/root',
        resolvePath: (path: string) => (path.startsWith('/') ? path : `/root/${path}`),
        getNode: () => mkFile('nmap', '\x7fELF'),
        getNodeFromMachine: () => null,
        createFileOnMachine: () => ({ allowed: true }),
        resolveNat: (ip: string, port: number) => ({ ip, port }),
      });

      expect(() => cmd.fn('/usr/bin/nmap', 'nobody@192.168.1.50:/tmp/nmap')).toThrow(
        'Permission denied',
      );
    });
  });
});
