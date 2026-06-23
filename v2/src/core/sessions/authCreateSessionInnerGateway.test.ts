import { describe, expect, it, vi } from 'vitest';
import {
  handleAuthCreateSessionInnerGateway,
  type AuthCreateSessionInnerGatewayDeps,
} from './authCreateSessionInnerGateway';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { generateDeepLayer, buildDeepHostFs, DEEP_LAYER_INDEX } from '../generation/generateDeepLayer';
import { computeInnerGatewayId } from '../identity/router';
import { seedInnerGatewayAdminPw } from '../generation/routerFs';
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
const PLAYER = generateIdentity();

const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

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

const DEEP = generateDeepLayer(PLAYER.publicKeyHex, ESSID, DEEP_LAYER_INDEX);
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
