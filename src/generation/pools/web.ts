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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — nginx</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>nginx reverse proxy — upstream: 127.0.0.1:8080</p>\n<p>SSL: enabled | HTTP/2: enabled</p>\n<p><a href="/server-status">Server Status</a> | <a href="/.well-known/security.txt">Security</a></p>\n<!-- nginx/1.24.0 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Application Server</title></head>\n<body>\n<h1>{{hostname}} App Server</h1>\n<p>Node.js v18.17.0 | PM2 cluster mode</p>\n<p>Workers: 4/4 | Memory: 312MB | Uptime: 18d 4h</p>\n<p><a href="/api/health">Health Check</a> | <a href="/metrics">Prometheus Metrics</a></p>\n<!-- Express 4.18.2 -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — pfSense</title></head>\n<body>\n<h1>pfSense — {{hostname}}</h1>\n<p>pfSense CE 2.7.0 | FreeBSD 14.0</p>\n<p>WAN: up | LAN: up | OpenVPN: 2 clients</p>\n<form action="/index.php" method="POST">\n<label>Username: <input type="text" name="usernamefld"></label><br>\n<label>Password: <input type="password" name="passwordfld"></label><br>\n<input type="submit" value="Sign In">\n</form>\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — OPNsense</title></head>\n<body>\n<h1>OPNsense — {{hostname}}</h1>\n<p>OPNsense 23.7 | HardenedBSD 13.2</p>\n<p>Interfaces: 3 | Firewall rules: 47 | NAT rules: 12</p>\n<p><a href="/ui/core/dashboard">Dashboard</a></p>\n<!-- default: root/opnsense -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — IP Camera</title></head>\n<body>\n<h1>{{hostname}} — Network Camera</h1>\n<p>Hikvision DS-2CD2xx — Firmware V5.5.82</p>\n<p>Resolution: 1080p | FPS: 25 | Storage: SD 64GB (38% used)</p>\n<form action="/ISAPI/Security/userCheck" method="POST">\n<label>Admin: <input type="text" name="user" value="admin"></label><br>\n<label>Password: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — HVAC Controller</title></head>\n<body>\n<h1>{{hostname}} BMS Interface</h1>\n<p>Building Management System — Honeywell WEB-8000</p>\n<p>Zones: 4 | Set: 22.0°C | Current: 21.8°C | Mode: Auto</p>\n<p><a href="/api/v1/zones">Zone API</a> | <a href="/schedules">Schedules</a></p>\n<!-- Niagara 4.10 -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>pgAdmin 4 — {{hostname}}</title></head>\n<body>\n<h1>pgAdmin 4</h1>\n<p>PostgreSQL Administration v7.8</p>\n<form action="/login" method="POST">\n<label>Email: <input type="text" name="email"></label><br>\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- pgAdmin4 7.8 / PostgreSQL {{hostname}} -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Redis Commander</title></head>\n<body>\n<h1>Redis Commander — {{hostname}}</h1>\n<p>Connected to redis://127.0.0.1:6379</p>\n<p>Keys: 12,847 | Memory: 48MB / 256MB | Clients: 6</p>\n<p><a href="/apiv2/server/info">Server Info</a> | <a href="/apiv2/connection">Connection</a></p>\n<!-- redis-commander 0.8.0 -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — MinIO Console</title></head>\n<body>\n<h1>MinIO — {{hostname}}</h1>\n<p>Object Storage Console</p>\n<p>Buckets: 5 | Objects: 23,401 | Usage: 1.2TB</p>\n<form action="/api/v1/login" method="POST">\n<label>Access Key: <input type="text" name="accessKey"></label><br>\n<label>Secret Key: <input type="password" name="secretKey"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- MinIO RELEASE.2024-01-16 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Nextcloud</title></head>\n<body>\n<h1>Nextcloud — {{hostname}}</h1>\n<p>Nextcloud Hub 27.1.4</p>\n<p>Users: 12 | Files: 48,293 | Storage: 340GB</p>\n<form action="/login" method="POST">\n<label>Username: <input type="text" name="user"></label><br>\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Log in">\n</form>\n<!-- PHP 8.2 | Apache/2.4.57 -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Zimbra</title></head>\n<body>\n<h1>Zimbra Collaboration — {{hostname}}</h1>\n<p>Zimbra 10.0.1 Network Edition</p>\n<form action="/service/soap/AuthRequest" method="POST">\n<label>Email: <input type="text" name="username"></label><br>\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Sign In">\n</form>\n<!-- Zimbra 10.0.1_GA | Jetty 9.4.51 -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — SOGo</title></head>\n<body>\n<h1>SOGo Groupware — {{hostname}}</h1>\n<p>SOGo v5.9.0 | Contacts, Calendar, Mail</p>\n<p>Active users: 14 | Queue: 0 deferred | Uptime: 31d</p>\n<p><a href="/SOGo/">Webmail</a> | <a href="/SOGo/so/admin">Admin</a></p>\n<!-- SOGo 5.9.0 / Postfix 3.7.4 -->\n</body>\n</html>',
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
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Gitea</title></head>\n<body>\n<h1>Gitea — {{hostname}}</h1>\n<p>Gitea Version: 1.21.4 | Git Version: 2.43.0</p>\n<p>Repos: 23 | Users: 8 | Orgs: 2</p>\n<form action="/user/login" method="POST">\n<label>Username: <input type="text" name="user_name"></label><br>\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Sign In">\n</form>\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Jenkins</title></head>\n<body>\n<h1>Jenkins — {{hostname}}</h1>\n<p>Jenkins ver. 2.426.3</p>\n<p>Executors: 4/4 busy | Queue: 2 | Builds today: 47</p>\n<form action="/j_spring_security_check" method="POST">\n<label>User: <input type="text" name="j_username"></label><br>\n<label>Password: <input type="password" name="j_password"></label><br>\n<input type="submit" value="Sign in">\n</form>\n<!-- Jenkins 2.426.3 -->\n</body>\n</html>',
  },
];

// Managed switch web management interface templates.
const switchWebContentTemplates: readonly WebContentTemplate[] = [
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Switch Management</title></head>\n<body>\n<h1>{{hostname}} L3 Switch</h1>\n<p>Cisco IOS Web Interface v15.2(4)E</p>\n<form action="/login" method="POST">\n<label>Username: <input type="text" name="user"></label><br>\n<label>Password: <input type="password" name="pass"></label><br>\n<input type="submit" value="Login">\n</form>\n<!-- firmware: IOS 15.2(4)E -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — VLAN Manager</title></head>\n<body>\n<h1>{{hostname}}</h1>\n<p>Layer 3 Switch Management v3.1.0</p>\n<p><a href="/admin/">ACL Config</a> | <a href="/vlans">VLAN Status</a></p>\n<!-- contact: netadmin@corp.local for access -->\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — HP ProCurve</title></head>\n<body>\n<h1>HP ProCurve — {{hostname}}</h1>\n<p>ProCurve Switch 2920-24G | Firmware WB.16.10</p>\n<p>Ports: 24 (20 up) | PoE: 185W / 370W | VLANs: 6</p>\n<form action="/login/authenticate" method="POST">\n<label>Username: <input type="text" name="username"></label><br>\n<label>Password: <input type="password" name="password"></label><br>\n<input type="submit" value="Log In">\n</form>\n</body>\n</html>',
  },
  {
    path: '/var/www/html/index.html',
    content:
      '<html>\n<head><title>{{hostname}} — Aruba</title></head>\n<body>\n<h1>ArubaOS-CX — {{hostname}}</h1>\n<p>Aruba CX 6300M | AOS-CX 10.12</p>\n<p>Uplink: 10Gbps | STP: root bridge | Clients: 47</p>\n<p><a href="/rest/v10.12/system">REST API</a> | <a href="/admin/">Dashboard</a></p>\n<!-- ArubaOS-CX 10.12.0001 -->\n</body>\n</html>',
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
  switch: switchWebContentTemplates,
};
