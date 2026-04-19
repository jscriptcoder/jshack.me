import { describe, it, expect, vi } from 'vitest';
import type { UserType } from '../session/SessionContext';
import type { PermissionResult } from '../filesystem/types';
import { createMkdirCommand } from './mkdir';

type MockConfig = {
  readonly userType?: UserType;
  readonly createDirectory?: (
    path: string,
    userType: UserType,
    options?: { readonly parents?: boolean },
  ) => PermissionResult;
};

const createMockContext = (config: MockConfig = {}) => {
  const { userType = 'user', createDirectory } = config;
  const fn = createDirectory ?? vi.fn((): PermissionResult => ({ allowed: true }));
  const mock = vi.fn(fn);
  return {
    context: {
      getUserType: () => userType,
      createDirectory: mock,
    },
    createDirectory: mock,
  };
};

describe('mkdir command', () => {
  describe('happy path', () => {
    it('creates a single directory', () => {
      const { context, createDirectory } = createMockContext();
      const mkdir = createMkdirCommand(context);

      mkdir.fn('/tmp/newdir');

      expect(createDirectory).toHaveBeenCalledWith(
        '/tmp/newdir',
        'user',
        expect.objectContaining({ parents: false }),
      );
    });

    it('creates nested directories with -p', () => {
      const { context, createDirectory } = createMockContext();
      const mkdir = createMkdirCommand(context);

      mkdir.fn('-p', '/tmp/a/b/c');

      expect(createDirectory).toHaveBeenCalledWith(
        '/tmp/a/b/c',
        'user',
        expect.objectContaining({ parents: true }),
      );
    });

    it('accepts -p before, between, or after paths', () => {
      const { context: c1, createDirectory: fn1 } = createMockContext();
      createMkdirCommand(c1).fn('-p', '/a', '/b');
      expect(fn1).toHaveBeenCalledTimes(2);
      expect(fn1.mock.calls[0][2]).toMatchObject({ parents: true });
      expect(fn1.mock.calls[1][2]).toMatchObject({ parents: true });

      const { context: c2, createDirectory: fn2 } = createMockContext();
      createMkdirCommand(c2).fn('/a', '-p', '/b');
      expect(fn2).toHaveBeenCalledTimes(2);
      expect(fn2.mock.calls.every((c) => (c[2] as { parents?: boolean }).parents)).toBe(true);

      const { context: c3, createDirectory: fn3 } = createMockContext();
      createMkdirCommand(c3).fn('/a', '/b', '-p');
      expect(fn3.mock.calls.every((c) => (c[2] as { parents?: boolean }).parents)).toBe(true);
    });

    it('creates multiple directories in a single call', () => {
      const { context, createDirectory } = createMockContext();
      const mkdir = createMkdirCommand(context);

      mkdir.fn('/tmp/a', '/tmp/b', '/tmp/c');

      expect(createDirectory).toHaveBeenCalledTimes(3);
      expect(createDirectory.mock.calls.map((c) => c[0])).toEqual(['/tmp/a', '/tmp/b', '/tmp/c']);
    });

    it('returns empty string on success', () => {
      const { context } = createMockContext();
      const mkdir = createMkdirCommand(context);

      const result = mkdir.fn('/tmp/newdir');

      expect(result).toBe('');
    });
  });

  describe('error handling', () => {
    it('throws on missing operand', () => {
      const { context } = createMockContext();
      const mkdir = createMkdirCommand(context);

      expect(() => mkdir.fn()).toThrow('mkdir: missing operand');
      expect(() => mkdir.fn('-p')).toThrow('mkdir: missing operand');
    });

    it('throws when createDirectory denies a single path', () => {
      const { context } = createMockContext({
        createDirectory: () => ({
          allowed: false,
          error: "mkdir: cannot create directory '/etc/foo': Permission denied",
        }),
      });
      const mkdir = createMkdirCommand(context);

      expect(() => mkdir.fn('/etc/foo')).toThrow(
        "mkdir: cannot create directory '/etc/foo': Permission denied",
      );
    });

    it('throws on unknown flag', () => {
      const { context } = createMockContext();
      const mkdir = createMkdirCommand(context);

      expect(() => mkdir.fn('-z', '/tmp/foo')).toThrow("mkdir: invalid option -- 'z'");
    });

    it('continues walking when one path in a batch fails', () => {
      const calls: string[] = [];
      const { context, createDirectory } = createMockContext({
        createDirectory: (path) => {
          calls.push(path);
          if (path === '/bad') {
            return {
              allowed: false,
              error: "mkdir: cannot create directory '/bad': Permission denied",
            };
          }
          return { allowed: true };
        },
      });
      const mkdir = createMkdirCommand(context);

      expect(() => mkdir.fn('/good', '/bad', '/also-good')).toThrow(/Permission denied/);

      expect(calls).toEqual(['/good', '/bad', '/also-good']);
      expect(createDirectory).toHaveBeenCalledTimes(3);
    });

    it('joins multiple errors with newlines', () => {
      const { context } = createMockContext({
        createDirectory: (path) => ({
          allowed: false,
          error: `mkdir: cannot create directory '${path}': Permission denied`,
        }),
      });
      const mkdir = createMkdirCommand(context);

      let thrown: unknown;
      try {
        mkdir.fn('/a', '/b');
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      const message = (thrown as Error).message;
      expect(message.split('\n')).toHaveLength(2);
      expect(message).toContain('/a');
      expect(message).toContain('/b');
    });
  });

  describe('user context', () => {
    it('passes the current user type to createDirectory', () => {
      const { context, createDirectory } = createMockContext({ userType: 'root' });
      const mkdir = createMkdirCommand(context);

      mkdir.fn('/tmp/rootdir');

      expect(createDirectory).toHaveBeenCalledWith('/tmp/rootdir', 'root', expect.anything());
    });
  });
});
