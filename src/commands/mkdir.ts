import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { PermissionResult } from '../filesystem/types';

type MkdirContext = {
  readonly getUserType: () => UserType;
  readonly createDirectory: (
    path: string,
    userType: UserType,
    options?: { readonly parents?: boolean },
  ) => PermissionResult;
};

const parseArgs = (
  args: readonly unknown[],
): { readonly parents: boolean; readonly paths: readonly string[] } => {
  let parents = false;
  const paths: string[] = [];

  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('-') && arg.length > 1 && !arg.startsWith('--')) {
      for (const ch of arg.slice(1)) {
        if (ch === 'p') parents = true;
        else throw new Error(`mkdir: invalid option -- '${ch}'`);
      }
    } else {
      paths.push(arg);
    }
  }

  return { parents, paths };
};

export const createMkdirCommand = (context: MkdirContext): Command => ({
  name: 'mkdir',
  category: 'filesystem',
  description: 'Create directories',
  manual: {
    synopsis: 'mkdir [-p] <path> [paths...]',
    description:
      'Create one or more directories. Without -p, the parent of each target must already exist and the target itself must not. With -p, missing intermediate directories are created automatically and an existing target is not treated as an error.',
    arguments: [
      {
        name: '-p',
        description:
          'Create missing parent directories. Do not error if the target already exists.',
        required: false,
      },
      {
        name: 'path',
        description: 'Directory path to create',
        required: true,
      },
    ],
    examples: [
      {
        command: 'mkdir stash',
        description: 'Create a directory in the current working directory',
      },
      { command: 'mkdir -p /tmp/a/b/c', description: 'Create a nested path, parents included' },
      { command: 'mkdir docs logs tmp', description: 'Create several directories at once' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { getUserType, createDirectory } = context;
    const { parents, paths } = parseArgs(args);

    if (paths.length === 0) {
      throw new Error('mkdir: missing operand');
    }

    const userType = getUserType();
    const errors: string[] = [];

    for (const path of paths) {
      const result = createDirectory(path, userType, { parents });
      if (!result.allowed) {
        errors.push(result.error ?? `mkdir: cannot create directory '${path}'`);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }

    return '';
  },
});
