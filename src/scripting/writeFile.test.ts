import { describe, it, expect, vi } from 'vitest';
import type { FileNode, PermissionResult } from '../filesystem/types';
import type { UserType } from '../session/types';
import { createWriteFile } from './writeFile';

type ContextConfig = {
  readonly userType?: UserType;
  readonly files?: Readonly<Record<string, FileNode | null>>;
  readonly createFileResult?: PermissionResult;
  readonly writeFileResult?: PermissionResult;
};

const createMockFile = (name: string, content: string): FileNode => ({
  name,
  type: 'file',
  owner: 'user',
  permissions: {
    read: ['root', 'user'],
    write: ['root', 'user'],
    execute: ['root'],
  },
  content,
});

const createMockContext = (config: ContextConfig = {}) => {
  const {
    userType = 'user',
    files = {},
    createFileResult = { allowed: true },
    writeFileResult = { allowed: true },
  } = config;

  const createFile = vi.fn().mockReturnValue(createFileResult);
  const writeFile = vi.fn().mockReturnValue(writeFileResult);

  return {
    context: {
      resolvePath: (path: string) => (path.startsWith('/') ? path : `/${path}`),
      getNode: (path: string) => files[path] ?? null,
      getUserType: () => userType,
      createFile,
      writeFile,
    },
    mocks: { createFile, writeFile },
  };
};

describe('writeFile scripting helper', () => {
  describe('create vs overwrite', () => {
    it('creates a new file when path does not exist', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/new.txt', 'hello');

      expect(mocks.createFile).toHaveBeenCalledWith('/tmp/new.txt', 'hello', 'user');
      expect(mocks.writeFile).not.toHaveBeenCalled();
    });

    it('overwrites an existing file via writeFile', () => {
      const existing = createMockFile('existing.txt', 'old');
      const { context, mocks } = createMockContext({
        files: { '/tmp/existing.txt': existing },
      });
      const writeFile = createWriteFile(context);

      writeFile('/tmp/existing.txt', 'new content');

      expect(mocks.writeFile).toHaveBeenCalledWith('/tmp/existing.txt', 'new content', 'user');
      expect(mocks.createFile).not.toHaveBeenCalled();
    });

    it('resolves relative paths against the current working directory', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('out.txt', 'data');

      // resolvePath in the mock prefixes with '/'
      expect(mocks.createFile).toHaveBeenCalledWith('out.txt', 'data', 'user');
    });
  });

  describe('content stringification', () => {
    it('writes strings unchanged', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/a.txt', 'raw string');

      expect(mocks.createFile).toHaveBeenCalledWith('/tmp/a.txt', 'raw string', 'user');
    });

    it('stringifies numbers', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/n.txt', 42);

      expect(mocks.createFile).toHaveBeenCalledWith('/tmp/n.txt', '42', 'user');
    });

    it('pretty-prints objects as JSON', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/o.json', { key: 'value' });

      expect(mocks.createFile).toHaveBeenCalledWith(
        '/tmp/o.json',
        '{\n  "key": "value"\n}',
        'user',
      );
    });

    it('writes arrays of strings joined with newlines', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/lines.txt', ['line 1', 'line 2', 'line 3']);

      // Arrays of strings are the natural return shape of `await asyncCmd()`
      // in scripts, so joining with '\n' makes the common case frictionless.
      expect(mocks.createFile).toHaveBeenCalledWith(
        '/tmp/lines.txt',
        'line 1\nline 2\nline 3',
        'user',
      );
    });

    it('stringifies null and undefined', () => {
      const { context, mocks } = createMockContext();
      const writeFile = createWriteFile(context);

      writeFile('/tmp/a.txt', null);
      writeFile('/tmp/b.txt', undefined);

      expect(mocks.createFile).toHaveBeenNthCalledWith(1, '/tmp/a.txt', 'null', 'user');
      expect(mocks.createFile).toHaveBeenNthCalledWith(2, '/tmp/b.txt', 'undefined', 'user');
    });
  });

  describe('permissions', () => {
    it('throws when create is denied', () => {
      const { context } = createMockContext({
        createFileResult: { allowed: false, error: 'Permission denied: /root/secret.txt' },
      });
      const writeFile = createWriteFile(context);

      expect(() => writeFile('/root/secret.txt', 'x')).toThrow(
        'writeFile: Permission denied: /root/secret.txt',
      );
    });

    it('throws when write is denied', () => {
      const existing = createMockFile('locked.txt', 'x');
      const { context } = createMockContext({
        files: { '/locked.txt': existing },
        writeFileResult: { allowed: false, error: 'Permission denied: /locked.txt' },
      });
      const writeFile = createWriteFile(context);

      expect(() => writeFile('/locked.txt', 'y')).toThrow(
        'writeFile: Permission denied: /locked.txt',
      );
    });

    it('uses the current user type when writing', () => {
      const { context, mocks } = createMockContext({ userType: 'root' });
      const writeFile = createWriteFile(context);

      writeFile('/etc/conf', 'data');

      expect(mocks.createFile).toHaveBeenCalledWith('/etc/conf', 'data', 'root');
    });
  });

  describe('input validation', () => {
    it('throws when path is empty', () => {
      const { context } = createMockContext();
      const writeFile = createWriteFile(context);

      expect(() => writeFile('', 'x')).toThrow('writeFile: missing path');
    });
  });
});
