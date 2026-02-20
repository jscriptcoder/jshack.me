import type { EntryVariant, MachineRole } from './types';
import type { Vulnerability } from '../network/types';
import { secrets } from '../secrets/__encoded';

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
};

export const guestPasswords: readonly string[] = [
  'guest',
  'guest123',
  'password',
  'letmein',
  'welcome',
  'changeme',
];

export const passwords: readonly string[] = JSON.parse(
  secrets.MISSION_PASSWORDS,
) as readonly string[];

export const hostnamesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: ['web01', 'web-prod', 'www', 'frontend', 'apache01'],
  database: ['db-primary', 'db01', 'mysql-prod', 'postgres01', 'datastore'],
  fileserver: ['files01', 'nas', 'backup-srv', 'storage01', 'ftp-main'],
  workstation: ['ws-admin', 'dev-box', 'ops-station', 'analyst-pc', 'jump-box'],
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
};

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
};

export const noiseFiles: readonly { readonly name: string; readonly content: string }[] = [
  { name: '.bashrc', content: 'export PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -la"' },
  { name: '.bash_history', content: 'ls -la\ncd /tmp\nwhoami\nclear\nexit' },
  { name: '.vimrc', content: 'set number\nset tabstop=2\nset shiftwidth=2\nsyntax on' },
  { name: '.profile', content: '# ~/.profile\nif [ -n "$BASH_VERSION" ]; then\n  . ~/.bashrc\nfi' },
  { name: '.ssh_known_hosts', content: '# known hosts\n192.168.1.1 ssh-rsa AAAAB3NzaC1yc2E...' },
];

export const entryCredentialHintTemplates: readonly {
  readonly ftpPath: string;
  readonly ncPath: string;
  readonly exploitPath: string;
  readonly template: string;
}[] = [
  {
    ftpPath: '/home/{{localUser}}/.ssh_backup',
    ncPath: '/home/{{owner}}/ssh_backup.txt',
    exploitPath: '/home/{{owner}}/ssh_backup.txt',
    template:
      'SSH Credentials Backup\n======================\nHost: {{hostname}}\nUser: {{user}}\nPass: {{password}}\nLast updated: Jan 10',
  },
  {
    ftpPath: '/home/{{localUser}}/notes.txt',
    ncPath: '/home/{{owner}}/notes.txt',
    exploitPath: '/home/{{owner}}/notes.txt',
    template: 'Server notes:\n- SSH access: {{user}} / {{password}}\n- Remember to rotate!',
  },
  {
    ftpPath: '/home/{{localUser}}/credentials.bak',
    ncPath: '/home/{{owner}}/.credentials',
    exploitPath: '/home/{{owner}}/.credentials',
    template:
      '# auto-generated credentials\nssh_user={{user}}\nssh_pass={{password}}\nhost={{hostname}}',
  },
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
        'ID,Patient,Date,Status,Notes\n2041,Martinez,2024-01-15,discharged,routine\n2042,Chen,2024-01-16,discharged,follow-up scheduled\n2043,Williams,2024-01-17,transferred,{{flag}}\n2044,Johnson,2024-01-18,discharged,routine',
    },
    {
      path: '/srv/ftp/exports/financial_report.csv',
      contentTemplate:
        'Account,Type,Balance,Flag\nACCT-001,checking,12500.00,normal\nACCT-002,savings,48200.00,normal\nACCT-003,offshore,999999.99,{{flag}}\nACCT-004,checking,3200.00,normal',
    },
    {
      path: '/srv/backup/confidential_memo.txt',
      contentTemplate:
        'INTERNAL MEMO — CONFIDENTIAL\nDate: 2024-01-20\nFrom: Director of Operations\n\nAll staff must update credentials by end of quarter.\nAuthorization code: {{flag}}\n\nDo not distribute.',
    },
  ],
  database: [
    {
      path: '/opt/mysql/dumps/users_backup.sql',
      contentTemplate:
        "-- MySQL dump 10.13\n-- Server version: 5.7.42\n\nINSERT INTO `users` VALUES (1,'admin','pbkdf2:sha256:admin_hash','admin@corp.local',1);\nINSERT INTO `users` VALUES (2,'service','pbkdf2:sha256:svc_hash','svc@corp.local',0);\nINSERT INTO `secrets` VALUES (1,'master_key','{{flag}}');\nINSERT INTO `users` VALUES (3,'backup','pbkdf2:sha256:bak_hash','backup@corp.local',0);",
    },
    {
      path: '/opt/db/exports/accounts.csv',
      contentTemplate:
        'user_id,username,email,access_token\n1001,admin,admin@corp.local,tok_a8f3e2\n1002,service,svc@corp.local,{{flag}}\n1003,readonly,ro@corp.local,tok_c4d1b7',
    },
    {
      path: '/opt/postgresql/audit_log.txt',
      contentTemplate:
        '[2024-01-15 03:14:22] AUTH admin: SELECT * FROM credentials\n[2024-01-15 03:14:23] RESULT 3 rows returned\n[2024-01-15 03:15:01] AUTH admin: INSERT INTO audit VALUES ({{flag}})\n[2024-01-15 03:15:44] AUTH service: VACUUM ANALYZE',
    },
  ],
  webserver: [
    {
      path: '/srv/www/data/users.json',
      contentTemplate:
        '{\n  "users": [\n    {"id": 1, "name": "admin", "role": "superadmin", "api_key": "{{flag}}"},\n    {"id": 2, "name": "editor", "role": "content", "api_key": "ak_29f84c"},\n    {"id": 3, "name": "viewer", "role": "readonly", "api_key": "ak_d1e037"}\n  ]\n}',
    },
    {
      path: '/srv/www/private/admin_credentials.conf',
      contentTemplate:
        '# Admin Panel Configuration\nADMIN_USER=superadmin\nADMIN_PASS=Pr0d_S3cur3!\nSECRET_KEY={{flag}}\nDEBUG=false',
    },
    {
      path: '/srv/www/html/.htaccess_backup',
      contentTemplate:
        '# Apache .htaccess backup\nAuthType Basic\nAuthName "Restricted"\nAuthUserFile /etc/apache2/.htpasswd\n# Recovery token: {{flag}}\nRequire valid-user',
    },
  ],
  workstation: [
    {
      path: '/opt/projects/classified_memo.txt',
      contentTemplate:
        'CLASSIFIED — INTERNAL USE ONLY\n\nProject Oversight Committee Meeting Notes\nDate: 2024-01-18\n\nAction items:\n- Rotate all service account credentials\n- Authorization override: {{flag}}\n- Schedule penetration test for Q2',
    },
    {
      path: '/opt/projects/internal_report.txt',
      contentTemplate:
        'Quarterly Security Audit Report\n==============================\nPrepared by: Security Operations\n\nFindings:\n1. SSH key rotation overdue on 3 servers\n2. Unencrypted backup found: {{flag}}\n3. Firewall rule 47 permits excessive inbound traffic',
    },
    {
      path: '/opt/local/secret_notes.txt',
      contentTemplate:
        'Personal notes — DO NOT SHARE\n\nVPN config: vpn.corp.local:1194\nEmergency access code: {{flag}}\nBackup server: 10.0.0.50 (ask Dave for creds)',
    },
  ],
};

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
