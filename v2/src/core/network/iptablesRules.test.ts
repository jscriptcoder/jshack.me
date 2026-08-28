import { describe, expect, it } from 'vitest';
import {
  parseForwardRules,
  readRulesV4,
  withForward,
  RULES_V4_OWNER,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
} from './iptablesRules';
import { buildApGatewayBaseFs } from '../generation/routerFs';
import { buildDirectory } from '../../test/factories/filesystem';

/**
 * Story 5.1: `/etc/iptables/rules.v4` is the SINGLE parsed source of truth for
 * the router's NAT forwards. Grammar (ported from legacy `iptablesParser.ts`,
 * deliberately simplified — NOT real iptables-save):
 *   `forward <public_port> to <internal_ip>:<internal_port>`
 * Lenient: comments (`#`), blank lines, and malformed lines are skipped; ports
 * out of the 1–65535 range are rejected.
 */
describe('parseForwardRules', () => {
  it('parses a single forward line into its three fields', () => {
    expect(parseForwardRules('forward 2222 to 10.0.0.5:22')).toEqual([
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ]);
  });

  it('parses multiple forward lines in order', () => {
    const content = 'forward 2222 to 10.0.0.5:22\nforward 8080 to 10.0.0.6:80';
    expect(parseForwardRules(content)).toEqual([
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
      { publicPort: 8080, internalIp: '10.0.0.6', internalPort: 80 },
    ]);
  });

  it('skips comment lines and blank lines', () => {
    const content = '# NAT rules\n\nforward 2222 to 10.0.0.5:22\n   \n# trailing comment';
    expect(parseForwardRules(content)).toEqual([
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ]);
  });

  it('tolerates surrounding and repeated internal whitespace', () => {
    expect(parseForwardRules('  forward   2222   to   10.0.0.5:22  ')).toEqual([
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
    ]);
  });

  it('skips malformed lines but keeps the valid ones', () => {
    const content = [
      'forward 2222 to 10.0.0.5:22', // valid
      'forward 9999 10.0.0.7:80', // missing `to`
      'allow 80 to 10.0.0.8:80', // wrong keyword
      'forward abc to 10.0.0.9:22', // non-numeric public port
      'forward 7000 to 10.0.0.10', // missing :port
      'forward 8080 to 10.0.0.6:80', // valid
    ].join('\n');
    expect(parseForwardRules(content)).toEqual([
      { publicPort: 2222, internalIp: '10.0.0.5', internalPort: 22 },
      { publicPort: 8080, internalIp: '10.0.0.6', internalPort: 80 },
    ]);
  });

  it('accepts the port boundaries 1 and 65535', () => {
    expect(parseForwardRules('forward 1 to 10.0.0.5:65535')).toEqual([
      { publicPort: 1, internalIp: '10.0.0.5', internalPort: 65535 },
    ]);
  });

  it('rejects an out-of-range public port (0 or 65536)', () => {
    expect(parseForwardRules('forward 0 to 10.0.0.5:22')).toEqual([]);
    expect(parseForwardRules('forward 65536 to 10.0.0.5:22')).toEqual([]);
  });

  it('rejects an out-of-range internal port (0 or 65536)', () => {
    expect(parseForwardRules('forward 2222 to 10.0.0.5:0')).toEqual([]);
    expect(parseForwardRules('forward 2222 to 10.0.0.5:65536')).toEqual([]);
  });

  it('anchors at line start — junk before `forward` is not a rule', () => {
    // A `forward …` clause must begin the line; an embedded match is rejected.
    expect(parseForwardRules('block forward 2222 to 10.0.0.5:22')).toEqual([]);
  });

  it('anchors at line end — trailing junk after the port is not a rule', () => {
    expect(parseForwardRules('forward 2222 to 10.0.0.5:22 trailing')).toEqual([]);
  });

  it('returns no rules for empty or comment-only content', () => {
    expect(parseForwardRules('')).toEqual([]);
    expect(parseForwardRules('# just a header\n# and a note')).toEqual([]);
  });
});

/**
 * Finding the file on a device. Every box is asked this, not only the ones that route:
 * the SNMP door reads a device's port table before it knows which kind of device it is
 * talking to, so a tree without the directory has to answer emptily rather than throw
 * at the first step.
 */
describe('where a rules.v4 lives', () => {
  it('is the path a router routes by, owned and writable by root alone', () => {
    // Asserted against the literals rather than against the constants themselves: the
    // boot seed and every server-side write share these, so a test comparing each to
    // itself would agree with any value at all.
    expect(RULES_V4_PATH).toBe('/etc/iptables/rules.v4');
    expect(RULES_V4_OWNER).toBe('root');
    expect(RULES_V4_PERMISSIONS).toEqual({ read: ['root'], write: ['root'], execute: [] });
  });
});

describe('readRulesV4', () => {
  it('reads the seeded rules.v4 off a gateway filesystem', () => {
    const content = readRulesV4(buildApGatewayBaseFs('BREW-AND-CODE'));

    expect(content.startsWith('#')).toBe(true);
    // Default-deny: the seed is a header and a commented example, and parses to nothing.
    expect(parseForwardRules(content)).toEqual([]);
  });

  it('returns empty for a filesystem with no /etc at all', () => {
    expect(readRulesV4(buildDirectory({}))).toBe('');
  });

  it('returns empty for a box whose /etc holds no iptables directory', () => {
    // What a switch looks like: it keeps an access list where a router keeps a NAT
    // table, so the absence says which device this is rather than that anything broke.
    expect(readRulesV4(buildDirectory({ etc: buildDirectory({}) }))).toBe('');
  });

  it('returns empty when /etc/iptables exists but holds no rules.v4', () => {
    expect(readRulesV4(buildDirectory({ etc: buildDirectory({ iptables: buildDirectory({}) }) }))).toBe(
      '',
    );
  });

  it('returns empty when rules.v4 is present but is not a regular file', () => {
    const fs = buildDirectory({
      etc: buildDirectory({ iptables: buildDirectory({ 'rules.v4': buildDirectory({}) }) }),
    });
    expect(readRulesV4(fs)).toBe('');
  });
});

/**
 * Writing the file back — what `snmpset` does to a router's NAT table, and what any
 * later door that edits this file will do too.
 *
 * The value names the STATE the public port should be in, never an operation: a
 * destination puts the port there, and `null` leaves it forwarding nowhere. So one
 * function covers add, overwrite and remove, and the caller never has to know which of
 * the three it is asking for.
 *
 * It is a TEXT edit, and that is the whole design. Re-rendering the file from
 * `parseForwardRules` would be shorter and would silently eat the seeded header, the
 * commented example, and whatever the owner wrote in `nano` last week — they would open
 * their own file afterwards and find a machine had rewritten it. One line changes;
 * every other byte is the one that was there.
 */
describe('withForward', () => {
  const ESSID = 'BREW-AND-CODE';

  /** The file a generated gateway actually ships with, rather than a header written
   *  next to the test: a writer proved only against its own fixture can drift from the
   *  file devices carry, and then both halves look right while no forward lands. */
  const seededRules = (): string => readRulesV4(buildApGatewayBaseFs(ESSID));

  /** The file's lines, without the empty string its trailing newline leaves behind. */
  const linesOf = (content: string): readonly string[] => content.replace(/\n$/, '').split('\n');

  const commentsIn = (content: string): readonly string[] =>
    linesOf(content).filter((line) => line.trim().startsWith('#'));

  it('adds a forward to a device whose table is empty, keeping every seeded line', () => {
    const seeded = seededRules();
    const written = withForward(seeded, 2222, {
      internalIp: '192.168.188.10',
      internalPort: 22,
    });

    expect(commentsIn(written)).toEqual(commentsIn(seeded));
    expect(linesOf(written)).toContain('forward 2222 to 192.168.188.10:22');
  });

  it('overwrites the forward already on that public port, in the place it sat', () => {
    // A forward table is keyed by public port, so one port holding two destinations is
    // not a state this file can represent. Rewriting the line where it stands is also
    // what the owner's own `nano` edit would do — a removal plus an append would
    // reorder a file nobody asked to reorder.
    const content = [
      '# NAT rules',
      'forward 2222 to 192.168.188.10:22',
      'forward 8080 to 192.168.188.11:80',
    ].join('\n');

    expect(
      linesOf(withForward(content, 2222, { internalIp: '192.168.188.12', internalPort: 3306 })),
    ).toEqual(['# NAT rules', 'forward 2222 to 192.168.188.12:3306', 'forward 8080 to 192.168.188.11:80']);
  });

  it('removes the forward on that port when the value names no destination', () => {
    const content = [
      '# NAT rules',
      'forward 2222 to 192.168.188.10:22',
      'forward 8080 to 192.168.188.11:80',
    ].join('\n');

    expect(linesOf(withForward(content, 2222, null))).toEqual([
      '# NAT rules',
      'forward 8080 to 192.168.188.11:80',
    ]);
  });

  it('leaves the file byte-identical when asked to remove a port it does not carry', () => {
    // A port that forwards nowhere, told to forward nowhere, is already in the state
    // that was asked for. Byte-identical rather than merely equivalent: a no-op that
    // normalized the file would rewrite an owner's formatting for nothing.
    const seeded = seededRules();
    expect(withForward(seeded, 9999, null)).toBe(seeded);

    const unterminated = '# NAT rules\nforward 8080 to 192.168.188.11:80';
    expect(withForward(unterminated, 9999, null)).toBe(unterminated);
  });

  it("keeps the owner's own comments, including a commented-out rule on the same port", () => {
    // The obvious way to park a rule without losing it. A writer matching the port
    // anywhere in the line would rewrite the note and leave the live rule alone —
    // exactly backwards, and invisible until the forward failed to route.
    const content = [
      '# my rules',
      '# forward 2222 to 192.168.188.99:22  (parked, testing)',
      'forward 2222 to 192.168.188.10:22',
    ].join('\n');

    expect(
      linesOf(withForward(content, 2222, { internalIp: '192.168.188.10', internalPort: 8022 })),
    ).toEqual([
      '# my rules',
      '# forward 2222 to 192.168.188.99:22  (parked, testing)',
      'forward 2222 to 192.168.188.10:8022',
    ]);
  });

  it('appends to a file left without a trailing newline without gluing two rules together', () => {
    // `/etc/switch/acl.conf` ships without one and `rules.v4` ships with one, and an
    // owner's `nano` edit can leave either file either way. A writer that trusted the
    // seed it happened to meet would produce `forward 8080 …forward 2222 …`.
    expect(
      linesOf(
        withForward('# NAT rules\nforward 8080 to 192.168.188.11:80', 2222, {
          internalIp: '192.168.188.10',
          internalPort: 22,
        }),
      ),
    ).toEqual([
      '# NAT rules',
      'forward 8080 to 192.168.188.11:80',
      'forward 2222 to 192.168.188.10:22',
    ]);
  });

  it('finds a rule the owner indented, rather than appending a duplicate beside it', () => {
    // The parser trims before matching and so must the writer's search. Left untrimmed,
    // an indented rule is invisible to it and the port ends up named twice — with the
    // file's own parser then honouring whichever came first.
    const content = ['# NAT rules', '   forward 2222 to 192.168.188.9:22'].join('\n');
    const written = withForward(content, 2222, {
      internalIp: '192.168.188.10',
      internalPort: 22,
    });

    expect(parseForwardRules(written)).toEqual([
      { publicPort: 2222, internalIp: '192.168.188.10', internalPort: 22 },
    ]);
  });

  it('ends what it writes with a newline, the way every file an owner may append to does', () => {
    expect(
      withForward('# NAT rules', 2222, { internalIp: '192.168.188.10', internalPort: 22 }),
    ).toBe('# NAT rules\nforward 2222 to 192.168.188.10:22\n');
  });

  it("writes lines the file's own parser reads straight back", () => {
    // The round trip is the point: the scan path and the ssh router both read this
    // file through `parseForwardRules`, so a line only the writer understood would be
    // a forward the world does not honour — visible to the player who wrote it, in a
    // walk, and nowhere else.
    const added = withForward(seededRules(), 2222, {
      internalIp: '192.168.188.10',
      internalPort: 22,
    });
    expect(parseForwardRules(added)).toEqual([
      { publicPort: 2222, internalIp: '192.168.188.10', internalPort: 22 },
    ]);

    const overwritten = withForward(added, 2222, {
      internalIp: '192.168.188.12',
      internalPort: 3306,
    });
    expect(parseForwardRules(overwritten)).toEqual([
      { publicPort: 2222, internalIp: '192.168.188.12', internalPort: 3306 },
    ]);

    expect(parseForwardRules(withForward(overwritten, 2222, null))).toEqual([]);
  });
});
