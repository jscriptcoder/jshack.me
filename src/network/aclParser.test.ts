import { describe, it, expect } from 'vitest';
import { parseAclRules, isPortDeniedByAcl } from './aclParser';

describe('parseAclRules', () => {
  it('parses valid ACL deny rules', () => {
    const content = 'deny tcp any 10.42.2.0/24 port 22\ndeny tcp any 10.42.2.0/24 port 80';
    const rules = parseAclRules(content);
    expect(rules).toEqual([
      { action: 'deny', protocol: 'tcp', destination: '10.42.2.0/24', port: 22 },
      { action: 'deny', protocol: 'tcp', destination: '10.42.2.0/24', port: 80 },
    ]);
  });

  it('parses valid ACL allow rules', () => {
    const content = 'allow tcp any 10.42.2.0/24 port 443';
    const rules = parseAclRules(content);
    expect(rules).toEqual([
      { action: 'allow', protocol: 'tcp', destination: '10.42.2.0/24', port: 443 },
    ]);
  });

  it('parses mixed allow and deny rules', () => {
    const content = [
      'deny tcp any 10.42.2.0/24 port 22',
      'allow tcp any 10.42.2.0/24 port 443',
      'deny tcp any 10.42.2.0/24 port 80',
    ].join('\n');
    const rules = parseAclRules(content);
    expect(rules).toHaveLength(3);
    expect(rules[0]!.action).toBe('deny');
    expect(rules[1]!.action).toBe('allow');
    expect(rules[2]!.action).toBe('deny');
  });

  it('ignores comments and blank lines', () => {
    const content = '# Access Control List\n\ndeny tcp any 10.42.2.0/24 port 22\n# Syntax help\n';
    const rules = parseAclRules(content);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({
      action: 'deny',
      protocol: 'tcp',
      destination: '10.42.2.0/24',
      port: 22,
    });
  });

  it('returns empty array for empty content', () => {
    expect(parseAclRules('')).toEqual([]);
  });

  it('returns empty array for comment-only content', () => {
    expect(
      parseAclRules('# Access Control List\n# Syntax: <action> <proto> any <subnet> port <port>'),
    ).toEqual([]);
  });

  it('ignores malformed lines', () => {
    const content = [
      'deny tcp any 10.42.2.0/24 port 22',
      'bad line',
      'deny any 10.42.2.0/24', // missing port keyword
      'allow tcp 10.42.2.0/24 port 80', // missing "any"
      'deny tcp any 10.42.2.0/24 port 80',
    ].join('\n');
    const rules = parseAclRules(content);
    expect(rules).toEqual([
      { action: 'deny', protocol: 'tcp', destination: '10.42.2.0/24', port: 22 },
      { action: 'deny', protocol: 'tcp', destination: '10.42.2.0/24', port: 80 },
    ]);
  });

  it('handles UDP protocol rules', () => {
    const rules = parseAclRules('deny udp any 10.42.2.0/24 port 161');
    expect(rules).toEqual([
      { action: 'deny', protocol: 'udp', destination: '10.42.2.0/24', port: 161 },
    ]);
  });

  it('trims whitespace from lines', () => {
    const content = '  deny tcp any 10.42.2.0/24 port 22  ';
    const rules = parseAclRules(content);
    expect(rules).toHaveLength(1);
  });
});

describe('isPortDeniedByAcl', () => {
  const denyRules = parseAclRules(
    'deny tcp any 10.42.2.0/24 port 22\ndeny tcp any 10.42.2.0/24 port 80',
  );

  it('returns true for a denied port', () => {
    expect(isPortDeniedByAcl(denyRules, '10.42.2.5', 22)).toBe(true);
    expect(isPortDeniedByAcl(denyRules, '10.42.2.10', 80)).toBe(true);
  });

  it('returns false for a port with no matching rule', () => {
    expect(isPortDeniedByAcl(denyRules, '10.42.2.5', 443)).toBe(false);
  });

  it('returns false for a different subnet', () => {
    expect(isPortDeniedByAcl(denyRules, '10.42.3.5', 22)).toBe(false);
  });

  it('returns false when last matching rule is allow', () => {
    const mixed = parseAclRules(
      'deny tcp any 10.42.2.0/24 port 22\nallow tcp any 10.42.2.0/24 port 22',
    );
    expect(isPortDeniedByAcl(mixed, '10.42.2.5', 22)).toBe(false);
  });

  it('returns true when last matching rule is deny', () => {
    const mixed = parseAclRules(
      'allow tcp any 10.42.2.0/24 port 22\ndeny tcp any 10.42.2.0/24 port 22',
    );
    expect(isPortDeniedByAcl(mixed, '10.42.2.5', 22)).toBe(true);
  });

  it('returns false for empty rules', () => {
    expect(isPortDeniedByAcl([], '10.42.2.5', 22)).toBe(false);
  });
});
