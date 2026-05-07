// Externally-observable allowlist for listPatchesForMachines callers
// who have NO active session on the target machine. Default-deny: any
// path not matching one of these patterns drops out of the response.
//
// The patterns describe files whose content is observable from outside
// the box via simulated network protocols (port banners, HTTP, nmap -sV,
// firewall probing). Leaking them through the patch stream mirrors what
// an off-box observer can already gather, so excluding them would make
// the simulation inconsistent for non-session callers.
//
// Files NOT on this list (e.g., /etc/passwd, /root/*, /home/<user>/*,
// wallet keys, shell history, /var/log/*) drop through default-deny —
// the no-session caller can't read them. /etc/passwd is specifically
// excluded because passwords live inline in /etc/passwd in this game;
// letting no-session callers fetch the hash list would enable offline
// cracking without ever establishing presence on the box, breaking the
// "must crack root first" gameplay loop on the wallet defense.
//
// TRIPWIRE: /var/lib/dpkg/status leaks the full installed package list,
// not just running services. Today's CVE model is port-bound, so this is
// safe (knowing what's installed doesn't enable any new attack). If
// off-port CVEs are ever added (kernel-level, libc-level), narrow this
// entry to running-service entries only.
export const READ_ALLOWLIST: readonly string[] = [
  '/var/run/*.pid',
  '/etc/iptables/rules.v4',
  '/etc/snmp/snmpd.conf',
  '/etc/switch/acl.conf',
  '/var/www/**',
  '/var/lib/dpkg/status',
];

// Glob matcher lives in src/utils/pathGlob.ts (shared with the
// projected-content allowlist in machineFilesystems). See that file
// for `*` / `**` semantics.
import { matchesAnyGlobPattern } from '../utils/pathGlob';

export const matchesReadAllowlist = (
  path: string,
  allowlist: readonly string[] = READ_ALLOWLIST,
): boolean => matchesAnyGlobPattern(path, allowlist);
