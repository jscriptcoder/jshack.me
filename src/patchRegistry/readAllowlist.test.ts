import { describe, it, expect } from 'vitest';
import { matchesReadAllowlist, READ_ALLOWLIST } from './readAllowlist';

// The allowlist gates what can be returned by listPatchesForMachines for
// callers without a session on the target machine. Default-deny: anything
// not on the allowlist is dropped. See plans/read-path-privacy-filter.md.
//
// Tests describe behaviour: pattern semantics (segment-bound vs recursive
// glob, exact match), and the externally-observable shape of the live
// allowlist (the patterns that ship are themselves part of the contract,
// since narrowing them is a security event).

describe('matchesReadAllowlist — pattern semantics', () => {
  it('matches single-segment wildcard against daemon PID files', () => {
    expect(matchesReadAllowlist('/var/run/sshd.pid', ['/var/run/*.pid'])).toBe(true);
    expect(matchesReadAllowlist('/var/run/redis-server.pid', ['/var/run/*.pid'])).toBe(true);
  });

  it('rejects single-segment wildcard crossing slash boundaries', () => {
    expect(matchesReadAllowlist('/var/run/sub/dir.pid', ['/var/run/*.pid'])).toBe(false);
    expect(matchesReadAllowlist('/var/run/.pid', ['/var/run/*.pid'])).toBe(true);
  });

  it('matches recursive ** at any depth under prefix', () => {
    expect(matchesReadAllowlist('/var/www/index.html', ['/var/www/**'])).toBe(true);
    expect(matchesReadAllowlist('/var/www/app/static/main.js', ['/var/www/**'])).toBe(true);
    expect(matchesReadAllowlist('/var/www/a/b/c/d/e/f.txt', ['/var/www/**'])).toBe(true);
  });

  it('rejects recursive ** escaping the prefix boundary', () => {
    expect(matchesReadAllowlist('/var/wwwOTHER/foo', ['/var/www/**'])).toBe(false);
    expect(matchesReadAllowlist('/var/wwwx', ['/var/www/**'])).toBe(false);
  });

  it('matches exact paths only on full equality', () => {
    expect(matchesReadAllowlist('/etc/iptables/rules.v4', ['/etc/iptables/rules.v4'])).toBe(true);
    expect(matchesReadAllowlist('/etc/iptables/rules.v4.bak', ['/etc/iptables/rules.v4'])).toBe(
      false,
    );
    expect(matchesReadAllowlist('/etc/iptables/rules.v4/foo', ['/etc/iptables/rules.v4'])).toBe(
      false,
    );
    expect(matchesReadAllowlist('/etc/iptables/rules', ['/etc/iptables/rules.v4'])).toBe(false);
  });

  it('rejects paths containing an allowlist entry as a suffix (start-anchor enforcement)', () => {
    // Without ^ anchoring, an attacker could craft a path that ends with
    // an allowlist entry to slip past the filter (e.g., `/leak/etc/iptables/
    // rules.v4` would match `/etc/iptables/rules.v4`). Anchor must be
    // enforced at the START of the path.
    expect(matchesReadAllowlist('/leak/etc/iptables/rules.v4', ['/etc/iptables/rules.v4'])).toBe(
      false,
    );
    expect(matchesReadAllowlist('/leak/var/run/sshd.pid', ['/var/run/*.pid'])).toBe(false);
    expect(matchesReadAllowlist('/leak/var/www/index.html', ['/var/www/**'])).toBe(false);
  });

  it('passes when ANY allowlist pattern matches', () => {
    const allowlist = ['/etc/iptables/rules.v4', '/var/www/**', '/var/run/*.pid'];
    expect(matchesReadAllowlist('/etc/iptables/rules.v4', allowlist)).toBe(true);
    expect(matchesReadAllowlist('/var/www/about.html', allowlist)).toBe(true);
    expect(matchesReadAllowlist('/var/run/nginx.pid', allowlist)).toBe(true);
    expect(matchesReadAllowlist('/etc/passwd', allowlist)).toBe(false);
  });

  it('treats glob characters in patterns as literals when escaped via exact match', () => {
    // Patterns without * stay literal — no inadvertent regex metacharacters
    // bleeding through. Tests with patterns containing regex specials that
    // are common in path syntax.
    expect(matchesReadAllowlist('/etc/snmp/snmpd.conf', ['/etc/snmp/snmpd.conf'])).toBe(true);
    expect(matchesReadAllowlist('/etc/snmpXsnmpd.conf', ['/etc/snmp/snmpd.conf'])).toBe(false);
  });

  it('escapes regex metacharacters in patterns (literal dot is not "any char")', () => {
    // Without escaping, `.` in a pattern would match any single character,
    // so `/var/run/*.pid` would match `/var/run/sshdXpid`. The matcher
    // must escape literals so the dot only matches a literal dot.
    expect(matchesReadAllowlist('/var/run/sshdXpid', ['/var/run/*.pid'])).toBe(false);
    expect(matchesReadAllowlist('/etc/iptables/rulesXv4', ['/etc/iptables/rules.v4'])).toBe(false);
    expect(matchesReadAllowlist('/var/lib/dpkg/statusX', ['/var/lib/dpkg/status'])).toBe(false);
  });

  it('escapes other regex metacharacters in patterns', () => {
    // Patterns might one day contain literal `+`, `?`, `(`, `)`, `[`, `]`,
    // `{`, `}`, `|`, `^`, `$`, `\`. None of these should be interpreted
    // as regex syntax. (Today's allowlist doesn't use them, but the
    // contract is "patterns are globs, not regexes".)
    expect(matchesReadAllowlist('/data', ['/data+'])).toBe(false);
    expect(matchesReadAllowlist('/dataa', ['/data+'])).toBe(false);
    expect(matchesReadAllowlist('/data+', ['/data+'])).toBe(true);
    expect(matchesReadAllowlist('/file?', ['/file?'])).toBe(true);
    expect(matchesReadAllowlist('/file', ['/file?'])).toBe(false);
  });
});

describe('matchesReadAllowlist — default-deny semantics', () => {
  it('drops paths not matching any pattern (the default branch is deny)', () => {
    const allowlist = ['/var/run/*.pid', '/var/www/**'];
    expect(matchesReadAllowlist('/etc/passwd', allowlist)).toBe(false);
    expect(matchesReadAllowlist('/root/.notes', allowlist)).toBe(false);
    expect(matchesReadAllowlist('/home/alice/.bashrc', allowlist)).toBe(false);
    expect(matchesReadAllowlist('/var/log/syslog', allowlist)).toBe(false);
    expect(matchesReadAllowlist('', allowlist)).toBe(false);
  });

  it('returns false when the allowlist is empty (no permits)', () => {
    expect(matchesReadAllowlist('/var/run/sshd.pid', [])).toBe(false);
    expect(matchesReadAllowlist('/var/www/index.html', [])).toBe(false);
  });
});

describe('READ_ALLOWLIST — shipped contract', () => {
  // These tests pin which paths are no-session readable. Adding/removing
  // an entry must update the test, making the change visible in code review
  // — narrowing the allowlist is a security event and shouldn't slip in.

  it('permits daemon liveness via /var/run/*.pid', () => {
    expect(matchesReadAllowlist('/var/run/sshd.pid')).toBe(true);
    expect(matchesReadAllowlist('/var/run/ftpd.pid')).toBe(true);
    expect(matchesReadAllowlist('/var/run/redis-server.pid')).toBe(true);
  });

  it('permits gateway NAT rules via /etc/iptables/rules.v4', () => {
    expect(matchesReadAllowlist('/etc/iptables/rules.v4')).toBe(true);
  });

  it('permits SNMP firewall+ACL config via /etc/snmp/snmpd.conf', () => {
    expect(matchesReadAllowlist('/etc/snmp/snmpd.conf')).toBe(true);
  });

  it('permits switch ACL deny rules via /etc/switch/acl.conf', () => {
    expect(matchesReadAllowlist('/etc/switch/acl.conf')).toBe(true);
  });

  it('permits HTTP-served content via /var/www/**', () => {
    expect(matchesReadAllowlist('/var/www/index.html')).toBe(true);
    expect(matchesReadAllowlist('/var/www/app/static/css/main.css')).toBe(true);
  });

  it('permits service versions via /var/lib/dpkg/status', () => {
    expect(matchesReadAllowlist('/var/lib/dpkg/status')).toBe(true);
  });

  it('drops password hashes — /etc/passwd is NOT on the allowlist', () => {
    // Inline-hash storage; remote-cracking without a session would break
    // the wallet-defense premise. See feedback_no_etc_shadow.md.
    expect(matchesReadAllowlist('/etc/passwd')).toBe(false);
  });

  it('drops user-private files — /root/* and /home/<user>/* are NOT on the allowlist', () => {
    expect(matchesReadAllowlist('/root/.notes')).toBe(false);
    expect(matchesReadAllowlist('/root/wallet-seed')).toBe(false);
    expect(matchesReadAllowlist('/home/alice/.bashrc')).toBe(false);
    expect(matchesReadAllowlist('/home/alice/.ssh/id_rsa')).toBe(false);
  });

  it('drops shell history and log files — NOT on the allowlist', () => {
    expect(matchesReadAllowlist('/home/alice/.bash_history')).toBe(false);
    expect(matchesReadAllowlist('/var/log/syslog')).toBe(false);
    expect(matchesReadAllowlist('/var/log/auth.log')).toBe(false);
  });

  it('exports READ_ALLOWLIST as a frozen, non-empty contract', () => {
    expect(READ_ALLOWLIST.length).toBeGreaterThan(0);
    expect(Array.isArray(READ_ALLOWLIST)).toBe(true);
  });
});
