import type {
  AttackPattern,
  Severity,
  Vulnerability,
  VulnerabilityEffect,
} from '../../network/types';
import { describeEffect } from '../describeEffect';
import { pickPatternForEffect } from '../attackPatterns';
import { createPrng } from '../prng';

export type VulnerabilityTemplate = {
  readonly port: number;
  readonly service: string;
  readonly vulnerability: Vulnerability;
};

// Default "safe" service version used when constructing ports that shouldn't
// be exploitable. The string is deliberately chosen to never match any entry
// in vulnerabilityTemplates — i.e., findVulnForService(anyService, 'latest')
// always returns undefined. Phase 3+ can replace this with per-service
// realistic version strings (OpenSSH 9.6, Apache/2.4.59, etc.) without
// changing any consumer — they only care about lookup results.
export const DEFAULT_SERVICE_VERSION = 'latest';

export const defaultServiceVersion = (_service: string): string => DEFAULT_SERVICE_VERSION;

// Hand-authored CVEs that are live at universe-day-0. Fake CVE IDs (CVE-2024-9NNN
// namespace — chosen to stay clear of both real-world CVEs and the walker's
// year-≥2026 serial space). Descriptions and attack patterns are auto-derived
// from the effect kind via describeEffect and pickPatternForEffect so the
// fields are guaranteed coherent — what the description claims is what the
// log will show and what msfconsole will do.
type TemplateSpec = {
  readonly port: number;
  readonly service: string;
  readonly version: string;
  readonly cveSerial: string;
  readonly severity: Severity;
  readonly effect: VulnerabilityEffect;
  readonly attackPattern?: AttackPattern;
};

const mkTemplate = (spec: TemplateSpec): VulnerabilityTemplate => {
  const cve = `CVE-${spec.cveSerial}`;
  const prng = createPrng(`handauth:${cve}`);
  return {
    port: spec.port,
    service: spec.service,
    vulnerability: {
      cve,
      description: describeEffect(spec.service, spec.version, cve, spec.effect),
      serviceVersion: spec.version,
      severity: spec.severity,
      publishedAt: 0,
      effect: spec.effect,
      attackPattern: spec.attackPattern ?? pickPatternForEffect(spec.service, spec.effect, prng),
    },
  };
};

// Curated classic attack patterns preserved for iconic exploits. The vsftpd
// 2.3.4 backdoor's smiley-face username is its signature; losing it would
// cost more flavor than uniform generation gains.
const VSFTPD_BACKDOOR_PATTERN: AttackPattern = {
  logFile: '/var/log/vsftpd.log',
  command: 'USER user:)',
};

export const vulnerabilityTemplates: readonly VulnerabilityTemplate[] = [
  // --- HTTP / web ---
  mkTemplate({
    port: 80,
    service: 'http',
    version: 'Apache/2.4.49',
    cveSerial: '2024-9001',
    severity: 'critical',
    effect: { kind: 'shell_limited', tier: 'user' },
  }),
  mkTemplate({
    port: 80,
    service: 'http',
    version: 'Apache/2.4.25',
    cveSerial: '2024-9002',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 80,
    service: 'http',
    version: 'Apache/2.4.38',
    cveSerial: '2024-9003',
    severity: 'high',
    effect: { kind: 'script_exec', tier: 'user' },
  }),
  mkTemplate({
    port: 80,
    service: 'http',
    version: 'nginx/1.20.0',
    cveSerial: '2024-9004',
    severity: 'high',
    effect: { kind: 'file_write', tier: 'user' },
  }),
  mkTemplate({
    port: 8080,
    service: 'http-alt',
    version: 'Struts/2.3.31',
    cveSerial: '2024-9005',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'root' },
  }),
  mkTemplate({
    port: 8080,
    service: 'http-alt',
    version: 'Tomcat/9.0.40',
    cveSerial: '2024-9006',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 9200,
    service: 'elasticsearch',
    version: 'Elasticsearch 1.4.2',
    cveSerial: '2024-9007',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'user' },
  }),
  mkTemplate({
    port: 8443,
    service: 'https',
    version: 'PulseSecure/9.0R1',
    cveSerial: '2024-9008',
    severity: 'high',
    effect: { kind: 'file_read', tier: 'user' },
  }),

  // --- FTP ---
  mkTemplate({
    port: 21,
    service: 'ftp',
    version: 'vsftpd 2.3.4',
    cveSerial: '2024-9009',
    severity: 'critical',
    effect: { kind: 'shell_limited', tier: 'root' },
    attackPattern: VSFTPD_BACKDOOR_PATTERN,
  }),
  mkTemplate({
    port: 21,
    service: 'ftp',
    version: 'ProFTPD 1.3.5',
    cveSerial: '2024-9010',
    severity: 'critical',
    effect: { kind: 'file_write', tier: 'user' },
  }),
  mkTemplate({
    port: 21,
    service: 'ftp',
    version: 'ProFTPD 1.3.6',
    cveSerial: '2024-9011',
    severity: 'high',
    effect: { kind: 'dir_list', tier: 'user' },
  }),

  // --- MySQL / MariaDB ---
  mkTemplate({
    port: 3306,
    service: 'mysql',
    version: 'MySQL 5.5.23',
    cveSerial: '2024-9012',
    severity: 'high',
    effect: { kind: 'password_reset', tier: 'user' },
  }),
  mkTemplate({
    port: 3306,
    service: 'mysql',
    version: 'MySQL 5.5.52',
    cveSerial: '2024-9013',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'root' },
  }),
  mkTemplate({
    port: 3306,
    service: 'mysql',
    version: 'MariaDB 10.5.8',
    cveSerial: '2024-9014',
    severity: 'critical',
    effect: { kind: 'file_read', tier: 'user' },
  }),

  // --- Redis ---
  mkTemplate({
    port: 6379,
    service: 'redis',
    version: 'Redis 5.0.7',
    cveSerial: '2024-9015',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'user' },
  }),
  mkTemplate({
    port: 6379,
    service: 'redis',
    version: 'Redis 2.8.19',
    cveSerial: '2024-9016',
    severity: 'critical',
    effect: { kind: 'file_write', tier: 'root' },
  }),

  // --- Mail ---
  mkTemplate({
    port: 25,
    service: 'smtp',
    version: 'Exim 4.87',
    cveSerial: '2024-9017',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 25,
    service: 'smtp',
    version: 'Exim 4.69',
    cveSerial: '2024-9018',
    severity: 'critical',
    effect: { kind: 'backdoor_port_open', tier: 'root', port: 31337 },
  }),
  mkTemplate({
    port: 25,
    service: 'smtp',
    version: 'Postfix 3.4.8',
    cveSerial: '2024-9019',
    severity: 'high',
    effect: { kind: 'file_read', tier: 'user' },
  }),
  mkTemplate({
    port: 143,
    service: 'imap',
    version: 'Dovecot 2.3.7',
    cveSerial: '2024-9020',
    severity: 'high',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 110,
    service: 'pop3',
    version: 'Dovecot 2.2.33',
    cveSerial: '2024-9021',
    severity: 'medium',
    effect: { kind: 'backdoor_port_open', tier: 'user', port: 4444 },
  }),
  mkTemplate({
    port: 110,
    service: 'pop3',
    version: 'Courier 0.75.0',
    cveSerial: '2024-9022',
    severity: 'high',
    effect: { kind: 'shell_full', tier: 'root' },
  }),

  // --- MQTT ---
  mkTemplate({
    port: 1883,
    service: 'mqtt',
    version: 'Mosquitto 2.0.14',
    cveSerial: '2024-9023',
    severity: 'high',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 1883,
    service: 'mqtt',
    version: 'Mosquitto 1.4.12',
    cveSerial: '2024-9024',
    severity: 'medium',
    effect: { kind: 'backdoor_port_open', tier: 'user', port: 1337 },
  }),

  // --- SMB ---
  mkTemplate({
    port: 445,
    service: 'smb',
    version: 'Samba 4.5.9',
    cveSerial: '2024-9025',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'root' },
  }),

  // --- PostgreSQL ---
  mkTemplate({
    port: 5432,
    service: 'postgresql',
    version: 'PostgreSQL 9.3',
    cveSerial: '2024-9026',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'user' },
  }),
  mkTemplate({
    port: 5432,
    service: 'postgresql',
    version: 'PostgreSQL 13.10',
    cveSerial: '2024-9027',
    severity: 'low',
    effect: { kind: 'password_reset', tier: 'user' },
  }),

  // --- MongoDB ---
  mkTemplate({
    port: 27017,
    service: 'mongodb',
    version: 'MongoDB 3.6.12',
    cveSerial: '2024-9028',
    severity: 'high',
    effect: { kind: 'password_reset', tier: 'user' },
  }),
  mkTemplate({
    port: 27017,
    service: 'mongodb',
    version: 'MongoDB 4.0.5',
    cveSerial: '2024-9029',
    severity: 'critical',
    effect: { kind: 'script_exec', tier: 'root' },
  }),

  // --- rsync ---
  mkTemplate({
    port: 873,
    service: 'rsync',
    version: 'rsync 3.2.3',
    cveSerial: '2024-9030',
    severity: 'high',
    effect: { kind: 'file_write', tier: 'user' },
  }),
  mkTemplate({
    port: 873,
    service: 'rsync',
    version: 'rsync 3.2.7',
    cveSerial: '2024-9031',
    severity: 'critical',
    effect: { kind: 'dir_list', tier: 'user' },
  }),

  // --- VNC ---
  mkTemplate({
    port: 5900,
    service: 'vnc',
    version: 'TightVNC 1.3.10',
    cveSerial: '2024-9032',
    severity: 'high',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 5900,
    service: 'vnc',
    version: 'RealVNC 4.1.1',
    cveSerial: '2024-9033',
    severity: 'critical',
    effect: { kind: 'backdoor_port_open', tier: 'root', port: 5901 },
  }),

  // --- Modbus ---
  mkTemplate({
    port: 502,
    service: 'modbus',
    version: 'ModbusTCP 1.0',
    cveSerial: '2024-9034',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 502,
    service: 'modbus',
    version: 'Modicon M340',
    cveSerial: '2024-9035',
    severity: 'critical',
    effect: { kind: 'shell_full', tier: 'root' },
  }),

  // --- OpenVPN ---
  mkTemplate({
    port: 1194,
    service: 'openvpn',
    version: 'OpenVPN 2.4.3',
    cveSerial: '2024-9036',
    severity: 'high',
    effect: { kind: 'shell_full', tier: 'root' },
  }),
  mkTemplate({
    port: 1194,
    service: 'openvpn',
    version: 'OpenVPN 2.5.1',
    cveSerial: '2024-9037',
    severity: 'high',
    effect: { kind: 'backdoor_port_open', tier: 'user', port: 12345 },
  }),

  // --- DNS ---
  mkTemplate({
    port: 53,
    service: 'dns',
    version: 'BIND 9.16.18',
    cveSerial: '2024-9038',
    severity: 'medium',
    effect: { kind: 'shell_full', tier: 'user' },
  }),
  mkTemplate({
    port: 53,
    service: 'dns',
    version: 'BIND 9.14.11',
    cveSerial: '2024-9039',
    severity: 'medium',
    effect: { kind: 'backdoor_port_open', tier: 'user', port: 8080 },
  }),
];
