import type { FileNode } from './types';
import type { UserType } from '../session/SessionContext';

export type UserConfig = {
  readonly username: string;
  readonly passwordHash: string;
  readonly userType: UserType;
  readonly uid: number;
  readonly homeContent?: Readonly<Record<string, FileNode>>;
};

export type MachineFileSystemConfig = {
  readonly users: readonly UserConfig[];
  readonly rootContent?: Readonly<Record<string, FileNode>>;
  readonly varLogContent?: Readonly<Record<string, FileNode>>;
  readonly etcExtraContent?: Readonly<Record<string, FileNode>>;
  readonly extraDirectories?: Readonly<Record<string, FileNode>>;
  readonly binContent?: Readonly<Record<string, FileNode>>;
  readonly usrBinContent?: Readonly<Record<string, FileNode>>;
  readonly usrSbinContent?: Readonly<Record<string, FileNode>>;
  readonly libContent?: Readonly<Record<string, FileNode>>;
  readonly varRunContent?: Readonly<Record<string, FileNode>>;
  readonly passwdReadableBy?: readonly UserType[];
};

const generatePasswdContent = (users: readonly UserConfig[]): string =>
  users
    .map(
      (u) =>
        `${u.username}:${u.passwordHash}:${u.uid}:${u.uid}:${u.username}:${u.userType === 'root' ? '/root' : `/home/${u.username}`}:/bin/bash`,
    )
    .join('\n');

const createHomeDirectory = (user: UserConfig): FileNode => ({
  name: user.username,
  type: 'directory',
  owner: user.userType,
  permissions: {
    read: user.userType === 'guest' ? ['root', 'user', 'guest'] : ['root', user.userType],
    write: ['root', user.userType],
    execute: user.userType === 'guest' ? ['root', 'user', 'guest'] : ['root', user.userType],
  },
  children: user.homeContent ?? {},
});

const createHomeDirectories = (
  users: readonly UserConfig[],
): Readonly<Record<string, FileNode>> => {
  const regularUsers = users.filter((u) => u.userType !== 'root');
  return Object.fromEntries(regularUsers.map((user) => [user.username, createHomeDirectory(user)]));
};

const BIN_DIR_PERMISSIONS = {
  read: ['root', 'user', 'guest'] as readonly UserType[],
  write: ['root'] as readonly UserType[],
  execute: ['root', 'user', 'guest'] as readonly UserType[],
};

// Recursively merges two FileNode children records. When both sides have a directory
// with the same key, their children are merged recursively (preserving both subtrees).
// Non-directory conflicts or unique keys take the additions value.
// Prevents e.g. /var/log/ from clobbering /var/www/ when both sources define /var/.
export const mergeFileNodeChildren = (
  base: Readonly<Record<string, FileNode>>,
  additions: Readonly<Record<string, FileNode>>,
): Record<string, FileNode> => {
  const result: Record<string, FileNode> = { ...base };
  Object.entries(additions).forEach(([key, node]) => {
    const existing = result[key];
    if (existing && existing.type === 'directory' && node.type === 'directory') {
      result[key] = {
        ...existing,
        children: mergeFileNodeChildren(existing.children ?? {}, node.children ?? {}),
      };
    } else {
      result[key] = node;
    }
  });
  return result;
};

export const createFileSystem = (config: MachineFileSystemConfig): FileNode => {
  const factoryChildren: Record<string, FileNode> = {
    root: {
      name: 'root',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root'],
        write: ['root'],
        execute: ['root'],
      },
      children: config.rootContent ?? {},
    },
    home: {
      name: 'home',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: createHomeDirectories(config.users),
    },
    etc: {
      name: 'etc',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        passwd: {
          name: 'passwd',
          type: 'file',
          owner: 'root',
          permissions: {
            read: [...(config.passwdReadableBy ?? ['root'])],
            write: ['root'],
            execute: ['root'],
          },
          content: generatePasswdContent(config.users),
        },
        ...config.etcExtraContent,
      },
    },
    var: {
      name: 'var',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        log: {
          name: 'log',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root', 'user', 'guest'],
          },
          children: config.varLogContent ?? {},
        },
        run: {
          name: 'run',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root', 'user', 'guest'],
          },
          children: config.varRunContent ?? {},
        },
      },
    },
    tmp: {
      name: 'tmp',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', 'user', 'guest'],
        execute: ['root', 'user', 'guest'],
      },
      children: {},
    },
    boot: {
      name: 'boot',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        vmlinuz: {
          name: 'vmlinuz',
          type: 'file',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root'],
          },
          content: 'bzImage, version 5.15.0-91-generic',
        },
        'initrd.img': {
          name: 'initrd.img',
          type: 'file',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root'],
          },
          content: 'initramfs image, version 5.15.0-91-generic',
        },
      },
    },
    bin: {
      name: 'bin',
      type: 'directory',
      owner: 'root',
      permissions: BIN_DIR_PERMISSIONS,
      children: config.binContent ?? {},
    },
    lib: {
      name: 'lib',
      type: 'directory',
      owner: 'root',
      permissions: BIN_DIR_PERMISSIONS,
      children: config.libContent ?? {},
    },
    usr: {
      name: 'usr',
      type: 'directory',
      owner: 'root',
      permissions: BIN_DIR_PERMISSIONS,
      children: {
        bin: {
          name: 'bin',
          type: 'directory',
          owner: 'root',
          permissions: BIN_DIR_PERMISSIONS,
          children: config.usrBinContent ?? {},
        },
        sbin: {
          name: 'sbin',
          type: 'directory',
          owner: 'root',
          permissions: BIN_DIR_PERMISSIONS,
          children: config.usrSbinContent ?? {},
        },
      },
    },
  };

  return {
    name: '/',
    type: 'directory',
    owner: 'root',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root'],
      execute: ['root', 'user', 'guest'],
    },
    children: config.extraDirectories
      ? mergeFileNodeChildren(factoryChildren, config.extraDirectories)
      : factoryChildren,
  };
};
