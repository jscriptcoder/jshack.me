import { describe, expect, it } from 'vitest';
import { signRequest } from './sign';
import { generateIdentity } from '../identity/identity';

const parse = (payload: string): Record<string, unknown> =>
  JSON.parse(payload) as Record<string, unknown>;

describe('signRequest', () => {
  it('carries the identity public key and a 128-hex signature', () => {
    const id = generateIdentity();
    const envelope = signRequest(id, 'upsertPatch', { path: '/tmp/x' });
    expect(envelope.publicKey).toBe(id.publicKeyHex);
    expect(envelope.signature).toMatch(/^[0-9a-f]{128}$/);
  });

  it('embeds action, an integer ts, a 32-hex nonce, and the caller fields', () => {
    const envelope = signRequest(generateIdentity(), 'upsertPatch', {
      path: '/tmp/x',
      content: 'hi',
    });
    const payload = parse(envelope.payload);
    expect(payload.action).toBe('upsertPatch');
    expect(Number.isInteger(payload.ts)).toBe(true);
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(payload.path).toBe('/tmp/x');
    expect(payload.content).toBe('hi');
  });

  it('overrides caller-supplied action/ts/nonce (no stale-ts or known-nonce injection)', () => {
    const envelope = signRequest(generateIdentity(), 'realAction', {
      action: 'forged',
      ts: 1,
      nonce: 'deadbeef',
    });
    const payload = parse(envelope.payload);
    expect(payload.action).toBe('realAction');
    expect(payload.ts).not.toBe(1);
    expect(payload.nonce).not.toBe('deadbeef');
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces a fresh nonce on each call', () => {
    const id = generateIdentity();
    const first = parse(signRequest(id, 'x', {}).payload);
    const second = parse(signRequest(id, 'x', {}).payload);
    expect(first.nonce).not.toBe(second.nonce);
  });
});
