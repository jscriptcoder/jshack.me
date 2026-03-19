import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
  LOCALHOST_PREINSTALLED_TOOLS,
} from '../../commands/availability';

const jshackerHome: Readonly<Record<string, FileNode>> = {
  'README.txt': {
    name: 'README.txt',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `=== WELCOME TO JSHACK.ME ===

You are jshacker, a freelance hacker-for-hire.
This is a JavaScript terminal — commands are function calls:

  ls()          not  ls
  cat("file")   not  cat file
  cd("/etc")    not  cd /etc

Type help() to see all commands. Use man("cmd") for details.

ROOT ACCESS
  This is your machine. Root password: sup3rus3r
  Switch with: su("root")
  You'll need root to install tools and crack WiFi.

NEXT STEPS
  Read .mission for your full roadmap:  cat(".mission")
`,
  },
  '.mission': {
    name: '.mission',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `HACKER NOTES
============

PHASE 1 — GET ROOT
  su("root") with password from README.txt
  Need root to install tools and manage the system.

PHASE 2 — CRACK THE WIFI
  WiFi card is installed but not connected yet.
  Aircrack suite is pre-installed. Steps:
    1. airmon("start", "wlan0")
    2. airdump()
    3. aircrack("<BSSID>")       — copies password to clipboard
    4. nmcli("connect", "<ESSID>", "<password>")
  Full cheatsheet: cat("downloads/wifi_tools.txt")

PHASE 3 — INSTALL YOUR TOOLKIT
  Once online, install hacking tools with apt:
    apt("install", "nmap")
    apt("install", "hydra")
    apt("install", "john")
  Run apt("list") to see all available packages.

PHASE 4 — TAKE CONTRACTS
  Browse the darknet marketplace:  missions()
  Accept a contract:               accept("<seed>")
  Each contract gives you a target network to hack into.

PHASE 5 — COMPLETE THE JOB
  Follow the mission briefing — hack the target, find what
  the client wants, then deliver proof:
    mail("<recipient>", "<proof>")
  The briefing tells you who to mail and what to send.

USEFUL TOOLS
  nmap("target")            — scan for open ports
  ssh("user@host")          — remote access
  cat("downloads/nmap_cheatsheet.txt") — port reference
`,
  },
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `ls()
cat("README.txt")
cat(".mission")
su("root")
ifconfig()
cat("downloads/wifi_tools.txt")
airmon("start", "wlan0")
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
      'wifi_tools.txt': {
        name: 'wifi_tools.txt',
        type: 'file',
        owner: 'user',
        permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
        content: `WIRELESS PENETRATION TESTING CHEATSHEET
========================================
1. Enable monitor mode:  airmon("start", "wlan0")
2. Scan for networks:    airdump()
3. Crack target network: aircrack("<BSSID>")
4. Connect to network:   nmcli("connect", "<ESSID>", "<password>")
5. Check status:         nmcli("status")
6. Disconnect:           nmcli("disconnect")
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
  binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
  usrBinContent: createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS),
  usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
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
  rootContent: {
    '.note': {
      name: '.note',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `Root access acquired. Next steps:
1. Crack WiFi: see /home/jshacker/downloads/wifi_tools.txt
2. Install tools: apt("install", "nmap"), apt("list") to see all
3. Browse contracts: missions()
`,
    },
  },
  varLogContent: {
    'auth.log': {
      name: 'auth.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `Mar 15 08:30:00 localhost sshd[2341]: Starting OpenSSH server
Mar 15 09:15:22 localhost sshd[2345]: Connection from 192.168.1.1 port 22
Mar 15 09:15:25 localhost sshd[2345]: Accepted password for jshacker
Mar 16 02:00:00 localhost cron[2500]: Running scheduled backup
Mar 16 08:30:00 localhost sshd[2510]: Connection from 192.168.1.1 port 22
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
