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
];
