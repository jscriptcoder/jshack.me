import type { FileNode } from './types';
import { localhost, fileserver, webserver } from './machines/__encoded';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../commands/availability';
import { PID_FILE_NAME, createSshdPidFileNode } from '../commands/sshd';

const BIN_DIR_PERMISSIONS = {
  read: ['root', 'user', 'guest'] as const,
  write: ['root'] as const,
  execute: ['root', 'user', 'guest'] as const,
};

// Common permission sets for the gateway filesystem
const ALL_READ = {
  read: ['root', 'user', 'guest'] as const,
  write: ['root'] as const,
  execute: ['root', 'user', 'guest'] as const,
};

const ROOT_ONLY = {
  read: ['root'] as const,
  write: ['root'] as const,
  execute: ['root'] as const,
};

const ROOT_USER_READ = {
  read: ['root', 'user'] as const,
  write: ['root'] as const,
  execute: ['root', 'user'] as const,
};

const GUEST_HOME = {
  read: ['root', 'guest'] as const,
  write: ['root', 'guest'] as const,
  execute: ['root', 'guest'] as const,
};

// Gateway filesystem — static border router with PulseSecure VPN vulnerability
const gatewayFs: FileNode = {
  name: '/',
  type: 'directory',
  owner: 'root',
  permissions: ALL_READ,
  children: {
    etc: {
      name: 'etc',
      type: 'directory',
      owner: 'root',
      permissions: ALL_READ,
      children: {
        hostname: {
          name: 'hostname',
          type: 'file',
          owner: 'root',
          permissions: { ...ALL_READ, execute: ['root'] as const },
          content: 'gateway\n',
        },
        passwd: {
          name: 'passwd',
          type: 'file',
          owner: 'root',
          permissions: { ...ALL_READ, execute: ['root'] as const },
          content: `root:x:0:0:root:/root:/bin/bash
admin:x:1000:1000:Network Admin:/home/admin:/bin/bash
guest:x:1001:1001:Guest Account:/home/guest:/bin/bash
`,
        },
        hosts: {
          name: 'hosts',
          type: 'file',
          owner: 'root',
          permissions: { ...ALL_READ, execute: ['root'] as const },
          content: `127.0.0.1       localhost
192.168.1.1     gateway
192.168.1.50    fileserver
192.168.1.75    webserver
192.168.1.100   jshacker-pc
`,
        },
        iptables: {
          name: 'iptables',
          type: 'directory',
          owner: 'root',
          permissions: ROOT_USER_READ,
          children: {
            'rules.v4': {
              name: 'rules.v4',
              type: 'file',
              owner: 'root',
              permissions: { ...ROOT_USER_READ, execute: ['root'] as const },
              content: `*filter
:INPUT DROP [0:0]
:FORWARD ACCEPT [0:0]
:OUTPUT ACCEPT [0:0]
-A INPUT -i lo -j ACCEPT
-A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
-A INPUT -p tcp --dport 22 -j ACCEPT
-A INPUT -p tcp --dport 8443 -j ACCEPT
-A FORWARD -s 192.168.1.0/24 -j ACCEPT
-A FORWARD -d 192.168.1.0/24 -m state --state ESTABLISHED,RELATED -j ACCEPT
COMMIT
`,
            },
          },
        },
      },
    },
    home: {
      name: 'home',
      type: 'directory',
      owner: 'root',
      permissions: ALL_READ,
      children: {
        admin: {
          name: 'admin',
          type: 'directory',
          owner: 'root',
          permissions: ROOT_ONLY,
          children: {
            '.bash_history': {
              name: '.bash_history',
              type: 'file',
              owner: 'root',
              permissions: ROOT_ONLY,
              content: `iptables -L -n
systemctl restart pulsesecure
cat /etc/iptables/rules.v4
ssh admin@192.168.1.50
ping 192.168.1.75
`,
            },
            'network_notes.txt': {
              name: 'network_notes.txt',
              type: 'file',
              owner: 'root',
              permissions: ROOT_ONLY,
              content: `=== Network Maintenance Notes ===

LAN segment: 192.168.1.0/24
  - fileserver (192.168.1.50): FTP + SSH, backup storage
  - webserver (192.168.1.75): HTTP + MySQL, production site
  - jshacker-pc (192.168.1.100): dev workstation

VPN appliance on port 8443 — needs upgrade from PulseSecure 9.0R1
  TODO: patch CVE-2019-11510 before next audit
`,
            },
          },
        },
        guest: {
          name: 'guest',
          type: 'directory',
          owner: 'guest',
          permissions: GUEST_HOME,
          children: {
            'welcome.txt': {
              name: 'welcome.txt',
              type: 'file',
              owner: 'guest',
              permissions: { ...GUEST_HOME, execute: [] as const },
              content: `Welcome to the gateway VPN portal.
For network access, contact the system administrator.
`,
            },
          },
        },
      },
    },
    root: {
      name: 'root',
      type: 'directory',
      owner: 'root',
      permissions: ROOT_ONLY,
      children: {
        '.bash_history': {
          name: '.bash_history',
          type: 'file',
          owner: 'root',
          permissions: ROOT_ONLY,
          content: `iptables -L
cat /var/log/firewall.log
systemctl status sshd
`,
        },
      },
    },
    var: {
      name: 'var',
      type: 'directory',
      owner: 'root',
      permissions: ALL_READ,
      children: {
        log: {
          name: 'log',
          type: 'directory',
          owner: 'root',
          permissions: ROOT_USER_READ,
          children: {
            'auth.log': {
              name: 'auth.log',
              type: 'file',
              owner: 'root',
              permissions: { ...ROOT_USER_READ, execute: ['root'] as const },
              content: `Mar 15 08:30:00 gateway sshd[1001]: Starting OpenSSH server
Mar 15 09:00:00 gateway sshd[1002]: Connection from 192.168.1.100 port 22
Mar 15 09:00:03 gateway sshd[1002]: Accepted password for admin
Mar 15 10:15:22 gateway pulsesecure[2041]: VPN session started for guest
Mar 15 10:15:25 gateway pulsesecure[2041]: Client connected from 192.168.1.100
`,
            },
            'firewall.log': {
              name: 'firewall.log',
              type: 'file',
              owner: 'root',
              permissions: { ...ROOT_USER_READ, execute: ['root'] as const },
              content: `Mar 15 08:00:01 gateway kernel: [iptables] IN=eth0 OUT= SRC=192.168.1.100 DST=192.168.1.1 PROTO=TCP DPT=22 ACCEPT
Mar 15 08:05:12 gateway kernel: [iptables] IN=eth0 OUT= SRC=192.168.1.100 DST=192.168.1.1 PROTO=TCP DPT=8443 ACCEPT
Mar 15 08:10:33 gateway kernel: [iptables] IN=eth0 OUT= SRC=192.168.1.100 DST=192.168.1.50 PROTO=TCP DPT=21 FORWARD
Mar 15 08:15:44 gateway kernel: [iptables] IN=eth0 OUT= SRC=192.168.1.75 DST=192.168.1.1 PROTO=TCP DPT=22 ACCEPT
`,
            },
          },
        },
        run: {
          name: 'run',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'] as const,
            write: ['root'] as const,
            execute: ['root', 'user', 'guest'] as const,
          },
          children: { [PID_FILE_NAME]: createSshdPidFileNode() },
        },
      },
    },
    tmp: {
      name: 'tmp',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'] as const,
        write: ['root', 'user', 'guest'] as const,
        execute: ['root', 'user', 'guest'] as const,
      },
      children: {},
    },
    bin: {
      name: 'bin',
      type: 'directory',
      owner: 'root',
      permissions: BIN_DIR_PERMISSIONS,
      children: createBinaryEntries(SYSTEM_UTILITY_NAMES),
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
          children: {},
        },
        sbin: {
          name: 'sbin',
          type: 'directory',
          owner: 'root',
          permissions: BIN_DIR_PERMISSIONS,
          children: createBinaryEntries(SBIN_UTILITY_NAMES),
        },
      },
    },
  },
};

export type MachineId = string;

export const machineFileSystems: Readonly<Record<string, FileNode>> = {
  localhost,
  '192.168.1.1': gatewayFs,
  '192.168.1.50': fileserver,
  '192.168.1.75': webserver,
};

// _machineId is unused today (all machines use the same /home/username convention)
// but kept in the signature so callers pass it — allows per-machine home paths later
// without changing every call site
export const getDefaultHomePath = (_machineId: string, username: string): string => {
  if (username === 'root') return '/root';
  return `/home/${username}`;
};
