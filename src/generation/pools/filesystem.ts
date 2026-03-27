import type { MachineRole } from '../types';

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
  '{{date}} sshd[{{pid}}]: pam_unix(sshd:auth): authentication failure; logname= uid=0 euid=0 tty=ssh ruser= rhost={{ip}} user={{user}}',
  '{{date}} kernel: [{{uptime}}] Out of memory: Killed process {{pid}} (java) total-vm:2048000kB',
  '{{date}} systemd[1]: {{service}}.service: Main process exited, code=exited, status=1/FAILURE',
  '{{date}} sshd[{{pid}}]: Accepted keyboard-interactive/pam for {{user}} from {{ip}} port {{srcport}} ssh2',
  '{{date}} CRON[{{pid}}]: ({{user}}) CMD (/opt/scripts/cleanup.sh >> /var/log/cleanup.log 2>&1)',
  '{{date}} sudo: {{user}} : TTY=pts/1 ; PWD=/opt/app ; COMMAND=/bin/systemctl restart nginx',
  '{{date}} kernel: [{{uptime}}] [UFW BLOCK] IN=eth0 OUT= MAC=00:16:3e:5e:6c:00 SRC={{ip}} DST=10.0.0.1 PROTO=TCP DPT=443',
  '{{date}} sshd[{{pid}}]: error: maximum authentication attempts exceeded for {{user}} from {{ip}} port {{srcport}} ssh2',
  '{{date}} systemd-logind[{{pid}}]: New session 47 of user {{user}}.',
  '{{date}} postfix/smtp[{{pid}}]: {{ip}}: to=<admin@corp.local>, relay=mail.corp.local[10.0.0.8]:25, status=sent',
  '{{date}} kernel: [{{uptime}}] device eth0 entered promiscuous mode',
  '{{date}} dhclient[{{pid}}]: DHCPREQUEST for 10.0.0.{{pid}} on eth0 to {{ip}} port 67',
  '{{date}} rsyslogd: [origin software="rsyslogd"] start',
  '{{date}} fail2ban.actions[{{pid}}]: NOTICE [sshd] Ban {{ip}}',
];

export const configTemplatesByRole: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    'ServerRoot "/etc/httpd"\nListen {{port}}\nDocumentRoot "/var/www/html"\nServerName {{hostname}}',
    'server {\n  listen {{port}};\n  server_name {{hostname}};\n  root /var/www/html;\n}',
    '<VirtualHost *:{{port}}>\n  ServerName {{hostname}}\n  DocumentRoot /var/www/html\n  ErrorLog /var/log/apache2/error.log\n  CustomLog /var/log/apache2/access.log combined\n  SSLEngine on\n  SSLCertificateFile /etc/ssl/certs/{{hostname}}.pem\n</VirtualHost>',
    'upstream backend {\n  server 127.0.0.1:8080;\n}\nserver {\n  listen {{port}};\n  server_name {{hostname}};\n  location / {\n    proxy_pass http://backend;\n    proxy_set_header Host $host;\n  }\n}',
    'server {\n  listen {{port}} ssl;\n  server_name {{hostname}};\n  ssl_certificate /etc/ssl/certs/{{hostname}}.pem;\n  ssl_certificate_key /etc/ssl/private/{{hostname}}.key;\n  root /var/www/html;\n  index index.html;\n  access_log /var/log/nginx/access.log;\n}',
    '<VirtualHost *:{{port}}>\n  ServerName {{hostname}}\n  ProxyPreserveHost On\n  ProxyPass / http://127.0.0.1:3000/\n  ProxyPassReverse / http://127.0.0.1:3000/\n  ErrorLog ${APACHE_LOG_DIR}/error.log\n</VirtualHost>',
  ],
  database: [
    '[mysqld]\nport={{port}}\ndatadir=/var/lib/mysql\nuser={{user}}\nbind-address=0.0.0.0',
    "listen_addresses = '*'\nport = {{port}}\nmax_connections = 100",
    '[mysqld]\nserver-id=1\nlog_bin=mysql-bin\nbinlog_do_db=app_prod\nport={{port}}\nmax_connections=200\ninnodb_buffer_pool_size=256M',
    'shared_buffers = 128MB\nwork_mem = 4MB\nwal_level = replica\nmax_wal_senders = 3\narchive_mode = on\narchive_command = cp %p /var/lib/postgresql/archive/%f',
    '[mysqld]\nskip-name-resolve\nmax_allowed_packet=64M\nport={{port}}\nslow_query_log=1\nslow_query_log_file=/var/log/mysql/slow.log\nlong_query_time=2',
    "host all all 0.0.0.0/0 md5\nhost replication replicator 10.0.0.0/24 md5\nlocal all all peer\n# pg_hba.conf — {{hostname}}",
  ],
  fileserver: [
    '[global]\nworkgroup = MISSION\nsecurity = user\n\n[share]\npath = /srv/ftp\nwritable = yes',
    'anonymous_enable=NO\nlocal_enable=YES\nwrite_enable=YES\nchroot_local_user=YES',
    '[global]\nworkgroup = CORP\nserver string = {{hostname}}\nsecurity = user\nmap to guest = Bad Password\n\n[public]\npath = /srv/share\nbrowseable = yes\nread only = no\nguest ok = yes',
    'listen=YES\nlocal_enable=YES\nwrite_enable=YES\npasv_min_port=30000\npasv_max_port=31000\nuserlist_enable=YES\nuserlist_file=/etc/vsftpd.userlist\nuserlist_deny=NO\nssl_enable=NO',
    '[global]\nworkgroup = INTERNAL\nserver string = File Server (%h)\nlog file = /var/log/samba/%m.log\nmax log size = 1000\nsecurity = user\n\n[data]\npath = /srv/data\nvalid users = @staff\nread only = no',
    'listen=YES\nanonymous_enable=YES\nanon_root=/srv/ftp/pub\nlocal_enable=YES\nwrite_enable=YES\nxferlog_enable=YES\nxferlog_file=/var/log/vsftpd.log\nidle_session_timeout=600',
  ],
  workstation: [
    'Host *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3',
    'export PS1="\\u@\\h:\\w\\$ "\nexport EDITOR=nano\nexport PATH=$PATH:/usr/local/bin',
    'Host bastion\n  HostName 10.0.0.10\n  User {{user}}\n  IdentityFile ~/.ssh/id_rsa\n  ProxyJump none\n  ForwardAgent yes',
    '# ~/.tmux.conf\nset -g mouse on\nset -g history-limit 10000\nset -g default-terminal "screen-256color"\nbind r source-file ~/.tmux.conf',
    '[default]\nregion = us-east-1\noutput = json\n\n[profile admin]\nrole_arn = arn:aws:iam::123456789012:role/admin\nsource_profile = default',
    '# Crontab for {{user}}\n*/5 * * * * /opt/scripts/health_check.sh\n0 2 * * * /opt/scripts/backup_db.sh\n0 6 * * 1 /opt/scripts/weekly_report.sh',
  ],
  mailserver: [
    'smtpd_banner = $myhostname ESMTP $mail_name\nsmtpd_tls_cert_file=/etc/ssl/certs/ssl-cert.pem\nsmtpd_tls_key_file=/etc/ssl/private/ssl-cert.key\nmyhostname = {{hostname}}\nmydestination = $myhostname, localhost\ninet_interfaces = all',
    'protocols = imap\nlisten = *, ::\nmail_location = mbox:~/mail:INBOX=/var/mail/%u\nssl = required\nssl_cert = </etc/ssl/certs/dovecot.pem\nssl_key = </etc/ssl/private/dovecot.pem',
    'smtpd_relay_restrictions = permit_mynetworks permit_sasl_authenticated defer_unauth_destination\nmyhostname = {{hostname}}\nalias_maps = hash:/etc/aliases\nmailbox_size_limit = 51200000\nrecipient_delimiter = +\ninet_interfaces = all\ninet_protocols = ipv4',
    'service imap-login {\n  inet_listener imap {\n    port = 143\n  }\n  inet_listener imaps {\n    port = 993\n    ssl = yes\n  }\n}\nmail_location = maildir:~/Maildir\nauth_mechanisms = plain login',
    'queue_directory = /var/spool/postfix\ncommand_directory = /usr/sbin\ndaemon_directory = /usr/lib/postfix/sbin\ndata_directory = /var/lib/postfix\nmail_owner = postfix\nmyhostname = {{hostname}}\nmynetworks = 10.0.0.0/24, 127.0.0.0/8',
    '# Dovecot + LDAP auth\nbase = dc=corp,dc=local\nscope = subtree\nuser_attrs = uid=user\npass_attrs = uid=user,userPassword=password\ndefault_pass_scheme = SSHA',
  ],
  iot: [
    '# BusyBox v1.31.1\nhostname={{hostname}}\ndevice_type=sensor_gateway\nfirmware=v2.1.4\nmqtt_broker=127.0.0.1\nmqtt_port=1883\nlog_level=warn',
    '# Device configuration\n[network]\ndhcp=yes\nhostname={{hostname}}\n[mqtt]\nbroker=localhost\nport=1883\ntopic_prefix=devices/{{hostname}}\n[sensor]\ninterval=60\nthreshold=25.0',
    '# Zigbee coordinator config\nserial_port=/dev/ttyUSB0\nbaud_rate=115200\npan_id=0x1A62\nchannel=15\nnetwork_key=01030507090B0D0F00020406080A0C0E\nhostname={{hostname}}',
    '# OTA update manifest\n[firmware]\ncurrent=2.1.4\nchannel=stable\ncheck_url=https://ota.vendor.io/{{hostname}}\nverify_sig=true\nauto_install=false\nrollback_slot=A',
    '# Home Assistant config\nhomeassistant:\n  name: Home\n  unit_system: metric\n  time_zone: UTC\nmqtt:\n  broker: localhost\n  port: 1883\n  discovery: true\nautomation: !include automations.yaml',
    '# Modbus RTU configuration\n[modbus]\ndevice=/dev/ttyS0\nbaudrate=9600\nparity=N\nstopbits=1\nunit_id=1\nregisters=0x0000-0x00FF\npoll_interval=5',
  ],
  router: [
    '*filter\n:INPUT DROP [0:0]\n:FORWARD ACCEPT [0:0]\n:OUTPUT ACCEPT [0:0]\n-A INPUT -i lo -j ACCEPT\n-A INPUT -p tcp --dport 22 -j ACCEPT\n-A INPUT -p tcp --dport {{port}} -j ACCEPT\n-A FORWARD -i eth1 -o eth0 -j ACCEPT\n-A FORWARD -i eth0 -o eth1 -m state --state RELATED,ESTABLISHED -j ACCEPT\nCOMMIT',
    'auto eth0\niface eth0 inet static\n  address {{hostname}}\n  netmask 255.255.255.0\n  gateway 0.0.0.0\n\nauto eth1\niface eth1 inet static\n  address 10.0.0.1\n  netmask 255.255.255.0',
    '# OSPF configuration\nrouter ospf\n  router-id {{hostname}}\n  network 10.0.0.0/24 area 0\n  passive-interface eth0\n  default-information originate\n  log-adjacency-changes',
    '# NAT configuration\n*nat\n:PREROUTING ACCEPT [0:0]\n:POSTROUTING ACCEPT [0:0]\n-A POSTROUTING -s 10.0.0.0/24 -o eth0 -j MASQUERADE\nCOMMIT\n# Sysctl\nnet.ipv4.ip_forward=1',
    'auto eth0\niface eth0 inet dhcp\n\nauto eth1\niface eth1 inet static\n  address 10.0.0.1\n  netmask 255.255.255.0\n  post-up echo 1 > /proc/sys/net/ipv4/ip_forward\n  post-up iptables-restore < /etc/iptables.rules',
    '# BGP configuration\nrouter bgp 65001\n  bgp router-id {{hostname}}\n  neighbor 10.0.0.2 remote-as 65002\n  network 192.168.0.0/16\n  redistribute connected\n  maximum-paths 2',
  ],
  switch: [
    '! Cisco IOS L3 Switch Configuration\nhostname {{hostname}}\n!\nvlan 10\n  name MGMT\nvlan 20\n  name DATA\n!\ninterface GigabitEthernet0/1\n  switchport mode trunk\n  switchport trunk allowed vlan 10,20',
    '! Spanning Tree Configuration\nspanning-tree mode rapid-pvst\nspanning-tree vlan 10,20 priority 4096\n!\ninterface GigabitEthernet0/1\n  spanning-tree portfast trunk\n  spanning-tree bpduguard enable',
    '! Port Security Configuration\ninterface GigabitEthernet0/2\n  switchport port-security\n  switchport port-security maximum 3\n  switchport port-security violation restrict\n  switchport port-security mac-address sticky',
    '! ACL and QoS Configuration\nhostname {{hostname}}\n!\nip access-list extended MGMT-ACCESS\n  permit tcp any host {{hostname}} eq 22\n  permit udp any host {{hostname}} eq 161\n  deny ip any any log',
    '! DHCP Snooping Configuration\nhostname {{hostname}}\n!\nip dhcp snooping\nip dhcp snooping vlan 10,20\n!\ninterface GigabitEthernet0/1\n  ip dhcp snooping trust\n!\ninterface GigabitEthernet0/2\n  ip dhcp snooping limit rate 15',
    '! LACP Configuration\nhostname {{hostname}}\n!\ninterface Port-channel1\n  switchport mode trunk\n  switchport trunk allowed vlan 10,20,30\n!\ninterface GigabitEthernet0/1\n  channel-group 1 mode active\ninterface GigabitEthernet0/2\n  channel-group 1 mode active',
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
  {
    name: '.bash_logout',
    content: '# ~/.bash_logout\nclear\nhistory -c',
  },
  {
    name: '.inputrc',
    content: 'set editing-mode vi\nset show-all-if-ambiguous on\nset completion-ignore-case on',
  },
  {
    name: '.wgetrc',
    content: 'timestamping = on\ntries = 3\nwaitretry = 10\ntimeout = 30',
  },
  {
    name: '.selected_editor',
    content: '# Generated by select-editor\nSELECTED_EDITOR="/usr/bin/nano"',
  },
  {
    name: '.bash_history',
    content:
      'df -h\nfree -m\ntop -bn1 | head -20\nsudo apt update\nsudo apt upgrade -y\nreboot',
  },
  {
    name: '.bash_history',
    content:
      'mysql -u root -p\nSELECT * FROM users;\nmysqldump --all-databases > dump.sql\nexit',
  },
  {
    name: '.psql_history',
    content: '\\dt\nSELECT count(*) FROM sessions;\n\\q',
  },
  {
    name: '.tmux.conf',
    content:
      'set -g prefix C-a\nunbind C-b\nbind C-a send-prefix\nset -g base-index 1\nset -g pane-base-index 1',
  },
  {
    name: '.toprc',
    content: 'RCfile for "top"\nId:a, Mode_altscr=0, Mode_irixps=1, Delay_time=3.0',
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
    {
      path: '/srv/ftp/uploads/vendor_contract.txt',
      contentTemplate:
        'VENDOR AGREEMENT — STRICTLY CONFIDENTIAL\nContract #: VND-2024-0847\nParty: Acme Corp\nValue: $3,200,000\n\nSigning authorization: {{access_key}}\n\nThis document is legally binding.',
    },
    {
      path: '/srv/backup/tax_records_2024.csv',
      contentTemplate:
        'Entity,TaxID,Revenue,Filing_Key\nCorp-Main,XX-1234567,48200000,FK-001\nCorp-EU,XX-7654321,12400000,{{access_key}}\nCorp-APAC,XX-9876543,8700000,FK-003',
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
    {
      path: '/opt/mysql/dumps/api_keys.sql',
      contentTemplate:
        "-- API key rotation dump\nINSERT INTO `api_keys` VALUES (1,'internal','ak_public_f8a2');\nINSERT INTO `api_keys` VALUES (2,'admin','{{access_key}}');\nINSERT INTO `api_keys` VALUES (3,'readonly','ak_public_d1e0');",
    },
    {
      path: '/opt/db/exports/transactions.csv',
      contentTemplate:
        'TxnID,From,To,Amount,AuthCode\nTXN-4401,Treasury,Ops,150000.00,AC-7721\nTXN-4402,Treasury,Offshore,2450000.00,{{access_key}}\nTXN-4403,Ops,Payroll,62000.00,AC-8834',
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
    {
      path: '/srv/www/data/session_tokens.json',
      contentTemplate:
        '{\n  "sessions": [\n    {"user": "admin", "token": "{{access_key}}", "expires": "2025-12-31"},\n    {"user": "editor", "token": "tok_expired_001", "expires": "2024-01-01"},\n    {"user": "viewer", "token": "tok_expired_002", "expires": "2024-01-01"}\n  ]\n}',
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
    {
      path: '/opt/projects/board_minutes.txt',
      contentTemplate:
        'Board Meeting Minutes — 2024-Q1\n================================\nAttendees: CEO, CFO, CTO, General Counsel\n\nResolution #47: Approve offshore transfer\nAuthorization: {{access_key}}\n\nMeeting adjourned 16:45.',
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
    {
      path: '/opt/firmware/telemetry_export.json',
      contentTemplate:
        '{\n  "device": "{{hostname}}",\n  "readings": [\n    {"sensor": "temp", "value": 22.5, "unit": "C"},\n    {"sensor": "humidity", "value": 61.2, "unit": "%"}\n  ],\n  "api_key": "{{access_key}}",\n  "uploaded": "2024-01-15T08:30:00Z"\n}',
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
    {
      path: '/var/spool/mail/finance',
      contentTemplate:
        'From: payroll@corp.local\nTo: finance@corp.local\nSubject: Wire Transfer Authorization\nDate: Thu, 18 Jan 2024 09:44:11 -0500\n\nPlease authorize the following wire:\nAmount: $1,850,000\nDestination: Cayman National Bank\nAuth code: {{access_key}}\n\nApproval required by EOD.',
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
  // Switch is infrastructure-only (never the mission target), but the type system
  // requires target file templates for every role. These are unused in practice.
  switch: [
    {
      path: '/opt/switch/acl_backup.txt',
      contentTemplate:
        'Switch ACL Backup\n=================\nManagement key: {{access_key}}\nLast audit: 2024-01-15',
    },
    {
      path: '/opt/switch/vlan_keys.txt',
      contentTemplate:
        'VLAN Pre-shared Keys\n====================\nVLAN-10: {{access_key}}\nVLAN-20: psk_c3d4e5f6',
    },
    {
      path: '/opt/switch/running_config.txt',
      contentTemplate:
        '! Switch running configuration\n! Secret: {{access_key}}\nhostname l3-switch\nno ip domain-lookup',
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
    {
      path: '/srv/ftp/exports/shipping_manifest.csv',
      contentTemplate:
        'OrderID,Destination,Weight_kg,Status\nSHP-901,Warehouse-A,1200,{{tamperOldValue}}\nSHP-902,Warehouse-B,850,in_transit\nSHP-903,Warehouse-C,2100,delivered',
      tamperField: 'status',
      tamperOldValue: 'held_customs',
      tamperNewValue: 'cleared',
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
    {
      path: '/opt/db/exports/permissions.csv',
      contentTemplate:
        'UserID,Username,Role,MFA\n1001,admin,superadmin,enabled\n1002,target_user,{{tamperOldValue}},disabled\n1003,service,readonly,enabled',
      tamperField: 'role',
      tamperOldValue: 'readonly',
      tamperNewValue: 'superadmin',
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
    {
      path: '/srv/www/data/pricing.json',
      contentTemplate:
        '{\n  "products": [\n    {"sku": "PRD-001", "name": "Enterprise License", "price": {{tamperOldValue}}, "currency": "USD"},\n    {"sku": "PRD-002", "name": "Standard License", "price": 499, "currency": "USD"}\n  ]\n}',
      tamperField: 'price',
      tamperOldValue: '4999',
      tamperNewValue: '1',
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
    {
      path: '/opt/projects/expense_report.csv',
      contentTemplate:
        'ClaimID,Employee,Amount,Approved\nEXP-301,Reynolds,$847.50,yes\nEXP-302,Target,{{tamperOldValue}},pending\nEXP-303,Foster,$124.00,yes',
      tamperField: 'amount',
      tamperOldValue: '$12,500.00',
      tamperNewValue: '$125,000.00',
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
    {
      path: '/etc/config/access.conf',
      contentTemplate:
        '# Physical access control\nzone=server_room\nauth_mode=badge\nfail_mode={{tamperOldValue}}\nlog_access=true\nalert_email=security@corp.local',
      tamperField: 'fail_mode',
      tamperOldValue: 'locked',
      tamperNewValue: 'open',
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
    {
      path: '/etc/postfix/transport',
      contentTemplate:
        '# Transport map\ncorp.local    local:\nexternal.com  smtp:[relay.corp.local]\naudit.corp.local  {{tamperOldValue}}\n.corp.local   smtp:',
      tamperField: 'transport',
      tamperOldValue: 'smtp:[audit-relay.corp.local]',
      tamperNewValue: 'discard:',
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
  switch: [
    {
      path: '/opt/switch/acl_policy.conf',
      contentTemplate:
        '# ACL Policy\nrule_12_action={{tamperOldValue}}\nrule_12_src=10.0.0.0/8\nrule_12_dst=0.0.0.0/0\nrule_12_proto=tcp',
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
  {
    path: '/etc/luks/recovery.key',
    template: '# LUKS recovery key — store offline\nSLOT=7\nKEY={{key}}',
    hint: 'A LUKS disk encryption recovery key is stored in /etc/luks/ on {{machine}}',
  },
  {
    path: '/opt/app/.encryption_key',
    template:
      '# Application-level encryption key\n# Generated: 2024-01-22\nENC_KEY={{key}}\nCIPHER=AES-256-GCM',
    hint: 'An application encryption key exists in /opt/app/ on {{machine}}',
  },
  {
    path: '/srv/ssl/archive_decrypt.pem',
    template:
      '-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\n\n{{key}}\n-----END RSA PRIVATE KEY-----',
    hint: 'A decryption key for the archives is in /srv/ssl/ on {{machine}}',
  },
  {
    path: '/tmp/.gpg-export',
    template:
      '# Exported GPG key — temporary\nUID: ops@corp.local\nFINGERPRINT: 4A2B...C8D9\nSECRET={{key}}',
    hint: 'A temporary GPG key export was left in /tmp/ on {{machine}}',
  },
  {
    path: '/etc/wireguard/psk.key',
    template: '# WireGuard pre-shared key\n{{key}}',
    hint: 'A WireGuard pre-shared key is stored in /etc/wireguard/ on {{machine}}',
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
  {
    name: 'README.txt',
    content:
      'Server setup notes:\n1. Install packages from requirements.txt\n2. Run migrations\n3. Set ENV vars per .env.example\nContact ops@corp.local for access.',
  },
  {
    name: 'ssh_keys.bak',
    content:
      '# Rotated SSH keys — DO NOT USE\n# Replaced 2024-01-15 per security audit\nold_key_1: ssh-rsa AAAAB3Nza... (revoked)\nold_key_2: ssh-rsa AAAAB3Nza... (revoked)',
  },
  {
    name: '.env.example',
    content:
      'DB_HOST=localhost\nDB_USER=<your_user>\nDB_PASS=<your_password>\nSECRET_KEY=<generate_one>\nDEBUG=false',
  },
  {
    name: 'CHANGELOG.md',
    content:
      '## v4.2.1 (2024-01-18)\n- Patched CVE-2024-0001\n- Updated dependencies\n\n## v4.2.0 (2024-01-10)\n- Added 2FA support\n- Fixed session timeout',
  },
  {
    name: 'api_keys.revoked',
    content:
      '# Revoked API keys — audit trail\nak_f8a2e7c1 revoked 2024-01-05 (leaked in logs)\nak_29f84c0d revoked 2024-01-12 (employee departure)\nAll active keys migrated to Vault.',
  },
  {
    name: 'backup_manifest.txt',
    content:
      'Backup: 2024-01-15 02:00:01\nFiles: 12,847\nSize: 2.3GB\nStatus: completed\nNext: 2024-01-16 02:00:00\nRetention: 30 days',
  },
  {
    name: 'known_issues.txt',
    content:
      '- Port 8080 intermittently drops connections under load\n- Cron job at 02:00 sometimes overlaps with backup\n- /tmp fills up if logs not rotated\n- DNS resolution slow from this subnet',
  },
  {
    name: '.htpasswd.old',
    content:
      '# Expired htpasswd — migrated to LDAP\nadmin:$apr1$x9z.../... (disabled)\ndevops:$apr1$y8w.../... (disabled)',
  },
  {
    name: 'network_diagram.txt',
    content:
      'Internal Network Map (outdated)\n================================\n10.0.0.1 — gateway\n10.0.0.5 — web (decommissioned)\n10.0.0.10 — db (migrated to cloud)\nSee Confluence for current diagram.',
  },
];
