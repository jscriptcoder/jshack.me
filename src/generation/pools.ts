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
  'sh4d0w_',
  'n1ghtcr4wl',
  'd34dc0de',
  'r00tk1t_',
  'bytefl00d',
  'cr4sh_0v3r',
  'nullp0int3r',
  'w1r3sh4rk',
  'sp00f3r',
  'h4ckb0x',
];

export type PortTemplate = {
  readonly port: number;
  readonly service: string;
  readonly open: boolean;
  readonly protocol?: 'tcp' | 'udp';
};

export const usernamesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    'www-data',
    'webadmin',
    'apache',
    'nginx',
    'deploy',
    'devops',
    'httpd',
    'proxy',
    'caddy',
    'webops',
  ],
  database: [
    'dbadmin',
    'postgres',
    'mysql',
    'dba',
    'dataops',
    'dbuser',
    'replication',
    'analytics',
    'etl',
    'sqldev',
  ],
  fileserver: [
    'ftpuser',
    'backup',
    'storage',
    'sysadmin',
    'fileadm',
    'archive',
    'nfs',
    'rsync',
    'datamgr',
    'shareuser',
  ],
  workstation: [
    'jsmith',
    'admin',
    'developer',
    'analyst',
    'operator',
    'mrodriguez',
    'pwilson',
    'sthompson',
    'klee',
    'rjohnson',
  ],
  mailserver: [
    'postmaster',
    'mailadm',
    'dovecot',
    'smtp-svc',
    'mailops',
    'listadm',
    'relay',
    'quarantine',
    'mxops',
    'imapuser',
  ],
  iot: [
    'admin',
    'device',
    'iotuser',
    'sensor',
    'operator',
    'mqtt',
    'telemetry',
    'gateway',
    'controller',
    'monitor',
  ],
  router: [
    'netops',
    'routeadm',
    'admin',
    'fwadmin',
    'operator',
    'bgpuser',
    'snmpadm',
    'vpnuser',
    'natadm',
    'core',
  ],
};

export const guestPasswords: readonly string[] = JSON.parse(
  secrets.GUEST_PASSWORDS,
) as readonly string[];

export const passwords: readonly string[] = JSON.parse(
  secrets.MISSION_PASSWORDS,
) as readonly string[];

export const hostnamesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    'web01',
    'web-prod',
    'www',
    'frontend',
    'apache01',
    'webnode-1',
    'http-srv',
    'proxy01',
    'lb-web',
    'cdn-edge',
  ],
  database: [
    'db-primary',
    'db01',
    'mysql-prod',
    'postgres01',
    'datastore',
    'replica-01',
    'db-analytics',
    'redis-cache',
    'mongo-srv',
    'data-node',
  ],
  fileserver: [
    'files01',
    'nas',
    'backup-srv',
    'storage01',
    'ftp-main',
    'nfs-share',
    'archive01',
    'rsync-srv',
    'samba-dc',
    'backup-nas',
  ],
  workstation: [
    'ws-admin',
    'dev-box',
    'ops-station',
    'analyst-pc',
    'jump-box',
    'workbench',
    'admin-ws',
    'lab-pc',
    'bastion',
    'deploy-box',
  ],
  mailserver: [
    'mail01',
    'mx-primary',
    'smtp-relay',
    'postfix-srv',
    'exchange01',
    'relay-01',
    'imap-srv',
    'mail-gw',
    'mx-backup',
    'mailer01',
  ],
  iot: [
    'cam-01',
    'thermostat',
    'smart-lock',
    'iot-hub',
    'sensor-gw',
    'doorbell',
    'hvac-ctrl',
    'pir-sensor',
    'weather-stn',
    'ip-cam-02',
  ],
  router: [
    'router01',
    'gw-main',
    'border-gw',
    'core-rtr',
    'firewall01',
    'edge-rtr',
    'fw-dmz',
    'switch-core',
    'vpn-gw',
    'net-gateway',
  ],
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
  mailserver: [
    { port: 22, service: 'ssh', open: true },
    { port: 25, service: 'smtp', open: true },
    { port: 143, service: 'imap', open: true },
    { port: 993, service: 'imaps', open: false },
  ],
  iot: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 1883, service: 'mqtt', open: true },
    { port: 8443, service: 'https', open: false },
  ],
  router: [
    { port: 22, service: 'ssh', open: true },
    { port: 80, service: 'http', open: true },
    { port: 8443, service: 'https', open: false },
  ],
};

export const backdoorPorts: readonly number[] = [4444, 31337, 8888, 1337];

// Public-facing ports the client wants exposed via port forwarding on the router.
// Non-standard ports that wouldn't normally be forwarded.
export const forwardPublicPorts: readonly number[] = [8080, 8443, 9090, 8888, 3000, 4443];

// SNMP read-write community strings — common misconfigurations and vendor defaults.
// Encoded at build time to prevent finding them in the JS bundle.
export const snmpRwCommunities: readonly string[] = JSON.parse(
  secrets.SNMP_COMMUNITIES,
) as readonly string[];

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
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 21, service: 'ftp', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 25, service: 'smtp', open: true },
    ],
  },
  {
    variant: 'exploit',
    ports: [
      { port: 22, service: 'ssh', open: true },
      { port: 1883, service: 'mqtt', open: true },
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
  {
    variant: 'snmp',
    ports: [
      { port: 22, service: 'ssh', open: false },
      { port: 161, service: 'snmp', open: true, protocol: 'udp' },
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
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2011-2523',
      description: 'vsftpd 2.3.4 backdoor command execution',
      serviceVersion: 'vsftpd 2.3.4',
    },
  },
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2019-10149',
      description: 'Exim 4.87-4.91 RCE (The Return of WIZard)',
      serviceVersion: 'Exim 4.87',
    },
  },
  {
    port: 143,
    service: 'imap',
    vulnerability: {
      cve: 'CVE-2019-11500',
      description: 'Dovecot IMAP/POP3 buffer overflow',
      serviceVersion: 'Dovecot 2.3.7',
    },
  },
  {
    port: 1883,
    service: 'mqtt',
    vulnerability: {
      cve: 'CVE-2023-3028',
      description: 'Mosquitto MQTT broker auth bypass',
      serviceVersion: 'Mosquitto 2.0.14',
    },
  },
  {
    port: 445,
    service: 'smb',
    vulnerability: {
      cve: 'CVE-2017-0144',
      description: 'SMB remote code execution (EternalBlue)',
      serviceVersion: 'Samba 4.5.9',
    },
  },
  {
    port: 5432,
    service: 'postgresql',
    vulnerability: {
      cve: 'CVE-2019-9193',
      description: 'PostgreSQL COPY TO/FROM PROGRAM RCE',
      serviceVersion: 'PostgreSQL 9.3',
    },
  },
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2017-7679',
      description: 'Apache mod_mime buffer overread / RCE',
      serviceVersion: 'Apache/2.4.25',
    },
  },
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2016-6662',
      description: 'MySQL remote root code execution via config manipulation',
      serviceVersion: 'MySQL 5.5.52',
    },
  },
  {
    port: 6379,
    service: 'redis',
    vulnerability: {
      cve: 'CVE-2015-4335',
      description: 'Redis Lua sandbox escape via eval',
      serviceVersion: 'Redis 2.8.19',
    },
  },
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2015-3306',
      description: 'ProFTPD mod_copy unauthenticated file copy / RCE',
      serviceVersion: 'ProFTPD 1.3.5',
    },
  },
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2010-4344',
      description: 'Exim heap overflow remote code execution',
      serviceVersion: 'Exim 4.69',
    },
  },
  {
    port: 1883,
    service: 'mqtt',
    vulnerability: {
      cve: 'CVE-2017-7650',
      description: 'Mosquitto pattern-based ACL bypass',
      serviceVersion: 'Mosquitto 1.4.12',
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
  '{{date}} sshd[{{pid}}]: Accepted publickey for {{user}} from {{ip}} port {{srcport}}',
  '{{date}} sshd[{{pid}}]: Invalid user admin from {{ip}} port {{srcport}}',
  '{{date}} systemd[1]: Stopping {{service}}.service',
  '{{date}} kernel: [{{uptime}}] TCP: request_sock_TCP: Possible SYN flooding on port 22',
  '{{date}} su[{{pid}}]: pam_unix(su:session): session opened for user root by {{user}}(uid=1000)',
  '{{date}} CRON[{{pid}}]: (root) CMD (/usr/local/bin/certbot renew --quiet)',
  '{{date}} postfix/smtpd[{{pid}}]: connect from unknown[{{ip}}]',
  '{{date}} sshd[{{pid}}]: Received disconnect from {{ip}} port {{srcport}}: 11: disconnected by user',
];

export const configTemplatesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    'ServerRoot "/etc/httpd"\nListen {{port}}\nDocumentRoot "/var/www/html"\nServerName {{hostname}}',
    'server {\n  listen {{port}};\n  server_name {{hostname}};\n  root /var/www/html;\n}',
    '<VirtualHost *:{{port}}>\n  ServerName {{hostname}}\n  DocumentRoot /var/www/html\n  ErrorLog /var/log/apache2/error.log\n  CustomLog /var/log/apache2/access.log combined\n  SSLEngine on\n  SSLCertificateFile /etc/ssl/certs/{{hostname}}.pem\n</VirtualHost>',
    'upstream backend {\n  server 127.0.0.1:8080;\n}\nserver {\n  listen {{port}};\n  server_name {{hostname}};\n  location / {\n    proxy_pass http://backend;\n    proxy_set_header Host $host;\n  }\n}',
  ],
  database: [
    '[mysqld]\nport={{port}}\ndatadir=/var/lib/mysql\nuser={{user}}\nbind-address=0.0.0.0',
    "listen_addresses = '*'\nport = {{port}}\nmax_connections = 100",
    '[mysqld]\nserver-id=1\nlog_bin=mysql-bin\nbinlog_do_db=app_prod\nport={{port}}\nmax_connections=200\ninnodb_buffer_pool_size=256M',
    'shared_buffers = 128MB\nwork_mem = 4MB\nwal_level = replica\nmax_wal_senders = 3\narchive_mode = on\narchive_command = cp %p /var/lib/postgresql/archive/%f',
  ],
  fileserver: [
    '[global]\nworkgroup = MISSION\nsecurity = user\n\n[share]\npath = /srv/ftp\nwritable = yes',
    'anonymous_enable=NO\nlocal_enable=YES\nwrite_enable=YES\nchroot_local_user=YES',
    '[global]\nworkgroup = CORP\nserver string = {{hostname}}\nsecurity = user\nmap to guest = Bad Password\n\n[public]\npath = /srv/share\nbrowseable = yes\nread only = no\nguest ok = yes',
    'listen=YES\nlocal_enable=YES\nwrite_enable=YES\npasv_min_port=30000\npasv_max_port=31000\nuserlist_enable=YES\nuserlist_file=/etc/vsftpd.userlist\nuserlist_deny=NO\nssl_enable=NO',
  ],
  workstation: [
    'Host *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3',
    'export PS1="\\u@\\h:\\w\\$ "\nexport EDITOR=nano\nexport PATH=$PATH:/usr/local/bin',
    'Host bastion\n  HostName 10.0.0.10\n  User {{user}}\n  IdentityFile ~/.ssh/id_rsa\n  ProxyJump none\n  ForwardAgent yes',
    '# ~/.tmux.conf\nset -g mouse on\nset -g history-limit 10000\nset -g default-terminal "screen-256color"\nbind r source-file ~/.tmux.conf',
  ],
  mailserver: [
    'smtpd_banner = $myhostname ESMTP $mail_name\nsmtpd_tls_cert_file=/etc/ssl/certs/ssl-cert.pem\nsmtpd_tls_key_file=/etc/ssl/private/ssl-cert.key\nmyhostname = {{hostname}}\nmydestination = $myhostname, localhost\ninet_interfaces = all',
    'protocols = imap\nlisten = *, ::\nmail_location = mbox:~/mail:INBOX=/var/mail/%u\nssl = required\nssl_cert = </etc/ssl/certs/dovecot.pem\nssl_key = </etc/ssl/private/dovecot.pem',
    'smtpd_relay_restrictions = permit_mynetworks permit_sasl_authenticated defer_unauth_destination\nmyhostname = {{hostname}}\nalias_maps = hash:/etc/aliases\nmailbox_size_limit = 51200000\nrecipient_delimiter = +\ninet_interfaces = all\ninet_protocols = ipv4',
    'service imap-login {\n  inet_listener imap {\n    port = 143\n  }\n  inet_listener imaps {\n    port = 993\n    ssl = yes\n  }\n}\nmail_location = maildir:~/Maildir\nauth_mechanisms = plain login',
  ],
  iot: [
    '# BusyBox v1.31.1\nhostname={{hostname}}\ndevice_type=sensor_gateway\nfirmware=v2.1.4\nmqtt_broker=127.0.0.1\nmqtt_port=1883\nlog_level=warn',
    '# Device configuration\n[network]\ndhcp=yes\nhostname={{hostname}}\n[mqtt]\nbroker=localhost\nport=1883\ntopic_prefix=devices/{{hostname}}\n[sensor]\ninterval=60\nthreshold=25.0',
    '# Zigbee coordinator config\nserial_port=/dev/ttyUSB0\nbaud_rate=115200\npan_id=0x1A62\nchannel=15\nnetwork_key=01030507090B0D0F00020406080A0C0E\nhostname={{hostname}}',
    '# OTA update manifest\n[firmware]\ncurrent=2.1.4\nchannel=stable\ncheck_url=https://ota.vendor.io/{{hostname}}\nverify_sig=true\nauto_install=false\nrollback_slot=A',
  ],
  router: [
    '*filter\n:INPUT DROP [0:0]\n:FORWARD ACCEPT [0:0]\n:OUTPUT ACCEPT [0:0]\n-A INPUT -i lo -j ACCEPT\n-A INPUT -p tcp --dport 22 -j ACCEPT\n-A INPUT -p tcp --dport {{port}} -j ACCEPT\n-A FORWARD -i eth1 -o eth0 -j ACCEPT\n-A FORWARD -i eth0 -o eth1 -m state --state RELATED,ESTABLISHED -j ACCEPT\nCOMMIT',
    'auto eth0\niface eth0 inet static\n  address {{hostname}}\n  netmask 255.255.255.0\n  gateway 0.0.0.0\n\nauto eth1\niface eth1 inet static\n  address 10.0.0.1\n  netmask 255.255.255.0',
    '# OSPF configuration\nrouter ospf\n  router-id {{hostname}}\n  network 10.0.0.0/24 area 0\n  passive-interface eth0\n  default-information originate\n  log-adjacency-changes',
    '# NAT configuration\n*nat\n:PREROUTING ACCEPT [0:0]\n:POSTROUTING ACCEPT [0:0]\n-A POSTROUTING -s 10.0.0.0/24 -o eth0 -j MASQUERADE\nCOMMIT\n# Sysctl\nnet.ipv4.ip_forward=1',
  ],
};

export const noiseFiles: readonly { readonly name: string; readonly content: string }[] = [
  { name: '.bashrc', content: 'export PS1="\\u@\\h:\\w\\$ "\nalias ll="ls -la"' },
  { name: '.bash_history', content: 'ls -la\ncd /tmp\nwhoami\nclear\nexit' },
  { name: '.vimrc', content: 'set number\nset tabstop=2\nset shiftwidth=2\nsyntax on' },
  { name: '.profile', content: '# ~/.profile\nif [ -n "$BASH_VERSION" ]; then\n  . ~/.bashrc\nfi' },
  { name: '.ssh_known_hosts', content: '# known hosts\n192.168.1.1 ssh-rsa AAAAB3NzaC1yc2E...' },
  {
    name: '.gitconfig',
    content: '[user]\n  name = Admin\n  email = admin@corp.local\n[core]\n  editor = vim',
  },
  { name: '.wget-hsts', content: '# HSTS 1.0 Known Hosts database\nlocalhost\t0\t0\t443\t1' },
  {
    name: '.lesshst',
    content: '.less-history-file:\n/var/log/syslog\n/etc/passwd\n/var/log/auth.log',
  },
  {
    name: '.bash_history',
    content:
      'sudo systemctl restart sshd\ncat /etc/passwd\nnmap -sV 10.0.0.1\nssh root@10.0.0.10\nhistory -c',
  },
  { name: '.nanorc', content: 'set autoindent\nset tabsize 4\nset linenumbers\nset mouse' },
  {
    name: '.screenrc',
    content: 'startup_message off\ndefscrollback 10000\nhardstatus alwayslastline "%H | %w"',
  },
  {
    name: '.curlrc',
    content: '# Default curl options\nconnect-timeout = 10\nmax-time = 30\nsilent',
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
  iot: [
    {
      path: '/opt/firmware/config_dump.bin',
      contentTemplate:
        '# Firmware config export — {{hostname}}\ndevice_id=IOT-4812\napi_endpoint=https://cloud.vendor.io/v2\napi_key={{access_key}}\nfirmware_version=2.1.4\nlast_checkin=2024-01-15T08:30:00Z',
    },
    {
      path: '/var/log/mqtt_export.csv',
      contentTemplate:
        'timestamp,topic,payload\n2024-01-15T08:30:12Z,devices/status,online\n2024-01-15T08:30:13Z,devices/auth,{{access_key}}\n2024-01-15T08:30:14Z,devices/temp,22.5\n2024-01-15T08:30:15Z,devices/status,heartbeat',
    },
    {
      path: '/tmp/device_backup.tar.log',
      contentTemplate:
        'Backup manifest — {{hostname}}\nCreated: 2024-01-15 02:00:01\nFiles: 847\nSize: 12.4MB\nEncryption: none\nMaster token: {{access_key}}\nNext backup: 2024-01-16 02:00:00',
    },
  ],
  mailserver: [
    {
      path: '/var/mail/ceo',
      contentTemplate:
        'From: finance@corp.local\nTo: ceo@corp.local\nSubject: Q4 Authorization Token\nDate: Mon, 15 Jan 2024 09:23:41 -0500\n\nAs requested, the emergency authorization token for\nthe offshore account transfer:\n\n{{access_key}}\n\nPlease confirm receipt. This token expires in 72 hours.\n\n— Finance Dept',
    },
    {
      path: '/var/spool/mail/admin',
      contentTemplate:
        'From: noreply@internal.corp.local\nTo: admin@corp.local\nSubject: Wire Transfer Confirmation #8847\nDate: Tue, 16 Jan 2024 14:05:12 -0500\n\nTransaction ID: TXN-2024-8847\nAmount: $2,450,000.00\nVerification code: {{access_key}}\nStatus: PENDING APPROVAL\n\nThis is an automated message. Do not reply.',
    },
    {
      path: '/srv/mail/archive/confidential.eml',
      contentTemplate:
        'From: security@corp.local\nTo: sysadmin@corp.local\nSubject: Re: Emergency Access Credentials\nDate: Wed, 17 Jan 2024 22:17:33 -0500\n\nHere are the emergency access credentials you requested.\nKeep these secure — do not forward.\n\nAccess key: {{access_key}}\n\nRotation scheduled for end of quarter.',
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
  iot: [
    {
      path: '/etc/config/device.conf',
      contentTemplate:
        '# Device security settings\ndevice_id=IOT-4812\nalarm_status={{tamperOldValue}}\nmotion_sensitivity=high\nauto_lock=enabled\nnotify=admin@corp.local',
      tamperField: 'alarm_status',
      tamperOldValue: 'armed',
      tamperNewValue: 'disarmed',
    },
    {
      path: '/etc/config/update.conf',
      contentTemplate:
        '# Firmware update configuration\ncurrent_version=2.1.4\nupdate_url={{tamperOldValue}}\nverify_signature=true\nauto_update=enabled\ncheck_interval=3600',
      tamperField: 'update_url',
      tamperOldValue: 'https://updates.vendor.io/stable',
      tamperNewValue: 'https://evil.hacker.net/firmware',
    },
  ],
  mailserver: [
    {
      path: '/var/mail/hr',
      contentTemplate:
        'From: legal@corp.local\nTo: hr@corp.local\nSubject: Employee Termination — Case #4471\nDate: Fri, 19 Jan 2024 11:30:00 -0500\n\nEmployee: Marcus Webb\nDepartment: Engineering\nTermination status: {{tamperOldValue}}\n\nPlease process accordingly.\n— Legal',
      tamperField: 'termination_status',
      tamperOldValue: 'approved',
      tamperNewValue: 'denied',
    },
    {
      path: '/etc/aliases',
      contentTemplate:
        '# Mail aliases\npostmaster: root\nabuse: postmaster\nwebmaster: postmaster\n{{tamperOldValue}}: admin@corp.local\nsecurity: admin@corp.local',
      tamperField: 'alias_target',
      tamperOldValue: 'billing: finance@corp.local',
      tamperNewValue: 'billing: devnull@corp.local',
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
  {
    path: '/tmp/.cache/decrypt.key',
    template: '# Temporary decryption key — cleanup pending\nDECRYPT_KEY={{key}}\nEXPIRES=never',
    hint: 'A temporary decryption key was left in /tmp/.cache/ on {{machine}}',
  },
  {
    path: '/srv/backup/.encryption.conf',
    template:
      '[backup_encryption]\ncipher=aes-256-cbc\nkey={{key}}\niv_mode=random\ncreated=2024-02-01',
    hint: 'Backup encryption config on {{machine}} contains the key at /srv/backup/',
  },
  {
    path: '/etc/docker/.registry.key',
    template: '# Docker registry signing key\nREGISTRY=registry.corp.local:5000\nSIGN_KEY={{key}}',
    hint: 'A registry signing key exists in /etc/docker/ on {{machine}}',
  },
  {
    path: '/home/{{user}}/.config/keyfile.pem',
    template:
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-256-CBC\n\n{{key}}\n-----END ENCRYPTED PRIVATE KEY-----',
    hint: "Check {{user}}'s .config directory on {{machine}} for a key file",
  },
  {
    path: '/usr/share/keys/archive-master.key',
    template:
      'KEY_ID=archive-master\nKEY_TYPE=symmetric\nALGORITHM=AES-256\nKEY_DATA={{key}}\nCREATED=2024-01-20\nROTATION=quarterly',
    hint: 'An archive master key is stored in /usr/share/keys/ on {{machine}}',
  },
];

type WebContentTemplate = {
  readonly path: string;
  readonly content: string;
};

// Web page templates for webserver machines. {{hostname}} and {{ip}} are filled in at generation.
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
  {
    name: 'credentials.old',
    content:
      '# DEPRECATED — migrated to vault\nservice_user=deploy\nservice_pass=d3pl0y_2023\n# DO NOT USE — accounts disabled 2024-01-10',
  },
  {
    name: '.secret_key',
    content: 'aGVsbG8gd29ybGQ=\n# Base64 test key — not used in production',
  },
  {
    name: 'todo.md',
    content:
      '- [x] Migrate DB to new subnet\n- [x] Rotate SSH keys\n- [ ] Disable guest accounts\n- [ ] Audit /tmp for leftover scripts',
  },
  {
    name: 'recovery_codes.txt',
    content:
      'MFA Recovery Codes (USED)\n========================\n4821-7739 (used 2024-01-05)\n9103-2847 (used 2024-01-12)\n6650-1183 (used 2024-01-19)\nAll codes exhausted. Generate new set.',
  },
  {
    name: 'access_log.old',
    content:
      '10.0.0.5 - admin [15/Jan/2024:03:14:22] "GET /admin/ HTTP/1.1" 401\n10.0.0.5 - admin [15/Jan/2024:03:14:25] "GET /admin/ HTTP/1.1" 401\n# IP blocked after brute force detection',
  },
  {
    name: '.docker-compose.yml.bak',
    content:
      'version: "3"\nservices:\n  app:\n    image: corp/webapp:2.1.0\n    environment:\n      - DB_PASS=changeme  # placeholder\n    # DECOMISSIONED — moved to k8s',
  },
];

// Credential leak templates — careless user credentials found in guest-readable locations.
// {{username}} and {{password}} are filled with an actual user-type account on the machine.
// binary: true means the file is wrapped in binary noise (requires `strings` to read cleanly).
export type CredentialLeakTemplate = {
  readonly path: string;
  readonly content: string;
  readonly binary?: boolean;
};

export const credentialLeakTemplates: readonly CredentialLeakTemplate[] = [
  // /etc/ config files
  {
    path: '/etc/maintenance.conf',
    content: [
      '# Automated maintenance configuration',
      '# Last updated: 2024-03-15',
      '[remote_backup]',
      'host = 10.0.0.1',
      'user = {{username}}',
      'pass = {{password}}',
      'schedule = daily 02:00',
      'compress = gzip',
    ].join('\n'),
  },
  {
    path: '/etc/crontab',
    content: [
      'SHELL=/bin/bash',
      'PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin',
      '',
      '# m h dom mon dow user command',
      '17 * * * * root cd / && run-parts --report /etc/cron.hourly',
      '25 6 * * * root test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.daily )',
      `0 2 * * * {{username}} /opt/backup.sh --user={{username}} --pass={{password}}`,
      '47 6 * * 7 root test -x /usr/sbin/anacron || ( cd / && run-parts --report /etc/cron.weekly )',
    ].join('\n'),
  },
  // /srv/www/ and /var/www/ web configs
  {
    path: '/srv/www/.env',
    content: [
      'APP_ENV=production',
      'APP_DEBUG=false',
      'APP_KEY=base64:Rg2Kf8Q7vYz3mXpNsL0wJh6dBtCeAuWi9oElGnHjDs=',
      '',
      'DB_CONNECTION=mysql',
      'DB_HOST=127.0.0.1',
      'DB_PORT=3306',
      'DB_DATABASE=app_prod',
      'DB_USERNAME={{username}}',
      'DB_PASSWORD={{password}}',
      '',
      'CACHE_DRIVER=redis',
      'SESSION_DRIVER=file',
    ].join('\n'),
  },
  {
    path: '/var/www/config.php.bak',
    content: [
      '<?php',
      '// Database configuration — backed up before migration',
      '$db_host = "localhost";',
      '$db_name = "webapp";',
      '$db_user = "{{username}}";',
      '$db_pass = "{{password}}";',
      '',
      '$db = new PDO("mysql:host=$db_host;dbname=$db_name", $db_user, $db_pass);',
      '?>',
    ].join('\n'),
  },
  // /tmp/ forgotten scripts and logs
  {
    path: '/tmp/.backup.sh',
    content: [
      '#!/bin/bash',
      '# Quick backup script — delete after use',
      'TIMESTAMP=$(date +%Y%m%d_%H%M%S)',
      `REMOTE_USER="{{username}}"`,
      `REMOTE_PASS="{{password}}"`,
      '',
      'mysqldump -u $REMOTE_USER -p$REMOTE_PASS --all-databases > /tmp/dump_$TIMESTAMP.sql',
      'echo "Backup complete: /tmp/dump_$TIMESTAMP.sql"',
    ].join('\n'),
  },
  {
    path: '/tmp/deploy.log',
    content: [
      '[2024-03-12 14:23:01] Starting deployment v4.2.1',
      '[2024-03-12 14:23:02] Connecting to database...',
      `[2024-03-12 14:23:02] Using credentials: {{username}} / {{password}}`,
      '[2024-03-12 14:23:03] Running migrations... OK',
      '[2024-03-12 14:23:05] Restarting services... OK',
      '[2024-03-12 14:23:06] Deployment complete',
      '[2024-03-12 14:23:06] TODO: clean up this log file',
    ].join('\n'),
  },
  // /opt/ and /srv/ application configs
  {
    path: '/opt/app/config.ini',
    content: [
      '[general]',
      'name = app-service',
      'debug = false',
      'log_level = warn',
      '',
      '[database]',
      'host = 127.0.0.1',
      'port = 3306',
      'name = app_data',
      'user = {{username}}',
      'password = {{password}}',
      '',
      '[cache]',
      'driver = redis',
      'host = 127.0.0.1',
      'port = 6379',
    ].join('\n'),
  },
  {
    path: '/opt/app/settings.yml',
    content: [
      'app:',
      '  name: internal-service',
      '  version: 2.1.0',
      '  environment: production',
      '',
      'database:',
      '  driver: postgresql',
      '  host: localhost',
      '  port: 5432',
      '  username: {{username}}',
      '  password: {{password}}',
      '  pool_size: 10',
      '',
      'logging:',
      '  level: info',
      '  output: /var/log/app.log',
    ].join('\n'),
  },
  {
    path: '/srv/app/db.conf',
    content: [
      '# Service database connector',
      '# Auto-generated by setup wizard',
      'DRIVER=mysql',
      'HOST=localhost',
      'PORT=3306',
      'USER={{username}}',
      'PASS={{password}}',
      'MAX_CONNECTIONS=50',
      'TIMEOUT=30',
    ].join('\n'),
  },
  {
    path: '/opt/monitoring/check_service.sh',
    content: [
      '#!/bin/bash',
      '# Health check script — runs every 5 minutes',
      'SERVICE_URL="http://localhost:8080/health"',
      `DB_USER="{{username}}"`,
      `DB_PASS="{{password}}"`,
      '',
      'curl -sf $SERVICE_URL > /dev/null || echo "ALERT: service down"',
      'mysql -u $DB_USER -p$DB_PASS -e "SELECT 1" > /dev/null 2>&1 || echo "ALERT: db down"',
    ].join('\n'),
  },
  // Binary files (require `strings` to read cleanly)
  {
    path: '/usr/local/bin/health_check',
    content: [
      'health_check v2.1.3 — compiled service monitor',
      'config: host=localhost port=8080',
      `credentials: user={{username}} pass={{password}}`,
      'interval: 60s',
      'timeout: 5s',
    ].join('\n'),
    binary: true,
  },
  {
    path: '/opt/lib/libauth.so',
    content: [
      'libauth.so.2.0 — authentication module',
      'default_realm=INTERNAL',
      `service_account={{username}}`,
      `service_secret={{password}}`,
      'token_expiry=3600',
    ].join('\n'),
    binary: true,
  },
  {
    path: '/var/cache/app.db',
    content: [
      'SQLite format 3',
      'CREATE TABLE sessions (id INTEGER PRIMARY KEY, user TEXT, token TEXT);',
      `INSERT INTO credentials VALUES (1, "{{username}}", "{{password}}");`,
      'INSERT INTO sessions VALUES (1, "admin", "tok_a8f3e2b1");',
      'INSERT INTO sessions VALUES (2, "service", "tok_c4d9f0e7");',
    ].join('\n'),
    binary: true,
  },
  // Ansible/automation credential files
  {
    path: '/opt/ansible/host_vars/localhost.yml',
    content: [
      '---',
      '# Ansible host variables',
      'ansible_user: {{username}}',
      'ansible_password: {{password}}',
      'ansible_become: true',
      'ansible_become_method: sudo',
      'http_proxy: ""',
    ].join('\n'),
  },
  {
    path: '/srv/www/wp-config.php.save',
    content: [
      '<?php',
      "define('DB_NAME', 'wordpress');",
      "define('DB_USER', '{{username}}');",
      "define('DB_PASSWORD', '{{password}}');",
      "define('DB_HOST', 'localhost');",
      "define('DB_CHARSET', 'utf8mb4');",
      '',
      "define('AUTH_KEY', 'put-your-unique-phrase-here');",
      '?>',
    ].join('\n'),
  },
  {
    path: '/etc/supervisor/conf.d/app.conf',
    content: [
      '[program:app-worker]',
      'command=/opt/app/worker --db-user={{username}} --db-pass={{password}}',
      'autostart=true',
      'autorestart=true',
      'user=nobody',
      'stdout_logfile=/var/log/worker.log',
      'stderr_logfile=/var/log/worker_err.log',
    ].join('\n'),
  },
  {
    path: '/tmp/.migration_rollback.sql',
    content: [
      '-- Emergency rollback script',
      '-- Created during failed migration on 2024-03-10',
      `-- Credentials: {{username}} / {{password}}`,
      '',
      'BEGIN;',
      'ALTER TABLE users DROP COLUMN mfa_token;',
      'UPDATE schema_version SET version = 41;',
      'COMMIT;',
      '-- TODO: delete this file after rollback',
    ].join('\n'),
  },
  {
    path: '/opt/scripts/sync_remote.sh',
    content: [
      '#!/bin/bash',
      '# Sync files to backup server nightly',
      `RSYNC_USER="{{username}}"`,
      `RSYNC_PASS="{{password}}"`,
      '',
      'export RSYNC_PASSWORD=$RSYNC_PASS',
      'rsync -avz /srv/data/ $RSYNC_USER@10.0.0.50::backup/',
      'echo "$(date): sync completed" >> /var/log/sync.log',
    ].join('\n'),
  },
  {
    path: '/var/www/.git/config',
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
  // Binary files (require `strings` to read cleanly)
  {
    path: '/opt/bin/db_connector',
    content: [
      'db_connector v1.4.0 — database connection pool manager',
      'driver: mysql',
      'host: 127.0.0.1:3306',
      `auth: {{username}}:{{password}}`,
      'pool_size: 25',
      'timeout: 30s',
    ].join('\n'),
    binary: true,
  },
];

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
    iot: [
      {
        path: '/opt/scripts/check_sensors.js',
        bugVariants: {
          syntax: [
            'const readings = [22.5, 25.1, 18.3, 24.7, 19.8]',
            'const normal = readings.filter(r => r >= 18 && r <= 25)',
            'if (normal.length === 4) {',
            '  echo(_decode(normal.join("-"))',
            '} else {',
            '  echo("ERROR: sensor check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const readings = [22.5, 25.1, 18.3, 24.7, 19.8]',
            'const normal = readings.filter(r => r >= 18 && r <= 25)',
            'if (normal.length === 5) {',
            '  echo(_decode(normal.join("-")))',
            '} else {',
            '  echo("ERROR: sensor check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const readings = [22.5, ???, 18.3, 24.7, 19.8]',
            'const normal = readings.filter(r => r >= 18 && r <= 25)',
            'if (normal.length === 4) {',
            '  echo(_decode(normal.join("-")))',
            '} else {',
            '  echo("ERROR: sensor check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.sensor_log',
        corruptedHintContent: 'reading_2=25.1',
        expectedChecksum: '22.5-18.3-24.7-19.8',
      },
      {
        path: '/opt/scripts/device_health.js',
        bugVariants: {
          syntax: [
            'const devices = [',
            '  { name: "cam-01", status: "online" },',
            '  { name: "cam-02", status: "offline" },',
            '  { name: "cam-03", status: "online" }',
            ']',
            'const active = devices.filter(d => d.status === "online")',
            'if (active.length === 2) {',
            '  echo(_decode(active.map(d => d.name).join("-")))',
            '} else {',
            '  echo("ERROR: device health check failed")',
            '',
          ].join('\n'),
          logic: [
            'const devices = [',
            '  { name: "cam-01", status: "online" },',
            '  { name: "cam-02", status: "offline" },',
            '  { name: "cam-03", status: "online" }',
            ']',
            'const active = devices.filter(d => d.status === "offline")',
            'if (active.length === 2) {',
            '  echo(_decode(active.map(d => d.name).join("-")))',
            '} else {',
            '  echo("ERROR: device health check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const devices = [',
            '  { name: "cam-01", status: "online" },',
            '  { name: "cam-02", status: ??? },',
            '  { name: "cam-03", status: "online" }',
            ']',
            'const active = devices.filter(d => d.status === "online")',
            'if (active.length === 2) {',
            '  echo(_decode(active.map(d => d.name).join("-")))',
            '} else {',
            '  echo("ERROR: device health check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.device_status',
        corruptedHintContent: 'cam-02_status="offline"',
        expectedChecksum: 'cam-01-cam-03',
      },
    ],
    mailserver: [
      {
        path: '/opt/scripts/filter_spam.js',
        bugVariants: {
          syntax: [
            'const messages = ["inbox", "spam", "inbox", "spam", "spam"]',
            'const spam = messages.filter(m => m === "spam")',
            'if (spam.length === 3) {',
            '  echo(_decode(spam.join("-"))',
            '} else {',
            '  echo("ERROR: spam filter check failed")',
            '}',
          ].join('\n'),
          logic: [
            'const messages = ["inbox", "spam", "inbox", "spam", "spam"]',
            'const spam = messages.filter(m => m === "spam")',
            'if (spam.length === 2) {',
            '  echo(_decode(spam.join("-")))',
            '} else {',
            '  echo("ERROR: spam filter check failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const messages = ["inbox", ???, "inbox", "spam", "spam"]',
            'const spam = messages.filter(m => m === "spam")',
            'if (spam.length === 3) {',
            '  echo(_decode(spam.join("-")))',
            '} else {',
            '  echo("ERROR: spam filter check failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.message_log',
        corruptedHintContent: 'message_2="spam"',
        expectedChecksum: 'spam-spam-spam',
      },
      {
        path: '/opt/scripts/validate_mailboxes.js',
        bugVariants: {
          syntax: [
            'const mailboxes = [',
            '  { user: "admin", quota: "full" },',
            '  { user: "ceo", quota: "ok" },',
            '  { user: "hr", quota: "full" }',
            ']',
            'const overQuota = mailboxes.filter(m => m.quota === "full")',
            'if (overQuota.length === 2) {',
            '  echo(_decode(overQuota.map(m => m.user).join("-")))',
            '} else {',
            '  echo("ERROR: mailbox validation failed")',
            '',
          ].join('\n'),
          logic: [
            'const mailboxes = [',
            '  { user: "admin", quota: "full" },',
            '  { user: "ceo", quota: "ok" },',
            '  { user: "hr", quota: "full" }',
            ']',
            'const overQuota = mailboxes.filter(m => m.quota === "ok")',
            'if (overQuota.length === 2) {',
            '  echo(_decode(overQuota.map(m => m.user).join("-")))',
            '} else {',
            '  echo("ERROR: mailbox validation failed")',
            '}',
          ].join('\n'),
          corrupted: [
            'const mailboxes = [',
            '  { user: "admin", quota: "full" },',
            '  { user: "ceo", quota: ??? },',
            '  { user: "hr", quota: "full" }',
            ']',
            'const overQuota = mailboxes.filter(m => m.quota === "full")',
            'if (overQuota.length === 2) {',
            '  echo(_decode(overQuota.map(m => m.user).join("-")))',
            '} else {',
            '  echo("ERROR: mailbox validation failed")',
            '}',
          ].join('\n'),
        },
        corruptedHintPath: '/opt/scripts/.mailbox_status',
        corruptedHintContent: 'ceo_quota="ok"',
        expectedChecksum: 'admin-hr',
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
