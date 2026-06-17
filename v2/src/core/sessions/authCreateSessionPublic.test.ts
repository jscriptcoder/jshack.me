import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionPublic,
  type AuthCreateSessionPublicDeps,
  type RegistryTarget,
} from './authCreateSessionPublic';
import type { AuthSessionRow } from './authCreateSession';
import { seedRouterAdminPw } from '../generation/routerFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeRouterId } from '../identity/router';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleAuthCreateSessionPublic` is the cross-player ssh-login gate, reshaped for
 * Story 5.1.2: it routes by DESTINATION PORT. A different identity's
 * `ssh [-p port] <user>@<A.publicIp>` resolves A's public IP in the registry,
 * materializes A's ROUTER (the box bearing the public IP, root-only, seeded admin
 * password recoverable from the owner key), and — for a port the router itself
 * serves (its `:22`) — validates the password against the router's `/etc/passwd`
 * and inserts the session on the ROUTER's machine id. A forwarded/unmatched port is
 * `host_unreachable` (the forward → workstation path is Story 5.1.3). A bricked
 * router takes the public IP dark before any password is checked.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
// A's identity → owner_key; the router's admin password + sshd presence are seeded
// from it alone, so the server recovers them when resolving a cross-player login.
const OWNER = generateIdentity();
const ROUTER_ID = computeRouterId(OWNER.publicKeyHex);
const REGISTRY: RegistryTarget = {
  owner_key: OWNER.publicKeyHex,
  router_machine_id: ROUTER_ID,
  essid: 'BEAN-THERE-WIFI',
};
const ADMIN_PW = seedRouterAdminPw(OWNER.publicKeyHex);

/** A root `rm /boot/vmlinuz` on the ROUTER's journal — replayed, it deletes the
 *  kernel so `canBoot` reports the router bricked (the whole public IP goes dark). */
const routerBootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

type LookupResult = { data: RegistryTarget | null; error: unknown };
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
    session_id: 'ssh-root-1',
    target: TARGET,
    parent_session_id: 'seed-session',
    source_ip: '192.168.1.5',
    ...fields,
  });

describe('handleAuthCreateSessionPublic', () => {
  it("authenticates root against the reconstructed router (default port 22) and inserts a session on the router's machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByPublicIp, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'root', machine_id: ROUTER_ID });
    expect(findRegistryByPublicIp).toHaveBeenCalledWith(TARGET);
    // The journal is read off the ROUTER machine, not the workstation.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: ROUTER_ID });
    expect(insertSession).toHaveBeenCalledTimes(1);
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'ssh-root-1',
      player_key: attacker.publicKeyHex,
      machine_id: ROUTER_ID,
      credentials: { username: 'root', userType: 'root' },
      parent_session_id: 'seed-session',
      source_ip: '192.168.1.5',
      kind: 'ssh',
      essid: 'BEAN-THERE-WIFI',
    });
  });

  it('rejects a wrong password as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: 'definitely-not-the-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a non-root user as invalid_credentials (the router is a root-only appliance)', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // The router has no guest/user account — only root. A correct workstation guest
    // password is meaningless here; `guest` is simply not an account on the router.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports an unforwarded destination port as host_unreachable, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();

    // -p 2222 with the opt-in default (no forward configured): the router serves no
    // such port. A CORRECT admin password must NOT matter — routing decides first.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses login to a bricked router (a /boot tombstone) as host_unreachable, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps(
      async () => ({ data: REGISTRY, error: null }),
      undefined,
      async () => ({ data: [routerBootTombstone], error: null }),
    );

    // A CORRECT admin password — the brick must win regardless, proving the boot
    // check short-circuits before (and independent of) password validation.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: ROUTER_ID });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports host_unreachable for an unregistered public IP without inserting or reading the journal', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps(async () => ({ data: null, error: null }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the registry lookup fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'registry_lookup_failed' } });
  });

  it('reports a server error when the boot-state patch lookup fails, without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(undefined, undefined, async () => ({
      data: null,
      error: new Error('db down'),
    }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const attacker = generateIdentity();
    const { deps } = makeDeps(undefined, async () => ({ error: new Error('insert boom') }));

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('rejects an envelope that smuggles a client-supplied player_key without looking up or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findRegistryByPublicIp, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW, player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findRegistryByPublicIp).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps();
    const signed = envelope(attacker, { username: 'root', password: ADMIN_PW });
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
        session_id: 'ssh-root-1',
        username: 'root',
        password: ADMIN_PW,
      }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(insertSession).not.toHaveBeenCalled();
  });
});
