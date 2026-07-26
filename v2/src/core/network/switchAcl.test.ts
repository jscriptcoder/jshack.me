import { describe, expect, it } from 'vitest';
import { parseAclDenies, readAclConf } from './switchAcl';
import { buildApGatewayBaseFs, buildSwitchBaseFs } from '../generation/routerFs';
import { buildDirectory } from '../../test/factories/filesystem';

/**
 * `/etc/switch/acl.conf` is a switch's port access-control list — the switch's
 * answer to a router's `rules.v4`. The policy is DEFAULT-ALLOW: every line names a
 * port to BLOCK (`deny <port>`). The scan path behind the switch reads this file to
 * subtract the denied ports; deleting a `deny` line re-opens that port. Parsing is
 * LENIENT (comments, blanks, and malformed lines are skipped, out-of-range ports
 * rejected) so a fat-fingered edit degrades gracefully rather than failing the file.
 */

const SEED_A = '1'.repeat(64);

describe('parseAclDenies', () => {
  it('parses each `deny <port>` line to its port number', () => {
    expect(parseAclDenies('deny 8080\ndeny 443')).toEqual([8080, 443]);
  });

  it('returns no denies for the empty / all-comment file (default-allow)', () => {
    expect(parseAclDenies('')).toEqual([]);
    expect(parseAclDenies('# default policy: ALLOW\n# deny <port>')).toEqual([]);
  });

  it('skips comments and blank lines, keeping the real denies', () => {
    const content = ['# header', '', 'deny 8080', '   ', '# deny 22 (example)', 'deny 3306'].join(
      '\n',
    );
    expect(parseAclDenies(content)).toEqual([8080, 3306]);
  });

  it('skips malformed lines (no port, non-numeric, wrong keyword, trailing junk, no space, leading junk)', () => {
    const content = [
      'deny', // no port
      'deny abc', // non-numeric
      'allow 80', // wrong keyword
      'deny 8080 extra', // trailing junk after the port
      'block 443', // wrong keyword
      'deny8080', // no space between the keyword and the port
      'xdeny 80', // junk before the keyword (the rule must anchor at line start)
    ].join('\n');
    expect(parseAclDenies(content)).toEqual([]);
  });

  it('trims surrounding whitespace before matching a deny line', () => {
    expect(parseAclDenies('  deny 22  ')).toEqual([22]);
  });

  it('accepts one or more spaces between the keyword and the port', () => {
    expect(parseAclDenies('deny  22')).toEqual([22]);
  });

  it('rejects out-of-range ports (0 and > 65535) but keeps the boundary ports 1 and 65535', () => {
    expect(parseAclDenies('deny 0\ndeny 70000\ndeny 1\ndeny 22\ndeny 65535')).toEqual([1, 22, 65535]);
  });
});

describe('readAclConf', () => {
  it('reads the seeded acl.conf content off a switch filesystem', () => {
    const content = readAclConf(buildSwitchBaseFs(SEED_A, 80));
    expect(content.startsWith('#')).toBe(true);
    expect(parseAclDenies(content)).toEqual([8080]);
  });

  it('returns empty for a filesystem with no /etc/switch (a router has rules.v4, not an ACL)', () => {
    expect(readAclConf(buildApGatewayBaseFs(SEED_A))).toBe('');
  });

  it('returns empty for a filesystem with no /etc at all', () => {
    expect(readAclConf(buildDirectory({}))).toBe('');
  });

  it('returns empty when /etc/switch/acl.conf is present but not a regular file', () => {
    const fs = buildDirectory({
      etc: buildDirectory({ switch: buildDirectory({ 'acl.conf': buildDirectory({}) }) }),
    });
    expect(readAclConf(fs)).toBe('');
  });

  it('returns empty when /etc/switch exists but holds no acl.conf at all', () => {
    const fs = buildDirectory({ etc: buildDirectory({ switch: buildDirectory({}) }) });
    expect(readAclConf(fs)).toBe('');
  });
});
