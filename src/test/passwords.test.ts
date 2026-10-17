import { describe, expect, it } from 'vitest';
import { md5 } from '../core/generation/md5.js';
import {
  ALL_GENERATED_PASSWORDS,
  CRACKABLE_PASSWORDS,
  plaintextFor,
  UNCRACKABLE_PASSWORDS,
} from './passwords.js';

describe('the reverse lookup', () => {
  it('covers every pool a generated door can draw from', () => {
    // Tests and wire-checks recover a plaintext by matching a hash against this
    // list. A pool missing from it does not fail — the lookup simply returns
    // nothing, so an assertion like "the full wordlist cracks every account" keeps
    // passing while quietly meaning "the accounts I could still identify".
    const everyPool = [...CRACKABLE_PASSWORDS, ...UNCRACKABLE_PASSWORDS];
    const missing = everyPool.filter((password) => !ALL_GENERATED_PASSWORDS.includes(password));

    expect(missing).toEqual([]);
  });

  it('carries the router factory defaults, so a cracked gateway resolves too', () => {
    // Gateways draw from the same pool as accounts, so this is really a check
    // that the merge happened: a lookup table missing the router defaults would
    // leave every crackable gateway unresolvable while every account still
    // worked, which is exactly the kind of half-broken that reads as fine.
    const routerDefaults = ['admin', 'root123', 'toor', 'default', 'cisco', 'linksys', 'netgear'];
    const missing = routerDefaults.filter(
      (password) => !ALL_GENERATED_PASSWORDS.includes(password),
    );

    expect(missing).toEqual([]);
  });

  it('turns a hash from either pool back into its word', () => {
    expect(plaintextFor(md5(CRACKABLE_PASSWORDS[0]!))).toBe(CRACKABLE_PASSWORDS[0]);
    expect(plaintextFor(md5(UNCRACKABLE_PASSWORDS[0]!))).toBe(UNCRACKABLE_PASSWORDS[0]);
  });

  it('throws naming a hash no generated door could hold', () => {
    const stranger = md5('not-a-pool-word');

    expect(() => plaintextFor(stranger)).toThrow(`no generated password hashes to ${stranger}`);
  });
});
