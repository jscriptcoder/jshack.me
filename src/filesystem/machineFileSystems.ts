import type { FileNode } from './types';
import { localhost } from './machines/__encoded';

// Minimal gateway filesystem — gateway is a static border router for localhost
const gatewayFs: FileNode = {
  name: '/',
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {
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
        hostname: {
          name: 'hostname',
          type: 'file',
          owner: 'root',
          permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
          content: 'gateway\n',
        },
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
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
          children: {
            'auth.log': {
              name: 'auth.log',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `Mar 15 08:30:00 gateway sshd[1001]: Starting OpenSSH server
Mar 15 09:00:00 gateway sshd[1002]: Connection from 192.168.1.100 port 22
Mar 15 09:00:03 gateway sshd[1002]: Accepted password for admin
`,
            },
          },
        },
      },
    },
  },
};

export type MachineId = string;

export const machineFileSystems: Readonly<Record<string, FileNode>> = {
  localhost,
  '192.168.1.1': gatewayFs,
};

// _machineId is unused today (all machines use the same /home/username convention)
// but kept in the signature so callers pass it — allows per-machine home paths later
// without changing every call site
export const getDefaultHomePath = (_machineId: string, username: string): string => {
  if (username === 'root') return '/root';
  return `/home/${username}`;
};
