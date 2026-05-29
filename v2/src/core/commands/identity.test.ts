import { describe, expect, it } from 'vitest';
import { identity } from './identity';
import { mockCommandEnv, mockIdentity } from '../../test/factories/commandEnv';
import { asPlayerKeyHex } from '../types';

const NO_FLAGS = new Map<string, string | true>();

// First 16 chars are distinct from the tail so a slice(0,16) → slice(0,N)
// mutant on the fingerprint changes the output.
const PUB = '0123456789abcdef' + 'f'.repeat(48);

describe('identity command', () => {
  it('prints the full public key and a 16-char fingerprint', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUB) }),
    });

    const result = await identity.execute(env, [], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: `Identity: ed25519:${PUB}` },
      { kind: 'text', content: 'Fingerprint: 0123456789abcdef' },
    ]);
  });

  it('ignores positional args (matches the other no-arg builtins)', async () => {
    const env = mockCommandEnv({
      identity: mockIdentity({ publicKeyHex: asPlayerKeyHex(PUB) }),
    });

    const result = await identity.execute(env, ['ignored'], NO_FLAGS);

    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([
      { kind: 'text', content: `Identity: ed25519:${PUB}` },
      { kind: 'text', content: 'Fingerprint: 0123456789abcdef' },
    ]);
  });
});
