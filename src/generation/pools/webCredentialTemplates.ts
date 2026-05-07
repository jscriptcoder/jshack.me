// Web credential templates — placed in /var/www/html/ on non-entry machines with HTTP ports.
// {{username}} and {{password}} are filled with a non-root, non-guest user on the machine.
// These are same-machine credentials discoverable via curl/gobuster.
export type WebCredentialTemplate = {
  readonly webPath: string;
  readonly content: string;
  readonly sidecarHeader?: string;
};

export const webCredentialTemplates: readonly WebCredentialTemplate[] = [
  // Body-based: credentials visible in file content
  {
    webPath: '.env.bak',
    content: [
      '# Environment backup — created during migration',
      'APP_ENV=production',
      'APP_DEBUG=false',
      '',
      'SSH_USER={{username}}',
      'SSH_PASS={{password}}',
      'SSH_HOST=localhost',
    ].join('\n'),
  },
  {
    webPath: 'config.php.bak',
    content: [
      '<?php',
      '// Config backup — do not deploy',
      '$ssh_host = "localhost";',
      '$ssh_user = "{{username}}";',
      '$ssh_pass = "{{password}}";',
      '',
      '$db = new PDO("mysql:host=localhost;dbname=app", $ssh_user, $ssh_pass);',
      '?>',
    ].join('\n'),
  },
  {
    webPath: 'api/config',
    content: [
      '{',
      '  "version": "3.1.0",',
      '  "env": "production",',
      '  "ssh": {',
      '    "host": "localhost",',
      '    "user": "{{username}}",',
      '    "password": "{{password}}"',
      '  },',
      '  "debug": false',
      '}',
    ].join('\n'),
  },
  {
    webPath: 'backup/db-dump.sh',
    content: [
      '#!/bin/bash',
      '# Quick DB backup — should not be in webroot',
      'USER="{{username}}"',
      'PASS="{{password}}"',
      'mysqldump -u $USER -p$PASS --all-databases > /tmp/dump.sql',
    ].join('\n'),
  },
  {
    webPath: 'install.php',
    content: [
      '<?php',
      '// Installation wizard — remove after setup!',
      '// Default SSH credentials for setup:',
      '//   user: {{username}}',
      '//   pass: {{password}}',
      '$setup_complete = true;',
      'if (!$setup_complete) { header("Location: /install/step1"); }',
      '?>',
    ].join('\n'),
  },
  // Header-based: credentials in .headers sidecar (requires curl -i)
  {
    webPath: '.well-known/security.txt',
    content: [
      'Contact: mailto:security@corp.local',
      'Preferred-Languages: en',
      'Canonical: /.well-known/security.txt',
      'Policy: /security-policy',
    ].join('\n'),
    sidecarHeader: 'X-Debug-Auth',
  },
  {
    webPath: 'metrics',
    content: [
      '# HELP http_requests_total Total HTTP requests',
      '# TYPE http_requests_total counter',
      'http_requests_total{method="GET",status="200"} 148203',
      'http_requests_total{method="POST",status="200"} 42891',
      'http_requests_total{method="GET",status="404"} 3012',
    ].join('\n'),
    sidecarHeader: 'X-Service-Auth',
  },
  {
    webPath: 'api/v2/status',
    content: [
      '{',
      '  "status": "operational",',
      '  "uptime": "22d 14h",',
      '  "services": {',
      '    "web": "running",',
      '    "db": "connected",',
      '    "cache": "active"',
      '  }',
      '}',
    ].join('\n'),
    sidecarHeader: 'X-Admin-Token',
  },
  {
    webPath: 'debug/info',
    content: [
      '{',
      '  "app": "internal-service",',
      '  "build": "2024-03-15T10:22:00Z",',
      '  "node": "prod-01",',
      '  "memory_mb": 512,',
      '  "pid": 1842',
      '}',
    ].join('\n'),
    sidecarHeader: 'X-Internal-Credential',
  },
  {
    webPath: 'sitemap.xml',
    content: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      '  <url><loc>/</loc><priority>1.0</priority></url>',
      '  <url><loc>/status</loc><priority>0.5</priority></url>',
      '</urlset>',
    ].join('\n'),
    sidecarHeader: 'X-Forwarded-Auth',
  },
];
