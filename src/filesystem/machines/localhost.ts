import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';

// FLAG 1 & 2: Welcome flags in jshacker's home
const jshackerHome: Readonly<Record<string, FileNode>> = {
  'README.txt': {
    name: 'README.txt',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `=== WELCOME TO JSHACK.ME ===

You are jshacker, a security researcher.
Your mission: investigate this network and uncover its secrets.

Start by exploring. Use ls() to list files, cd() to move around,
and cat() to read files.

FLAG{welcome_hacker}

Hint: Real hackers know that not all files are visible...
Try ls("-a") to see hidden files.
`,
  },
  '.mission': {
    name: '.mission',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `MISSION BRIEFING
================
This network has been compromised. Multiple machines are running
suspicious services. Your job is to investigate.

FLAG{hidden_in_plain_sight}

NEXT STEPS:
1. Check /etc/passwd to see who else is on this machine
2. The root account holds secrets. Can you crack the password?
   Hint: Use su("root") after figuring out the password.
`,
  },
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `ls
cd /etc
cat passwd
cd ~
ifconfig
ping 192.168.1.1
nmap 192.168.1.0/24
cat /var/log/auth.log
ssh admin 192.168.1.1
`,
  },
  '.bashrc': {
    name: '.bashrc',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `# ~/.bashrc: executed by bash for non-login shells
export PATH="/usr/local/bin:/usr/bin:/bin"
export EDITOR=vim
export LANG=en_US.UTF-8

alias ll='ls -la'
alias grep='grep --color=auto'

# Custom prompt
PS1='\\u@\\h:\\w\\$ '
`,
  },
  downloads: {
    name: 'downloads',
    type: 'directory',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root', 'user'] },
    children: {
      'nmap_cheatsheet.txt': {
        name: 'nmap_cheatsheet.txt',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `=== NMAP QUICK REFERENCE ===

Host Discovery:
  nmap 192.168.1.0/24     Scan entire subnet
  nmap 192.168.1.1        Scan single host

Common Ports:
  21  FTP       22  SSH       80  HTTP
  443 HTTPS     3306 MySQL    8080 HTTP-ALT

Tips:
  - Always start with a subnet scan to find live hosts
  - Check for non-standard ports (4444, 31337, etc.)
  - FTP servers sometimes allow anonymous access
`,
      },
      'todo.txt': {
        name: 'todo.txt',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `TODO
====
[x] Set up dev environment
[x] Configure network interfaces
[ ] Check gateway for misconfigurations
[ ] Scan full network range
[ ] Investigate that weird darknet traffic in the logs
[ ] Update passwords (they're too weak!)
`,
      },
    },
  },
};

const localhostConfig: MachineFileSystemConfig = {
  users: [
    {
      username: 'root',
      passwordHash: 'a0ff67e77425eb3cea40ecb60941aea4',
      userType: 'root',
      uid: 0,
    }, // sup3rus3r
    {
      username: 'jshacker',
      passwordHash: '25cd52d0d5975297e6c28700caa9dd72',
      userType: 'user',
      uid: 1000,
      homeContent: jshackerHome,
    }, // h4ckth3pl4n3t
    {
      username: 'guest',
      passwordHash: '0fb9cbecb7b8881511c69c39db643e8c',
      userType: 'guest',
      uid: 1001,
    }, // guestpass
  ],
  passwdReadableBy: ['root', 'user'],
  etcExtraContent: {
    hostname: {
      name: 'hostname',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: 'jshack-dev\n',
    },
    hosts: {
      name: 'hosts',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: `127.0.0.1       localhost
192.168.1.1     gateway.local
192.168.1.50    fileserver.local
192.168.1.75    webserver.local
192.168.1.100   jshack-dev
`,
    },
    crontab: {
      name: 'crontab',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `# /etc/crontab: system-wide crontab
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin

# m h dom mon dow user  command
0 2 * * *   root    /usr/local/bin/backup.sh
0 4 * * 0   root    /usr/sbin/logrotate /etc/logrotate.conf
*/15 * * * * root   /usr/bin/check_services.sh
`,
    },
  },
  // FLAG 3: Root-only flag
  rootContent: {
    'flag.txt': {
      name: 'flag.txt',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `FLAG{root_access_granted}

Now you have full control of this machine.
Try exploring the network:
  ifconfig() — see your network interface
  ping("192.168.1.1") — test connectivity
  nmap("192.168.1.1-254") — scan for machines
`,
    },
  },
  // HINT: Gateway guest credentials
  varLogContent: {
    'auth.log': {
      name: 'auth.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `Mar 15 08:30:00 localhost sshd[2341]: Starting OpenSSH server
Mar 15 09:15:22 localhost sshd[2345]: Connection from 192.168.1.1 port 22
Mar 15 09:15:25 localhost sshd[2345]: Accepted password for jshacker
Mar 15 10:00:00 localhost sudo[2400]: jshacker : command not found
Mar 15 14:30:00 localhost network[2401]: Auto-configured gateway access: guest/guest2024
Mar 16 02:00:00 localhost cron[2500]: Running scheduled backup
Mar 16 03:15:00 localhost sshd[2510]: Failed password for root from 203.0.113.42
Mar 16 03:15:05 localhost sshd[2510]: Failed password for root from 203.0.113.42
`,
    },
    syslog: {
      name: 'syslog',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `Mar 15 08:29:50 localhost kernel: [    0.000000] Linux version 5.15.0-91-generic
Mar 15 08:29:51 localhost systemd[1]: Started Journal Service.
Mar 15 08:29:52 localhost systemd[1]: Starting Network Manager...
Mar 15 08:29:53 localhost NetworkManager[845]: <info> NetworkManager is starting
Mar 15 08:29:55 localhost systemd[1]: Started OpenSSH server daemon.
Mar 15 08:29:56 localhost systemd[1]: Reached target Multi-User System.
Mar 15 08:30:00 localhost CRON[2500]: (root) CMD (/usr/local/bin/backup.sh)
Mar 16 08:30:00 localhost CRON[3100]: (root) CMD (/usr/local/bin/backup.sh)
`,
    },
  },
};

export const localhost: FileNode = createFileSystem(localhostConfig);
