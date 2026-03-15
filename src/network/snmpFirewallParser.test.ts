import { describe, it, expect } from 'vitest';
import { parseSnmpFirewallConfig } from './snmpFirewallParser';

describe('parseSnmpFirewallConfig', () => {
  it('parses firewallSSH permit as port 22 open', () => {
    const result = parseSnmpFirewallConfig('firewallSSH permit');
    expect(result).toEqual([{ port: 22, open: true }]);
  });

  it('parses firewallSSH deny as port 22 closed', () => {
    const result = parseSnmpFirewallConfig('firewallSSH deny');
    expect(result).toEqual([{ port: 22, open: false }]);
  });

  it('parses firewallHTTP permit as port 80 open', () => {
    const result = parseSnmpFirewallConfig('firewallHTTP permit');
    expect(result).toEqual([{ port: 80, open: true }]);
  });

  it('parses multiple firewall OIDs', () => {
    const content = 'firewallSSH permit\nfirewallHTTP deny';
    const result = parseSnmpFirewallConfig(content);
    expect(result).toEqual([
      { port: 22, open: true },
      { port: 80, open: false },
    ]);
  });

  it('ignores non-firewall lines', () => {
    const content = [
      '# SNMP config',
      'rocommunity public',
      'sysName router',
      'firewallSSH deny',
      'nsExtendArgs.backup --user admin',
    ].join('\n');
    const result = parseSnmpFirewallConfig(content);
    expect(result).toEqual([{ port: 22, open: false }]);
  });

  it('ignores unknown firewall OIDs', () => {
    const result = parseSnmpFirewallConfig('firewallFTP permit');
    expect(result).toEqual([]);
  });

  it('returns empty array for empty content', () => {
    expect(parseSnmpFirewallConfig('')).toEqual([]);
  });
});
