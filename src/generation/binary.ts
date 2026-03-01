import type { Prng } from './prng';
import type { MachineRole } from './types';

// Non-printable character ranges for simulating binary file content.
// The strings command's isPrintable() treats ASCII 32-126 + tab + newline
// as printable, so these characters will be filtered out by strings.
const LATIN1_MIN = 128;
const LATIN1_MAX = 255;
const CONTROL_MIN = 1;
const CONTROL_MAX = 8;
const CONTROL2_MIN = 14;
const CONTROL2_MAX = 31;

// Generates a chunk of random non-printable bytes.
const generateNoiseChunk = (prng: Prng, minLen: number, maxLen: number): string => {
  const length = prng.nextInt(minLen, maxLen);
  return Array.from({ length }, () => {
    const roll = prng.next();
    if (roll < 0.5) return String.fromCharCode(prng.nextInt(LATIN1_MIN, LATIN1_MAX));
    if (roll < 0.8) return String.fromCharCode(prng.nextInt(CONTROL_MIN, CONTROL_MAX));
    if (roll < 0.95) return String.fromCharCode(prng.nextInt(CONTROL2_MIN, CONTROL2_MAX));
    return '\0';
  }).join('');
};

// Simulates an ELF binary header with non-printable noise.
const generateBinaryHeader = (prng: Prng): string => {
  const elfMagic = '\x7fELF';
  const noise = generateNoiseChunk(prng, 20, 40);
  return elfMagic + noise;
};

// Wraps readable content in binary noise so that `cat` shows garbled output
// but `strings` (which extracts contiguous printable runs >= 4 chars) recovers
// the readable parts. Each line of content is padded with noise before and after.
export const wrapInBinaryNoise = (prng: Prng, content: string): string => {
  const header = generateBinaryHeader(prng);
  const lines = content.split('\n');

  const wrappedLines = lines.map((line) => {
    const before = generateNoiseChunk(prng, 3, 8);
    const after = generateNoiseChunk(prng, 3, 8);
    return before + line + after;
  });

  const footer = generateNoiseChunk(prng, 10, 25);
  return header + wrappedLines.join(generateNoiseChunk(prng, 2, 5)) + footer;
};

// Binary-looking file paths for credential breadcrumbs, keyed by machine role.
export const binaryCredentialPaths: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: ['/usr/local/bin/httpd_monitor', '/opt/lib/libmod_auth.so', '/var/cache/sessions.db'],
  database: ['/usr/local/bin/db_healthcheck', '/opt/lib/libmysqlclient.so', '/var/cache/query.db'],
  fileserver: ['/usr/local/bin/sync_agent', '/opt/lib/libstorage.so', '/var/cache/ftp_sessions.db'],
  workstation: [
    '/usr/local/bin/monitor_agent',
    '/opt/lib/libauth.so',
    '/var/cache/user_sessions.db',
  ],
  router: ['/usr/local/bin/fw_monitor', '/opt/lib/libnetfilter.so', '/var/cache/routing.db'],
};

// Binary-looking file paths for exfiltrate target files.
export const binaryTargetPaths: Readonly<Record<MachineRole, readonly string[]>> = {
  fileserver: ['/opt/app/records.bin', '/var/lib/export.dat', '/srv/cache/backup.db'],
  database: ['/opt/app/data.bin', '/var/lib/dbdump.dat', '/srv/cache/accounts.db'],
  webserver: ['/opt/app/webapp.bin', '/var/lib/sessions.dat', '/srv/cache/api_keys.db'],
  workstation: ['/opt/app/report.bin', '/var/lib/project.dat', '/srv/cache/notes.db'],
  router: ['/opt/app/config.bin', '/var/lib/routes.dat', '/srv/cache/firewall.db'],
};

// Binary-looking file paths for encryption key files.
export const binaryKeyPaths: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: ['/usr/local/lib/ssl_keystore.db', '/opt/lib/libcrypto_keys.so'],
  database: ['/usr/local/lib/db_keyring.db', '/opt/lib/libencrypt.so'],
  fileserver: ['/usr/local/lib/backup_keystore.db', '/opt/lib/libcrypt_store.so'],
  workstation: ['/usr/local/lib/user_keyring.db', '/opt/lib/libvault.so'],
  router: ['/usr/local/lib/vpn_keystore.db', '/opt/lib/libipsec_keys.so'],
};

// Hint templates for binary credential placements that mention `strings`.
export const binaryHintTemplates: readonly string[] = [
  "There's a suspicious binary at {{path}} on {{machine}} — try extracting strings from it",
  'A compiled binary on {{machine}} at {{path}} may contain embedded credentials — use strings',
  'Check {{path}} on {{machine}} with the strings command — looks like a data file with secrets',
];
