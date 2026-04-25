import { describe, it, expect } from 'vitest';
import { createIdentityCommand } from './identity';
import { generateIdentity } from '../identity/identity';

describe('identity command', () => {
  it('prints the player public key as ed25519:<hex>', () => {
    const id = generateIdentity();
    const command = createIdentityCommand({ getIdentity: () => id });
    const result = command.fn() as string;

    expect(result).toContain('ed25519:');
    expect(result).toContain(id.publicKeyHex);
  });

  it('output is deterministic for a fixed identity', () => {
    const id = generateIdentity();
    const command = createIdentityCommand({ getIdentity: () => id });
    expect(command.fn()).toBe(command.fn());
  });

  it('changes output when the identity changes', () => {
    let id = generateIdentity();
    const command = createIdentityCommand({ getIdentity: () => id });
    const before = command.fn() as string;

    id = generateIdentity();
    const after = command.fn() as string;

    expect(after).not.toBe(before);
  });
});
