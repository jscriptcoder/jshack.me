import type { FileNode } from '../types';
import { createFileSystem, type MachineFileSystemConfig } from '../fileSystemFactory';
import { createBinaryEntries, SYSTEM_UTILITY_NAMES } from '../../commands/availability';

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
Sitemap: http://webserver.local/sitemap.xml
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
            // Backdoor log — discoverable via nc on port 4444
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
