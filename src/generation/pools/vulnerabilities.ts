import type { Vulnerability } from '../../network/types';

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
  // MongoDB
  {
    port: 27017,
    service: 'mongodb',
    vulnerability: {
      cve: 'CVE-2020-7921',
      description: 'MongoDB auth bypass via crafted roleInfo command',
      serviceVersion: 'MongoDB 3.6.12',
    },
  },
  {
    port: 27017,
    service: 'mongodb',
    vulnerability: {
      cve: 'CVE-2019-2390',
      description: 'MongoDB BSON deserialization RCE via crafted document',
      serviceVersion: 'MongoDB 4.0.5',
    },
  },
  // rsync
  {
    port: 873,
    service: 'rsync',
    vulnerability: {
      cve: 'CVE-2022-29154',
      description: 'rsync arbitrary file write via path validation bypass',
      serviceVersion: 'rsync 3.2.3',
    },
  },
  {
    port: 873,
    service: 'rsync',
    vulnerability: {
      cve: 'CVE-2024-12084',
      description: 'rsync heap buffer overflow via checksum parsing',
      serviceVersion: 'rsync 3.2.7',
    },
  },
  // VNC
  {
    port: 5900,
    service: 'vnc',
    vulnerability: {
      cve: 'CVE-2019-15681',
      description: 'TightVNC heap buffer overflow / info leak',
      serviceVersion: 'TightVNC 1.3.10',
    },
  },
  {
    port: 5900,
    service: 'vnc',
    vulnerability: {
      cve: 'CVE-2006-2369',
      description: 'RealVNC authentication bypass via null auth type',
      serviceVersion: 'RealVNC 4.1.1',
    },
  },
  // POP3
  {
    port: 110,
    service: 'pop3',
    vulnerability: {
      cve: 'CVE-2017-15130',
      description: 'Dovecot POP3 denial-of-service via crafted RETR',
      serviceVersion: 'Dovecot 2.2.33',
    },
  },
  {
    port: 110,
    service: 'pop3',
    vulnerability: {
      cve: 'CVE-2019-3467',
      description: 'Courier POP3 buffer overflow / privilege escalation',
      serviceVersion: 'Courier 0.75.0',
    },
  },
  // Modbus (ICS/SCADA)
  {
    port: 502,
    service: 'modbus',
    vulnerability: {
      cve: 'CVE-2022-2003',
      description: 'AutomationDirect Modbus unauthenticated write to PLC registers',
      serviceVersion: 'ModbusTCP 1.0',
    },
  },
  {
    port: 502,
    service: 'modbus',
    vulnerability: {
      cve: 'CVE-2019-9560',
      description: 'Schneider Modbus gateway unauthenticated admin access',
      serviceVersion: 'Modicon M340',
    },
  },
  // OpenVPN
  {
    port: 1194,
    service: 'openvpn',
    vulnerability: {
      cve: 'CVE-2017-12166',
      description: 'OpenVPN buffer overflow in key-method negotiation',
      serviceVersion: 'OpenVPN 2.4.3',
    },
  },
  {
    port: 1194,
    service: 'openvpn',
    vulnerability: {
      cve: 'CVE-2020-15078',
      description: 'OpenVPN auth bypass via deferred auth plugin',
      serviceVersion: 'OpenVPN 2.5.1',
    },
  },
  // Additional HTTP variants
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2019-0211',
      description: 'Apache privilege escalation via scoreboard manipulation',
      serviceVersion: 'Apache/2.4.38',
    },
  },
  {
    port: 80,
    service: 'http',
    vulnerability: {
      cve: 'CVE-2021-23017',
      description: 'nginx DNS resolver off-by-one heap write',
      serviceVersion: 'nginx/1.20.0',
    },
  },
  // Additional SSH-adjacent
  {
    port: 8080,
    service: 'http-alt',
    vulnerability: {
      cve: 'CVE-2021-44228',
      description: 'Apache Log4j2 JNDI RCE (Log4Shell)',
      serviceVersion: 'Tomcat/9.0.40',
    },
  },
  // Additional database
  {
    port: 3306,
    service: 'mysql',
    vulnerability: {
      cve: 'CVE-2021-27928',
      description: 'MariaDB wsrep provider RCE via crafted SET GLOBAL',
      serviceVersion: 'MariaDB 10.5.8',
    },
  },
  {
    port: 5432,
    service: 'postgresql',
    vulnerability: {
      cve: 'CVE-2023-5868',
      description: 'PostgreSQL aggregate function memory disclosure',
      serviceVersion: 'PostgreSQL 13.10',
    },
  },
  // Additional FTP
  {
    port: 21,
    service: 'ftp',
    vulnerability: {
      cve: 'CVE-2019-12815',
      description: 'ProFTPD mod_copy arbitrary file copy (unauthenticated)',
      serviceVersion: 'ProFTPD 1.3.6',
    },
  },
  // Additional SMTP
  {
    port: 25,
    service: 'smtp',
    vulnerability: {
      cve: 'CVE-2021-3156',
      description: 'Postfix SMTP baron samedit heap overflow via MAIL FROM',
      serviceVersion: 'Postfix 3.4.8',
    },
  },
  // DNS
  {
    port: 53,
    service: 'dns',
    vulnerability: {
      cve: 'CVE-2021-25220',
      description: 'BIND 9.16 cache poisoning via forwarder response injection',
      serviceVersion: 'BIND 9.16.18',
    },
  },
  {
    port: 53,
    service: 'dns',
    vulnerability: {
      cve: 'CVE-2020-8617',
      description: 'BIND TSIG assertion failure causes remote DoS',
      serviceVersion: 'BIND 9.14.11',
    },
  },
];
