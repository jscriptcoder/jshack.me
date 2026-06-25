import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionInnerGateway,
  type AuthCreateSessionInnerGatewayDeps,
} from './authCreateSessionInnerGateway';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import {
  generateDeepLayer,
  buildDeepHostFs,
  seedNetworkDepth,
} from '../generation/generateDeepLayer';
import type { Identity } from '../commands/types';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { seedDeepGatewayAdminPw, seedInnerGatewayAdminPw } from '../generation/routerFs';
import { hostMachineId } from '../generation/remoteHostId';
import { accountIn } from './passwdAccount';
import { md5 } from '../generation/md5';
import { WEAK_PASSWORDS } from '../generation/remoteHostFs';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { AuthSessionRow } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { Directory } from '../filesystem/types';

/**
 * `handleAuthCreateSessionInnerGateway` is the server gate for `ssh user@<inner>:<fwd
 * port>` — the multi-layer payoff. It regenerates the caller's OWN inner gateway from
 * the verified pubkey + essid, replays its journal, and routes by destination port
 * through `machineServing`: a NAT-forwarded port reaches the one deep Layer-2 NPC
 * behind the gateway (auth against ITS `/etc/passwd`, session lands on the L2 host's
 * machine id); the gateway's own `:22` lands on the gateway; anything else is
 * unreachable. The deep layer stays private — nothing here touches the cross-player
 * registry.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';

/** A player whose home is seeded to EXACTLY `depth` layers. Depth is a per-(key, essid)
 *  roll, so pick deterministically rather than hoping a random identity lands at the
 *  depth a test needs. Pinning the exact depth (not just a minimum) keeps the
 *  child-gateway boundary tests reliable: a depth-2 home is the shallowest that hangs a
 *  child off its inner router, a depth-1 home hangs none. */
const playerWithNetworkDepth = (depth: number): Identity => {
  const found = Array.from({ length: 96 }, () => generateIdentity()).find(
    (identity) => seedNetworkDepth(identity.publicKeyHex, ESSID) === depth,
  );
  if (found === undefined) throw new Error(`no identity seeds network depth ${depth}`);
  return found;
};
const PLAYER = playerWithNetworkDepth(2);

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A player whose home is seeded to EXACTLY `depth` layers AND whose entire gateway chain
 *  is routers — every layer hangs a ROUTER child, so the chain runs the full `depth`
 *  gateways deep. The chained-reach tests need this: a switch caps the chain short (it
 *  forwards nothing), so a random depth-N home no longer guarantees N router hops. Picks
 *  deterministically by walking each candidate's seeded chain. */
const playerWithAllRouterChain = (depth: number): Identity => {
  const isAllRouterChain = (identity: Identity): boolean => {
    if (seedNetworkDepth(identity.publicKeyHex, ESSID) !== depth) return false;
    const inner = generateHomeLan(identity.publicKeyHex, ESSID).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (inner === undefined) return false;
    let parentId = computeInnerGatewayId(identity.publicKeyHex, octetOf(inner));
    for (let position = 1; position < depth; position++) {
      const child = generateDeepLayer(
        identity.publicKeyHex,
        ESSID,
        { machineId: parentId, kind: 'router' },
        { hangsChild: true },
      ).childGateway;
      if (child === null || child.kind !== 'router') return false;
      parentId = computeDeepGatewayId(identity.publicKeyHex, parentId, octetOf(child));
    }
    return true;
  };
  const found = Array.from({ length: 400 }, () => generateIdentity()).find(isAllRouterChain);
  if (found === undefined) throw new Error(`no identity seeds an all-router depth-${depth} chain`);
  return found;
};

const hostMatching = (predicate: (host: LanHost) => boolean): LanHost => {
  const host = generateHomeLan(PLAYER.publicKeyHex, ESSID).hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on LAN');
  return host;
};

const INNER = hostMatching((host) => host.kind === 'router' && octetOf(host) !== 1);
const EDGE = hostMatching((host) => octetOf(host) === 1);
const SIBLING = hostMatching((host) => host.kind === 'machine');

const GATEWAY_ID = computeInnerGatewayId(PLAYER.publicKeyHex, octetOf(INNER));
const GATEWAY_ROOT_PW = seedInnerGatewayAdminPw(PLAYER.publicKeyHex, octetOf(INNER));

const DEEP = generateDeepLayer(PLAYER.publicKeyHex, ESSID, { machineId: GATEWAY_ID, kind: 'router' });
const DEEP_FS: Directory = buildDeepHostFs(PLAYER.publicKeyHex, ESSID, DEEP.host);
const DEEP_ID = hostMachineId(DEEP.host, ESSID);

/** Recover a generated account's plaintext password (the seeded weak pool is exported
 *  exactly so a credential test can match an md5 hash back to its plaintext). */
const recover = (fs: Directory, username: string): { password: string; userType: string } => {
  const account = accountIn(fs, username);
  if (account === null) throw new Error(`no ${username} account`);
  const password = WEAK_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
  if (password === undefined) throw new Error(`cannot recover ${username} password`);
  return { password, userType: account.userType };
};

const DEEP_GUEST = recover(DEEP_FS, 'guest');

/** The CHILD GATEWAY hanging on the inner router's deep layer — the door to the next
 *  layer down (5b.4a). Its admin password is seeded off its own deep-gateway
 *  discriminator (owner key + parent gateway id + octet), distinct from the inner
 *  gateway's and the deep NPC's. A reach forwarded to its `:22` must land on ITS id. */
const CHILD = DEEP.childGateway;
if (CHILD === null) throw new Error('the inner router deep layer hangs no child gateway');
const CHILD_OCTET = octetOf(CHILD);
const CHILD_ID = computeDeepGatewayId(PLAYER.publicKeyHex, GATEWAY_ID, CHILD_OCTET);
// The child gateway's admin password is the SEED plaintext directly (a `ROUTER_ADMIN_
// PASSWORDS` pool member, disjoint from the workstation `WEAK_PASSWORDS` `recover`
// searches) — its base FS hashes it, exactly as the gateway-port-22 test uses
// `GATEWAY_ROOT_PW` for the inner gateway's own root login.
const CHILD_ROOT_PW = seedDeepGatewayAdminPw(PLAYER.publicKeyHex, GATEWAY_ID, CHILD_OCTET);

/** A root `nano /etc/iptables/rules.v4` edit on the gateway journal opening a NAT
 *  forward `2222 → <deep host>:22` — the opt-in that exposes the Layer-2 machine. */
const forwardPatch: OwnerPatchRow = {
  path: '/etc/iptables/rules.v4',
  content: `forward 2222 to ${DEEP.host.ip}:22`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-06-17T00:00:01.000Z',
  writer_key: PLAYER.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` tombstone on the gateway journal — replayed over its
 *  seeded base it bricks the gateway, taking the deep entrance dark. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-06-17T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
};

type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (
  patches: (query: { machine_id: string }) => Promise<PatchesResult> = async () => ({
    data: [forwardPatch],
    error: null,
  }),
  insert: (row: AuthSessionRow) => Promise<{ error: unknown }> = async () => ({ error: null }),
) => {
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(patches);
  const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(insert);
  const deps: AuthCreateSessionInnerGatewayDeps = { nonceStore: freshStore, findPatches, insertSession };
  return { deps, findPatches, insertSession };
};

const envelope = (over: Record<string, unknown>) =>
  signRequest(PLAYER, 'authCreateSessionInnerGateway', {
    session_id: 'ssh-guest-1',
    essid: ESSID,
    target: INNER.ip,
    username: 'guest',
    password: DEEP_GUEST.password,
    port: 2222,
    parent_session_id: 'sess-parent-1',
    source_ip: '192.168.0.5',
    ...over,
  });

describe('handleAuthCreateSessionInnerGateway — forward to the deep host', () => {
  it('lands a session on the Layer-2 NPC, authed against its own /etc/passwd', async () => {
    const { deps, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, userType: DEEP_GUEST.userType, machine_id: DEEP_ID },
    });
    // The journal it replays is the GATEWAY's (to read the forward + boot state)...
    expect(findPatches).toHaveBeenCalledWith({ machine_id: GATEWAY_ID });
    // ...but the SESSION lands on the deep host, with the server-derived userType,
    // and the parent hop + source IP flow through verbatim.
    expect(insertSession).toHaveBeenCalledWith({
      session_id: 'ssh-guest-1',
      player_key: PLAYER.publicKeyHex,
      machine_id: DEEP_ID,
      credentials: { username: 'guest', userType: DEEP_GUEST.userType },
      parent_session_id: 'sess-parent-1',
      source_ip: '192.168.0.5',
      kind: 'ssh',
      essid: ESSID,
    });
  });


  it('rejects a wrong password with 401 and inserts no session', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ password: 'not-the-password' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('rejects an unknown user with the same 401 (no account enumeration)', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ username: 'nobody' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a port with no matching forward as host_unreachable', async () => {
    const { deps, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(envelope({ port: 3333 }), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a forward that points at no deep host as host_unreachable', async () => {
    const strayForward: OwnerPatchRow = { ...forwardPatch, content: 'forward 2222 to 10.9.9.9:22' };
    const { deps, insertSession } = makeDeps(async () => ({ data: [strayForward], error: null }));

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a forward to a port the deep host does not serve as host_unreachable', async () => {
    const deadForward: OwnerPatchRow = {
      ...forwardPatch,
      content: `forward 2222 to ${DEEP.host.ip}:9999`,
    };
    const { deps, insertSession } = makeDeps(async () => ({ data: [deadForward], error: null }));

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

describe('handleAuthCreateSessionInnerGateway — forward to the deep child gateway', () => {
  /** A root edit on the gateway journal forwarding `2223 → <child gateway>:22` — the
   *  opt-in that exposes the deeper gateway (the chain door) to a reach. */
  const childForwardPatch: OwnerPatchRow = {
    ...forwardPatch,
    content: `forward 2223 to ${CHILD.ip}:22`,
  };

  it('lands a session on the child gateway, authed against its own admin password', async () => {
    const { deps, findPatches, insertSession } = makeDeps(async () => ({
      data: [childForwardPatch],
      error: null,
    }));

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ port: 2223, username: 'root', password: CHILD_ROOT_PW }),
      deps,
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, userType: 'root', machine_id: CHILD_ID },
    });
    // The journal it replays is still the GATEWAY's (forward + boot state)...
    expect(findPatches).toHaveBeenCalledWith({ machine_id: GATEWAY_ID });
    // ...but the session lands on the CHILD GATEWAY's deep id — not the gateway, not
    // the terminal NPC — with its root userType.
    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: CHILD_ID,
        credentials: { username: 'root', userType: 'root' },
      }),
    );
  });

  it('rejects a wrong child-gateway password with 401 and inserts no session', async () => {
    const { deps, insertSession } = makeDeps(async () => ({ data: [childForwardPatch], error: null }));

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ port: 2223, username: 'root', password: 'not-the-admin-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses a forward to a port the child gateway does not serve as host_unreachable', async () => {
    const deadChildForward: OwnerPatchRow = {
      ...forwardPatch,
      content: `forward 2223 to ${CHILD.ip}:9999`,
    };
    const { deps, insertSession } = makeDeps(async () => ({ data: [deadChildForward], error: null }));

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ port: 2223, username: 'root', password: CHILD_ROOT_PW }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

describe('handleAuthCreateSessionInnerGateway — depth-1 home (the inner router fronts no child)', () => {
  // A depth-1 home's inner router fronts a single TERMINAL layer, so a forward to where
  // a deeper home WOULD hang a child gateway points at nothing reachable — the reach is
  // refused even with the (would-be) child's correct admin password.
  const SHALLOW = playerWithNetworkDepth(1);
  const shallowHost = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(SHALLOW.publicKeyHex, ESSID).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on shallow LAN');
    return host;
  };
  const SHALLOW_INNER = shallowHost((host) => host.kind === 'router' && octetOf(host) !== 1);
  const SHALLOW_GATEWAY_ID = computeInnerGatewayId(SHALLOW.publicKeyHex, octetOf(SHALLOW_INNER));
  const WOULD_BE_CHILD = generateDeepLayer(
    SHALLOW.publicKeyHex,
    ESSID,
    { machineId: SHALLOW_GATEWAY_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (WOULD_BE_CHILD === null) throw new Error('expected a would-be child gateway to assert absence of');
  const WOULD_BE_CHILD_PW = seedDeepGatewayAdminPw(
    SHALLOW.publicKeyHex,
    SHALLOW_GATEWAY_ID,
    octetOf(WOULD_BE_CHILD),
  );
  const shallowChildForward: OwnerPatchRow = {
    path: '/etc/iptables/rules.v4',
    content: `forward 2223 to ${WOULD_BE_CHILD.ip}:22`,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-06-17T00:00:01.000Z',
    writer_key: SHALLOW.publicKeyHex,
  };

  it('refuses a forward to the would-be child gateway as host_unreachable', async () => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async () => ({
      data: [shallowChildForward],
      error: null,
    }));
    const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    }));
    const deps: AuthCreateSessionInnerGatewayDeps = {
      nonceStore: freshStore,
      findPatches,
      insertSession,
    };

    const result = await handleAuthCreateSessionInnerGateway(
      signRequest(SHALLOW, 'authCreateSessionInnerGateway', {
        session_id: 'ssh-shallow-1',
        essid: ESSID,
        target: SHALLOW_INNER.ip,
        username: 'root',
        password: WOULD_BE_CHILD_PW,
        port: 2223,
      }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

describe('handleAuthCreateSessionInnerGateway — chained reach down a deeper chain', () => {
  // A depth-3 home runs a gateway chain three deep: the inner router fronts an L2 child
  // gateway, which itself fronts an L3 child gateway (the terminal chain door). TWO
  // chained forwards expose the L3 gateway end-to-end — the inner forwards a port to the
  // L2 child, and the L2 child forwards that same port on to the L3 gateway's own sshd.
  // Logging in to the inner at that port should walk the chain and land on the L3 gateway.
  const DEEP3 = playerWithAllRouterChain(3);
  const deep3Host = (predicate: (host: LanHost) => boolean): LanHost => {
    const host = generateHomeLan(DEEP3.publicKeyHex, ESSID).hosts.find(predicate);
    if (host === undefined) throw new Error('no matching host on the depth-3 LAN');
    return host;
  };
  const INNER3 = deep3Host((host) => host.kind === 'router' && octetOf(host) !== 1);
  const INNER3_ID = computeInnerGatewayId(DEEP3.publicKeyHex, octetOf(INNER3));

  const L2 = generateDeepLayer(
    DEEP3.publicKeyHex,
    ESSID,
    { machineId: INNER3_ID, kind: 'router' },
    { hangsChild: true },
  );
  const L2CHILD = L2.childGateway;
  if (L2CHILD === null) throw new Error('the depth-3 inner router fronts no L2 child gateway');
  const L2CHILD_ID = computeDeepGatewayId(DEEP3.publicKeyHex, INNER3_ID, octetOf(L2CHILD));

  const L3 = generateDeepLayer(
    DEEP3.publicKeyHex,
    ESSID,
    { machineId: L2CHILD_ID, kind: 'router' },
    { hangsChild: true },
  );
  const L3CHILD = L3.childGateway;
  if (L3CHILD === null) throw new Error('the depth-3 L2 child fronts no L3 child gateway');
  const L3CHILD_ID = computeDeepGatewayId(DEEP3.publicKeyHex, L2CHILD_ID, octetOf(L3CHILD));
  const L3CHILD_PW = seedDeepGatewayAdminPw(DEEP3.publicKeyHex, L2CHILD_ID, octetOf(L3CHILD));

  const CHAINED_PORT = 2222;
  const innerForward: OwnerPatchRow = {
    path: '/etc/iptables/rules.v4',
    content: `forward ${CHAINED_PORT} to ${L2CHILD.ip}:${CHAINED_PORT}`,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-06-17T00:00:01.000Z',
    writer_key: DEEP3.publicKeyHex,
  };
  const l2Forward: OwnerPatchRow = {
    ...innerForward,
    content: `forward ${CHAINED_PORT} to ${L3CHILD.ip}:22`,
  };
  const l2Brick: OwnerPatchRow = {
    path: '/boot/vmlinuz',
    content: null,
    owner: 'root',
    permissions: null,
    node_type: null,
    updated_at: '2026-06-17T00:00:00.000Z',
    writer_key: DEEP3.publicKeyHex,
  };

  const chainDeps = (journals: Record<string, readonly OwnerPatchRow[]>) => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
      async (query) => ({ data: journals[query.machine_id] ?? [], error: null }),
    );
    const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    }));
    const deps: AuthCreateSessionInnerGatewayDeps = { nonceStore: freshStore, findPatches, insertSession };
    return { deps, findPatches, insertSession };
  };

  const chainEnvelope = (over: Record<string, unknown>) =>
    signRequest(DEEP3, 'authCreateSessionInnerGateway', {
      session_id: 'ssh-chain-1',
      essid: ESSID,
      target: INNER3.ip,
      username: 'root',
      password: L3CHILD_PW,
      port: CHAINED_PORT,
      ...over,
    });

  it('lands a session on the L3 gateway through two chained forwards', async () => {
    const { deps, insertSession } = chainDeps({
      [INNER3_ID]: [innerForward],
      [L2CHILD_ID]: [l2Forward],
      [L3CHILD_ID]: [],
    });

    const result = await handleAuthCreateSessionInnerGateway(chainEnvelope({}), deps);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, userType: 'root', machine_id: L3CHILD_ID },
    });
    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: L3CHILD_ID,
        credentials: { username: 'root', userType: 'root' },
      }),
    );
  });

  it('rejects a wrong password at the chain end with 401 and inserts no session', async () => {
    const { deps, insertSession } = chainDeps({
      [INNER3_ID]: [innerForward],
      [L2CHILD_ID]: [l2Forward],
      [L3CHILD_ID]: [],
    });

    const result = await handleAuthCreateSessionInnerGateway(
      chainEnvelope({ password: 'not-the-admin-pw' }),
      deps,
    );

    expect(result).toEqual({ status: 401, body: { error: 'invalid_credentials' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses the chained reach when an intermediate gateway is bricked', async () => {
    const { deps, insertSession } = chainDeps({
      [INNER3_ID]: [innerForward],
      [L2CHILD_ID]: [l2Forward, l2Brick],
      [L3CHILD_ID]: [],
    });

    const result = await handleAuthCreateSessionInnerGateway(chainEnvelope({}), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when an intermediate journal lookup fails', async () => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
      async (query) =>
        query.machine_id === L2CHILD_ID
          ? { data: null, error: new Error('db down') }
          : { data: [innerForward], error: null },
    );
    const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    }));
    const deps: AuthCreateSessionInnerGatewayDeps = { nonceStore: freshStore, findPatches, insertSession };

    const result = await handleAuthCreateSessionInnerGateway(chainEnvelope({}), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

describe('handleAuthCreateSessionInnerGateway — the seeded depth bounds the chain', () => {
  // PLAYER's home is depth-2: the inner router fronts the L2 child gateway, and the L2
  // child fronts a TERMINAL layer (no grandchild). A forward chain that tries to step
  // onto a THIRD gateway — where a deeper home WOULD hang one — reaches nothing: the walk
  // stops at the seeded depth even with a live forward pointed past it.
  const GRANDCHILD = generateDeepLayer(
    PLAYER.publicKeyHex,
    ESSID,
    { machineId: CHILD_ID, kind: 'router' },
    { hangsChild: true },
  ).childGateway;
  if (GRANDCHILD === null) throw new Error('expected a would-be grandchild gateway to assert absence of');

  const innerToChild: OwnerPatchRow = { ...forwardPatch, content: `forward 2222 to ${CHILD.ip}:2222` };
  const childToGrandchild: OwnerPatchRow = {
    ...forwardPatch,
    content: `forward 2222 to ${GRANDCHILD.ip}:22`,
  };

  it('refuses a forward that steps past the seeded depth onto a third gateway', async () => {
    const journals: Record<string, readonly OwnerPatchRow[]> = {
      [GATEWAY_ID]: [innerToChild],
      [CHILD_ID]: [childToGrandchild],
    };
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async (query) => ({
      data: journals[query.machine_id] ?? [],
      error: null,
    }));
    const insertSession = vi.fn<(row: AuthSessionRow) => Promise<{ error: unknown }>>(async () => ({
      error: null,
    }));
    const deps: AuthCreateSessionInnerGatewayDeps = { nonceStore: freshStore, findPatches, insertSession };

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({
        port: 2222,
        username: 'root',
        password: seedDeepGatewayAdminPw(PLAYER.publicKeyHex, CHILD_ID, octetOf(GRANDCHILD)),
      }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });
});

describe('handleAuthCreateSessionInnerGateway — the gateway itself (port 22)', () => {
  it('lands a session on the gateway when the port is its own sshd', async () => {
    const { deps, insertSession } = makeDeps(async () => ({ data: [], error: null }));

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ port: 22, username: 'root', password: GATEWAY_ROOT_PW }),
      deps,
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, userType: 'root', machine_id: GATEWAY_ID },
    });
    expect(insertSession).toHaveBeenCalledWith(
      expect.objectContaining({ machine_id: GATEWAY_ID, credentials: { username: 'root', userType: 'root' } }),
    );
  });
});

describe('handleAuthCreateSessionInnerGateway — guards', () => {
  it('refuses a login to a bricked gateway even when a live forward exists (the boot gate runs first)', async () => {
    // Journal carries BOTH the forward AND the brick: without the canBoot gate the
    // forward would resolve and the (valid) password would log in. The gate takes the
    // gateway dark first, so the deep entrance is refused before any password check.
    const { deps, insertSession } = makeDeps(async () => ({
      data: [forwardPatch, bootTombstone],
      error: null,
    }));

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the gateway journal lookup fails', async () => {
    const { deps, insertSession } = makeDeps(async () => ({ data: null, error: new Error('db down') }));

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('reports a server error when the session insert fails', async () => {
    const { deps } = makeDeps(undefined, async () => ({ error: new Error('insert failed') }));

    const result = await handleAuthCreateSessionInnerGateway(envelope({}), deps);

    expect(result).toEqual({ status: 500, body: { error: 'insert_failed' } });
  });

  it('refuses the edge .1 router as host_unreachable without reading any journal', async () => {
    const { deps, findPatches, insertSession } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(envelope({ target: EDGE.ip }), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
    expect(insertSession).not.toHaveBeenCalled();
  });

  it('refuses an ordinary sibling machine as host_unreachable without reading any journal', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(envelope({ target: SIBLING.ip }), deps);

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('refuses a target that is not a host on the LAN as host_unreachable', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ target: '192.168.250.250' }),
      deps,
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without reading any journal', async () => {
    const { deps, findPatches } = makeDeps();
    const signed = envelope({});
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleAuthCreateSessionInnerGateway(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleAuthCreateSessionInnerGateway(
      envelope({ player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const { deps, findPatches } = makeDeps();
    const signed = signRequest(PLAYER, 'authCreateSessionInnerGateway', {
      session_id: 'ssh-guest-1',
      essid: ESSID,
      username: 'guest',
      password: DEEP_GUEST.password,
      port: 2222,
    });

    const result = await handleAuthCreateSessionInnerGateway(signed, deps);

    expect(result.status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });
});
