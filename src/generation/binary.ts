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

// Binary-looking file paths for exfiltrate target files.
export const binaryTargetPaths: Readonly<Record<MachineRole, readonly string[]>> = {
  fileserver: [
    '/opt/app/records.bin',
    '/var/lib/export.dat',
    '/srv/cache/backup.db',
    '/opt/lib/archive_index.dat',
    '/usr/local/share/storage.dat',
    '/srv/lib/filecache.bin',
  ],
  database: [
    '/opt/app/data.bin',
    '/var/lib/dbdump.dat',
    '/srv/cache/accounts.db',
    '/opt/lib/query_cache.db',
    '/usr/local/share/repl_state.dat',
    '/var/lib/mysql/ibdata_export.bin',
  ],
  webserver: [
    '/opt/app/webapp.bin',
    '/var/lib/sessions.dat',
    '/srv/cache/api_keys.db',
    '/opt/lib/http_cache.db',
    '/usr/local/share/cert_store.dat',
    '/srv/lib/proxy_state.bin',
  ],
  workstation: [
    '/opt/app/report.bin',
    '/var/lib/project.dat',
    '/srv/cache/notes.db',
    '/opt/lib/audit_trail.dat',
    '/usr/local/share/workspace.dat',
    '/var/lib/user_prefs.bin',
  ],
  mailserver: [
    '/opt/app/mailstore.bin',
    '/var/lib/mailindex.dat',
    '/srv/cache/mbox.db',
    '/opt/lib/spam_filter.db',
    '/usr/local/share/dkim_cache.dat',
    '/var/lib/postfix/queue_state.bin',
  ],
  iot: [
    '/opt/app/firmware.bin',
    '/var/lib/sensor.dat',
    '/srv/cache/telemetry.db',
    '/opt/lib/mqtt_state.db',
    '/usr/local/share/device_reg.dat',
    '/var/lib/zigbee/mesh_state.bin',
  ],
  router: [
    '/opt/app/config.bin',
    '/var/lib/routes.dat',
    '/srv/cache/firewall.db',
    '/opt/lib/nat_table.db',
    '/usr/local/share/bgp_state.dat',
    '/var/lib/ipsec/sa_cache.bin',
  ],
  switch: [
    '/opt/app/vlans.bin',
    '/var/lib/acl_table.dat',
    '/srv/cache/switch.db',
    '/opt/lib/mac_table.db',
    '/usr/local/share/stp_state.dat',
    '/var/lib/lacp/port_state.bin',
  ],
};

// Binary-looking file paths for encryption key files.
export const binaryKeyPaths: Readonly<Record<MachineRole, readonly string[]>> = {
  webserver: [
    '/usr/local/lib/ssl_keystore.db',
    '/opt/lib/libcrypto_keys.so',
    '/var/lib/nginx/tls_cache.db',
    '/opt/lib/libsession_keys.so',
  ],
  database: [
    '/usr/local/lib/db_keyring.db',
    '/opt/lib/libencrypt.so',
    '/var/lib/mysql/keyring.db',
    '/opt/lib/libtde_keys.so',
  ],
  fileserver: [
    '/usr/local/lib/backup_keystore.db',
    '/opt/lib/libcrypt_store.so',
    '/var/lib/luks/volume_keys.db',
    '/opt/lib/libarchive_enc.so',
  ],
  workstation: [
    '/usr/local/lib/user_keyring.db',
    '/opt/lib/libvault.so',
    '/var/lib/gnupg/secring.db',
    '/opt/lib/libkeychain.so',
  ],
  mailserver: [
    '/usr/local/lib/mail_keyring.db',
    '/opt/lib/libsmtp_keys.so',
    '/var/lib/dovecot/tls_keys.db',
    '/opt/lib/libdkim_sign.so',
  ],
  iot: [
    '/usr/local/lib/device_keystore.db',
    '/opt/lib/libmqtt_keys.so',
    '/var/lib/firmware/sign_keys.db',
    '/opt/lib/libota_verify.so',
  ],
  router: [
    '/usr/local/lib/vpn_keystore.db',
    '/opt/lib/libipsec_keys.so',
    '/var/lib/openvpn/pki_cache.db',
    '/opt/lib/libwg_keys.so',
  ],
  switch: [
    '/usr/local/lib/switch_keystore.db',
    '/opt/lib/libacl_keys.so',
    '/var/lib/dot1x/radius_keys.db',
    '/opt/lib/libmacsec.so',
  ],
};
