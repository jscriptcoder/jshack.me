import { describe, expect, it } from 'vitest';
import { parseForwardRules } from './iptablesRules';

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
