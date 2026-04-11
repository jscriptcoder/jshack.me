import { findVulnForService } from './vulnerabilities';

// Phase 3 PR B: per-service version pools used by `apt upgrade` to pick a
// target version. Each pool is ordered oldest → newest. When a player runs
// `apt upgrade http`, the game walks the http pool from newest backward
// until it finds a version whose CVE (if any) has `publishedAt > gameTime`
// — i.e., currently unpublished relative to the real-world clock.
//
// In PR B every existing CVE has `publishedAt = 0`, so versions that
// appear in both the pool and the CVE table are currently vulnerable, and
// versions that appear only in the pool (no CVE entry) are currently safe.
// Follow-up content PRs add future-dated CVEs for the "safe" pool entries
// so the treadmill actually cycles over game time.
//
// The pools are hand-authored with realistic version strings. Players who
// recognize real software should see plausible progressions.

// Tuning knobs for future content PRs that generate timelines procedurally.
// PR B uses hand-authored pools; these constants are here for forward
// compatibility and can be tweaked later without code changes.
export const CVE_TIMING_CONFIG = {
  // Shortest gap (in game days) between one CVE publishing and the next
  // for the same service.
  minSafeWindowDays: 3,
  // Longest gap.
  maxSafeWindowDays: 21,
  // Number of versions in each pool that start with publishedAt = 0 (i.e.,
  // vulnerable from day 1). Used when content PRs procedurally assign
  // publishedAt values.
  initialVulnerableCount: 2,
} as const;

// Per-service version pools, ordered oldest → newest. Each entry is a
// realistic version string. Existing CVE-matched versions appear in the
// pool alongside newer versions that (currently) have no CVE association.
//
// Services without a pool entry fall through to a 'latest' sentinel in
// `getLatestSafeVersion`, matching PR A's default.
export const serviceVersionPools: Readonly<Record<string, readonly string[]>> = {
  http: [
    'Apache/2.4.25',
    'Apache/2.4.38',
    'Apache/2.4.49',
    'Apache/2.4.52',
    'Apache/2.4.55',
    'Apache/2.4.58',
    'Apache/2.4.60',
    'nginx/1.20.0',
    'nginx/1.22.0',
    'nginx/1.24.0',
    'nginx/1.26.0',
  ],
  'http-alt': [
    'Struts/2.3.31',
    'Struts/2.5.30',
    'Tomcat/9.0.40',
    'Tomcat/9.0.70',
    'Tomcat/10.1.13',
  ],
  https: ['PulseSecure/9.0R1', 'PulseSecure/9.1R10', 'nginx/1.24.0', 'nginx/1.26.0'],
  ftp: ['vsftpd 2.3.4', 'vsftpd 3.0.5', 'ProFTPD 1.3.5', 'ProFTPD 1.3.6', 'ProFTPD 1.3.8'],
  mysql: [
    'MySQL 5.5.23',
    'MySQL 5.5.52',
    'MySQL 5.7.40',
    'MariaDB 10.5.8',
    'MariaDB 10.6.15',
    'MariaDB 10.11.5',
    'MySQL 8.0.35',
  ],
  postgresql: ['PostgreSQL 9.3', 'PostgreSQL 11.20', 'PostgreSQL 13.10', 'PostgreSQL 16.1'],
  redis: ['Redis 2.8.19', 'Redis 5.0.7', 'Redis 6.2.13', 'Redis 7.2.4'],
  mongodb: ['MongoDB 3.6.12', 'MongoDB 4.0.5', 'MongoDB 5.0.20', 'MongoDB 7.0.2'],
  smtp: ['Exim 4.69', 'Exim 4.87', 'Postfix 3.4.8', 'Postfix 3.7.8'],
  imap: ['Dovecot 2.3.7', 'Dovecot 2.3.20'],
  pop3: ['Dovecot 2.2.33', 'Courier 0.75.0', 'Dovecot 2.3.20'],
  mqtt: ['Mosquitto 1.4.12', 'Mosquitto 2.0.14', 'Mosquitto 2.0.18'],
  smb: ['Samba 4.5.9', 'Samba 4.15.13', 'Samba 4.19.2'],
  rsync: ['rsync 3.2.3', 'rsync 3.2.7', 'rsync 3.3.0'],
  vnc: ['TightVNC 1.3.10', 'RealVNC 4.1.1', 'RealVNC 6.11'],
  modbus: ['ModbusTCP 1.0', 'Modicon M340', 'Modicon M580'],
  openvpn: ['OpenVPN 2.4.3', 'OpenVPN 2.5.1', 'OpenVPN 2.6.8'],
  dns: ['BIND 9.14.11', 'BIND 9.16.18', 'BIND 9.18.21'],
  elasticsearch: ['Elasticsearch 1.4.2', 'Elasticsearch 7.17', 'Elasticsearch 8.11'],
};

// Fallback sentinel for services that don't have a pool entry. Guaranteed
// not to match any CVE in the table.
export const DEFAULT_LATEST_VERSION = 'latest';

// Walks the service's version pool newest → oldest and returns the first
// entry whose CVE (looked up via findVulnForService) is either absent or
// not yet published at the current gameTime.
//
// Returns `undefined` if every version in the pool is currently vulnerable
// (shouldn't happen in practice — the pool should always have at least one
// safe entry at any game time) OR if the service has no pool.
export const getLatestSafeVersion = (service: string, gameTime: number): string | undefined => {
  const pool = serviceVersionPools[service];
  if (!pool || pool.length === 0) return DEFAULT_LATEST_VERSION;

  for (let i = pool.length - 1; i >= 0; i--) {
    const version = pool[i];
    if (version === undefined) continue;
    if (findVulnForService(service, version, gameTime) === undefined) {
      return version;
    }
  }
  return undefined;
};
