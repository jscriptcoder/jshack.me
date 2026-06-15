import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionPublic,
  type AuthCreateSessionPublicDeps,
  type RegistryWorkstation,
} from './authCreateSessionPublic';
import type { AuthSessionRow } from './authCreateSession';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { md5 } from '../generation/md5';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthCreateSessionPublic` is the cross-player ssh-login gate (Story 2,
 * slice 2b): a DIFFERENT identity's `ssh <user>@<A.publicIp>` resolves A's public
 * IP in the registry, RECONSTRUCTS A's workstation from the persisted identity
 * (owner_key + username + md5(rootPassword)), validates the supplied password
 * against A's REAL `/etc/passwd`, and on success inserts a session on A's REAL
 * `workstation_machine_id` (the seam slice 2c's tier-2 read lookup needs). It does
 * NOT touch A's box (the auth.log trace is Story 6) — only B's own session row.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
// A's identity → owner_key; the guest password is seeded from it, so the dev (and
// a future cracker) recovers it via `workstationGuestPassword`.
const OWNER = generateIdentity();
const REGISTRY: RegistryWorkstation = {
  owner_key: OWNER.publicKeyHex,
  workstation_machine_id: 'skylab-deadbeef',
  essid: 'BEAN-THERE-WIFI',
  workstation_username: 'neo',
  workstation_root_hash: md5('matrix1999'),
};
const GUEST_PW = workstationGuestPassword(OWNER.publicKeyHex);

/** A root `rm /boot/vmlinuz` on the shared journal — replayed, it deletes the
 *  kernel so `canBoot` reports the box bricked (unreachable to logins). */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-16T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

type LookupResult = { data: RegistryWorkstation | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  lookup: () => Promise<LookupResult> = async () => ({ data: REGISTRY, error: null }),
  insert: () => Promise<{ error: unknown }> = async () => ({ error: null }),
  patches: () => Promise<PatchesResult> = async () => ({ data: [], error: null }),
) => {
  const findRegistryByPublicIp = vi.fn<(publicIp: string) => Promise<LookupResult>>(lookup);
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(insert);
  const deps: AuthCreateSessionPublicDeps = {
    nonceStore: freshStore,
    findRegistryByPublicIp,
    findPatches,
    insertSession,
  };
  return { deps, findRegistryByPublicIp, findPatches, insertSession };
};

const envelope = (id: ReturnType<typeof generateIdentity>, fields: Record<string, unknown>) =>
  signRequest(id, 'authCreateSessionPublic', {
    session_id: 'ssh-guest-1',
    target: TARGET,
    parent_session_id: 'seed-session',
    source_ip: '192.168.1.5',
    ...fields,
  });

describe('handleAuthCreateSessionPublic', () => {
  it("authenticates guest against the reconstructed workstation and inserts a session on the owner's real machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByPublicIp, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'guest', machine_id: 'skylab-deadbeef' });
    expect(findRegistryByPublicIp).toHaveBeenCalledWith(TARGET);
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'ssh-guest-1',
      player_key: attacker.publicKeyHex,
      machine_id: 'skylab-deadbeef',
      credentials: { username: 'guest', userType: 'guest' },
      parent_session_id: 'seed-session',
      source_ip: '192.168.1.5',
      kind: 'ssh',
      essid: 'BEAN-THERE-WIFI',
    });
  });

  it('authenticates root using the registry root hash (the stored hash IS the auth boundary)', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root', machine_id: 'skylab-deadbeef' });
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      credentials: { username: 'root', userType: 'root' },
    });
  });

  it('rejects a wrong password as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: 'definitely-not-the-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown username as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'ghost', password: 'whatever' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("refuses login as the owner's passwordless user (empty hash is unauthenticatable)", async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // 'neo' is the owner's own user — empty hash. md5(anything) is never '', so no
    // password can ever match; a cross-player attacker can't ride the owner's
    // passwordless convenience account.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'neo', password: '' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable for an unregistered public IP without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses login to a bricked machine (a /boot tombstone) as host_unreachable, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps(
      async () => ({ data: REGISTRY, error: null }),
      undefined,
      async () => ({ data: [bootTombstone], error: null }),
    );

    // A CORRECT root password — the brick must win regardless, proving the boot
    // check short-circuits before (and independent of) password validation.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: 'matrix1999' }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: 'skylab-deadbeef' });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the boot-state patch lookup fails, without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(undefined, undefined, async () => ({
      data: null,
      error: new Error('db down'),
    }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('reports a server error when the session insert fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(undefined, async () => ({ error: new Error('insert boom') }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByPublicIp, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();
    const signed = envelope(attacker, { username: 'guest', password: GUEST_PW });
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthCreateSessionPublic(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      signRequest(attacker, 'authCreateSessionPublic', {
        session_id: 'ssh-guest-1',
        username: 'guest',
        password: GUEST_PW,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });
});
