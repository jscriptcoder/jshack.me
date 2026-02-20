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
