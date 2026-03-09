import type { Command } from '../components/Terminal/types';
import type { UserType } from '../session/SessionContext';
import type { FileNode, FilePermissions, PermissionResult } from '../filesystem/types';

type ChmodContext = {
  readonly resolvePath: (path: string) => string;
  readonly getNode: (path: string) => FileNode | null;
  readonly getUserType: () => UserType;
  readonly updatePermissions: (path: string, permissions: FilePermissions) => PermissionResult;
  readonly canTraverse: (path: string) => PermissionResult;
};

// Maps symbolic who characters to UserType values
// u = owner (resolved at call time), g = 'user', o = 'guest', a = all three
const WHO_MAP: Readonly<Record<string, readonly UserType[]>> = {
  g: ['user'],
  o: ['guest'],
  a: ['root', 'user', 'guest'],
};

const resolveWho = (chars: string, owner: UserType): readonly UserType[] => {
  if (chars === '' || chars === 'a') return ['root', 'user', 'guest'];

  const types = new Set<UserType>();
  for (const ch of chars) {
    if (ch === 'u') {
      types.add(owner);
    } else {
      const mapped = WHO_MAP[ch];
      if (mapped) mapped.forEach((t) => types.add(t));
    }
  }
  return [...types];
};

const PERM_KEYS: Readonly<Record<string, keyof FilePermissions>> = {
  r: 'read',
  w: 'write',
  x: 'execute',
};

// Parses symbolic mode like "o+x", "ug-w", "a+rx"
// Returns null on invalid input
const parseSymbolicMode = (
  mode: string,
  owner: UserType,
): {
  readonly targets: readonly UserType[];
  readonly op: '+' | '-';
  readonly perms: readonly (keyof FilePermissions)[];
} | null => {
  const match = /^([ugoa]*)([+-])([rwx]+)$/.exec(mode);
  if (!match) return null;

  const [, whoStr, op, permStr] = match;
  const targets = resolveWho(whoStr ?? '', owner);
  const perms = [...(permStr ?? '')]
    .map((ch) => PERM_KEYS[ch])
    .filter(Boolean) as (keyof FilePermissions)[];

  if (perms.length === 0) return null;

  return { targets, op: op as '+' | '-', perms };
};

const applyMode = (
  current: FilePermissions,
  targets: readonly UserType[],
  op: '+' | '-',
  perms: readonly (keyof FilePermissions)[],
): FilePermissions => {
  const updated = { ...current };

  for (const perm of perms) {
    const existing = new Set(current[perm]);
    for (const target of targets) {
      if (op === '+') {
        existing.add(target);
      } else {
        // Never remove root from any permission
        if (target !== 'root') existing.delete(target);
      }
    }
    (updated as Record<string, readonly UserType[]>)[perm] = [...existing];
  }

  return updated as FilePermissions;
};

export const createChmodCommand = (context: ChmodContext): Command => ({
  name: 'chmod',
  category: 'filesystem',
  description: 'Change file permissions',
  manual: {
    synopsis: 'chmod(mode, path)',
    description:
      'Change the permissions of a file or directory. Only the file owner or root can change permissions. Uses symbolic notation: [ugoa][+-][rwx]. u=owner, g=user, o=guest, a=all.',
    arguments: [
      {
        name: 'mode',
        description: 'Symbolic mode string (e.g., "o+x", "u-w", "a+rx", "go-w")',
        required: true,
      },
      {
        name: 'path',
        description: 'Path to the file or directory',
        required: true,
      },
    ],
    examples: [
      { command: 'chmod("o+x", "/usr/bin/nmap")', description: 'Make nmap executable by guests' },
      {
        command: 'chmod("a+rx", "script.sh")',
        description: 'Make script readable and executable by all',
      },
      { command: 'chmod("u-w", "readonly.txt")', description: 'Remove write permission for owner' },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { resolvePath, getNode, getUserType, updatePermissions, canTraverse } = context;

    if (args.length < 2) {
      throw new Error('chmod: missing operand\nUsage: chmod(mode, path)');
    }

    const mode = args[0];
    const path = args[1];

    if (typeof mode !== 'string' || typeof path !== 'string') {
      throw new Error('chmod: invalid arguments\nUsage: chmod(mode, path)');
    }

    const userType = getUserType();
    const resolvedPath = resolvePath(path);

    const traversal = canTraverse(resolvedPath);
    if (!traversal.allowed) {
      throw new Error(`chmod: cannot access '${path}': Permission denied`);
    }

    const node = getNode(resolvedPath);
    if (!node) {
      throw new Error(`chmod: cannot access '${path}': No such file or directory`);
    }

    // Only owner or root can chmod
    if (userType !== 'root' && userType !== node.owner) {
      throw new Error(`chmod: changing permissions of '${path}': Operation not permitted`);
    }

    const parsed = parseSymbolicMode(mode, node.owner);
    if (!parsed) {
      throw new Error(`chmod: invalid mode: '${mode}'`);
    }

    const newPermissions = applyMode(node.permissions, parsed.targets, parsed.op, parsed.perms);
    const result = updatePermissions(resolvedPath, newPermissions);

    if (!result.allowed) {
      throw new Error(result.error ?? `chmod: cannot modify '${path}'`);
    }

    return '';
  },
});
