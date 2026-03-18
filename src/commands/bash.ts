import type { Command } from '../components/Terminal/types';
import type { FileNode } from '../filesystem/types';
import type { UserType } from '../session/SessionContext';

export type BashAdapter = {
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly findCommand: (name: string) => ((...args: unknown[]) => unknown) | undefined;
};

// Core logic shared by NC shell and regular terminal. Resolves a filesystem
// path to an executable binary, checks permissions, and delegates to the
// corresponding game command.
export const executeBash = (adapter: BashAdapter, binaryPath: string, args: readonly unknown[]) => {
  const node = adapter.getNode(binaryPath);
  if (!node) throw new Error(`bash: ${binaryPath}: No such file or directory`);
  if (node.type !== 'file') throw new Error(`bash: ${binaryPath}: Is a directory`);

  const userType = adapter.getUserType();
  if (userType !== 'root' && !node.permissions.execute.includes(userType)) {
    throw new Error(`bash: ${binaryPath}: Permission denied`);
  }

  const binaryName = binaryPath.split('/').pop() ?? '';
  const commandFn = adapter.findCommand(binaryName);
  if (!commandFn) throw new Error(`bash: ${binaryPath}: cannot execute binary file`);

  return commandFn(...args);
};

export type BashContext = {
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly getExecutionContext: () => Record<string, (...args: unknown[]) => unknown>;
};

export const createBashCommand = (context: BashContext): Command => ({
  name: 'bash',
  category: 'general',
  description: 'Execute binary by filesystem path',
  manual: {
    synopsis: 'bash(path, ...args)',
    description:
      'Execute a binary by its filesystem path. Resolves the binary, checks execute ' +
      'permissions, and runs the corresponding command with forwarded arguments.',
    arguments: [
      {
        name: 'path',
        description: 'Filesystem path to the binary (e.g. /usr/sbin/sshd)',
        required: true,
      },
      { name: '...args', description: 'Arguments forwarded to the command', required: false },
    ],
    examples: [
      { command: 'bash("/usr/sbin/sshd")', description: 'Start sshd on default port' },
      { command: 'bash("/usr/sbin/sshd", 2222)', description: 'Start sshd on port 2222' },
    ],
  },
  fn: (binaryPath?: unknown, ...args: unknown[]) => {
    if (typeof binaryPath !== 'string' || !binaryPath) {
      throw new Error('bash: missing binary path\nUsage: bash("/path/to/binary", ...args)');
    }

    const adapter: BashAdapter = {
      getNode: (path) => context.getNode(path),
      getUserType: context.getUserType,
      findCommand: (name) => context.getExecutionContext()[name],
    };

    return executeBash(adapter, binaryPath, args);
  },
});
