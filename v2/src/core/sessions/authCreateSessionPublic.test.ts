import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionPublic,
  type AuthCreateSessionPublicDeps,
  type RegistryTarget,
} from './authCreateSessionPublic';
import type { AuthSessionRow } from './authCreateSession';
import { md5 } from '../generation/md5';
import { seedRouterAdminPw } from '../generation/routerFs';
import { workstationGuestPassword } from '../generation/workstationFs';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeRouterId } from '../identity/router';
import { assignHomeNetwork } from '../network/homeNetwork';
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
const WS_ID = 'workstation-a1b2c3d4';
const ESSID = 'BEAN-THERE-WIFI';
const REGISTRY: RegistryTarget = {
  owner_key: OWNER.publicKeyHex,
  router_machine_id: ROUTER_ID,
  essid: ESSID,
  workstation_machine_id: WS_ID,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};
const ADMIN_PW = seedRouterAdminPw(OWNER.publicKeyHex);
// A's one workstation behind the NAT: the deterministic LAN IP a `rules.v4` forward
// must target, and the seeded weak guest password the server recovers for the login.
const WS_LAN_IP = assignHomeNetwork(OWNER.publicKeyHex, ESSID).localIp;
const GUEST_PW = workstationGuestPassword(OWNER.publicKeyHex);

/** A's `nano` edit of the router's NAT table: forward public `:2222` to the
 *  workstation's `:22` — the opt-in that exposes A's ws behind the public IP. */
const routerForward: OwnerPatchRow = {
  path: '/etc/iptables/rules.v4',
  content: `forward 2222 to ${WS_LAN_IP}:22`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

/** A started the workstation's sshd — its pidfile on the ws journal makes `:22` a
 *  live service (a fresh ws has an empty `/var/run`, so the forward is dark until). */
const wsSshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: OWNER.publicKeyHex,
};

/** Route the per-machine journal read by `machine_id`: the router's forward table
 *  vs the workstation's running-service pidfiles live on different machines. */
const patchesByMachine =
  (byId: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> => ({
    data: byId[machine_id] ?? [],
    error: null,
  });

/** A root `rm /boot/vmlinuz` tombstone — replayed over a machine's seeded base, it
 *  deletes the kernel so `canBoot` reports that box bricked. Dropped on the ROUTER's
 *  journal it takes the whole public IP dark; dropped on the WORKSTATION's journal it
 *  drops only the forward behind the NAT (the router still answers its own ports). */
const bootTombstone: OwnerPatchRow = {
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
  patches: (query: { machine_id: string }) => Promise<PatchesResult> = async () => ({
    data: [],
    error: null,
  }),
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

  it('reports an unforwarded destination port as host_unreachable, before the password is checked and without reading the workstation journal or inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps();

    // -p 2222 with the opt-in default (no forward configured): the router serves no
    // such port. A CORRECT admin password must NOT matter — routing decides first.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'root', password: ADMIN_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    // An unserved port is NOT a forward: the gate must not read the workstation
    // journal (only the router's, for the boot gate) — it short-circuits at routing.
    expect(findPatches).not.toHaveBeenCalledWith({ machine_id: WS_ID });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("routes a NAT-forwarded port to the workstation: validates the guest password against ITS passwd and opens a session on the workstation's machine id", async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [routerForward], [WS_ID]: [wsSshdUp] }),
    );

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, userType: 'guest', machine_id: WS_ID });
    // The journal is read off BOTH the router (forward table + boot gate) AND the
    // workstation (its running services + passwd) — the forward bridges the two.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: ROUTER_ID });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: WS_ID });
    expect(insertSession.mock.calls[0]![0]).toMatchObject({
      session_id: 'ssh-root-1',
      player_key: attacker.publicKeyHex,
      machine_id: WS_ID,
      credentials: { username: 'guest', userType: 'guest' },
      kind: 'ssh',
      essid: ESSID,
    });
  });

  it('rejects a wrong workstation password on a forwarded port as invalid_credentials without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [routerForward], [WS_ID]: [wsSshdUp] }),
    );

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: 'not-the-guest-pw', port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a forwarded port as host_unreachable when the workstation sshd is down, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    // The forward is configured on the router, but the workstation never started
    // sshd (empty ws journal → empty /var/run): the DNAT target is not listening.
    const { deps, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [routerForward], [WS_ID]: [] }),
    );

    // A CORRECT guest password — liveness must win regardless, proving the routing
    // refuses a dark target before (and independent of) password validation.
    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a forward to a non-existent internal host as host_unreachable without inserting', async () => {
    const attacker = generateIdentity();
    // A fat-fingered forward targeting an IP that is not A's one workstation: the
    // DNAT resolves to no host, so the public port reaches nothing.
    const strayForward: OwnerPatchRow = {
      ...routerForward,
      content: 'forward 2222 to 192.168.99.99:22',
    };
    const { deps, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [strayForward], [WS_ID]: [wsSshdUp] }),
    );

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it("reports a forwarded port as host_unreachable when the workstation serves a DIFFERENT port than the forward's internal target, without inserting", async () => {
    const attacker = generateIdentity();
    // The forward targets the ws `:22`, but the ws sshd is bound to 2222 — the DNAT
    // target port is not listening even though the ws has an open port. Liveness must
    // check the forward's specific internal port, not merely "any service is up".
    const wsSshdOnOtherPort: OwnerPatchRow = { ...wsSshdUp, content: 'sshd:port=2222' };
    const { deps, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [routerForward], [WS_ID]: [wsSshdOnOtherPort] }),
    );

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a forwarded port to a BRICKED workstation as host_unreachable, even with its sshd up and a correct password, without inserting', async () => {
    const attacker = generateIdentity();
    // The forward is live (router forward + ws sshd pidfile present), but the
    // workstation has been bricked (a /boot tombstone). A bricked box behind the NAT
    // can't come up, so the forward reaches a dead host — refused regardless of a
    // CORRECT guest password, proving the boot gate wins over liveness + credentials.
    const { deps, insertSession } = makeDeps(
      undefined,
      undefined,
      patchesByMachine({ [ROUTER_ID]: [routerForward], [WS_ID]: [wsSshdUp, bootTombstone] }),
    );

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the workstation journal lookup fails, without inserting', async () => {
    const attacker = generateIdentity();
    // Router journal (forward + boot) succeeds; the SECOND lookup — the ws journal —
    // fails, so the gate 500s rather than auth against an unknown ws state.
    const patches = async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> =>
      machine_id === WS_ID
        ? { data: null, error: new Error('db down') }
        : { data: [routerForward], error: null };
    const { deps, insertSession } = makeDeps(undefined, undefined, patches);

    const result = await handleAuthCreateSessionPublic(
      envelope(attacker, { username: 'guest', password: GUEST_PW, port: 2222 }),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses login to a bricked router (a /boot tombstone) as host_unreachable, before the password is checked and without inserting', async () => {
    const attacker = generateIdentity();
    const { deps, findPatches, insertSession } = makeDeps(
      async () => ({ data: REGISTRY, error: null }),
      undefined,
      async () => ({ data: [bootTombstone], error: null }),
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
