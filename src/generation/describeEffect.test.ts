import { describe, it, expect } from 'vitest';
import { describeEffect } from './describeEffect';

const SERVICE = 'http';
const VERSION = 'Apache/2.4.61';
const CVE = 'CVE-2026-0012345';

describe('describeEffect', () => {
  it('always includes service, version, and cve id', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'shell_limited', tier: 'user' });
    expect(desc).toContain(SERVICE);
    expect(desc).toContain(VERSION);
    expect(desc).toContain(CVE);
  });

  it('shell_limited reads as remote code execution', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'shell_limited', tier: 'user' });
    expect(desc).toMatch(/remote code execution/i);
  });

  it('shell_full mentions authenticated shell and the tier', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'shell_full', tier: 'root' });
    expect(desc).toMatch(/shell/i);
    expect(desc).toContain('root');
  });

  it('file_read mentions arbitrary file read', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'file_read', tier: 'user' });
    expect(desc).toMatch(/file read/i);
  });

  it('dir_list mentions directory listing', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'dir_list', tier: 'user' });
    expect(desc).toMatch(/director(y|ies) listing/i);
  });

  it('file_write mentions arbitrary file write', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'file_write', tier: 'user' });
    expect(desc).toMatch(/file write/i);
  });

  it('password_reset mentions auth bypass / credential override and the tier', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'password_reset', tier: 'root' });
    expect(desc).toMatch(/auth bypass|credential/i);
    expect(desc).toContain('root');
  });

  it('backdoor_port_open mentions backdoor and the port number', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, {
      kind: 'backdoor_port_open',
      tier: 'user',
      port: 31337,
    });
    expect(desc).toMatch(/backdoor/i);
    expect(desc).toContain('31337');
  });

  it('script_exec mentions script execution and the tier', () => {
    const desc = describeEffect(SERVICE, VERSION, CVE, { kind: 'script_exec', tier: 'root' });
    expect(desc).toMatch(/script/i);
    expect(desc).toContain('root');
  });

  it('produces distinct descriptions for different effect kinds', () => {
    const kinds = [
      describeEffect(SERVICE, VERSION, CVE, { kind: 'shell_limited', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'shell_full', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'file_read', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'dir_list', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'file_write', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'password_reset', tier: 'user' }),
      describeEffect(SERVICE, VERSION, CVE, {
        kind: 'backdoor_port_open',
        tier: 'user',
        port: 4444,
      }),
      describeEffect(SERVICE, VERSION, CVE, { kind: 'script_exec', tier: 'user' }),
    ];
    expect(new Set(kinds).size).toBe(kinds.length);
  });
});
