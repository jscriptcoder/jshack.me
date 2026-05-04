import { describe, it, expect } from 'vitest';
import { generateLocalhost } from './generateLocalhost';
import type { FileNode } from '../filesystem/types';
import type { GameState } from '../game/types';

// Structural fingerprint — everything L2 cares about (path keys via
// children, owner, permissions, type). Excludes `content` because L2
// dropped it from machine_filesystems in 20260503210309 and content is
// allowed to vary with seed/rootPassword/hostname. Sorted children keys
// keep ordering insensitive in case generation order ever shifts.
const structuralFingerprint = (node: FileNode): unknown => {
  const children = node.children;
  return {
    name: node.name,
    type: node.type,
    owner: node.owner,
    permissions: node.permissions,
    children: children
      ? Object.fromEntries(
          Object.entries(children)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, structuralFingerprint(child)]),
        )
      : undefined,
  };
};

const buildGameState = (overrides: Partial<GameState> = {}): GameState => ({
  seed: 'seed-default',
  workstationName: 'box',
  username: 'alice',
  rootPassword: 'pw-default',
  ...overrides,
});

describe('generateLocalhost', () => {
  // Load-bearing for the L2 own-workstation backfill (chunk #1b): the
  // server regenerates the workstation FS with placeholder seed/
  // rootPassword/hostname because L2 only stores owner+permissions and
  // those must NOT depend on those fields. If any of these tests start
  // failing, regenWorkstationRows produces wrong rows server-side and
  // L2 walks against a fiction — fix the underlying coupling before
  // expanding the workstations table to capture the new dependency.
  describe('FS structure invariant under (seed, rootPassword, hostname)', () => {
    it('FS structure is identical when only seed differs', () => {
      const a = generateLocalhost(buildGameState({ seed: 'seed-A' }), 'host');
      const b = generateLocalhost(buildGameState({ seed: 'seed-B' }), 'host');
      expect(structuralFingerprint(a.fileSystem)).toEqual(structuralFingerprint(b.fileSystem));
    });

    it('FS structure is identical when only rootPassword differs', () => {
      const a = generateLocalhost(buildGameState({ rootPassword: 'pw-A' }), 'host');
      const b = generateLocalhost(buildGameState({ rootPassword: 'pw-B' }), 'host');
      expect(structuralFingerprint(a.fileSystem)).toEqual(structuralFingerprint(b.fileSystem));
    });

    it('FS structure is identical when only hostname differs', () => {
      const a = generateLocalhost(buildGameState(), 'host-A');
      const b = generateLocalhost(buildGameState(), 'host-B');
      expect(structuralFingerprint(a.fileSystem)).toEqual(structuralFingerprint(b.fileSystem));
    });

    it('FS structure is identical when seed, rootPassword, and hostname all differ — only username matches', () => {
      const a = generateLocalhost(buildGameState({ seed: 'sA', rootPassword: 'pA' }), 'hostA');
      const b = generateLocalhost(buildGameState({ seed: 'sB', rootPassword: 'pB' }), 'hostB');
      expect(structuralFingerprint(a.fileSystem)).toEqual(structuralFingerprint(b.fileSystem));
    });

    it('FS structure DIFFERS when username differs (sanity — username IS structurally load-bearing)', () => {
      const a = generateLocalhost(buildGameState({ username: 'alice' }), 'host');
      const b = generateLocalhost(buildGameState({ username: 'bob' }), 'host');
      expect(structuralFingerprint(a.fileSystem)).not.toEqual(structuralFingerprint(b.fileSystem));
    });
  });
});
