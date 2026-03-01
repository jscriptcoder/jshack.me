import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';
import { createBinaryEntries, SYSTEM_UTILITY_NAMES } from '../../commands/availability';

// Scanner binary — ELF-style tool with embedded strings
const scannerBinary =
  '\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00' +
  '\x02\x00>\x00\x01\x00\x00\x00\x80\x04\x40\x00\x00\x00\x00\x00' +
  '\x40\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' +
  'scanner v2.3.1\x00' +
  '\x89\xe5\x48\x83\xec\x20\x00\x00\x00\x00\x00\x00' +
  'Usage: scanner [options] target\x00' +
  '\xb8\x01\x00\x00\x00\xbb\x00\x00\x00\x00\xcd\x80' +
  '\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00' +
  'DECRYPT_KEY_PART1=76e2e21dacea215ff2293e4eafc5985c\x00' +
  '\x48\x89\xc7\xe8\x00\x00\x00\x00\x00\x00\x00\x00' +
  'See /var/www/backups/ for the encrypted file.\x00' +
  '\x00\x00\x00\x00' +
  'The second half of the key is in /srv/ftp/config/ on the fileserver.\x00' +
  '\xc3\x90\x90\x00\x00\x00\x00\x00';

const wwwDataHome: Readonly<Record<string, FileNode>> = {
  '.bash_history': {
    name: '.bash_history',
    type: 'file',
    owner: 'user',
    permissions: { read: ['root', 'user'], write: ['root', 'user'], execute: ['root'] },
    content: `systemctl restart apache2
tail -f /var/log/access.log
mysql -u root -p production
cat /var/www/html/index.html
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
    content: `Guest account — limited shell access.
Contact www-data for application deployment.
`,
  },
};

const webserverConfig: MachineFileSystemConfig = {
  users: [
    {
      username: 'root',
      passwordHash: 'a6f6c10dc3602b020c56ff49fb043ca9',
      userType: 'root',
      uid: 0,
    }, // r00tW3b!
    {
      username: 'www-data',
      passwordHash: 'd2d8d0cdf38ea5a54439ffadf7597722',
      userType: 'user',
      uid: 1000,
      homeContent: wwwDataHome,
    }, // d3v0ps2024
    {
      username: 'guest',
      passwordHash: 'b2ce03aefab9060e1a42bd1aa1c571f6',
      userType: 'guest',
      uid: 1001,
      homeContent: guestHome,
    }, // w3lcome
  ],
  etcExtraContent: {
    hostname: {
      name: 'hostname',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: 'webserver\n',
    },
    apache2: {
      name: 'apache2',
      type: 'directory',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
      children: {
        'apache2.conf': {
          name: 'apache2.conf',
          type: 'file',
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
          content: `# Apache2 Configuration
ServerRoot "/etc/apache2"
Listen 80
ServerName webserver.local
DocumentRoot "/var/www/html"

<Directory "/var/www/html">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

ErrorLog /var/log/error.log
CustomLog /var/log/access.log combined
`,
        },
      },
    },
    mysql: {
      name: 'mysql',
      type: 'directory',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
      children: {
        'my.cnf': {
          name: 'my.cnf',
          type: 'file',
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
          content: `# MySQL Configuration
[mysqld]
datadir=/var/lib/mysql
socket=/var/run/mysqld/mysqld.sock
port=3306
bind-address=127.0.0.1
max_connections=100
innodb_buffer_pool_size=256M
log_error=/var/log/mysql.log
`,
        },
      },
    },
  },
  varLogContent: {
    'access.log': {
      name: 'access.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: `192.168.1.100 - - [10/Mar/2024:10:00:00 +0000] "GET / HTTP/1.1" 200 1234
192.168.1.100 - - [10/Mar/2024:10:00:05 +0000] "GET /admin HTTP/1.1" 403 567
192.168.1.1 - - [10/Mar/2024:12:30:00 +0000] "POST /api/login HTTP/1.1" 200 89
192.168.1.50 - - [11/Mar/2024:08:00:00 +0000] "GET /status HTTP/1.1" 200 456
`,
    },
    'error.log': {
      name: 'error.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user', 'guest'], write: ['root'], execute: ['root'] },
      content: `[error] MySQL connection failed: Access denied for user 'webapp'@'localhost'
[error] PHP Warning: include(/var/www/html/config.php): failed to open stream
[warn] mod_security: Suspicious request detected from 10.0.0.42
[notice] www-data console login: password 'd3v0ps2024' (audit mode enabled)
`,
    },
    'mysql.log': {
      name: 'mysql.log',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `2024-03-10T08:00:00.000000Z 0 [System] mysqld: ready for connections. Version: '5.7.42'
2024-03-10T10:00:15.123456Z 12 [Query] SELECT * FROM sessions WHERE expires > NOW()
2024-03-10T10:05:22.654321Z 12 [Query] UPDATE users SET last_login = NOW() WHERE id = 2
2024-03-10T12:30:45.789012Z 18 [Query] INSERT INTO sessions (token, user_id, expires) VALUES (...)
2024-03-11T04:00:00.000000Z 0 [System] mysqld: Shutdown complete
2024-03-11T04:00:05.000000Z 0 [System] mysqld: ready for connections. Version: '5.7.42'
`,
    },
    syslog: {
      name: 'syslog',
      type: 'file',
      owner: 'root',
      permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
      content: `Mar 15 00:00:01 webserver CRON[4001]: (root) CMD (/usr/local/bin/cleanup.sh)
Mar 15 02:00:00 webserver mysqld[4100]: ready for connections
Mar 15 06:00:01 webserver CRON[4200]: (root) CMD (logrotate /etc/logrotate.conf)
Mar 15 08:30:00 webserver sshd[4300]: Starting OpenSSH server
Mar 15 08:30:05 webserver kernel: [  120.5] eth0: link up
`,
    },
  },
  extraDirectories: {
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
        www: {
          name: 'www',
          type: 'directory',
          owner: 'root',
          permissions: {
            read: ['root', 'user', 'guest'],
            write: ['root'],
            execute: ['root', 'user', 'guest'],
          },
          children: {
            html: {
              name: 'html',
              type: 'directory',
              owner: 'root',
              permissions: {
                read: ['root', 'user', 'guest'],
                write: ['root'],
                execute: ['root', 'user', 'guest'],
              },
              children: {
                'index.html': {
                  name: 'index.html',
                  type: 'file',
                  owner: 'root',
                  permissions: {
                    read: ['root', 'user', 'guest'],
                    write: ['root'],
                    execute: ['root'],
                  },
                  content: `<!DOCTYPE html>
<html>
<head><title>TechCorp Internal</title></head>
<body>
<h1>TechCorp Internal Portal</h1>
<p>Welcome to the TechCorp internal web server.</p>
<ul>
  <li><a href="/status">System Status</a></li>
  <li><a href="/admin">Admin Panel</a> (restricted)</li>
</ul>
<!-- Server: Apache/2.4.41 -->
<!-- MySQL running on port 3306 -->
</body>
</html>
`,
                },
                'robots.txt': {
                  name: 'robots.txt',
                  type: 'file',
                  owner: 'root',
                  permissions: {
                    read: ['root', 'user', 'guest'],
                    write: ['root'],
                    execute: ['root'],
                  },
                  content: `User-agent: *
Disallow: /admin/
Disallow: /api/
Disallow: /backups/
Sitemap: http://webserver.local/sitemap.xml
`,
                },
                '.htaccess': {
                  name: '.htaccess',
                  type: 'file',
                  owner: 'root',
                  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
                  content: `RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^(.*)$ /index.html [L]

# Security headers
Header set X-Content-Type-Options "nosniff"
Header set X-Frame-Options "SAMEORIGIN"
Header set X-XSS-Protection "1; mode=block"
`,
                },
                'style.css': {
                  name: 'style.css',
                  type: 'file',
                  owner: 'root',
                  permissions: {
                    read: ['root', 'user', 'guest'],
                    write: ['root'],
                    execute: ['root'],
                  },
                  content: `/* TechCorp Internal Portal */
:root { --primary: #1a5276; --accent: #2ecc71; --bg: #ecf0f1; }
body { font-family: 'Segoe UI', sans-serif; background: var(--bg); margin: 0; }
.header { background: var(--primary); color: white; padding: 1rem 2rem; }
.nav a { color: #85c1e9; margin-right: 1rem; text-decoration: none; }
.content { padding: 2rem; max-width: 960px; margin: 0 auto; }
.alert { background: #f9e79f; padding: 10px; border-left: 4px solid #f1c40f; }
`,
                },
              },
            },
            backups: {
              name: 'backups',
              type: 'directory',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
              children: {
                'backup_manifest.txt': {
                  name: 'backup_manifest.txt',
                  type: 'file',
                  owner: 'root',
                  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
                  content: `Backup Manifest — TechCorp Webserver
=====================================

Date        File                    Size     Status
2024-03-10  db_backup.sql           2.4 KB   OK
2024-03-03  db_backup_old.sql       2.1 KB   ARCHIVED
2024-02-24  site_backup.tar.gz      45.2 MB  ARCHIVED

Schedule: Daily at 02:00 UTC
Retention: 30 days
`,
                },
                'db_backup.sql': {
                  name: 'db_backup.sql',
                  type: 'file',
                  owner: 'root',
                  permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
                  content: `-- MySQL dump
-- Server version: 5.7.42
-- Database: production

CREATE TABLE users (
  id INT PRIMARY KEY,
  username VARCHAR(50),
  password VARCHAR(255),
  role VARCHAR(20)
);

INSERT INTO users VALUES (1, 'root', 'r00tW3b!', 'administrator');
INSERT INTO users VALUES (2, 'www-data', 'd3v0ps2024', 'service');
INSERT INTO users VALUES (3, 'guest', 'w3lcome', 'readonly');

CREATE TABLE sessions (
  token VARCHAR(255),
  user_id INT,
  expires DATETIME
);
`,
                },
              },
            },
          },
        },
      },
    },
    opt: {
      name: 'opt',
      type: 'directory',
      owner: 'root',
      permissions: {
        read: ['root', 'user', 'guest'],
        write: ['root'],
        execute: ['root', 'user', 'guest'],
      },
      children: {
        tools: {
          name: 'tools',
          type: 'directory',
          owner: 'root',
          permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
          children: {
            scanner: {
              name: 'scanner',
              type: 'file',
              owner: 'root',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root', 'user'] },
              content: scannerBinary,
            },
            '.backdoor_log': {
              name: '.backdoor_log',
              type: 'file',
              owner: 'user',
              permissions: { read: ['root', 'user'], write: ['root'], execute: ['root'] },
              content: `Backdoor installed by unknown actor
Connection established on port 4444
Last activity: 2024-03-11 03:15:00 UTC
`,
            },
          },
        },
      },
    },
  },
  binContent: createBinaryEntries(SYSTEM_UTILITY_NAMES),
  passwdReadableBy: ['root'],
};

export const webserver: FileNode = createFileSystem(webserverConfig);
