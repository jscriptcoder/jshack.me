import { describe, expect, it } from 'vitest';
import {
  parseAclDenies,
  readAclConf,
  withDeny,
  ACL_CONF_OWNER,
  ACL_CONF_PATH,
  ACL_CONF_PERMISSIONS,
} from './switchAcl';
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

// A switch and the AP gateway both seed off the network they stand on.
const ESSID = 'BREW-AND-CODE';

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

describe('where an acl.conf lives', () => {
  it('is the path a switch filters by, owned and writable by root alone', () => {
    // Asserted against the literals rather than against the constants themselves: the
    // boot seed and every server-side write share these, so a test comparing each to
    // itself would agree with any value at all.
    expect(ACL_CONF_PATH).toBe('/etc/switch/acl.conf');
    expect(ACL_CONF_OWNER).toBe('root');
    expect(ACL_CONF_PERMISSIONS).toEqual({ read: ['root'], write: ['root'], execute: [] });
  });
});

describe('readAclConf', () => {
  it('reads the seeded acl.conf content off a switch filesystem', () => {
    const content = readAclConf(buildSwitchBaseFs(ESSID, 80));
    expect(content.startsWith('#')).toBe(true);
    expect(parseAclDenies(content)).toEqual([8080]);
  });

  it('returns empty for a filesystem with no /etc/switch (a router has rules.v4, not an ACL)', () => {
    expect(readAclConf(buildApGatewayBaseFs(ESSID))).toBe('');
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

/**
 * Writing the file back — the switch's half of what `snmpset` does, and the mirror of
 * `withForward` on the router side.
 *
 * The value names the STATE the port should be in: denied, or open. There is nothing
 * to overwrite here the way a forward's destination can be overwritten — a deny is a
 * deny — so a port already in the state asked for is left exactly as it was, in both
 * directions.
 *
 * The seeded file is the reason the trailing-newline case is not a curiosity: this one
 * ships WITHOUT a final newline while `rules.v4` ships with one, so a writer that
 * trusted whichever it met first would produce `deny 8080deny 22` on a real switch.
 */
describe('withDeny', () => {
  /** The file a generated switch actually ships with — one active deny under a header,
   *  and no trailing newline. */
  const seededAcl = (): string => readAclConf(buildSwitchBaseFs(ESSID, 80));

  const linesOf = (content: string): readonly string[] => content.replace(/\n$/, '').split('\n');

  const commentsIn = (content: string): readonly string[] =>
    linesOf(content).filter((line) => line.trim().startsWith('#'));

  it('adds a deny to the shipped file without gluing it onto the last rule', () => {
    const seeded = seededAcl();
    const written = withDeny(seeded, 22, true);

    expect(commentsIn(written)).toEqual(commentsIn(seeded));
    expect(linesOf(written).slice(-2)).toEqual(['deny 8080', 'deny 22']);
    expect(parseAclDenies(written)).toEqual([8080, 22]);
  });

  it("re-opens a port by removing its deny line, which is what deleting it by hand does", () => {
    const written = withDeny(seededAcl(), 8080, false);

    expect(commentsIn(written)).toEqual(commentsIn(seededAcl()));
    expect(parseAclDenies(written)).toEqual([]);
  });

  it('leaves the file byte-identical when the port is already in the state asked for', () => {
    // A deny has no destination to overwrite, so both directions of a no-op are the
    // same answer: the file the owner formatted, unchanged.
    const seeded = seededAcl();
    expect(withDeny(seeded, 8080, true)).toBe(seeded);
    expect(withDeny(seeded, 22, false)).toBe(seeded);
  });

  it("keeps the owner's own comments, including a commented-out deny on the same port", () => {
    // A writer matching the port anywhere in the line would delete the note and leave
    // the live rule standing — backwards, and invisible until the port stayed shut.
    const content = ['# my list', '# deny 22  (parked)', 'deny 22', 'deny 443'].join('\n');

    expect(linesOf(withDeny(content, 22, false))).toEqual([
      '# my list',
      '# deny 22  (parked)',
      'deny 443',
    ]);
  });

  it('ends what it writes with a newline, the way every file an owner may append to does', () => {
    expect(withDeny('# my list', 22, true)).toBe('# my list\ndeny 22\n');
  });

  it('appends after the last rule on a file that already ends in a newline', () => {
    // The shipped file has no trailing newline and `rules.v4` has one, and an owner's
    // `nano` edit can leave either file either way. Appending after the empty string a
    // trailing newline leaves behind would put a blank line between the rules.
    expect(withDeny('# my list\ndeny 443\n', 22, true)).toBe('# my list\ndeny 443\ndeny 22\n');
  });

  it('finds a deny the owner indented, rather than leaving it in place', () => {
    // The parser trims before matching and so must the writer's search. Left untrimmed,
    // an indented deny is invisible to it: the port stays shut while the device reports
    // it open.
    expect(parseAclDenies(withDeny('# my list\n   deny 22', 22, false))).toEqual([]);
  });
});
