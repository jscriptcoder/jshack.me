/**
 * The config file a generated NPC box keeps in `/etc`, keyed by what the box is for.
 *
 * This is the lowest tier of recon in the game: no credential opens it, a **guest**
 * can read it, and it is the only thing on the three roles whose daemon has not
 * shipped that says what they are. A `db-11` carries a `mysql.cnf` naming its data
 * directory and bind address long before any `mysqld` exists in the world to run —
 * which is the point. A config states what a box is SET UP to be; that claim stays
 * true on a box whose daemon is down, so unlike `/var/log/vsftpd.log` — which
 * follows its service, because a log on a box that never ran one claims something
 * happened — this file follows the ROLE.
 *
 * The contents are real configs, not labels. A file whose only content is "this is a
 * camera" tells a player nothing the hostname on the scan did not, so every template
 * names paths, tunings and neighbours worth reading, and every one of them names the
 * host it sits on.
 *
 * **No template names an account.** `/etc/passwd` is guest-unreadable precisely
 * because account names and inline hashes are what the cracking curve exists to make
 * a player earn, and a guest-readable file naming the box's own uid-1000 user would
 * hand back half of that for free. There is no fill for it, so a template that tried
 * would render a literal placeholder and fail its test rather than leak.
 *
 * The names are legacy's `serviceConfigNames`, adopted rather than coined, so a
 * `mysql.cnf` means in v2 what it meant in the app this one replaces.
 */

import { createPrng } from '../prng';
import { SERVICE_CATALOG, type ServiceSpec } from '../../services/serviceCatalog';
import type { DrawnRole } from '../machineRole';

/** Interpolated wherever the host's own name belongs. */
const HOSTNAME_PLACEHOLDER = /\{\{hostname\}\}/g;
/** Interpolated wherever the port the box's own daemon listens on belongs. */
const PORT_PLACEHOLDER = /\{\{port\}\}/g;

type RoleConfig = {
  readonly filename: string;
  /** The catalog service whose LISTEN PORT this role's templates state. Present only
   *  where the world actually ships that daemon, because only then can the file and
   *  a scan disagree — a `www-04` answering on 8080 must not keep a config claiming
   *  :80. Absent for the roles whose door has not shipped: `mysql.cnf` says 3306
   *  because that is what mysql listens on, and nothing can contradict it until a
   *  `mysqld` exists to be scanned. */
  readonly service?: ServiceSpec;
  readonly templates: readonly string[];
};

const CONFIG_BY_ROLE: Readonly<Record<DrawnRole, RoleConfig>> = {
  workstation: {
    filename: 'ssh_config',
    templates: [
      '# ssh client config — {{hostname}}\nHost *\n  ServerAliveInterval 60\n  ServerAliveCountMax 3\n  HashKnownHosts yes',
      '# {{hostname}}\nHost bastion\n  HostName 10.0.0.10\n  IdentityFile ~/.ssh/id_rsa\n  ForwardAgent yes\n  StrictHostKeyChecking ask',
      '# {{hostname}}\nHost *\n  Compression yes\n  ControlMaster auto\n  ControlPath ~/.ssh/cm-%r@%h:%p\n  ControlPersist 10m',
      '# {{hostname}}\nHost fileserver\n  HostName 192.168.1.20\n  Port 21\nHost *\n  ServerAliveInterval 120\n  TCPKeepAlive yes',
      '# {{hostname}}\nHost *\n  PubkeyAuthentication yes\n  PasswordAuthentication yes\n  IdentitiesOnly yes\n  LogLevel INFO',
    ],
  },
  iot: {
    filename: 'device.conf',
    templates: [
      '# BusyBox v1.31.1\nhostname={{hostname}}\ndevice_type=sensor_gateway\nfirmware=v2.1.4\nmqtt_broker=127.0.0.1\nmqtt_port=1883\nlog_level=warn',
      '# Device configuration\n[network]\ndhcp=yes\nhostname={{hostname}}\n[mqtt]\nbroker=localhost\nport=1883\ntopic_prefix=devices/{{hostname}}\n[sensor]\ninterval=60\nthreshold=25.0',
      '# Zigbee coordinator\nhostname={{hostname}}\nserial_port=/dev/ttyUSB0\nbaud_rate=115200\npan_id=0x1A62\nchannel=15\nnetwork_key=01030507090B0D0F00020406080A0C0E',
      '# OTA update manifest\n[firmware]\ncurrent=2.1.4\nchannel=stable\ncheck_url=https://ota.vendor.io/{{hostname}}\nverify_sig=true\nauto_install=false\nrollback_slot=A',
      '# Modbus RTU — {{hostname}}\n[modbus]\ndevice=/dev/ttyS0\nbaudrate=9600\nparity=N\nstopbits=1\nunit_id=1\nregisters=0x0000-0x00FF\npoll_interval=5',
    ],
  },
  webserver: {
    filename: 'httpd.conf',
    service: SERVICE_CATALOG.http,
    templates: [
      'ServerRoot "/etc/httpd"\nListen {{port}}\nDocumentRoot "/var/www/html"\nServerName {{hostname}}\nErrorLog /var/log/apache2/error.log',
      'server {\n  listen {{port}};\n  server_name {{hostname}};\n  root /var/www/html;\n  index index.html;\n  access_log /var/log/nginx/access.log;\n}',
      '<VirtualHost *:{{port}}>\n  ServerName {{hostname}}\n  DocumentRoot /var/www/html\n  ErrorLog /var/log/apache2/error.log\n  CustomLog /var/log/apache2/access.log combined\n</VirtualHost>',
      'upstream backend {\n  server 127.0.0.1:3000;\n}\nserver {\n  listen {{port}};\n  server_name {{hostname}};\n  location / {\n    proxy_pass http://backend;\n    proxy_set_header Host $host;\n  }\n}',
      'server {\n  listen {{port}} ssl;\n  server_name {{hostname}};\n  ssl_certificate /etc/ssl/certs/{{hostname}}.pem;\n  ssl_certificate_key /etc/ssl/private/{{hostname}}.key;\n  root /var/www/html;\n}',
    ],
  },
  fileserver: {
    filename: 'vsftpd.conf',
    service: SERVICE_CATALOG.ftp,
    templates: [
      '# {{hostname}}\nlisten=YES\nlisten_port={{port}}\nanonymous_enable=NO\nlocal_enable=YES\nwrite_enable=YES\nchroot_local_user=YES',
      '# {{hostname}}\nlisten=YES\nlisten_port={{port}}\nlocal_enable=YES\nwrite_enable=YES\npasv_min_port=30000\npasv_max_port=31000\nuserlist_enable=YES\nuserlist_file=/etc/vsftpd.userlist',
      '# {{hostname}}\nlisten=YES\nlisten_port={{port}}\nanonymous_enable=YES\nanon_root=/srv/ftp/pub\nlocal_enable=YES\nxferlog_enable=YES\nxferlog_file=/var/log/vsftpd.log',
      '# {{hostname}}\nlisten=YES\nlisten_port={{port}}\nlocal_root=/srv/share\nlocal_enable=YES\nwrite_enable=YES\nidle_session_timeout=600\ndirmessage_enable=YES',
      '# {{hostname}}\nlisten=YES\nlisten_port={{port}}\nlocal_enable=YES\nwrite_enable=YES\nssl_enable=NO\nmax_clients=50\nmax_per_ip=4\nlocal_umask=022',
    ],
  },
  database: {
    filename: 'mysql.cnf',
    templates: [
      '[mysqld]\n# {{hostname}}\nport=3306\ndatadir=/var/lib/mysql\nuser=mysql\nbind-address=0.0.0.0\nsocket=/var/run/mysqld/mysqld.sock',
      '[mysqld]\n# {{hostname}}\nport=3306\nserver-id=1\nlog_bin=mysql-bin\nbinlog_do_db=app_prod\nmax_connections=200\ninnodb_buffer_pool_size=256M',
      '[mysqld]\n# {{hostname}}\nport=3306\nskip-name-resolve\nmax_allowed_packet=64M\nslow_query_log=1\nslow_query_log_file=/var/log/mysql/slow.log\nlong_query_time=2',
      '[mysqld]\n# {{hostname}}\nport=3306\ndatadir=/var/lib/mysql\ncharacter-set-server=utf8mb4\ncollation-server=utf8mb4_general_ci\ninnodb_file_per_table=1',
      '[mysqld]\n# replica of {{hostname}}\nport=3306\nread_only=1\nrelay_log=relay-bin\nreplicate_do_db=app_prod\nexpire_logs_days=7\nsync_binlog=1',
    ],
  },
  mailserver: {
    filename: 'postfix.conf',
    templates: [
      'myhostname = {{hostname}}\nsmtpd_banner = $myhostname ESMTP\nmydestination = $myhostname, localhost\ninet_interfaces = all\nmailbox_size_limit = 51200000',
      'myhostname = {{hostname}}\nsmtpd_relay_restrictions = permit_mynetworks permit_sasl_authenticated defer_unauth_destination\nalias_maps = hash:/etc/aliases\nrecipient_delimiter = +\ninet_protocols = ipv4',
      'myhostname = {{hostname}}\nqueue_directory = /var/spool/postfix\ncommand_directory = /usr/sbin\ndata_directory = /var/lib/postfix\nmail_owner = postfix\nmynetworks = 10.0.0.0/24, 127.0.0.0/8',
      'myhostname = {{hostname}}\nsmtpd_tls_cert_file = /etc/ssl/certs/ssl-cert.pem\nsmtpd_tls_key_file = /etc/ssl/private/ssl-cert.key\nsmtpd_tls_security_level = may\ninet_interfaces = all',
      'myhostname = {{hostname}}\nvirtual_mailbox_domains = /etc/postfix/vdomains\nvirtual_mailbox_base = /var/mail/vhosts\nmessage_size_limit = 20480000\nmaximal_queue_lifetime = 5d',
    ],
  },
  dns: {
    filename: 'named.conf',
    templates: [
      '// {{hostname}}\noptions {\n  listen-on port 53 { any; };\n  directory "/var/cache/bind";\n  recursion yes;\n  allow-recursion { 10.0.0.0/8; 192.168.0.0/16; };\n  forwarders { 8.8.8.8; 8.8.4.4; };\n};',
      '// {{hostname}}\noptions {\n  listen-on port 53 { any; };\n  directory "/var/cache/bind";\n  recursion yes;\n  allow-query { any; };\n  max-cache-size 256M;\n  version "not disclosed";\n};',
      '// {{hostname}}\noptions {\n  listen-on port 53 { any; };\n  directory "/var/cache/bind";\n  recursion no;\n  allow-query { any; };\n  rate-limit {\n    responses-per-second 10;\n  };\n};',
      '// {{hostname}}\noptions {\n  listen-on port 53 { any; };\n  directory "/var/cache/bind";\n  forwarders { 1.1.1.1; 9.9.9.9; };\n  forward only;\n  max-cache-ttl 3600;\n  max-ncache-ttl 300;\n};',
      '// {{hostname}}\noptions {\n  listen-on port 53 { any; };\n  directory "/var/cache/bind";\n  dnssec-validation yes;\n  auth-nxdomain no;\n  listen-on-v6 { none; };\n  querylog yes;\n};',
    ],
  },
};

/**
 * The `/etc` config file a box of this role keeps: what it is called, and what
 * reading it tells you about THIS box.
 *
 * `ports` is what the box actually has listening, service name to port. A role whose
 * daemon the world ships states the port it really answers on — read from there,
 * falling back to the daemon's default where the box is not running it, because a
 * config describes what is configured rather than what happens to be up.
 *
 * The draw takes the caller's seed as its OWN stream rather than continuing the
 * host's other draws: appending to a shared PRNG sequence would re-roll every value
 * picked after it, silently moving accounts and passwords already generated.
 */
export const roleConfigFile = ({
  role,
  hostname,
  seed,
  ports,
}: {
  readonly role: DrawnRole;
  readonly hostname: string;
  readonly seed: string;
  readonly ports: ReadonlyMap<string, number>;
}): { readonly name: string; readonly content: string } => {
  const config = CONFIG_BY_ROLE[role];
  const template = createPrng(seed).pick(config.templates);
  const named = template.replace(HOSTNAME_PLACEHOLDER, hostname);
  if (config.service === undefined) return { name: config.filename, content: named };

  const listening = ports.get(config.service.service);
  const port = listening === undefined ? config.service.defaultPort : listening;
  return { name: config.filename, content: named.replace(PORT_PLACEHOLDER, String(port)) };
};
