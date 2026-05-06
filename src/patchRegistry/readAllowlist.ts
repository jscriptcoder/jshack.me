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
// see plans/read-path-privacy-filter.md and project_read_path_privacy_gap
// memory.
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

// Translate an allowlist glob pattern into a fully-anchored regex.
//   `**`   → `.*`        (any characters, including slashes)
//   `*`    → `[^/]*`     (any characters within a single path segment)
//   other  → escaped literally so regex metacharacters in paths
//            (`.`, `+`, `?`, `(`, etc.) match themselves
//
// Order matters: `**` must be replaced before `*`, otherwise the single-
// segment branch would consume the first star of a recursive pattern and
// leave a stray `*` behind.
const REGEX_META = /[.+?^${}()|[\]\\]/g;
const escapeLiterals = (segment: string): string => segment.replace(REGEX_META, '\\$&');

const compilePattern = (pattern: string): RegExp => {
  const body = pattern
    .split('**')
    .map((between) => between.split('*').map(escapeLiterals).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${body}$`);
};

export const matchesReadAllowlist = (
  path: string,
  allowlist: readonly string[] = READ_ALLOWLIST,
): boolean => allowlist.some((pattern) => compilePattern(pattern).test(path));
