import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthElevateSession,
  type AuthElevateSessionDeps,
  type SuSessionRow,
} from './authElevateSession';
import type { RegistryWorkstation } from './authCreateSessionPublic';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthElevateSession` is the server-authoritative `su`-to-root gate for a
 * CROSS-PLAYER hop (Story 4, slice 1). B, already ssh'd into A's box as guest,
 * runs `su` → this resolves A's REGISTERED workstation by its `machine_id`,
 * RECONSTRUCTS A's box from the persisted identity (owner_key + username +
 * md5(rootPassword)), validates the typed password against A's REAL `/etc/passwd`,
 * and on success inserts a root-tier `kind:'su'` session row for B on A's box.
 *
 * Why server-authoritative: the patch write path (L2) authorizes at the ACTIVE
 * session row's tier — a client-only `su` pushes a local session but no row, so
 * L2 would still see guest. Only a real `kind:'su'` root row makes B's later
 * writes authorize at root. Unknown-user and wrong-password collapse to one 401.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const MACHINE = 'skylab-deadbeef';
// A's identity → owner_key; the guest password is seeded from it, so the dev (and
// a future cracker) recovers it via `workstationGuestPassword`.
const OWNER = generateIdentity();
const REGISTRY: RegistryWorkstation = {
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: MACHINE,
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'neo',
  workstation_root_hash: md5('matrix1999'),
};
const GUEST_PW = workstationGuestPassword(OWNER.publicKeyHex);

type LookupResult = { data: RegistryWorkstation | null; error: unknown };

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: REGISTRY, error: null }),
  insert: () => Promise<{ error: unknown }> = async () => ({ error: null }),
) => {
  const findRegistryByMachineId = vi.fn<(machineId: string) => Promise<LookupResult>>(lookup);
  const insertSession = vi.fn<(row: SuSessionRow) => Promise<{ error: unknown }>>(insert);
  const deps: AuthElevateSessionDeps = { nonceStore: freshStore, findRegistryByMachineId, insertSession };
  return { deps, findRegistryByMachineId, insertSession };
};

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'suElevate', {
    session_id: 'su-root-1',
    machine_id: MACHINE,
    parent_session_id: 'ssh-guest-seed',
    source_ip: '192.168.1.5',
    ...fields,
  });

describe('handleAuthElevateSession', () => {
  it("elevates to root against the reconstructed workstation and inserts a su session on the owner's real machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root' });
    expect(findRegistryByMachineId).toHaveBeenCalledWith(MACHINE);
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'su-root-1',
      player_key: attacker.publicKeyHex,
      machine_id: MACHINE,
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'ssh-guest-seed',
      source_ip: '192.168.1.5',
      kind: 'su',
      essid: 'BEAN-THERE-WIFI',
    });
  });

  it('derives the userType from the passwd (a valid guest credential yields a guest session, not root)', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'guest' });
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      credentials: { username: 'guest', userType: 'guest' },
      kind: 'su',
    });
  });

  it('rejects a wrong root password as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'not-the-root-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown username as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'ghost', password: 'whatever' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("refuses to elevate to the owner's passwordless user (empty hash is unauthenticatable)", async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // 'neo' is the owner's own user — empty hash. md5(anything) is never '', so no
    // password can ever match; a cross-player attacker can't ride the owner's
    // passwordless convenience account up to that account.
    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'neo', password: '' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable for an unregistered machine id without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(undefined, async () => ({ error: new Error('insert boom') }));

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999', player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied userType (the server derives the tier) without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByMachineId, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      envelope(attacker, { username: 'root', password: 'matrix1999', userType: 'root' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByMachineId).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();
    const signed = envelope(attacker, { username: 'root', password: 'matrix1999' });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthElevateSession(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the machine id without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthElevateSession(
      signRequest(attacker, 'suElevate', {
        session_id: 'su-root-1',
        username: 'root',
        password: 'matrix1999',
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });
});
