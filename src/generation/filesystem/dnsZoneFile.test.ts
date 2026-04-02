import { describe, it, expect } from 'vitest';
import { generateDnsZoneContent, generateDnsNamedConf } from './networkConfig';
import type { DnsRecord } from '../../network/types';

describe('generateDnsZoneContent', () => {
  const records: readonly DnsRecord[] = [
    { domain: 'web01.mission', ip: '10.0.1.50', type: 'A' },
    { domain: 'db-prod.mission', ip: '10.0.1.20', type: 'A' },
    { domain: 'gateway-sw.mission', ip: '10.0.1.1', type: 'A' },
    { domain: 'admin-box.mission', ip: '10.0.2.15', type: 'A' },
  ];

  it('generates SOA and NS records', () => {
    const content = generateDnsZoneContent('dns01', records);
    expect(content).toContain('$ORIGIN mission.');
    expect(content).toContain('$TTL 3600');
    expect(content).toContain('IN SOA dns01.mission. hostmaster.mission.');
    expect(content).toContain('IN NS  dns01.mission.');
  });

  it('generates A records for all provided DNS records', () => {
    const content = generateDnsZoneContent('dns01', records);
    // Each hostname is padded to 15 chars
    expect(content).toContain('web01');
    expect(content).toContain('10.0.1.50');
    expect(content).toContain('db-prod');
    expect(content).toContain('10.0.1.20');
    expect(content).toContain('gateway-sw');
    expect(content).toContain('10.0.1.1');
    expect(content).toContain('admin-box');
    expect(content).toContain('10.0.2.15');
    // All A records have the correct format
    const aRecordLines = content.split('\n').filter((l) => l.includes('IN  A'));
    expect(aRecordLines).toHaveLength(4);
    aRecordLines.forEach((line) => {
      expect(line).toMatch(/\S+\s+3600\s+IN\s+A\s+\d+\.\d+\.\d+\.\d+/);
    });
  });

  it('strips .mission suffix from domain names in A records', () => {
    const content = generateDnsZoneContent('dns01', records);
    // Should NOT have full "web01.mission" in A record lines — just "web01"
    const aRecordLines = content.split('\n').filter((l) => l.includes('IN  A'));
    aRecordLines.forEach((line) => {
      expect(line).not.toMatch(/\.mission\s/);
    });
  });

  it('handles empty records array', () => {
    const content = generateDnsZoneContent('ns-primary', []);
    expect(content).toContain('$ORIGIN mission.');
    expect(content).toContain('IN SOA ns-primary.mission.');
    // Should still have SOA and NS, just no A records
    const aRecordLines = content.split('\n').filter((l) => l.includes('IN  A'));
    expect(aRecordLines).toHaveLength(0);
  });
});

describe('generateDnsNamedConf', () => {
  it('includes allow-transfer { any; } when AXFR is enabled', () => {
    const content = generateDnsNamedConf('mission', true);
    expect(content).toContain('allow-transfer { any; };');
    expect(content).not.toContain('allow-transfer { none; };');
  });

  it('includes allow-transfer { none; } when AXFR is disabled', () => {
    const content = generateDnsNamedConf('mission', false);
    expect(content).toContain('allow-transfer { none; };');
    expect(content).not.toContain('allow-transfer { any; };');
  });

  it('references the zone file path', () => {
    const content = generateDnsNamedConf('mission', true);
    expect(content).toContain('file "/etc/bind/zones/db.mission"');
  });

  it('includes zone name', () => {
    const content = generateDnsNamedConf('mission', true);
    expect(content).toContain('zone "mission"');
  });
});
