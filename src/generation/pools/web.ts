import type { MachineRole } from '../types';

type WebContentTemplate = {
  readonly path: string;
  readonly content: string;
};

export type { WebContentTemplate };

export const webContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Status</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Server operational. Build 4.2.1</p>\n<p><a href="/admin/">Admin Panel</a> | <a href="/status">Status</a></p>\n<!-- deploy: automated via CI/CD pipeline -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>Welcome — {{hostname}}</title></head>\n<body>\n<h1>Welcome to {{hostname}}</h1>\n<p>Internal corporate portal v3.1.0</p>\n<ul>\n<li><a href="/status">System Status</a></li>\n<li><a href="/admin/">Administration</a></li>\n</ul>\n<!-- TODO: remove debug endpoints before release -->\n</body>\n</html>',
  },
];

// Router admin panel templates — realistic management interfaces.
const routerWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Management Console</title></head>\n<body>\n<h1>{{hostname}} Admin Panel</h1>\n<p>Network Gateway Management Interface</p>\n<form action="/login" method="POST">\n<label>Username: <input type="text" name="user"></label><br>\n<label>Password: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- firmware: v2.4.1-stable -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Network Controller</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Firewall &amp; Routing Management v1.8.3</p>\n<p><a href="/admin/">Dashboard</a> | <a href="/status">System Status</a></p>\n<!-- contact: netops@corp.local for access -->\n</body>\n</html>',
  },
];

// IoT device admin panel templates — minimal embedded web interfaces.
const iotWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Device Portal</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>IoT Gateway — Firmware v2.1.4</p>\n<p>Status: <span style="color:green">ONLINE</span></p>\n<form action="/login" method="POST">\n<label>User: <input type="text" name="user" value="admin"></label><br>\n<label>Pass: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- GoAhead/3.6.5 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Sensor Hub</title></head>\n<body>\n<h1>{{hostname}} Control Panel</h1>\n<p>BusyBox httpd — Device Management</p>\n<p>Uptime: 47d 12h | MQTT: connected | Sensors: 3/3</p>\n<p><a href="/status">Status</a> | <a href="/config">Config</a> | <a href="/api/v1/data">API</a></p>\n<!-- default credentials: admin/admin -->\n</body>\n</html>',
  },
];

// Database admin panel templates — phpMyAdmin/pgAdmin-style interfaces.
const databaseWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>phpMyAdmin — {{hostname}}</title></head>\n<body>\n<h1>phpMyAdmin</h1>\n<p>Welcome to phpMyAdmin 5.2.1</p>\n<form action="/index.php" method="POST">\n<label>Username: <input type="text" name="pma_username"></label><br>\n<label>Password: <input type="password" name="pma_password"></label><br>\n<input type="submit" value="Go">\n</form>\n<!-- phpMyAdmin 5.2.1 / MySQL {{hostname}} -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Database Status</title></head>\n<body>\n<h1>{{hostname}} Database Server</h1>\n<p>Engine: MySQL 5.7 | Status: <span style="color:green">Running</span></p>\n<p>Connections: 14/100 | Uptime: 23d 8h</p>\n<p><a href="/admin/">Admin Console</a> | <a href="/status">Replication Status</a></p>\n<!-- Adminer 4.8.1 -->\n</body>\n</html>',
  },
];

// Fileserver web panel templates — web-based file manager interfaces.
const fileserverWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — File Manager</title></head>\n<body>\n<h1>{{hostname}} File Manager</h1>\n<p>Web File Browser v1.4.2</p>\n<form action="/login" method="POST">\n<label>User: <input type="text" name="user"></label><br>\n<label>Pass: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- FileBrowser/2.23.0 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Storage</title></head>\n<body>\n<h1>{{hostname}} NAS Portal</h1>\n<p>Storage: 847GB / 2TB (42% used)</p>\n<p>Shares: public, backup, archive</p>\n<p><a href="/files/">Browse Files</a> | <a href="/admin/">Admin</a></p>\n<!-- Synology DSM 7.1 -->\n</body>\n</html>',
  },
];

// Mailserver web panel templates — webmail/admin interfaces.
const mailserverWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>Roundcube Webmail — {{hostname}}</title></head>\n<body>\n<h1>Roundcube Webmail</h1>\n<p>{{hostname}} Mail Server</p>\n<form action="/login" method="POST">\n<label>Email: <input type="text" name="user"></label><br>\n<label>Password: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- Roundcube 1.6.3 | Postfix/Dovecot -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Mail Administration</title></head>\n<body>\n<h1>{{hostname}} Mail Admin</h1>\n<p>Postfix Admin 3.3.11</p>\n<p>Domains: 2 | Mailboxes: 14 | Aliases: 8</p>\n<p><a href="/admin/">Domain Admin</a> | <a href="/status">Queue Status</a></p>\n<!-- Postfix 3.5.6 -->\n</body>\n</html>',
  },
];

// Workstation web panel templates — development/internal tool interfaces.
const workstationWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Dev Tools</title></head>\n<body>\n<h1>{{hostname}} Developer Portal</h1>\n<p>Internal tooling dashboard v2.0.1</p>\n<p><a href="/jenkins/">CI/CD</a> | <a href="/grafana/">Monitoring</a> | <a href="/docs/">API Docs</a></p>\n<!-- nginx/1.20.1 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Workstation</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Code Server — VS Code in the browser</p>\n<form action="/login" method="POST">\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- code-server 4.16.1 -->\n</body>\n</html>',
  },
];

// Role-based web content template lookup. Every role has templates so any machine
// with an open HTTP port gets realistic web content.
export const webContentTemplatesByRole: Readonly<
  Record<MachineRole, readonly WebContentTemplate[]>
> = {
  webserver: webContentTemplates,
  router: routerWebContentTemplates,
  database: databaseWebContentTemplates,
  fileserver: fileserverWebContentTemplates,
  mailserver: mailserverWebContentTemplates,
  iot: iotWebContentTemplates,
  workstation: workstationWebContentTemplates,
};
