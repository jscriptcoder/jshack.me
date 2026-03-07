import type { EntryVariant, MachineRole, ScriptBugType } from './types';
import type { Vulnerability } from '../network/types';
import { secrets } from '../secrets/__encoded';

export const clientHandles: readonly string[] = [
  'xR0gu3x',
  'gh0st_',
  'cyph3rpunk',
  'n3twr4ith',
  'zer0day_',
  'bl4ckh4t',
  'silkr0ad',
  'darkfl0w',
  'v0id_agent',
  'ph4nt0m',
];

export type PortTemplate = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
};

export const usernamesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: ['www-data', 'webadmin', 'apache', 'nginx', 'deploy'],
  database: ['dbadmin', 'postgres', 'mysql', 'dba', 'dataops'],
  fileserver: ['ftpuser', 'backup', 'storage', 'sysadmin', 'fileadm'],
  workstation: ['jsmith', 'admin', 'developer', 'analyst', 'operator'],
  router: ['netops', 'routeadm', 'admin', 'fwadmin', 'operator'],
};

export const guestPasswords: readonly string[] = JSON.parse(
  secrets.GUEST_PASSWORDS,
) as readonly string[];

export const passwords: readonly string[] = JSON.parse(
  secrets.MISSION_PASSWORDS,
) as readonly string[];

export const hostnamesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: ['web01', 'web-prod', 'www', 'frontend', 'apache01'],
  database: ['db-primary', 'db01', 'mysql-prod', 'postgres01', 'datastore'],
  fileserver: ['files01', 'nas', 'backup-srv', 'storage01', 'ftp-main'],
  workstation: ['ws-admin', 'dev-box', 'ops-station', 'analyst-pc', 'jump-box'],
  router: ['router01', 'gw-main', 'border-gw', 'core-rtr', 'firewall01'],
};

export const portTemplatesByRole: Readonly<Record<MachineRole, readonly PortTemplate[]>> = {
  webserver: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 443, service: 'https', open: true },
  ],
  database: [
    { port: 22, service: 'ssh', open: true },
    { port: 3306, service: 'mysql', open: true },
    { port: 5432, service: 'postgresql', open: false },
  ],
  fileserver: [
    { port: 21, service: 'ftp', open: true },
    { port: 22, service: 'ssh', open: true },
    { port: 445, service: 'smb', open: false },
  ],
  workstation: [
    { port: 22, service: 'ssh', open: true },
    { port: 8080, service: 'http-alt', open: false },
  ],
  router: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 8443, service: 'https', open: false },
  ],
};

export const backdoorPorts: readonly number[] = [4444, 31337, 8888, 1337];

export type EntryPortTemplate = {
  readonly variant: EntryVariant;
  readonly ports: readonly PortTemplate[];
};

export const entryPortTemplates: readonly EntryPortTemplate[] = [
  {
    variant: 'ssh',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'ftp',
    ports: [
      { port: 21, service: 'ftp', open: true },
      { port: 22, service: 'ssh', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 4444, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 31337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8888, service: 'elite', open: true },
    ],
  },
  {
    variant: 'nc',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1337, service: 'elite', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 3306, service: 'mysql', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 6379, service: 'redis', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
];

// Entry port templates when the router itself is the entry point (router-first mode)
export const routerEntryPortTemplates: readonly EntryPortTemplate[] = [
  {
    variant: 'ssh',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 8443, service: 'https', open: true },
    ],
  },
  {
    variant: 'http',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 80, service: 'http', open: true },
    ],
  },
];

export type VulnerabilityTemplate = {
  readonly port: number;
  readonly service: string;
  readonly vulnerability: Vulnerability;
};

export const vulnerabilityTemplates: readonly VulnerabilityTemplate[] = [
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2021-41773',
      description: 'Apache 2.4.49 path traversal / RCE',
      serviceVersion: 'Apache/2.4.49',
    },
  },
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2012-2122',
      description: 'MySQL auth bypass (memcmp timing)',
      serviceVersion: 'MySQL 5.5.23',
    },
  },
  {
    port: 6379,
    service: 'redis',
    vulnerability: {
      cve: 'CVE-2022-0543',
      description: 'Redis Lua sandbox escape / RCE',
      serviceVersion: 'Redis 5.0.7',
    },
  },
  {
    port: 8080,
    service: 'http-alt',
    vulnerability: {
      cve: 'CVE-2017-5638',
      description: 'Apache Struts 2 RCE via Content-Type',
      serviceVersion: 'Struts/2.3.31',
    },
  },
  {
    port: 9200,
    service: 'elasticsearch',
    vulnerability: {
      cve: 'CVE-2015-1427',
      description: 'Elasticsearch Groovy sandbox bypass',
      serviceVersion: 'Elasticsearch 1.4.2',
    },
  },
  {
    port: 8443,
    service: 'https',
    vulnerability: {
      cve: 'CVE-2019-11510',
      description: 'Pulse Secure VPN arbitrary file read',
      serviceVersion: 'PulseSecure/9.0R1',
    },
  },
];

export const logTemplates: readonly string[] = [
  '{{date}} sshd[{{pid}}]: Accepted password for {{user}} from {{ip}} port {{srcport}}',
  '{{date}} sshd[{{pid}}]: Failed password for {{user}} from {{ip}} port {{srcport}}',
  '{{date}} sshd[{{pid}}]: Connection closed by {{ip}} port {{srcport}}',
  '{{date}} CRON[{{pid}}]: ({{user}}) CMD (/usr/bin/backup.sh)',
  '{{date}} systemd[1]: Started {{service}}.service',
  '{{date}} kernel: [{{uptime}}] eth0: link up',
  '{{date}} sudo: {{user}} : TTY=pts/0 ; PWD=/home/{{user}} ; COMMAND=/bin/cat /etc/shadow',
];

export const configTemplatesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    'ServerRoot "/etc/httpd"\nListen {{port}}\nDocumentRoot "/var/www/html"\nServerName {{hostname}}',
    'server {\n  listen {{port}};\n  server_name {{hostname}};\n  root /var/www/html;\n}',
  ],
  database: [
    '[mysqld]\nport={{port}}\ndatadir=/var/lib/mysql\nuser={{user}}\nbind-address=0.0.0.0',
    "listen_addresses = '*'\nport = {{port}}\nmax_connections = 100",
  ],
  fileserver: [
    '[global]\nworkgroup = MISSION\nsecurity = user\n\n[share]\npath = /srv/ftp\nwritable = yes',
    'anonymous_enable=NO\nlocal_enable=YES\nwrite_enable=YES\nchroot_local_user=YES',
  ],
  workstation: [
    'Host *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3',
    'export PS1="\\u@\\h:\\w\\$ "\nexport EDITOR=nano\nexport PATH=$PATH:/usr/local/bin',
  ],
  router: [
    '*filter\n:INPUT DROP [0:0]\n:FORWARD ACCEPT [0:0]\n:OUTPUT ACCEPT [0:0]\n-A INPUT -i lo -j ACCEPT\n-A INPUT -p tcp --dport 22 -j ACCEPT\n-A INPUT -p tcp --dport {{port}} -j ACCEPT\n-A FORWARD -i eth1 -o eth0 -j ACCEPT\n-A FORWARD -i eth0 -o eth1 -m state --state RELATED,ESTABLISHED -j ACCEPT\nCOMMIT',
    'auto eth0\niface eth0 inet static\n  address {{hostname}}\n  netmask 255.255.255.0\n  gateway 0.0.0.0\n\nauto eth1\niface eth1 inet static\n  address 10.0.0.1\n  netmask 255.255.255.0',
  ],
};

export const noiseFiles: readonly { readonly name: string; readonly content: string }[] = [
  { name: '.bashrc', content: 'export PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -la"' },
  { name: '.bash_history', content: 'ls -la\ncd /tmp\nwhoami\nclear\nexit' },
  { name: '.vimrc', content: 'set number\nset tabstop=2\nset shiftwidth=2\nsyntax on' },
  { name: '.profile', content: '# ~/.profile\nif [ -n "$BASH_VERSION" ]; then\n  . ~/.bashrc\nfi' },
  { name: '.ssh_known_hosts', content: '# known hosts\n192.168.1.1 ssh-rsa AAAAB3NzaC1yc2E...' },
];

export type TargetFileTemplate = {
  readonly path: string;
  readonly contentTemplate: string;
};

export const targetFileTemplatesByRole: Readonly<
  Record<MachineRole, readonly TargetFileTemplate[]>
> = {
  fileserver: [
    {
      path: '/srv/records/patient_discharge_2024.csv',
      contentTemplate:
        'ID,Patient,Date,Status,Notes\n2041,Martinez,2024-01-15,discharged,routine\n2042,Chen,2024-01-16,discharged,follow-up scheduled\n2043,Williams,2024-01-17,transferred,{{access_key}}\n2044,Johnson,2024-01-18,discharged,routine',
    },
    {
      path: '/srv/ftp/exports/financial_report.csv',
      contentTemplate:
        'Account,Type,Balance,Flag\nACCT-001,checking,12500.00,normal\nACCT-002,savings,48200.00,normal\nACCT-003,offshore,999999.99,{{access_key}}\nACCT-004,checking,3200.00,normal',
    },
    {
      path: '/srv/backup/confidential_memo.txt',
      contentTemplate:
        'INTERNAL MEMO — CONFIDENTIAL\nDate: 2024-01-20\nFrom: Director of Operations\n\nAll staff must update credentials by end of quarter.\nAuthorization code: {{access_key}}\n\nDo not distribute.',
    },
  ],
  database: [
    {
      path: '/opt/mysql/dumps/users_backup.sql',
      contentTemplate:
        "-- MySQL dump 10.13\n-- Server version: 5.7.42\n\nINSERT INTO `users` VALUES (1,'admin','pbkdf2:sha256:admin_hash','admin@corp.local',1);\nINSERT INTO `users` VALUES (2,'service','pbkdf2:sha256:svc_hash','svc@corp.local',0);\nINSERT INTO `secrets` VALUES (1,'master_key','{{access_key}}');\nINSERT INTO `users` VALUES (3,'backup','pbkdf2:sha256:bak_hash','backup@corp.local',0);",
    },
    {
      path: '/opt/db/exports/accounts.csv',
      contentTemplate:
        'user_id,username,email,access_token\n1001,admin,admin@corp.local,tok_a8f3e2\n1002,service,svc@corp.local,{{access_key}}\n1003,readonly,ro@corp.local,tok_c4d1b7',
    },
    {
      path: '/opt/postgresql/audit_log.txt',
      contentTemplate:
        '[2024-01-15 03:14:22] AUTH admin: SELECT * FROM credentials\n[2024-01-15 03:14:23] RESULT 3 rows returned\n[2024-01-15 03:15:01] AUTH admin: INSERT INTO audit VALUES ({{access_key}})\n[2024-01-15 03:15:44] AUTH service: VACUUM ANALYZE',
    },
  ],
  webserver: [
    {
      path: '/srv/www/data/users.json',
      contentTemplate:
        '{\n  "users": [\n    {"id": 1, "name": "admin", "role": "superadmin", "api_key": "{{access_key}}"},\n    {"id": 2, "name": "editor", "role": "content", "api_key": "ak_29f84c"},\n    {"id": 3, "name": "viewer", "role": "readonly", "api_key": "ak_d1e037"}\n  ]\n}',
    },
    {
      path: '/srv/www/private/admin_credentials.conf',
      contentTemplate:
        '# Admin Panel Configuration\nADMIN_USER=superadmin\nADMIN_PASS=Pr0d_S3cur3!\nSECRET_KEY={{access_key}}\nDEBUG=false',
    },
    {
      path: '/srv/www/html/.htaccess_backup',
      contentTemplate:
        '# Apache .htaccess backup\nAuthType Basic\nAuthName "Restricted"\nAuthUserFile /etc/apache2/.htpasswd\n# Recovery token: {{access_key}}\nRequire valid-user',
    },
  ],
  workstation: [
    {
      path: '/opt/projects/classified_memo.txt',
      contentTemplate:
        'CLASSIFIED — INTERNAL USE ONLY\n\nProject Oversight Committee Meeting Notes\nDate: 2024-01-18\n\nAction items:\n- Rotate all service account credentials\n- Authorization override: {{access_key}}\n- Schedule penetration test for Q2',
    },
    {
      path: '/opt/projects/internal_report.txt',
      contentTemplate:
        'Quarterly Security Audit Report\n==============================\nPrepared by: Security Operations\n\nFindings:\n1. SSH key rotation overdue on 3 servers\n2. Unencrypted backup found: {{access_key}}\n3. Firewall rule 47 permits excessive inbound traffic',
    },
    {
      path: '/opt/local/secret_notes.txt',
      contentTemplate:
        'Personal notes — DO NOT SHARE\n\nVPN config: vpn.corp.local:1194\nEmergency access code: {{access_key}}\nBackup server: 10.0.0.50 (ask Dave for creds)',
    },
  ],
  // Router is infrastructure-only (never the mission target), but the type system
  // requires target file templates for every role. These are unused in practice.
  router: [
    {
      path: '/opt/router/access_log.txt',
      contentTemplate:
        'Router Access Log\n=================\nEmergency override code: {{access_key}}\nLast maintenance: 2024-01-15',
    },
    {
      path: '/opt/router/vpn_keys.txt',
      contentTemplate:
        'VPN Pre-shared Keys\n===================\nSite-A: {{access_key}}\nSite-B: psk_f8a2e7c1',
    },
    {
      path: '/opt/router/backup_config.txt',
      contentTemplate:
        '! Router backup configuration\n! Secret: {{access_key}}\nhostname border-gw\nno ip domain-lookup',
    },
  ],
};

export type TamperFileTemplate = {
  readonly path: string;
  readonly contentTemplate: string;
  readonly tamperField: string;
  readonly tamperOldValue: string;
  readonly tamperNewValue: string;
};

export const tamperFileTemplatesByRole: Readonly<
  Record<MachineRole, readonly TamperFileTemplate[]>
> = {
  fileserver: [
    {
      path: '/srv/records/patient_records.csv',
      contentTemplate:
        'ID,Patient,Status,Date\n4001,Martinez,active,2024-01-15\n4002,Chen,{{tamperOldValue}},2024-01-16\n4003,Williams,active,2024-01-17',
      tamperField: 'status',
      tamperOldValue: 'active',
      tamperNewValue: 'discharged',
    },
    {
      path: '/srv/ftp/exports/employee_roster.csv',
      contentTemplate:
        'EmpID,Name,Clearance,Department\nE201,Adams,{{tamperOldValue}},Engineering\nE202,Baker,standard,Marketing\nE203,Clark,standard,Finance',
      tamperField: 'clearance',
      tamperOldValue: 'standard',
      tamperNewValue: 'executive',
    },
  ],
  database: [
    {
      path: '/opt/mysql/dumps/students.sql',
      contentTemplate:
        "-- Student records dump\nINSERT INTO `grades` VALUES (2847,'Thompson','CS101','{{tamperOldValue}}');\nINSERT INTO `grades` VALUES (2848,'Garcia','CS101','B+');\nINSERT INTO `grades` VALUES (2849,'Patel','CS101','A-');",
      tamperField: 'grade',
      tamperOldValue: 'F',
      tamperNewValue: 'A',
    },
    {
      path: '/opt/db/exports/accounts.csv',
      contentTemplate:
        'AccountID,Owner,Balance,Status\nACC-901,Corp Treasury,2500000.00,{{tamperOldValue}}\nACC-902,Ops Fund,150000.00,active\nACC-903,Reserve,800000.00,active',
      tamperField: 'status',
      tamperOldValue: 'frozen',
      tamperNewValue: 'active',
    },
  ],
  webserver: [
    {
      path: '/srv/www/data/users.json',
      contentTemplate:
        '{\n  "users": [\n    {"id": 1, "name": "target_user", "role": "{{tamperOldValue}}", "email": "target@corp.local"},\n    {"id": 2, "name": "editor", "role": "content", "email": "editor@corp.local"}\n  ]\n}',
      tamperField: 'role',
      tamperOldValue: 'readonly',
      tamperNewValue: 'admin',
    },
    {
      path: '/srv/www/private/access_control.conf',
      contentTemplate:
        '# Access Control Configuration\nuser=target_user\naccess_level={{tamperOldValue}}\nexpiry=2025-12-31\nMFA=enabled',
      tamperField: 'access_level',
      tamperOldValue: 'restricted',
      tamperNewValue: 'privileged',
    },
  ],
  workstation: [
    {
      path: '/opt/projects/payroll.csv',
      contentTemplate:
        'EmpID,Name,Department,Salary\n3001,Reynolds,Engineering,{{tamperOldValue}}\n3002,Mitchell,Marketing,$62,000\n3003,Foster,Finance,$58,000',
      tamperField: 'salary',
      tamperOldValue: '$45,000',
      tamperNewValue: '$145,000',
    },
    {
      path: '/opt/local/performance_review.txt',
      contentTemplate:
        'Employee Performance Review\nName: Target Employee\nRating: {{tamperOldValue}}\nRecommendation: No action\nReviewer: HR Department',
      tamperField: 'rating',
      tamperOldValue: 'needs_improvement',
      tamperNewValue: 'exceeds_expectations',
    },
  ],
  router: [
    {
      path: '/opt/router/firewall_policy.conf',
      contentTemplate:
        '# Firewall Policy\nrule_47_action={{tamperOldValue}}\nrule_47_src=10.0.0.0/8\nrule_47_dst=0.0.0.0/0\nrule_47_proto=tcp',
      tamperField: 'action',
      tamperOldValue: 'DENY',
      tamperNewValue: 'ALLOW',
    },
  ],
};

export type KeyPlacementTemplate = {
  readonly path: string;
  readonly template: string;
  readonly hint: string;
};

export const keyPlacementTemplates: readonly KeyPlacementTemplate[] = [
  {
    path: '/root/.keys/backup.key',
    template: '# AES key backup — do not distribute\nkey={{key}}',
    hint: 'An encryption key backup exists in /root/.keys/ on {{machine}}',
  },
  {
    path: '/etc/ssl/private/archive.key',
    template:
      '# SSL archive encryption key\n[encryption]\nalgorithm=AES-256\nkey={{key}}\nrotate=never',
    hint: 'Check /etc/ssl/private/ on {{machine}} for encryption keys',
  },
  {
    path: '/home/{{user}}/.gnupg/export.key',
    template:
      '-----BEGIN PGP PRIVATE KEY BLOCK-----\nComment: archive encryption key\n\n{{key}}\n-----END PGP PRIVATE KEY BLOCK-----',
    hint: "Look in {{user}}'s .gnupg directory on {{machine}} for an exported key",
  },
  {
    path: '/var/backups/.master.key',
    template:
      'MASTER ENCRYPTION KEY\n====================\n{{key}}\n\nUsed for archive encryption.',
    hint: 'A master encryption key is stored in /var/backups/ on {{machine}}',
  },
  {
    path: '/opt/security/vault.key',
    template:
      '{\n  "vault_key": "{{key}}",\n  "algorithm": "AES-256",\n  "created": "2024-01-15"\n}',
    hint: 'The security vault on {{machine}} stores an encryption key at /opt/security/',
  },
];

// Web page templates for webserver machines. {{hostname}} and {{ip}} are filled in at generation.
export const webContentTemplates: readonly {
  readonly path: string;
  readonly content: string;
}[] = [
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

export const redHerringFiles: readonly { readonly name: string; readonly content: string }[] = [
  { name: 'notes.txt', content: 'TODO: update server configs\nRemember to rotate credentials' },
  {
    name: 'old_passwords.txt',
    content:
      'These passwords are EXPIRED and no longer valid:\nadmin/letmein\nroot/toor\nguest/welcome',
  },
  {
    name: '.env.bak',
    content: 'DB_HOST=localhost\nDB_USER=app\nDB_PASS=oldpassword123\n# ROTATED',
  },
  {
    name: 'maintenance_log.txt',
    content:
      'Jan 15: Patched OpenSSH\nJan 20: Rotated all passwords\nFeb 01: Updated firewall rules',
  },
];

export type ScriptFixTemplate = {
  readonly path: string;
  readonly bugVariants: Readonly<Record<ScriptBugType, string>>;
  readonly corruptedHintPath: string;
  readonly corruptedHintContent: string;
  readonly expectedChecksum: string;
};

export const scriptFixTemplatesByRole: Readonly<Record<MachineRole, readonly ScriptFixTemplate[]>> =
  {
    fileserver: [
      {
        path: '/srv/scripts/validate_backups.js',
        bugVariants: {
          syntax: [
            'const backups = ["db_full", "db_diff", "logs", "config"]',
            'const critical = backups.filter(b => b.startsWith("db")',
            'if (critical.length === 2) {',
            '  echo(_decode(critical.join("-")))',
            '} else {',
            '  echo("ERROR: backup validation failed")',
            '}',
          ].join('\n'),
          logic: [
            'const backups = ["db_full", "db_diff", "logs", "config"]',
            'const critical = backups.filter(b => b.startsWith("db"))',
            'if (critical.length === 3) {',
            '  echo(_decode(critical.join("-")))',
            '} else {',
            '  echo("ERROR: backup validation failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const backups = ???',
            'const critical = backups.filter(b => b.startsWith("db"))',
            'if (critical.length === 2) {',
            '  echo(_decode(critical.join("-")))',
            '} else {',
            '  echo("ERROR: backup validation failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/srv/scripts/.backup_list',
        corruptedHintContent: 'backup_sources=["db_full", "db_diff", "logs", "config"]',
        expectedChecksum: 'db_full-db_diff',
      },
      {
        path: '/srv/scripts/check_exports.js',
        bugVariants: {
          syntax: [
            'const exports = ["report_q1", "report_q2", "summary", "archive"]',
            'const reports = exports.filter(e => e.startsWith("report"))',
            'if (reports.length === 2) {',
            '  echo(_decode(reports.join("-")))',
            '} else {',
            '  echo("ERROR: export check failed")',
            '',
          ].join('\n'),
          logic: [
            'const exports = ["report_q1", "report_q2", "summary", "archive"]',
            'const reports = exports.filter(e => e.startsWith("report"))',
            'if (reports.length === 1) {',
            '  echo(_decode(reports.join("-")))',
            '} else {',
            '  echo("ERROR: export check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const exports = ["report_q1", "report_q2", "summary", "archive"]',
            'const reports = exports.filter(e => e.startsWith(???))',
            'if (reports.length === 2) {',
            '  echo(_decode(reports.join("-")))',
            '} else {',
            '  echo("ERROR: export check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/srv/scripts/.export_config',
        corruptedHintContent: 'filter_prefix="report"',
        expectedChecksum: 'report_q1-report_q2',
      },
    ],
    database: [
      {
        path: '/opt/scripts/verify_records.js',
        bugVariants: {
          syntax: [
            'const records = [',
            '  { id: 1, status: "active" },',
            '  { id: 2, status: "inactive" },',
            '  { id: 3, status: "active" },',
            '  { id: 4, status: "active" }',
            ']',
            'const active = records.filter(r => r.status === "active")',
            'if (active.length === 3) {',
            '  echo(_decode(active.map(r => r.id).join("-"))',
            '} else {',
            '  echo("ERROR: record verification failed")',
            '}',
          ].join('\n'),
          logic: [
            'const records = [',
            '  { id: 1, status: "active" },',
            '  { id: 2, status: "inactive" },',
            '  { id: 3, status: "active" },',
            '  { id: 4, status: "active" }',
            ']',
            'const active = records.filter(r => r.status === "inactive")',
            'if (active.length === 3) {',
            '  echo(_decode(active.map(r => r.id).join("-")))',
            '} else {',
            '  echo("ERROR: record verification failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const records = [',
            '  { id: 1, status: "active" },',
            '  { id: 2, status: "inactive" },',
            '  { id: 3, status: "???" },',
            '  { id: 4, status: "active" }',
            ']',
            'const active = records.filter(r => r.status === "active")',
            'if (active.length === 3) {',
            '  echo(_decode(active.map(r => r.id).join("-")))',
            '} else {',
            '  echo("ERROR: record verification failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.record_data',
        corruptedHintContent: 'record_3_status=active',
        expectedChecksum: '1-3-4',
      },
      {
        path: '/opt/scripts/audit_check.js',
        bugVariants: {
          syntax: [
            'const entries = ["login", "query", "logout", "login", "query"]',
            'const logins = entries.filter(e => e === "login")',
            'const queries = entries.filter(e => e === "query)',
            'if (logins.length === 2 && queries.length === 2) {',
            '  echo(_decode(logins.length + "-" + queries.length))',
            '} else {',
            '  echo("ERROR: audit check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const entries = ["login", "query", "logout", "login", "query"]',
            'const logins = entries.filter(e => e === "login")',
            'const queries = entries.filter(e => e === "query")',
            'if (logins.length === 2 && queries.length === 3) {',
            '  echo(_decode(logins.length + "-" + queries.length))',
            '} else {',
            '  echo("ERROR: audit check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const entries = ???',
            'const logins = entries.filter(e => e === "login")',
            'const queries = entries.filter(e => e === "query")',
            'if (logins.length === 2 && queries.length === 2) {',
            '  echo(_decode(logins.length + "-" + queries.length))',
            '} else {',
            '  echo("ERROR: audit check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.audit_entries',
        corruptedHintContent: 'entries=["login", "query", "logout", "login", "query"]',
        expectedChecksum: '2-2',
      },
    ],
    webserver: [
      {
        path: '/srv/scripts/check_endpoints.js',
        bugVariants: {
          syntax: [
            'const endpoints = ["/api/users", "/api/health", "/api/admin", "/status"]',
            'const apiRoutes = endpoints.filter(e => e.startsWith("/api/"))',
            'if (apiRoutes.length === 3) {',
            '  echo(_decode(apiRoutes.join("-")))',
            ' else {',
            '  echo("ERROR: endpoint check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const endpoints = ["/api/users", "/api/health", "/api/admin", "/status"]',
            'const apiRoutes = endpoints.filter(e => e.startsWith("/api/"))',
            'if (apiRoutes.length === 4) {',
            '  echo(_decode(apiRoutes.join("-")))',
            '} else {',
            '  echo("ERROR: endpoint check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const endpoints = ["/api/users", "/api/health", ???, "/status"]',
            'const apiRoutes = endpoints.filter(e => e.startsWith("/api/"))',
            'if (apiRoutes.length === 3) {',
            '  echo(_decode(apiRoutes.join("-")))',
            '} else {',
            '  echo("ERROR: endpoint check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/srv/scripts/.endpoint_list',
        corruptedHintContent: 'endpoint_3="/api/admin"',
        expectedChecksum: '/api/users-/api/health-/api/admin',
      },
      {
        path: '/srv/scripts/validate_certs.js',
        bugVariants: {
          syntax: [
            'const certs = ["web.pem", "api.pem", "mail.pem"]',
            'const valid = certs.filter(c => c.endsWith(".pem"))',
            'if (valid.length === 3 {',
            '  echo(_decode(valid.join("-")))',
            '} else {',
            '  echo("ERROR: cert validation failed")',
            '}',
          ].join('\n'),
          logic: [
            'const certs = ["web.pem", "api.pem", "mail.pem"]',
            'const valid = certs.filter(c => c.endsWith(".pem"))',
            'if (valid.length === 2) {',
            '  echo(_decode(valid.join("-")))',
            '} else {',
            '  echo("ERROR: cert validation failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const certs = ["web.pem", ???, "mail.pem"]',
            'const valid = certs.filter(c => c.endsWith(".pem"))',
            'if (valid.length === 3) {',
            '  echo(_decode(valid.join("-")))',
            '} else {',
            '  echo("ERROR: cert validation failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/srv/scripts/.cert_list',
        corruptedHintContent: 'cert_2="api.pem"',
        expectedChecksum: 'web.pem-api.pem-mail.pem',
      },
    ],
    workstation: [
      {
        path: '/opt/scripts/verify_access.js',
        bugVariants: {
          syntax: [
            'const users = ["admin", "operator", "analyst", "guest"]',
            'const privileged = users.filter(u => u === "admin" || u === "operator")',
            'if (privileged.length === 2) {',
            '  echo(_decode(privileged.join("-")))',
            '} else {',
            '  echo("ERROR: access verification failed)',
            '}',
          ].join('\n'),
          logic: [
            'const users = ["admin", "operator", "analyst", "guest"]',
            'const privileged = users.filter(u => u === "admin")',
            'if (privileged.length === 2) {',
            '  echo(_decode(privileged.join("-")))',
            '} else {',
            '  echo("ERROR: access verification failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const users = ["admin", ???, "analyst", "guest"]',
            'const privileged = users.filter(u => u === "admin" || u === "operator")',
            'if (privileged.length === 2) {',
            '  echo(_decode(privileged.join("-")))',
            '} else {',
            '  echo("ERROR: access verification failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.user_list',
        corruptedHintContent: 'user_2="operator"',
        expectedChecksum: 'admin-operator',
      },
      {
        path: '/opt/scripts/check_projects.js',
        bugVariants: {
          syntax: [
            'const projects = [',
            '  { name: "alpha", priority: "high" },',
            '  { name: "beta", priority: "low" },',
            '  { name: "gamma", priority: "high" }',
            ']',
            'const urgent = projects.filter(p => p.priority === "high")',
            'if (urgent.length === 2) {',
            '  echo(_decode(urgent.map(p => p.name).join("-"))',
            '} else {',
            '  echo("ERROR: project check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const projects = [',
            '  { name: "alpha", priority: "high" },',
            '  { name: "beta", priority: "low" },',
            '  { name: "gamma", priority: "high" }',
            ']',
            'const urgent = projects.filter(p => p.priority === "low")',
            'if (urgent.length === 2) {',
            '  echo(_decode(urgent.map(p => p.name).join("-")))',
            '} else {',
            '  echo("ERROR: project check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const projects = [',
            '  { name: "alpha", priority: "high" },',
            '  { name: "beta", priority: ??? },',
            '  { name: "gamma", priority: "high" }',
            ']',
            'const urgent = projects.filter(p => p.priority === "high")',
            'if (urgent.length === 2) {',
            '  echo(_decode(urgent.map(p => p.name).join("-")))',
            '} else {',
            '  echo("ERROR: project check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.project_data',
        corruptedHintContent: 'beta_priority="low"',
        expectedChecksum: 'alpha-gamma',
      },
    ],
    // Router is infrastructure-only (never the mission target), but the type system
    // requires templates for every role. These are unused in practice.
    router: [
      {
        path: '/opt/scripts/check_routes.js',
        bugVariants: {
          syntax: [
            'const routes = ["10.0.0.0/24", "172.16.0.0/16", "192.168.1.0/24"]',
            'const internal = routes.filter(r => r.startsWith("10.") || r.startsWith("172.")',
            'if (internal.length === 2) {',
            '  echo(_decode(internal.join("-")))',
            '} else {',
            '  echo("ERROR: route check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const routes = ["10.0.0.0/24", "172.16.0.0/16", "192.168.1.0/24"]',
            'const internal = routes.filter(r => r.startsWith("10.") || r.startsWith("172."))',
            'if (internal.length === 3) {',
            '  echo(_decode(internal.join("-")))',
            '} else {',
            '  echo("ERROR: route check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const routes = [???, "172.16.0.0/16", "192.168.1.0/24"]',
            'const internal = routes.filter(r => r.startsWith("10.") || r.startsWith("172."))',
            'if (internal.length === 2) {',
            '  echo(_decode(internal.join("-")))',
            '} else {',
            '  echo("ERROR: route check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.route_config',
        corruptedHintContent: 'route_1="10.0.0.0/24"',
        expectedChecksum: '10.0.0.0/24-172.16.0.0/16',
      },
      {
        path: '/opt/scripts/verify_firewall.js',
        bugVariants: {
          syntax: [
            'const rules = ["ACCEPT", "DROP", "ACCEPT", "ACCEPT"]',
            'const allowed = rules.filter(r => r === "ACCEPT")',
            'if (allowed.length === 3) {',
            '  echo(_decode(allowed.join("-")))',
            '} else {',
            '  echo("ERROR: firewall verification failed)',
            '}',
          ].join('\n'),
          logic: [
            'const rules = ["ACCEPT", "DROP", "ACCEPT", "ACCEPT"]',
            'const allowed = rules.filter(r => r === "DROP")',
            'if (allowed.length === 3) {',
            '  echo(_decode(allowed.join("-")))',
            '} else {',
            '  echo("ERROR: firewall verification failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const rules = ["ACCEPT", ???, "ACCEPT", "ACCEPT"]',
            'const allowed = rules.filter(r => r === "ACCEPT")',
            'if (allowed.length === 3) {',
            '  echo(_decode(allowed.join("-")))',
            '} else {',
            '  echo("ERROR: firewall verification failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.fw_rules',
        corruptedHintContent: 'rule_2="DROP"',
        expectedChecksum: 'ACCEPT-ACCEPT-ACCEPT',
      },
    ],
  };
