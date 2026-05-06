import { describe, it, expect } from 'vitest';
import { generateIdentity } from '../identity/identity';
import { deriveHostnameSuffix } from '../homeNetworks/homeNetworkHelpers';
import type { FilePermissions } from '../filesystem/types';
import type { Credentials } from '../sessionRegistry/types';
import type { PatchSummary } from './types';
import { filterReadablePatches, isRowReadable } from './readFilter';

// readFilter composes the three-tier read-privacy rule:
//   1. Owner of the workstation → return.
//   2. Has session on the machine → walker.canRead with full ancestor chain.
//   3. No session → allowlist + default-deny.
//
// Tests describe observable behaviour at the filter boundary; the walker
// and allowlist are exercised here as black boxes via patch outcomes.
// Universal coverage: rules are machine-type-agnostic (workstation,
// home-net, world-net, mission).
//
// See plans/read-path-privacy-filter.md.

const TYPES: ReadonlyArray<'root' | 'user' | 'guest'> = ['root', 'user', 'guest'];

const getMockPermissions = (overrides?: Partial<FilePermissions>): FilePermissions => ({
  read: [...TYPES],
  write: ['root'],
  execute: [...TYPES],
  ...overrides,
});

const getMockPatch = (overrides?: Partial<PatchSummary>): PatchSummary => ({
  machine_id: '10.0.0.5',
  path: '/tmp/note.txt',
  content: 'hello',
  owner: 'user',
  permissions: getMockPermissions(),
  is_new: false,
  node_type: 'file',
  ...overrides,
});

const ownerWorkstationId = (playerKey: string, name = 'mybox'): string =>
  `${name}-${deriveHostnameSuffix(`ed25519:${playerKey}`)}`;

// Build a Map<machine_id, Map<path, perms>> for the fsLookup adapter.
const fsLookupOf = (
  rows: ReadonlyArray<{
    readonly machine_id: string;
    readonly path: string;
    readonly permissions: FilePermissions;
  }>,
) => {
  const byMachine = new Map<string, Map<string, FilePermissions>>();
  for (const row of rows) {
    const inner = byMachine.get(row.machine_id) ?? new Map<string, FilePermissions>();
    inner.set(row.path, row.permissions);
    byMachine.set(row.machine_id, inner);
  }
  return (machine_id: string, path: string): FilePermissions | null =>
    byMachine.get(machine_id)?.get(path) ?? null;
};

const sessionLookupOf = (
  sessions: ReadonlyArray<{ readonly machine_id: string; readonly credentials: Credentials }>,
) => {
  const byMachine = new Map<string, Credentials>();
  for (const s of sessions) byMachine.set(s.machine_id, s.credentials);
  return (machine_id: string): Credentials | null => byMachine.get(machine_id) ?? null;
};

describe('isRowReadable — Tier 1: owner bypass', () => {
  it("returns true for any row on the requester's own workstation regardless of perms", () => {
    const me = generateIdentity();
    const ownId = ownerWorkstationId(me.publicKeyHex);
    const row = getMockPatch({
      machine_id: ownId,
      path: '/root/wallet-seed',
      permissions: getMockPermissions({ read: ['root'] }),
    });
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        () => null,
        () => null,
      ),
    ).toBe(true);
  });

  it("does NOT bypass for another player's workstation (suffix mismatch)", () => {
    const me = generateIdentity();
    const someoneElse = generateIdentity();
    const otherId = ownerWorkstationId(someoneElse.publicKeyHex, 'theirbox');
    const row = getMockPatch({ machine_id: otherId, path: '/root/wallet-seed' });
    // No session, path not on allowlist → tier 3 default-deny applies.
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        () => null,
        () => null,
      ),
    ).toBe(false);
  });

  it('requires the literal "-" separator before the suffix (no substring spoofing)', () => {
    // A machine_id that ends with the same hex characters as the owner's
    // suffix but without the dash separator must NOT count as the owner's
    // box. Otherwise an attacker who learned a player's suffix could craft
    // a machine_id like `victim<aabbccdd>` (no dash) and trick tier 1.
    const me = generateIdentity();
    const suffix = deriveHostnameSuffix(`ed25519:${me.publicKeyHex}`);
    const spoofedId = `victim${suffix}`; // no '-' before the hex
    const row = getMockPatch({
      machine_id: spoofedId,
      path: '/root/wallet-seed',
      permissions: getMockPermissions({ read: ['root'] }),
    });
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        () => null,
        () => null,
      ),
    ).toBe(false);
  });
});

describe('isRowReadable — Tier 2: session + walker', () => {
  it('passes when walker allows read for session userType', () => {
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'user' } },
    ]);
    const fs = fsLookupOf([
      { machine_id: machine, path: '/tmp/note.txt', permissions: getMockPermissions() },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/tmp/note.txt' });
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(true);
  });

  it('drops when walker denies read for session userType (target r-bit missing)', () => {
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: machine,
        path: '/root/.notes',
        permissions: getMockPermissions({ read: ['root'] }),
      },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/root/.notes' });
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(false);
  });

  it('drops when walker denies traverse on a parent dir (parent x-bit missing)', () => {
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    // Target itself is world-readable, but /secret denies execute to guest.
    const fs = fsLookupOf([
      {
        machine_id: machine,
        path: '/secret',
        permissions: getMockPermissions({ execute: ['root'] }),
      },
      { machine_id: machine, path: '/secret/note.txt', permissions: getMockPermissions() },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/secret/note.txt' });
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(false);
  });

  it('passes for root-userType session even when r-bit excludes root (walker root bypass)', () => {
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'admin', userType: 'root' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: machine,
        path: '/root/.notes',
        permissions: getMockPermissions({ read: [] }),
      },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/root/.notes' });
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(true);
  });

  it('permits when target has no machine_filesystems entry (leaf-only fallback parity with L2 writes)', () => {
    // TRIPWIRE: this test mirrors the L2-write fallback documented in
    // patchRegistry/handler.ts. If we ever tighten the write-side
    // enforcement to deny-unless-found, the read-side filter should
    // tighten in the same PR — they share the same backfill story.
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/uncovered/path.txt' });
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        session,
        () => null, // no rows in machine_filesystems for this path
      ),
    ).toBe(true);
  });

  it('skips parents whose row is missing in machine_filesystems (treats them as traversable)', () => {
    // Parent-chain parity with the leaf-only fallback: a missing parent
    // row is permissive. Target itself has perms; `/missing` doesn't.
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'user' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: machine,
        path: '/missing/leaf.txt',
        permissions: getMockPermissions(),
      },
      // /missing is intentionally absent from fs — should not block.
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/missing/leaf.txt' });
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(true);
  });
});

describe('isRowReadable — Tier 3: no session + allowlist', () => {
  it('passes paths matching the externally-observable allowlist', () => {
    const me = generateIdentity();
    const row = getMockPatch({ machine_id: '10.0.0.5', path: '/var/run/sshd.pid' });
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        () => null,
        () => null,
      ),
    ).toBe(true);
  });

  it('drops password hashes — /etc/passwd is NOT on the allowlist', () => {
    const me = generateIdentity();
    const row = getMockPatch({ machine_id: '10.0.0.5', path: '/etc/passwd' });
    expect(
      isRowReadable(
        row,
        me.publicKeyHex,
        () => null,
        () => null,
      ),
    ).toBe(false);
  });

  it('drops user-private files — /root/* and /home/<user>/* are NOT on the allowlist', () => {
    const me = generateIdentity();
    for (const path of [
      '/root/.notes',
      '/root/wallet-seed',
      '/home/alice/.ssh/id_rsa',
      '/home/alice/.bash_history',
    ]) {
      const row = getMockPatch({ machine_id: '10.0.0.5', path });
      expect(
        isRowReadable(
          row,
          me.publicKeyHex,
          () => null,
          () => null,
        ),
      ).toBe(false);
    }
  });
});

describe('isRowReadable — universal coverage across machine types', () => {
  // The rule is machine-type-agnostic. Tier 1 (owner) is workstation-only;
  // Tiers 2 and 3 apply uniformly. This pinpoints the regression risk
  // where someone might add a per-machine-type carve-out.

  const me = generateIdentity();

  const allowlistRow = (machine_id: string) =>
    getMockPatch({ machine_id, path: '/var/run/sshd.pid' });

  const secretRow = (machine_id: string) => getMockPatch({ machine_id, path: '/etc/passwd' });

  const cases: ReadonlyArray<readonly [string, string]> = [
    ['home-network LAN occupant (10.0.0.x)', '10.0.0.42'],
    ['world-network static IP (203.0.113.x)', '203.0.113.42'],
    ['mission machine (198.51.100.x)', '198.51.100.5'],
    ["another player's workstation (suffix shape)", 'theirbox-deadbeef'],
  ];

  for (const [label, machine_id] of cases) {
    it(`no-session caller gets allowlist path on ${label}`, () => {
      expect(
        isRowReadable(
          allowlistRow(machine_id),
          me.publicKeyHex,
          () => null,
          () => null,
        ),
      ).toBe(true);
    });

    it(`no-session caller is denied secret path on ${label}`, () => {
      expect(
        isRowReadable(
          secretRow(machine_id),
          me.publicKeyHex,
          () => null,
          () => null,
        ),
      ).toBe(false);
    });
  }
});

describe('isRowReadable — tier dispatch order', () => {
  it('owner check fires BEFORE session check (a guest session on own box is irrelevant)', () => {
    // Defensive: even if some buggy state had a session row for the
    // requester on their own workstation with a stripped-down userType
    // AND restrictive perms in machine_filesystems, tier 1 should win.
    // The player's own gameplay never relies on walker-checking against
    // their own perms. Setup the walker to DENY so that session-first
    // ordering would return false; correct ordering must return true.
    const me = generateIdentity();
    const ownId = ownerWorkstationId(me.publicKeyHex);
    const row = getMockPatch({
      machine_id: ownId,
      path: '/root/wallet-seed',
      permissions: getMockPermissions({ read: ['root'] }),
    });
    const session = sessionLookupOf([
      { machine_id: ownId, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: ownId,
        path: '/root/wallet-seed',
        permissions: getMockPermissions({ read: ['root'] }),
      },
    ]);
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(true);
  });

  it('session check fires BEFORE allowlist check (a session caller is filtered by walker, not allowlist)', () => {
    // A guest session caller can read `/var/run/sshd.pid` because the
    // allowlist-equivalent walker-readable perms trivially permit it; the
    // tier-2 path is what runs. To prove the dispatch order, set up a
    // case where the walker would DENY but the allowlist would ALLOW —
    // the deny must win.
    const me = generateIdentity();
    const machine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: machine, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: machine,
        path: '/var/run/sshd.pid',
        permissions: getMockPermissions({ read: ['root'] }),
      },
    ]);
    const row = getMockPatch({ machine_id: machine, path: '/var/run/sshd.pid' });
    // Guest can't read root-only-readable file even though path is on
    // the allowlist — session caller goes through walker.
    expect(isRowReadable(row, me.publicKeyHex, session, fs)).toBe(false);
  });
});

describe('filterReadablePatches — wraps isRowReadable across many rows', () => {
  it('returns only rows that pass the per-row check (mixed batch)', () => {
    const me = generateIdentity();
    const ownId = ownerWorkstationId(me.publicKeyHex);
    const otherMachine = '10.0.0.5';
    const session = sessionLookupOf([
      { machine_id: otherMachine, credentials: { username: 'alice', userType: 'guest' } },
    ]);
    const fs = fsLookupOf([
      {
        machine_id: otherMachine,
        path: '/etc/passwd',
        permissions: getMockPermissions({ read: ['root'] }),
      },
    ]);
    const rows: PatchSummary[] = [
      getMockPatch({ machine_id: ownId, path: '/root/wallet-seed' }), // tier 1 → keep
      getMockPatch({ machine_id: otherMachine, path: '/etc/passwd' }), // tier 2 deny
      getMockPatch({ machine_id: otherMachine, path: '/var/run/sshd.pid' }), // tier 2 walker permit (default perms)
      getMockPatch({ machine_id: 'random-host', path: '/etc/passwd' }), // tier 3 deny
      getMockPatch({ machine_id: 'random-host', path: '/var/run/sshd.pid' }), // tier 3 allowlist permit
    ];
    const kept = filterReadablePatches(rows, me.publicKeyHex, session, fs);
    expect(kept.map((r) => `${r.machine_id}:${r.path}`)).toEqual([
      `${ownId}:/root/wallet-seed`,
      `${otherMachine}:/var/run/sshd.pid`,
      'random-host:/var/run/sshd.pid',
    ]);
  });

  it('preserves the original ordering of kept rows', () => {
    const me = generateIdentity();
    const rows: PatchSummary[] = [
      getMockPatch({ machine_id: 'a', path: '/var/run/a.pid' }),
      getMockPatch({ machine_id: 'b', path: '/etc/passwd' }), // dropped
      getMockPatch({ machine_id: 'c', path: '/var/run/c.pid' }),
    ];
    const kept = filterReadablePatches(
      rows,
      me.publicKeyHex,
      () => null,
      () => null,
    );
    expect(kept.map((r) => r.machine_id)).toEqual(['a', 'c']);
  });
});
