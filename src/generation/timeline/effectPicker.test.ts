import { describe, it, expect } from 'vitest';
import { pickEffect } from './effectPicker';
import { createPrng } from '../prng';
import type { VulnerabilityEffect } from '../../network/types';

const VALID_KINDS: readonly VulnerabilityEffect['kind'][] = [
  'shell_limited',
  'shell_full',
  'file_read',
  'dir_list',
  'file_write',
  'password_reset',
  'backdoor_port_open',
  'script_exec',
];

const rollMany = (service: string, count: number): readonly VulnerabilityEffect[] =>
  Array.from({ length: count }, (_, i) => pickEffect(service, createPrng(`test:${service}:${i}`)));

describe('pickEffect', () => {
  it('returns a valid effect kind', () => {
    const effect = pickEffect('http', createPrng('test:http:0'));
    expect(VALID_KINDS).toContain(effect.kind);
  });

  it('is deterministic for the same prng state', () => {
    const a = pickEffect('ssh', createPrng('test:determinism'));
    const b = pickEffect('ssh', createPrng('test:determinism'));
    expect(a).toEqual(b);
  });

  it('ssh rolls a variety of effects (universal hammer)', () => {
    const effects = rollMany('ssh', 100);
    const kinds = new Set(effects.map((e) => e.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('ftp never rolls shell effects or script_exec or password_reset', () => {
    const effects = rollMany('ftp', 100);
    const forbidden = ['shell_limited', 'shell_full', 'script_exec', 'password_reset'];
    for (const e of effects) {
      expect(forbidden).not.toContain(e.kind);
    }
  });

  it('http can roll script_exec', () => {
    const effects = rollMany('http', 200);
    expect(effects.some((e) => e.kind === 'script_exec')).toBe(true);
  });

  it('redis can roll script_exec (Redis EVAL is a classic)', () => {
    const effects = rollMany('redis', 200);
    expect(effects.some((e) => e.kind === 'script_exec')).toBe(true);
  });

  it('databases can roll password_reset', () => {
    const effects = rollMany('mysql', 200);
    expect(effects.some((e) => e.kind === 'password_reset')).toBe(true);
  });

  it('shell_full effects include a tier', () => {
    const effects = rollMany('ssh', 200);
    const shellFulls = effects.filter((e) => e.kind === 'shell_full');
    expect(shellFulls.length).toBeGreaterThan(0);
    for (const e of shellFulls) {
      if (e.kind === 'shell_full') {
        expect(['guest', 'user', 'root']).toContain(e.tier);
      }
    }
  });

  it('backdoor_port_open effects include a port from the classic pool', () => {
    const effects = rollMany('ssh', 500);
    const backdoors = effects.filter((e) => e.kind === 'backdoor_port_open');
    expect(backdoors.length).toBeGreaterThan(0);
    for (const e of backdoors) {
      if (e.kind === 'backdoor_port_open') {
        expect([31337, 4444, 1337, 12345, 8080]).toContain(e.port);
      }
    }
  });

  it('services without an explicit pool fall back to shell_limited', () => {
    const effects = rollMany('no-such-service', 50);
    for (const e of effects) {
      expect(e.kind).toBe('shell_limited');
    }
  });
});
