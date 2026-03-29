import type { FileNode } from '../../filesystem/types';

export const mkFile = (
  name: string,
  content: string,
  owner: 'root' | 'user' | 'guest' = 'root',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: {
    read: owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
    write: owner === 'guest' ? ['root', 'guest'] : ['root', owner],
    execute: ['root'],
  },
  content,
});

// Script files have variable permissions based on owner:
// user-owned: anyone can read/write/execute (easier — no privilege escalation needed)
// root-owned: anyone can read, but only root can write/execute (must su first)
export const mkScript = (
  name: string,
  content: string,
  owner: 'root' | 'user' = 'user',
): FileNode => ({
  name,
  type: 'file',
  owner,
  permissions: {
    read: ['root', 'user', 'guest'],
    write: owner === 'user' ? ['root', 'user', 'guest'] : ['root'],
    execute: owner === 'user' ? ['root', 'user', 'guest'] : ['root'],
  },
  content,
});

// worldReadable: system directories (/var, /tmp, /etc, /srv, /opt, /home, /usr) should
// be traversable by all users. Home subdirs remain owner-scoped via the default.
export const mkDir = (
  name: string,
  children: Readonly<Record<string, FileNode>>,
  owner: 'root' | 'user' | 'guest' = 'root',
  worldReadable: boolean = false,
): FileNode => ({
  name,
  type: 'directory',
  owner,
  permissions: {
    read: worldReadable || owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
    write: ['root', owner],
    execute: worldReadable || owner === 'guest' ? ['root', 'user', 'guest'] : ['root', owner],
  },
  children,
});

export const fillTemplate = (template: string, vars: Readonly<Record<string, string>>): string =>
  Object.entries(vars).reduce(
    (result, [key, value]) => result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value),
    template,
  );

// Walks a nested directory tree to find the deepest directory node.
// Used to merge sibling files into an existing directory structure
// (e.g., adding a hint file alongside a script in /srv/scripts/).
export const findLeafDir = (node: FileNode): FileNode | undefined => {
  if (node.type !== 'directory' || !node.children) return undefined;
  const childDirs = Object.values(node.children).filter((c) => c.type === 'directory');
  if (childDirs.length === 0) return node;
  return findLeafDir(childDirs[0] as FileNode) ?? node;
};

// Builds a nested directory tree from path segments, placing the file at the leaf.
// e.g., ['srv', 'records', 'file.csv'] → mkDir('srv', { records: mkDir('records', { 'file.csv': file }) })
// All intermediate directories are world-readable (system paths like /srv/, /opt/, /usr/).
export const buildNestedDirs = (segments: readonly string[], file: FileNode): FileNode => {
  if (segments.length <= 1) return file;

  const dirName = segments[0] as string;
  const child = buildNestedDirs(segments.slice(1), file);
  const childName = segments[1] as string;

  return mkDir(dirName, { [childName]: child }, 'root', true);
};
