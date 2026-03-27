import { describe, it, expect } from 'vitest';
import { parseSnmpAclConfig } from './snmpAclParser';

describe('parseSnmpAclConfig', () => {
  it('parses ACL OIDs with deny values', () => {
    const content = 'aclSSH deny\naclHTTP deny';
    const overrides = parseSnmpAclConfig(content);
    expect(overrides).toEqual([
      { port: 22, allowed: false },
      { port: 80, allowed: false },
    ]);
  });

  it('parses ACL OIDs with allow values', () => {
    const content = 'aclSSH allow\naclHTTP allow';
    const overrides = parseSnmpAclConfig(content);
    expect(overrides).toEqual([
      { port: 22, allowed: true },
      { port: 80, allowed: true },
    ]);
  });

  it('parses mixed allow and deny', () => {
    const content = 'aclSSH allow\naclHTTP deny\naclFTP deny';
    const overrides = parseSnmpAclConfig(content);
    expect(overrides).toEqual([
      { port: 22, allowed: true },
      { port: 80, allowed: false },
      { port: 21, allowed: false },
    ]);
  });

  it('ignores non-ACL lines', () => {
    const content = [
      '# SNMP config',
      'rocommunity public',
      'rwcommunity secret',
      'sysDescr Linux',
      'aclSSH deny',
      'firewallSSH permit',
    ].join('\n');
    const overrides = parseSnmpAclConfig(content);
    expect(overrides).toEqual([{ port: 22, allowed: false }]);
  });

  it('returns empty array for empty content', () => {
    expect(parseSnmpAclConfig('')).toEqual([]);
  });

  it('returns empty array for content with no ACL OIDs', () => {
    const content = 'rocommunity public\nfirewallSSH permit\nfirewallHTTP deny';
    expect(parseSnmpAclConfig(content)).toEqual([]);
  });

  it('ignores unknown ACL OIDs', () => {
    const content = 'aclSSH deny\naclUnknown deny\naclHTTP allow';
    const overrides = parseSnmpAclConfig(content);
    expect(overrides).toEqual([
      { port: 22, allowed: false },
      { port: 80, allowed: true },
    ]);
  });

  it('ignores ACL lines without a value', () => {
    const content = 'aclSSH';
    expect(parseSnmpAclConfig(content)).toEqual([]);
  });

  it('handles aclFTP OID', () => {
    const overrides = parseSnmpAclConfig('aclFTP allow');
    expect(overrides).toEqual([{ port: 21, allowed: true }]);
  });
});
