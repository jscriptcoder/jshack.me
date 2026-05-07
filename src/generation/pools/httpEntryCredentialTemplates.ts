// HTTP entry credential templates — placed in /var/www/html/ on the entry machine
// when the entry variant is 'http'. Players discover these via gobuster + curl.
// Body-based: credentials visible in file content via regular curl.
// Header-based (sidecarHeader set): credentials in .headers sidecar, requires curl -i.
export type HttpEntryCredentialTemplate = {
  readonly webPath: string; // Path relative to /var/www/html/, e.g., '.env', 'admin/config.json'
  readonly content: string; // File body (with {{username}}/{{password}} for body-based)
  readonly sidecarHeader?: string; // If set, credential goes in .headers sidecar with this header name
};

export const httpEntryCredentialTemplates: readonly HttpEntryCredentialTemplate[] = [
  // Body-based: credentials in file content
  {
    webPath: '.env',
    content: [
      'APP_ENV=production',
      'APP_DEBUG=false',
      'APP_KEY=base64:Rk9PQkFSQkFaUVVYQ09SR0U=',
      '',
      'DB_CONNECTION=mysql',
      'DB_HOST=127.0.0.1',
      'DB_PORT=3306',
      'DB_DATABASE=webapp',
      '',
      '# SSH tunnel for remote DB access',
      'SSH_USER={{username}}',
      'SSH_PASS={{password}}',
      'SSH_HOST=localhost',
    ].join('\n'),
  },
  {
    webPath: 'admin/config.json',
    content: [
      '{',
      '  "admin": {',
      '    "panel": "/admin/",',
      '    "debug": false',
      '  },',
      '  "ssh": {',
      '    "host": "localhost",',
      '    "user": "{{username}}",',
      '    "password": "{{password}}"',
      '  },',
      '  "backup": {',
      '    "enabled": true,',
      '    "schedule": "daily"',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    webPath: 'api/health',
    content: [
      '{',
      '  "status": "healthy",',
      '  "uptime": "14d 6h 23m",',
      '  "version": "4.2.1",',
      '  "services": {',
      '    "ssh": {',
      '      "user": "{{username}}",',
      '      "pass": "{{password}}",',
      '      "status": "active"',
      '    },',
      '    "http": "running",',
      '    "db": "connected"',
      '  }',
      '}',
    ].join('\n'),
  },
  // Header-based: credentials in .headers sidecar (requires curl -i)
  {
    webPath: 'index.html',
    content: '', // Uses the existing index.html body (no new file created for this path)
    sidecarHeader: 'X-Debug-Token',
  },
  {
    webPath: 'status',
    content: [
      'System Status: OK',
      'Uptime: 14 days, 6 hours',
      'Load: 0.42',
      'Services: ssh(active) http(active) db(active)',
    ].join('\n'),
    sidecarHeader: 'X-Session-Token',
  },
  {
    webPath: 'admin/debug.html',
    content: [
      '<html>',
      '<head><title>Debug Console</title></head>',
      '<body>',
      '<h1>Debug Console</h1>',
      '<p>Debug mode: disabled</p>',
      '<p>Environment: production</p>',
      '<!-- enable debug: ?debug=1 -->',
      '</body>',
      '</html>',
    ].join('\n'),
    sidecarHeader: 'X-Internal-Auth',
  },
  // Body-based: credentials in file content
  {
    webPath: 'backup/credentials.txt',
    content: [
      '# Emergency access credentials',
      '# Created: 2024-03-10 during migration',
      '',
      'SSH_HOST=localhost',
      'SSH_PORT=22',
      'SSH_USER={{username}}',
      'SSH_PASS={{password}}',
      '',
      '# TODO: delete this file after migration completes',
    ].join('\n'),
  },
  {
    webPath: 'api/debug/config',
    content: [
      '{',
      '  "debug": true,',
      '  "env": "staging",',
      '  "build": "4.2.1-rc3",',
      '  "ssh_tunnel": {',
      '    "enabled": true,',
      '    "username": "{{username}}",',
      '    "password": "{{password}}",',
      '    "forward": "localhost:3306"',
      '  }',
      '}',
    ].join('\n'),
  },
  // Header-based: credentials in .headers sidecar (requires curl -i)
  {
    webPath: 'api/v1/health',
    content: [
      '{',
      '  "status": "ok",',
      '  "checks": {',
      '    "database": "connected",',
      '    "cache": "hit_rate_94",',
      '    "queue": "0_pending"',
      '  },',
      '  "version": "3.8.2"',
      '}',
    ].join('\n'),
    sidecarHeader: 'X-Service-Token',
  },
  {
    webPath: 'server-status',
    content: [
      'Server Status for {{hostname}}',
      'Server uptime: 31 days 4 hours 22 minutes',
      'Total accesses: 148203',
      'CPU Usage: u12.3 s4.1',
      '2 requests currently being processed, 8 idle workers',
    ].join('\n'),
    sidecarHeader: 'X-Admin-Credential',
  },
  // Body-based: credentials in file content
  {
    webPath: 'config/database.yml',
    content: [
      'production:',
      '  adapter: postgresql',
      '  host: localhost',
      '  port: 5432',
      '  database: webapp_prod',
      '  ssh_user: {{username}}',
      '  ssh_password: {{password}}',
      '  pool: 10',
      '  timeout: 5000',
    ].join('\n'),
  },
  {
    webPath: '.git/config',
    content: [
      '[core]',
      '  repositoryformatversion = 0',
      '  filemode = true',
      '[remote "origin"]',
      '  url = https://{{username}}:{{password}}@git.corp.local/webapp.git',
      '  fetch = +refs/heads/*:refs/remotes/origin/*',
      '[branch "main"]',
      '  remote = origin',
      '  merge = refs/heads/main',
    ].join('\n'),
  },
  {
    webPath: 'phpinfo.php',
    content: [
      '<?php',
      '// Temporary debug page — remove before go-live',
      '// SSH access for remote debugging:',
      '//   user: {{username}}',
      '//   pass: {{password}}',
      'phpinfo();',
      '?>',
    ].join('\n'),
  },
  {
    webPath: 'api/internal/whoami',
    content: [
      '{',
      '  "service": "auth-gateway",',
      '  "node": "prod-web-01",',
      '  "tunnel": {',
      '    "type": "ssh",',
      '    "user": "{{username}}",',
      '    "password": "{{password}}"',
      '  },',
      '  "uptime_sec": 1243800',
      '}',
    ].join('\n'),
  },
  {
    webPath: 'wp-config.php.bak',
    content: [
      '<?php',
      "define('DB_NAME', 'wordpress');",
      "define('DB_USER', '{{username}}');",
      "define('DB_PASSWORD', '{{password}}');",
      "define('DB_HOST', 'localhost');",
      '',
      "define('AUTH_KEY', 'z9$kR!mP&4qW^eB');",
      "define('SECURE_AUTH_KEY', 'vN2@xL#8dF+jH5');",
      '?>',
    ].join('\n'),
  },
  // Header-based: credentials in .headers sidecar (requires curl -i)
  {
    webPath: 'robots.txt',
    content: [
      'User-agent: *',
      'Disallow: /admin/',
      'Disallow: /api/internal/',
      'Disallow: /backup/',
    ].join('\n'),
    sidecarHeader: 'X-Forwarded-Credentials',
  },
  {
    webPath: 'health',
    content: [
      '{',
      '  "status": "healthy",',
      '  "checks": {',
      '    "disk": "ok",',
      '    "memory": "ok",',
      '    "database": "ok"',
      '  },',
      '  "version": "2.14.0"',
      '}',
    ].join('\n'),
    sidecarHeader: 'X-Auth-Token',
  },
  {
    webPath: 'admin/login.html',
    content: [
      '<html>',
      '<head><title>Admin Login</title></head>',
      '<body>',
      '<form method="POST" action="/admin/auth">',
      '  <input type="text" name="user" placeholder="Username">',
      '  <input type="password" name="pass" placeholder="Password">',
      '  <button type="submit">Login</button>',
      '</form>',
      '</body>',
      '</html>',
    ].join('\n'),
    sidecarHeader: 'X-Dev-Credentials',
  },
];
