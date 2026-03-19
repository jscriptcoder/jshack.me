import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';
import {
  createBinaryEntries,
  SYSTEM_UTILITY_NAMES,
  SBIN_UTILITY_NAMES,
} from '../../commands/availability';
import { SSH_PID_FILE_NAME, createSshdPidFileNode } from '../../commands/sshd';
import { FTP_PID_FILE_NAME, createFtpdPidFileNode } from '../../commands/ftpd';

const ftpuserHome: Readonly<Record<string, FileNode>> = {
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `ls /srv/ftp/
cd /srv/ftp/uploads
cat meeting_notes.txt
vsftpd -v
`,
  },
};

const guestHome: Readonly<Record<string, FileNode>> = {
  'readme.txt': {
    name: 'readme.txt',
    type: 'file',
    owner: 'guest',
    permissions: {
      read: ['root', 'user', 'guest'],
      write: ['root', 'user', 'guest'],
      execute: ['root'],
    },
    content: `Guest account — read-only FTP access.
Contact ftpuser for upload permissions.
`,
  },
};

const srvFtp: FileNode = {
  name: 'srv',
  type: 'directory',
  owner: 'root',
  permissions: {
    read: ['root', 'user', 'guest'],
    write: ['root'],
    execute: ['root', 'user', 'guest'],
  },
  children: {
    ftp: {
      name: 'ftp',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root', 'user'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        public: {
          name: 'public',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root', 'user', 'guest'],
          },
          children: {
            'readme.txt': {
              name: 'readme.txt',
              type: 'file',
              owner: 'root',
              permissions: {
                read: ['root', 'user', 'guest'],
                write: ['root'],
                execute: ['root'],
              },
              content: `=== JSHACK-CORP FILE SERVER ===
Public FTP directory — read-only for guests.
Upload permissions require ftpuser account.

For issues, contact sysadmin.
`,
            },
            'CHANGELOG.txt': {
              name: 'CHANGELOG.txt',
              type: 'file',
              owner: 'root',
              permissions: {
                read: ['root', 'user', 'guest'],
                write: ['root'],
                execute: ['root'],
              },
              content: `v2.1.0 - Migrated to vsftpd 3.0.5
v2.0.3 - Fixed upload permissions for ftpuser
v2.0.2 - Disabled anonymous login (security audit)
v2.0.1 - Patched passive mode port range
v2.0.0 - Initial deployment
`,
            },
          },
        },
        uploads: {
          name: 'uploads',
          type: 'directory',
          owner: 'user',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root', 'user'],
            execute: ['root', 'user', 'guest'],
          },
          children: {
            '.backup_notes.txt': {
              name: '.backup_notes.txt',
              type: 'file',
              owner: 'user',
              permissions: {
                read: ['root', 'user'],
                write: ['root', 'user'],
                execute: ['root'],
              },
              content: `Backup rotation schedule — DO NOT SHARE

Daily backups run at 02:00 UTC via /usr/local/bin/backup.sh
Retention policy: 30 days
Encryption: AES-256-GCM (key stored separately in /srv/ftp/config/)

Webserver SSH accepts default guest credentials.
`,
            },
            'meeting_notes_2024.txt': {
              name: 'meeting_notes_2024.txt',
              type: 'file',
              owner: 'user',
              permissions: {
                read: ['root', 'user'],
                write: ['root', 'user'],
                execute: ['root'],
              },
              content: `Team Standup — March 2024
=========================

Attendees: admin, www-data, ftpuser

Action Items:
- [admin] Review firewall rules on gateway
- [www-data] Deploy new portal update by Friday
- [ftpuser] Clean up old uploads directory
- [admin] Schedule quarterly password rotation
- [www-data] Fix Apache config warnings

Next meeting: April 1, 2024
`,
            },
            'tmp_data.csv': {
              name: 'tmp_data.csv',
              type: 'file',
              owner: 'user',
              permissions: {
                read: ['root', 'user', 'guest'],
                write: ['root', 'user'],
                execute: ['root'],
              },
              content: `timestamp,source_ip,dest_ip,bytes,protocol
2024-03-10T10:00:00,192.168.1.100,192.168.1.75,4520,TCP
2024-03-10T10:05:00,192.168.1.75,192.168.1.50,12800,TCP
2024-03-10T10:10:00,192.168.1.1,192.168.1.100,890,ICMP
2024-03-10T10:15:00,192.168.1.50,192.168.1.1,1200,TCP
2024-03-10T10:20:00,192.168.1.100,192.168.1.75,33200,TCP
`,
            },
          },
        },
        config: {
          name: 'config',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user'],
            write: ['root'],
            execute: ['root', 'user'],
          },
          children: {
            '.key_fragment': {
              name: '.key_fragment',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `# Encryption key fragment (part 2 of 2)
# Combine with part 1 to get the full 64-character hex key

DECRYPT_KEY_PART2=ea2d996cb180258ec89c0000b42db460
`,
            },
          },
        },
      },
    },
  },
};

const fileserverConfig: MachineFileSystemConfig = {
  users: [
    {
      username: 'root',
      passwordHash: '4a080e0e088d55294ab894a02b5c8e3f',
      userType: 'root',
      uid: 0,
    },
    {
      username: 'ftpuser',
      passwordHash: 'be7a9d8e813210208cb7fba28717cda7',
      userType: 'user',
      uid: 1001,
      homeContent: ftpuserHome,
    },
    {
      username: 'guest',
      passwordHash: '294de3557d9d00b3d2d8a1e6aab028cf',
      userType: 'guest',
      uid: 1002,
      homeContent: guestHome,
    },
  ],
  etcExtraContent: {
    hostname: {
      name: 'hostname',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: 'fileserver\n',
    },
    'vsftpd.conf': {
      name: 'vsftpd.conf',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root'], write: ['root'], execute: ['root'] },
      content: `# vsftpd configuration
listen=YES
anonymous_enable=NO
local_enable=YES
write_enable=YES
chroot_local_user=NO
pasv_min_port=10000
pasv_max_port=10100
ftpd_banner=Welcome to JSHACK-CORP FTP service.
`,
    },
  },
  varLogContent: {
    'vsftpd.log': {
      name: 'vsftpd.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `[2024-03-14 22:00:01] CONNECT: Client "192.168.1.100"
[2024-03-14 22:00:03] OK LOGIN: Client "192.168.1.100", user "ftpuser"
[2024-03-14 22:00:10] OK DOWNLOAD: Client "192.168.1.100", "/srv/ftp/uploads/meeting_notes.txt", 312 bytes
[2024-03-14 22:05:00] OK UPLOAD: Client "192.168.1.100", "/srv/ftp/uploads/tmp_data.csv", 280 bytes
[2024-03-15 02:00:00] CONNECT: Client "192.168.1.1"
[2024-03-15 02:00:02] OK LOGIN: Client "192.168.1.1", user "ftpuser"
[2024-03-15 02:00:15] OK DOWNLOAD: Client "192.168.1.1", "/srv/ftp/public/CHANGELOG.txt", 188 bytes
`,
    },
    syslog: {
      name: 'syslog',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `Mar 15 00:00:01 fileserver CRON[5001]: (root) CMD (/usr/local/bin/backup.sh)
Mar 15 02:00:00 fileserver vsftpd[5100]: connection from 192.168.1.1
Mar 15 06:00:01 fileserver CRON[5200]: (root) CMD (/usr/local/bin/cleanup.sh)
Mar 15 08:30:00 fileserver sshd[5300]: Starting OpenSSH server
Mar 15 08:30:05 fileserver kernel: [  120.5] eth0: link up
`,
    },
  },
  extraDirectories: { srv: srvFtp },
  binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
  usrSbinContent: createBinaryEntries(SBIN_UTILITY_NAMES),
  varRunContent: {
    [SSH_PID_FILE_NAME]: createSshdPidFileNode(),
    [FTP_PID_FILE_NAME]: createFtpdPidFileNode(),
  },
  passwdReadableBy: ['root'],
};

export const fileserver: FileNode = createFileSystem(fileserverConfig);
