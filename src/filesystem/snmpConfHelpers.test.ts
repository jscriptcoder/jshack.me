import { describe, it, expect } from 'vitest';
import { findSnmpRwCommunity } from './snmpConfHelpers';

describe('findSnmpRwCommunity', () => {
  it('extracts rwcommunity value from a typical config', () => {
    const content = [
      '# SNMP configuration',
      'rocommunity public',
      'rwcommunity private-rw 192.168.0.0/16',
      'sysLocation Server room',
    ].join('\n');
    expect(findSnmpRwCommunity(content)).toBe('private-rw');
  });

  it('returns undefined when rwcommunity is absent (read-only config)', () => {
    const content = 'rocommunity public\nsysLocation here';
    expect(findSnmpRwCommunity(content)).toBeUndefined();
  });

  it('returns undefined for null content', () => {
    expect(findSnmpRwCommunity(null)).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(findSnmpRwCommunity('')).toBeUndefined();
  });

  it('skips commented rwcommunity lines', () => {
    const content = ['# rwcommunity commented-out', 'rocommunity public'].join('\n');
    expect(findSnmpRwCommunity(content)).toBeUndefined();
  });

  it('handles rwcommunity without a source/network field', () => {
    const content = 'rwcommunity admin-pw';
    expect(findSnmpRwCommunity(content)).toBe('admin-pw');
  });

  it('handles leading whitespace on the directive line', () => {
    const content = '   rwcommunity indented-pw';
    expect(findSnmpRwCommunity(content)).toBe('indented-pw');
  });

  it('does not match rocommunity (the read-only counterpart)', () => {
    const content = 'rocommunity public-ro';
    expect(findSnmpRwCommunity(content)).toBeUndefined();
  });

  it('returns the first uncommented rwcommunity when multiple present', () => {
    const content = ['rwcommunity first-pw', 'rwcommunity second-pw'].join('\n');
    expect(findSnmpRwCommunity(content)).toBe('first-pw');
  });
});
