import { describe, it, expect } from 'vitest';
import { regenHomeNetworkRows } from './populateHomeNetworkBaseFs';

// Integration-style tests — the helper is a thin wrapper over
// generateHomeNetwork (deterministic, seeded) so we exercise the real
// generator rather than mocking. The world-network helper at
// ./populateWorldNetworkBaseFs.ts uses an injectable selectGenerator
// because its signature has runtime dispatch on theme; the home helper
// has only one generator, so the injection would be artificial.
//
// What these tests catch:
//   - Determinism — same (seed, publicIp) must produce identical rows
//     across runs. Mutation testing on this helper would target the seed
//     argument; constant-replacement mutants are caught here.
//   - Seed dependence — different seeds produce observably different
//     rows. Catches mutants that hard-code or swallow the seed input.
//   - publicIp routing — the input publicIp appears as a machine_id in
//     the output rows. Catches mutants that swap input.publicIp with
//     input.seed (the rename input.publicIp → routerPublicIp inside
//     the helper is the riskiest wiring site).
//   - Multi-machine flatten — non-trivial home networks produce rows
//     across multiple machine_ids. Catches mutants that drop everything
//     except the first machine.

const SEED_A = 'home-test-seed-A';
const SEED_B = 'home-test-seed-B';
const PUBLIC_IP_A = '198.51.100.1';
const PUBLIC_IP_B = '198.51.100.2';

describe('regenHomeNetworkRows', () => {
  it('is deterministic — same (seed, publicIp) produces identical rows', async () => {
    const a = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });
    const b = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });

    expect(a).toEqual(b);
  });

  it('produces different rows for different seeds', async () => {
    const a = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });
    const b = await regenHomeNetworkRows({ seed: SEED_B, publicIp: PUBLIC_IP_A });

    // Network shapes diverge — at minimum the machine_id set differs
    // (different seeds → different generated topology). Comparing the
    // sorted unique machine_id list is robust to row-order differences
    // within a machine.
    const idsA = [...new Set(a.map((r) => r.machine_id))].sort();
    const idsB = [...new Set(b.map((r) => r.machine_id))].sort();
    expect(idsA).not.toEqual(idsB);
  });

  it('routes the input publicIp into the network as the router machine_id', async () => {
    // Pinned: catches the wiring rename input.publicIp → routerPublicIp.
    // A mutant that passed input.seed in place of input.publicIp would
    // produce rows with seed-string machine_ids (or nonsense), surfacing
    // here. The router IP is the public-facing entrypoint of every home
    // network — it MUST appear in the flattened machine_id set.
    const rows = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });
    const ids = new Set(rows.map((r) => r.machine_id));

    expect(ids.has(PUBLIC_IP_A)).toBe(true);
  });

  it('respects the input publicIp — different IPs produce different machine_id sets', async () => {
    // Strengthens the previous test: with same seed, swapping the
    // publicIp argument flips which IP appears as the router. A mutant
    // that hard-coded a constant publicIp would produce identical
    // machine_id sets for both inputs.
    const a = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });
    const b = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_B });

    const idsA = new Set(a.map((r) => r.machine_id));
    const idsB = new Set(b.map((r) => r.machine_id));
    expect(idsA.has(PUBLIC_IP_A)).toBe(true);
    expect(idsA.has(PUBLIC_IP_B)).toBe(false);
    expect(idsB.has(PUBLIC_IP_B)).toBe(true);
    expect(idsB.has(PUBLIC_IP_A)).toBe(false);
  });

  it('flattens every machine in the network (router + LAN hosts)', async () => {
    // Pinned: a mutant that returned only the router's rows would
    // survive single-machine fixtures but fail this multi-machine
    // assertion. Home networks always have at least the router + 1
    // LAN host on layer 0; harder difficulties add more.
    const rows = await regenHomeNetworkRows({ seed: SEED_A, publicIp: PUBLIC_IP_A });
    const uniqueMachineIds = new Set(rows.map((r) => r.machine_id));

    expect(uniqueMachineIds.size).toBeGreaterThan(1);
  });
});
