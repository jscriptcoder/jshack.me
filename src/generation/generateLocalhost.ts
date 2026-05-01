import type { FileNode } from '../filesystem/types';
import type { GameState } from '../game/types';
import { createFileSystem, type MachineFileSystemConfig } from '../filesystem/fileSystemFactory';
import {
  createBinaryEntries,
  createLibraryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
  LOCALHOST_PREINSTALLED_TOOLS,
} from '../commands/availability';
import { SYSTEM_LIBRARIES } from './pools/systemLibraryTemplates';
import { md5 } from '../utils/md5';
import { createPrng } from './prng';
import { guestPasswords } from './pools';

const buildHomeContent = (username: string): Readonly<Record<string, FileNode>> => ({
  'README.txt': {
    name: 'README.txt',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `=== WELCOME TO JSHACK.ME ===

You're at a Linux-style shell. Type commands with space-separated
arguments, just like a real terminal.

Type help to see all commands. Use man <cmd> for details.

GETTING STARTED
  You will need root access to install tools and crack WiFi.
  Switch to root: su root

  Once you are root, check out the WiFi cracking cheatsheet:
    cat /home/${username}/downloads/wifi_tools.txt

  After connecting to WiFi, install your hacking toolkit:
    apt install nmap
    apt list    (to see all available packages)

CONTRACTS
  Browse the darknet marketplace:  missions
  Accept a contract:               accept <seed>
  Each contract gives you a target network to hack into.
  Follow the briefing, find the proof, and deliver it:
    mail <recipient> <proof>
`,
  },
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `ls
cat README.txt
su root
ifconfig
cat downloads/wifi_tools.txt
airmon start wlan0
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
  nmap <subnet>/24        Scan entire subnet (check ifconfig for IP)
  nmap <ip>               Scan single host

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
1. Enable monitor mode:  airmon start wlan0
2. Scan for networks:    airdump
3. Crack target network: aircrack <BSSID>
4. Connect to network:   nmcli connect <ESSID> <password>
5. Check status:         nmcli status
6. Disconnect:           nmcli disconnect
`,
      },
    },
  },
});

const buildRootContent = (username: string): Readonly<Record<string, FileNode>> => ({
  '.note': {
    name: '.note',
    type: 'file',
    owner: 'root',
    permissions: { read: ['root'], write: ['root'], execute: ['root'] },
    content: `Root access acquired. Next steps:
1. Crack WiFi: see /home/${username}/downloads/wifi_tools.txt
2. Install tools: apt install nmap   (apt list to see all)
3. Browse contracts: missions
`,
  },
});

export type LocalhostResult = {
  readonly fileSystem: FileNode;
  readonly users: readonly string[];
  readonly guestPassword: string;
};

// `hostname` is the player's full machine name including the identity-
// derived suffix (e.g., 'skylab-9k3'). Computed once at game start by
// computePlayerHostname and threaded down here so the localhost
// filesystem (/etc/hostname, sample log entries) reflects the same name
// the prompt and server-side occupant rows resolve to.
export const generateLocalhost = (gameState: GameState, hostname: string): LocalhostResult => {
  const { username, rootPassword, seed } = gameState;
  const prng = createPrng(`localhost-${seed}`);
  const guestPassword = prng.pick(guestPasswords);

  const config: MachineFileSystemConfig = {
    users: [
      {
        username: 'root',
        passwordHash: md5(rootPassword),
        userType: 'root',
        uid: 0,
      },
      {
        username,
        // No password for the player's own user — they can always exit() back
        passwordHash: '',
        userType: 'user',
        uid: 1000,
        homeContent: buildHomeContent(username),
      },
      {
        username: 'guest',
        passwordHash: md5(guestPassword),
        userType: 'guest',
        uid: 1001,
      },
    ],
    binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
    usrBinContent: createBinaryEntries(LOCALHOST_PREINSTALLED_TOOLS),
    usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
    libContent: createLibraryEntries(SYSTEM_LIBRARIES),
    passwdReadableBy: ['root', 'user'],
    etcExtraContent: {
      hostname: {
        name: 'hostname',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
        content: `${hostname}\n`,
      },
      hosts: {
        name: 'hosts',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
        content: `127.0.0.1       localhost\n`,
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
    rootContent: buildRootContent(username),
    varLogContent: {
      'auth.log': {
        name: 'auth.log',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
        content: `Mar 15 08:30:00 ${hostname} sshd[2341]: Starting OpenSSH server
Mar 15 09:15:22 ${hostname} sshd[2345]: Accepted password for ${username}
Mar 16 02:00:00 ${hostname} cron[2500]: Running scheduled backup
Mar 16 14:22:10 ${hostname} kernel: [42891.33] wlan0: link is not ready
`,
      },
      syslog: {
        name: 'syslog',
        type: 'file',
        owner: 'root',
        permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
        content: `Mar 15 08:29:50 ${hostname} kernel: [    0.000000] Linux version 5.15.0-91-generic
Mar 15 08:29:51 ${hostname} systemd[1]: Started Journal Service.
Mar 15 08:29:52 ${hostname} systemd[1]: Starting Network Manager...
Mar 15 08:29:53 ${hostname} NetworkManager[845]: <info> NetworkManager is starting
Mar 15 08:29:55 ${hostname} systemd[1]: Started OpenSSH server daemon.
Mar 15 08:29:56 ${hostname} systemd[1]: Reached target Multi-User System.
Mar 15 08:30:00 ${hostname} CRON[2500]: (root) CMD (/usr/local/bin/backup.sh)
Mar 16 08:30:00 ${hostname} CRON[3100]: (root) CMD (/usr/local/bin/backup.sh)
`,
      },
    },
  };

  return {
    fileSystem: createFileSystem(config),
    users: ['root', username, 'guest'],
    guestPassword,
  };
};
