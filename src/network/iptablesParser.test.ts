import { describe, it, expect } from 'vitest';
import { parseIptablesRules } from './iptablesParser';

describe('parseIptablesRules', () => {
  it('parses valid forward rules', () => {
    const content = 'forward 22 to 10.0.1.10:22\nforward 80 to 10.0.1.11:80';
    const rules = parseIptablesRules(content);
    expect(rules).toEqual([
      { publicPort: 22, internalIp: '10.0.1.10', internalPort: 22 },
      { publicPort: 80, internalIp: '10.0.1.11', internalPort: 80 },
    ]);
  });

  it('ignores comments and blank lines', () => {
    const content = '# Comment\n\nforward 22 to 10.0.1.10:22\n# Another comment\n';
    const rules = parseIptablesRules(content);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual({ publicPort: 22, internalIp: '10.0.1.10', internalPort: 22 });
  });

  it('returns empty array for empty content', () => {
    expect(parseIptablesRules('')).toEqual([]);
  });

  it('returns empty array for comment-only content', () => {
    expect(
      parseIptablesRules(
        '# Port Forwarding Rules\n# forward <public_port> to <internal_ip>:<port>',
      ),
    ).toEqual([]);
  });

  it('ignores malformed lines', () => {
    const content = [
      'forward 22 to 10.0.1.10:22',
      'bad line',
      'forward abc to xyz',
      'forward to 10.0.1.10:22', // missing port
      'forward 80 to 10.0.1.11:80',
    ].join('\n');
    const rules = parseIptablesRules(content);
    expect(rules).toEqual([
      { publicPort: 22, internalIp: '10.0.1.10', internalPort: 22 },
      { publicPort: 80, internalIp: '10.0.1.11', internalPort: 80 },
    ]);
  });

  it('handles the router-first mode template (no rules)', () => {
    const content = '# Port Forwarding Rules\n# forward <public_port> to <internal_ip>:<port>';
    expect(parseIptablesRules(content)).toEqual([]);
  });

  it('handles different port numbers in public and internal', () => {
    const rules = parseIptablesRules('forward 2222 to 10.0.1.10:22');
    expect(rules).toEqual([{ publicPort: 2222, internalIp: '10.0.1.10', internalPort: 22 }]);
  });

  it('trims whitespace from lines', () => {
    const content = '  forward 22 to 10.0.1.10:22  ';
    const rules = parseIptablesRules(content);
    expect(rules).toHaveLength(1);
  });
});
