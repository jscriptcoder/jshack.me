// Allowlist of paths whose content gets dual-written into machine_filesystems.
//
// machine_filesystems exists to project owner + permissions for L2's
// permission walker. After 20260503210309_drop_machine_fs_unused_columns,
// it no longer carries content for the bulk of patched files (the patches
// table is the canonical content store, per-player). But a small set of
// paths need server-readable content for cross-player or server-authoritative
// concerns:
//
//   - /etc/passwd                       — server-side userType validation
//                                         in createSession (PR #122) and
//                                         cross-player password validation
//                                         for SSH/SCP/su.
//   - /etc/vsftpd/virtual_users.conf    — cross-player FTP login.
//   - /var/lib/mysql/data.json          — cross-player MySQL login.
//   - /etc/redis/redis.conf             — cross-player Redis login.
//   - /etc/snmp/snmpd.conf              — cross-player snmpset/snmpwalk
//                                         community-string validation.
//   - /var/run/*.pid                    — backdoor connect (nc) tier
//                                         resolution. Glob: covers
//                                         `nc-<port>.pid`, daemon pidfiles,
//                                         CVE-opened backdoor pidfiles.
//
// The dual-write SQL function (upsert_patch_with_fs) checks the
// project_fs_content flag on every call and stores content only when
// the path matches this allowlist. Adding a new entry is a single-line
// change here + a one-time backfill rerun for existing rows.

import { matchesAnyGlobPattern } from '../utils/pathGlob';

export const FS_PROJECTED_CONTENT_PATHS: readonly string[] = [
  '/etc/passwd',
  '/etc/vsftpd/virtual_users.conf',
  '/var/lib/mysql/data.json',
  '/etc/redis/redis.conf',
  '/etc/snmp/snmpd.conf',
  '/var/run/*.pid',
];

export const shouldProjectFsContent = (path: string): boolean =>
  matchesAnyGlobPattern(path, FS_PROJECTED_CONTENT_PATHS);
