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

const MODE_SYNTAX = /^[ugoa]*[+-][rwx]+$/;

type PathedNode = { readonly node: FileNode; readonly path: string };

function* walkTree(node: FileNode, path: string): Generator<PathedNode> {
  yield { node, path };
  if (node.type === 'directory' && node.children) {
    for (const [childName, child] of Object.entries(node.children)) {
      const childPath = path === '/' ? `/${childName}` : `${path}/${childName}`;
      yield* walkTree(child, childPath);
    }
  }
}

export const createChmodCommand = (context: ChmodContext): Command => ({
  name: 'chmod',
  category: 'filesystem',
  description: 'Change file permissions',
  manual: {
    synopsis: 'chmod [-R] <mode> <path>',
    description:
      'Change the permissions of a file or directory. Only the file owner or root can change permissions. Uses symbolic notation: [ugoa][+-][rwx]. u=owner, g=user, o=guest, a=all. -R recurses into directories; per-node ownership is enforced, non-owned nodes are skipped with an error and the walk continues.',
    arguments: [
      {
        name: '-R',
        description: 'Recurse into directories, applying the mode to every descendant',
        required: false,
      },
      {
        name: 'mode',
        description: 'Symbolic mode string (e.g., "o+x", "u-w", "a+rx", "go-rwx")',
        required: true,
      },
      {
        name: 'path',
        description: 'Path to the file or directory',
        required: true,
      },
    ],
    examples: [
      { command: 'chmod o+x /usr/bin/nmap', description: 'Make nmap executable by guests' },
      {
        command: 'chmod a+rx script.sh',
        description: 'Make script readable and executable by all',
      },
      { command: 'chmod u-w readonly.txt', description: 'Remove write permission for owner' },
      {
        command: 'chmod -R go-rwx /home/jscript',
        description: 'Lock down a home directory tree: strip all access from user + guest',
      },
    ],
  },
  fn: (...args: unknown[]): string => {
    const { resolvePath, getNode, getUserType, updatePermissions, canTraverse } = context;

    const recursive = args.includes('-R');
    const positional = args.filter((a) => a !== '-R');

    if (positional.length < 2) {
      throw new Error('chmod: missing operand\nUsage: chmod [-R] <mode> <path>');
    }

    const mode = positional[0];
    const path = positional[1];

    if (typeof mode !== 'string' || typeof path !== 'string') {
      throw new Error('chmod: invalid arguments\nUsage: chmod [-R] <mode> <path>');
    }

    if (!MODE_SYNTAX.test(mode)) {
      throw new Error(`chmod: invalid mode: '${mode}'`);
    }

    const userType = getUserType();
    const resolvedPath = resolvePath(path);

    const traversal = canTraverse(resolvedPath);
    if (!traversal.allowed) {
      throw new Error(`chmod: cannot access '${path}': Permission denied`);
    }

    const rootNode = getNode(resolvedPath);
    if (!rootNode) {
      throw new Error(`chmod: cannot access '${path}': No such file or directory`);
    }

    const targets: readonly PathedNode[] =
      recursive && rootNode.type === 'directory'
        ? [...walkTree(rootNode, resolvedPath)]
        : [{ node: rootNode, path: resolvedPath }];

    // Per-file ownership check so partial failures don't stop the walk (matches
    // real chmod -R). For a non-recursive invocation with a single target this
    // still produces the same single-error behavior via the throw below.
    const errors: string[] = [];

    for (const { node, path: nodePath } of targets) {
      if (userType !== 'root' && userType !== node.owner) {
        const msg = `chmod: changing permissions of '${nodePath}': Operation not permitted`;
        if (!recursive) {
          throw new Error(msg);
        }
        errors.push(msg);
        continue;
      }

      // Parse per-node because 'u' resolves to each file's own owner.
      const parsed = parseSymbolicMode(mode, node.owner);
      if (!parsed) {
        throw new Error(`chmod: invalid mode: '${mode}'`);
      }

      const newPermissions = applyMode(node.permissions, parsed.targets, parsed.op, parsed.perms);
      const result = updatePermissions(nodePath, newPermissions);

      if (!result.allowed) {
        const msg = result.error ?? `chmod: cannot modify '${nodePath}'`;
        if (!recursive) {
          throw new Error(msg);
        }
        errors.push(msg);
      }
    }

    return errors.join('\n');
  },
});
