import { describe, it, expect, vi } from 'vitest';
import { createInsertOccupant } from './createInsertOccupant';
import type { HomeNetworkOccupantRow } from './types';

const row: HomeNetworkOccupantRow = {
  network_id: '203.0.113.10',
  player_key: 'ed25519:abc',
  lan_ip: '.187',
  hostname: 'skylab-9k3',
};

describe('createInsertOccupant', () => {
  it("returns 'ok' when the insert succeeds", async () => {
    const insertRow = vi.fn().mockResolvedValue({ error: null });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('ok');
    expect(insertRow).toHaveBeenCalledWith(row);
  });

  it("returns 'lan_ip_conflict' when unique violation mentions lan_ip", async () => {
    const insertRow = vi.fn().mockResolvedValue({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "home_network_occupants_network_id_lan_ip_key"',
        details: 'Key (network_id, lan_ip)=(203.0.113.10, .187) already exists.',
      },
    });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('lan_ip_conflict');
  });

  it("returns 'hostname_conflict' when unique violation mentions hostname", async () => {
    const insertRow = vi.fn().mockResolvedValue({
      error: {
        code: '23505',
        message:
          'duplicate key value violates unique constraint "home_network_occupants_network_id_hostname_key"',
        details: 'Key (network_id, hostname)=(203.0.113.10, skylab-9k3) already exists.',
      },
    });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('hostname_conflict');
  });

  it("returns 'error' for unique violations on other constraints (e.g., PK race)", async () => {
    // (network_id, player_key) PK violation — would mean a race after the
    // handler's idempotent pre-check. Treat as error; the player can retry.
    const insertRow = vi.fn().mockResolvedValue({
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "home_network_occupants_pkey"',
        details: 'Key (network_id, player_key)=(203.0.113.10, ed25519:abc) already exists.',
      },
    });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('error');
  });

  it("returns 'error' for non-unique-violation Postgres errors", async () => {
    const insertRow = vi.fn().mockResolvedValue({
      error: {
        code: '23514',
        message: 'check constraint violated',
      },
    });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('error');
  });

  it("returns 'error' when the error has no code field", async () => {
    const insertRow = vi.fn().mockResolvedValue({ error: { message: 'network error' } });
    const insertOccupant = createInsertOccupant(insertRow);

    expect(await insertOccupant(row)).toBe('error');
  });
});
