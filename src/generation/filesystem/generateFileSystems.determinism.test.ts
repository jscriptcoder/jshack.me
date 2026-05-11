import { describe, it, expect } from 'vitest';
import { buildTestData } from './testHelpers';

// L2 patch validation gate.
//
// L2's server-side permission walker reads from machine_filesystems, which is
// dual-written from the same FS generator the client runs. The whole approach
// (Pattern A — eager denormalization) collapses if the generator produces
// different output server-side vs client-side for the same seed. JS-engine
// parity (V8 in Node, V8 in Chromium) gives this for free as long as the
// generator stays pure: no Math.random, no Date.now, no environment globals,
// no async race ordering.
//
// This sweep is the regression guard. It runs 1000 distinct seeds and
// rebuilds each twice, asserting deep equality. Any future change that
// introduces a non-deterministic dependency will fail here.
describe('generateFileSystems determinism (L2 gate)', () => {
  it('produces deep-equal filesystems on repeated builds for 1000 distinct seeds', async () => {
    const SEED_COUNT = 1000;
    const divergences: string[] = [];

    for (let i = 0; i < SEED_COUNT; i++) {
      const seed = `l2-det-${i}`;
      const a = await buildTestData(seed);
      const b = await buildTestData(seed);
      try {
        expect(a.fileSystems).toEqual(b.fileSystems);
      } catch {
        divergences.push(seed);
      }
    }

    expect(divergences, `seeds with non-deterministic output: ${divergences.join(', ')}`).toEqual(
      [],
    );
  }, 180_000);
});
