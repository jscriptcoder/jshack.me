import { describe, expect, it } from 'vitest';
import { workstationIdentityFields } from './workstationIdentity';
import { md5 } from '../generation/md5';
import type { GameConfig } from '../gameConfig/gameConfig';

/**
 * `workstationIdentityFields` derives the registry fields the server needs to
 * RECONSTRUCT a player's workstation for a cross-player reader (Story 2): the
 * player-chosen `username`/`machineName`, plus the root password as an md5 HASH —
 * never the plaintext. The guest password is pubkey-seeded (server-recomputable),
 * so only these three player-private fields must travel. Keeping the md5 in `core/`
 * (not the adapter) makes "the plaintext never leaves the browser" testable.
 */

const getMockConfig = (overrides?: Partial<GameConfig>): GameConfig => ({
  machineName: 'skylab',
  username: 'neo',
  rootPassword: 'matrix1999',
  ...overrides,
});

describe('workstationIdentityFields', () => {
  it('passes the username and machine name through unchanged', () => {
    const fields = workstationIdentityFields(
      getMockConfig({ username: 'trinity', machineName: 'nebuchadnezzar' }),
    );

    expect(fields.workstation_username).toBe('trinity');
    expect(fields.workstation_machine_name).toBe('nebuchadnezzar');
  });

  it('hashes the root password with md5 — the plaintext never appears in the output', () => {
    const fields = workstationIdentityFields(getMockConfig({ rootPassword: 'super-secret-pw' }));

    expect(fields.workstation_root_hash).toBe(md5('super-secret-pw'));
    expect(JSON.stringify(fields)).not.toContain('super-secret-pw');
  });
});
