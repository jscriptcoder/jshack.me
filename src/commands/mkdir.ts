import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/types';
import type { PermissionResult } from '../filesystem/types';

type MkdirContext = {
  readonly getUserType: () => UserType;
  readonly createDirectory: (
    path: string,
    userType: UserType,
    options?: { readonly parents?: boolean },
  ) => PermissionResult;
};

const isFlagToken = (s: string) => s.length > 1 && s.startsWith('-') && !s.startsWith('--');

const parseArgs = (
  args: readonly unknown[],
): { readonly parents: boolean; readonly paths: readonly string[] } => {
  const strings = args.filter((a): a is string => typeof a === 'string');
  const flagChars = strings.filter(isFlagToken).flatMap((token) => [...token.slice(1)]);

  const invalid = flagChars.find((ch) => ch !== 'p');
  if (invalid) throw new Error(`mkdir: invalid option -- '${invalid}'`);

  return {
    parents: flagChars.includes('p'),
    paths: strings.filter((s) => !isFlagToken(s)),
  };
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

    const errors = paths.flatMap((path) => {
      const result = createDirectory(path, userType, { parents });
      return result.allowed ? [] : [result.error ?? `mkdir: cannot create directory '${path}'`];
    });

    if (errors.length > 0) throw new Error(errors.join('\n'));
    return '';
  },
});
