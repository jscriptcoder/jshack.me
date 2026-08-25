import { describe, expect, it, vi } from 'vitest';
import {
  handleHydraCrackInnerGateway,
  type HydraCrackInnerGatewayDeps,
} from './hydraCrackInnerGateway';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { computeDeepGatewayId, computeInnerGatewayId } from '../identity/router';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import {
  buildDeepHostFs,
  generateDeepLayer,
  seedNetworkDepth,
} from '../generation/generateDeepLayer';
import { seedDeepGatewayAdminPw, seedInnerGatewayAdminPw } from '../generation/routerFs';
import { accountIn } from './passwdAccount';
import { md5 } from '../generation/md5';
import { ALL_GENERATED_PASSWORDS } from '../generation/passwordPools';
import { formatWordlist, WORDLIST_PATH } from '../wordlist/defaultWordlist';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asAbsPath, asGameTime } from '../types';
import { hostMachineId } from '../generation/remoteHostId';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadResult } from '../patches/appendMachineLog';
import type { ListPathPatchesResult, PathPatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';
import { deepStoreFixture, type DeepStoreFixture } from '../../test/factories/lanStore';
import type { Directory } from '../filesystem/types';

/**
 * `handleHydraCrackInnerGateway` is hydra pointed THROUGH a NAT forward on an inner
 * gateway — the deep layer's only credential door.
 *
 * Every deep host runs sshd and carries a guest account drawn from the crackable pool,
 * so the layer is furnished to be entered by a wordlist. But its addresses are absent
 * from `generateHomeLan().hosts`, so no shell can name one, and rooting the gateway
 * yields the forward table rather than any password. Without this seam the layer is
 * furnished and sealed.
 *
 * It mirrors `ssh -p <fwd> <inner>` deliberately, because hydra reporting a credential
 * `ssh` will not accept is the failure this whole layer exists to prevent: the same
 * chain walk by destination port, the same boot gate at every hop, and the same trace.
 *
 * The address in that trace is decided by the ROUTE, not by where the attacker stands:
 * NAT means the deep box only ever sees the fronting gateway's inner `.1`, whoever is
 * behind it.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const octetOf = (host: LanHost): number => Number(host.ip.split('.')[3]);

/** A network seeded to EXACTLY `depth` layers. Depth is a per-network roll, so pick
 *  deterministically rather than hoping an arbitrary ESSID lands where a test needs it. */
const networkWithDepth = (depth: number): string => {
  const found = crackableEssidPool.find((essid) => seedNetworkDepth(essid) === depth);
  if (found === undefined) throw new Error(`no network seeds depth ${depth}`);
  return found;
};

const ESSID = networkWithDepth(2);
const ATTACKER = generateIdentity();
const ATTACKER_MACHINE = computeWorkstationId('skylab', ATTACKER.publicKeyHex);

/** A network seeded to EXACTLY `depth` layers whose entire gateway chain is ROUTERS, so
 *  the chain runs the full depth. A switch caps it short (it forwards nothing), so depth
 *  alone does not guarantee the hops a chained test needs. */
const networkWithAllRouterChain = (depth: number): string => {
  const isAllRouterChain = (essid: string): boolean => {
    if (seedNetworkDepth(essid) !== depth) return false;
    const inner = generateHomeLan(essid).hosts.find(
      (host) => host.kind === 'router' && octetOf(host) !== 1,
    );
    if (inner === undefined) return false;
    let parentId = computeInnerGatewayId(essid, octetOf(inner));
    for (let position = 1; position < depth; position++) {
      const child = generateDeepLayer(
        essid,
        { machineId: parentId, kind: 'router' },
        { hangsChild: true },
      ).childGateway;
      if (child === null || child.kind !== 'router') return false;
      parentId = computeDeepGatewayId(parentId, octetOf(child));
    }
    return true;
  };
  const found = crackableEssidPool.find(isAllRouterChain);
  if (found === undefined) throw new Error(`no network seeds an all-router depth-${depth} chain`);
  return found;
};

const lanHostOn = (essid: string, predicate: (host: LanHost) => boolean): LanHost => {
  const host = generateHomeLan(essid).hosts.find(predicate);
  if (host === undefined) throw new Error('no matching host on LAN');
  return host;
};

const INNER = lanHostOn(ESSID, (host) => host.kind === 'router' && octetOf(host) !== 1);
const GATEWAY_ID = computeInnerGatewayId(ESSID, octetOf(INNER));

const DEEP = generateDeepLayer(ESSID, { machineId: GATEWAY_ID, kind: 'router' });
const DEEP_FS: Directory = buildDeepHostFs(ESSID, DEEP.host);
const DEEP_ID = hostMachineId(DEEP.host, ESSID);

/** Recover a generated account's plaintext password — the seeded weak pool is exported
 *  exactly so a credential test can match an md5 hash back to its plaintext. */
const recover = (fs: Directory, username: string): { password: string; userType: string } => {
  const account = accountIn(fs, username);
  if (account === null) throw new Error(`no ${username} account`);
  const password = ALL_GENERATED_PASSWORDS.find((candidate) => md5(candidate) === account.hash);
  if (password === undefined) throw new Error(`cannot recover ${username} password`);
  return { password, userType: account.userType };
};

const DEEP_GUEST = recover(DEEP_FS, 'guest');

/** The gateway's OWN sshd — the port that reaches the gateway rather than anything
 *  behind it. Its admin password is the seed plaintext directly (a router-admin pool
 *  member, disjoint from the account pools `recover` searches). */
const GATEWAY_SSH_PORT = 22;
const GATEWAY_ROOT_PW = seedInnerGatewayAdminPw(ESSID, octetOf(INNER));

/** The public-facing port the player opened on their gateway. Deliberately not 22: on
 *  this address 22 is the GATEWAY's own sshd, a different machine entirely. */
const FORWARD_PORT = 2222;

/** A root `nano /etc/iptables/rules.v4` edit on the gateway journal opening a NAT
 *  forward onto the deep host — the opt-in that exposes the layer at all. */
const forwardPatch: OwnerPatchRow = {
  path: '/etc/iptables/rules.v4',
  content: `forward ${FORWARD_PORT} to ${DEEP.host.ip}:22`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-08-11T10:00:00.000Z',
  writer_key: ATTACKER.publicKeyHex,
};

/** A root `rm /boot/vmlinuz` tombstone — replayed over a gateway's seeded base it
 *  bricks the box, taking everything behind it dark. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-08-11T10:00:00.000Z',
  writer_key: ATTACKER.publicKeyHex,
};

// 2026-08-11 11:04:07 UTC — the clock every trace line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 11, 11, 4, 7);

/** One line of the sweep as the DEEP box recorded it. The address is always the
 *  fronting gateway's `.1` — the only address NAT ever shows it. */
const traceLineOn =
  (hostname: string, fromIp: string) => (outcome: 'success' | 'failure', user: string) =>
    formatSshdAuthLine({
      outcome,
      user,
      fromIp,
      hostname,
      time: asGameTime(FIXED_NOW),
      pid: derivePid(FIXED_NOW),
    });

const deepTraceLine = traceLineOn(DEEP.host.hostname, `${DEEP.subnet}.1`);

const wordlistRow = (words: readonly string[]): PathPatchRow => ({
  content: formatWordlist(words),
  updated_at: '2026-08-11T11:00:00.000Z',
  writer_key: ATTACKER.publicKeyHex,
});

type DepOverrides = Partial<HydraCrackInnerGatewayDeps> & {
  /** The wordlist on the box the caller is standing on. `null` means no file. */
  readonly wordlist?: readonly string[] | null;
  /** The inner gateway's journal — where the forward lives, and the boot state that
   *  decides whether the entrance is dark at all. */
  readonly gatewayPatches?: readonly OwnerPatchRow[];
};

const depsWith = (over: DepOverrides = {}): HydraCrackInnerGatewayDeps => {
  const { wordlist = [DEEP_GUEST.password], gatewayPatches = [forwardPatch], ...rest } = over;
  return {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findActiveSession: async () => ({ data: null, error: null }),
    findPatches: async () => ({ data: gatewayPatches, error: null }),
    listPathPatches: async (): Promise<ListPathPatchesResult> => ({
      data: wordlist === null ? [] : [wordlistRow(wordlist)],
      error: null,
    }),
    readAuthLog: async (): Promise<MachineLogReadResult> => ({ data: null, error: null }),
    upsertPatch: vi.fn(async () => ({ error: null })),
    ...rest,
  };
};

const envelope = (over: Record<string, unknown> = {}) =>
  signRequest(ATTACKER, 'hydraCrackInnerGateway', {
    essid: ESSID,
    target: INNER.ip,
    service: 'ssh',
    port: FORWARD_PORT,
    caller_machine_id: ATTACKER_MACHINE,
    ...over,
  });

describe('handleHydraCrackInnerGateway', () => {
  it('sweeps the deep box behind the forward, not the gateway fronting it', async () => {
    const { status, body } = await handleHydraCrackInnerGateway(envelope(), depsWith());

    // The deep host's guest password, recovered from ITS /etc/passwd. The gateway's own
    // admin password is not in this wordlist, so a sweep that attacked the gateway
    // instead would report nothing cracked.
    expect(status).toBe(200);
    expect(body).toEqual({
      port: FORWARD_PORT,
      cracked: [{ username: 'guest', password: DEEP_GUEST.password }],
      wordlistFound: true,
    });
  });

  it('attacks the gateway itself on its own port, and records nothing there', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    const { status, body } = await handleHydraCrackInnerGateway(
      envelope({ port: GATEWAY_SSH_PORT }),
      depsWith({ wordlist: [GATEWAY_ROOT_PW], upsertPatch }),
    );

    // A port the gateway serves itself is the gateway, not a forward into the layer
    // behind it — the same rule `ssh` routes by.
    expect(status).toBe(200);
    expect(body).toEqual({
      port: GATEWAY_SSH_PORT,
      cracked: [{ username: 'root', password: GATEWAY_ROOT_PW }],
      wordlistFound: true,
    });
    // No trace, matching `ssh`: the gateway is a Layer-1 box reached directly, so the
    // address it saw is the caller's LAN address — which this seam is never told and
    // would have to invent. The own-LAN sweep owns that target, and traces it truthfully.
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes one auth.log line per password tried, at the fronting gateway’s address', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    await handleHydraCrackInnerGateway(
      // One account named, so the wall below is exactly the passwords tried against it —
      // a whole-box sweep writes the same lines for every account it enumerates.
      envelope({ username: 'guest' }),
      depsWith({ wordlist: ['hunter2', DEEP_GUEST.password], upsertPatch }),
    );

    // The address is the gateway's inner `.1`, not the attacker's: NAT is all the deep
    // box is shown. The lines land on the DEEP box, never on the gateway fronting it.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: DEEP_ID,
        path: asAbsPath(AUTH_LOG_PATH),
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        content: `${[deepTraceLine('failure', 'guest'), deepTraceLine('success', 'guest')].join('\n')}\n`,
      }),
    );
  });

  it('refuses a service the reached port is not running, without touching the wordlist', async () => {
    const listPathPatches = vi.fn(async () => ({ data: [], error: null }));

    const result = await handleHydraCrackInnerGateway(
      envelope({ service: 'ftp' }),
      depsWith({ listPathPatches }),
    );

    // The forward reaches the deep box's sshd. Asking for ftp on that door is not a
    // sweep that finds nothing — it is a service that is not there.
    expect(result).toEqual({ status: 404, body: { error: 'service_not_running' } });
    expect(listPathPatches).not.toHaveBeenCalled();
  });

  it('reports a missing wordlist as a real state, not an empty sweep', async () => {
    const { status, body } = await handleHydraCrackInnerGateway(
      envelope(),
      depsWith({ wordlist: null }),
    );

    // A hardened target and a deleted wordlist must never look the same to the player.
    expect(status).toBe(200);
    expect(body).toEqual({ port: FORWARD_PORT, cracked: [], wordlistFound: false });
  });

  it('reads the wordlist from the box the caller is standing on', async () => {
    const listPathPatches = vi.fn(async () => ({ data: [wordlistRow([DEEP_GUEST.password])], error: null }));

    await handleHydraCrackInnerGateway(envelope(), depsWith({ listPathPatches }));

    // The wordlist belongs to the box you are on, not to the target and not to you —
    // a rooted box with a fat list is worth standing on.
    expect(listPathPatches).toHaveBeenCalledWith({
      machine_id: ATTACKER_MACHINE,
      path: WORDLIST_PATH,
    });
  });

  it('reports a wordlist it could not read as a server error, not an empty sweep', async () => {
    const result = await handleHydraCrackInnerGateway(
      envelope(),
      depsWith({
        listPathPatches: async (): Promise<ListPathPatchesResult> => ({
          data: null,
          error: new Error('store down'),
        }),
      }),
    );

    expect(result).toEqual({ status: 500, body: { error: 'wordlist_lookup_failed' } });
  });

  it('writes nothing when the wordlist is empty — nothing was tried', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    const { body } = await handleHydraCrackInnerGateway(
      envelope(),
      depsWith({ wordlist: [], upsertPatch }),
    );

    // An empty list is a file that exists and holds nothing: a real sweep of zero
    // passwords, which the target has no reason to have noticed.
    expect(body).toEqual({ port: FORWARD_PORT, cracked: [], wordlistFound: true });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller holding no session on the machine they name', async () => {
    const findPatches = vi.fn(async () => ({ data: [forwardPatch], error: null }));

    const result = await handleHydraCrackInnerGateway(
      envelope({ caller_machine_id: 'workstation-not-mine' }),
      depsWith({ findPatches }),
    );

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without touching the gateway', async () => {
    const findPatches = vi.fn(async () => ({ data: [forwardPatch], error: null }));
    const signed = envelope();

    const result = await handleHydraCrackInnerGateway(
      { ...signed, payload: `${signed.payload} ` },
      depsWith({ findPatches }),
    );

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a request that names no port, before any lookup', async () => {
    const findPatches = vi.fn(async () => ({ data: [forwardPatch], error: null }));
    const signed = signRequest(ATTACKER, 'hydraCrackInnerGateway', {
      essid: ESSID,
      target: INNER.ip,
      service: 'ssh',
      caller_machine_id: ATTACKER_MACHINE,
    });

    // Without a port there is no forward to follow: the gateway itself is an own-LAN
    // target, and this action has nothing to resolve.
    const { status } = await handleHydraCrackInnerGateway(signed, depsWith({ findPatches }));

    expect(status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects a payload that claims an identity', async () => {
    // The caller is the verified signature, never a field. A request that names a
    // player_key is refused outright rather than having it quietly ignored.
    const { status } = await handleHydraCrackInnerGateway(
      envelope({ player_key: 'somebody-else' }),
      depsWith(),
    );

    expect(status).toBe(400);
  });

  it('goes dark when the gateway fronting the layer is bricked', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    const result = await handleHydraCrackInnerGateway(
      envelope(),
      depsWith({ gatewayPatches: [forwardPatch, bootTombstone], upsertPatch }),
    );

    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('handleHydraCrackInnerGateway — down a chain of forwards', () => {
  // A depth-3 network runs a gateway chain three deep: the inner router fronts an L2
  // child gateway, which fronts an L3 gateway. TWO chained forwards expose the L3
  // gateway end-to-end — the inner forwards a port to the L2 child, and the L2 child
  // forwards that same port on to the L3 gateway's own sshd. One hop would not prove the
  // walk recurses; a bricked middle hop is the reason it must.
  const ESSID3 = networkWithAllRouterChain(3);
  const INNER3 = lanHostOn(ESSID3, (host) => host.kind === 'router' && octetOf(host) !== 1);
  const INNER3_ID = computeInnerGatewayId(ESSID3, octetOf(INNER3));

  const L2 = generateDeepLayer(ESSID3, { machineId: INNER3_ID, kind: 'router' }, { hangsChild: true });
  const L2CHILD = L2.childGateway;
  if (L2CHILD === null) throw new Error('the depth-3 inner router fronts no L2 child gateway');
  const L2CHILD_ID = computeDeepGatewayId(INNER3_ID, octetOf(L2CHILD));

  const L3 = generateDeepLayer(ESSID3, { machineId: L2CHILD_ID, kind: 'router' }, { hangsChild: true });
  const L3CHILD = L3.childGateway;
  if (L3CHILD === null) throw new Error('the depth-3 L2 child fronts no L3 child gateway');
  const L3CHILD_ID = computeDeepGatewayId(L2CHILD_ID, octetOf(L3CHILD));
  const L3CHILD_PW = seedDeepGatewayAdminPw(L2CHILD_ID, octetOf(L3CHILD));

  const CHAINED_PORT = 2222;
  const innerForward: OwnerPatchRow = {
    ...forwardPatch,
    content: `forward ${CHAINED_PORT} to ${L2CHILD.ip}:${CHAINED_PORT}`,
  };
  const l2Forward: OwnerPatchRow = {
    ...forwardPatch,
    content: `forward ${CHAINED_PORT} to ${L3CHILD.ip}:22`,
  };

  const chainDeps = (
    journals: Record<string, readonly OwnerPatchRow[]>,
    over: Partial<HydraCrackInnerGatewayDeps> = {},
  ) =>
    depsWith({
      wordlist: [L3CHILD_PW],
      findPatches: async (query) => ({ data: journals[query.machine_id] ?? [], error: null }),
      ...over,
    });

  const chainEnvelope = () =>
    signRequest(ATTACKER, 'hydraCrackInnerGateway', {
      essid: ESSID3,
      target: INNER3.ip,
      service: 'ssh',
      port: CHAINED_PORT,
      caller_machine_id: ATTACKER_MACHINE,
    });

  it('cracks a gateway two forwards down, traced at the layer it sits on', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    const { status, body } = await handleHydraCrackInnerGateway(
      chainEnvelope(),
      chainDeps({ [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2Forward] }, { upsertPatch }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      port: CHAINED_PORT,
      cracked: [{ username: 'root', password: L3CHILD_PW }],
      wordlistFound: true,
    });
    // The address is the `.1` of the layer the L3 gateway stands on — the hop it was
    // reached through, not the one the sweep started from.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: L3CHILD_ID,
        content: `${traceLineOn(L3CHILD.hostname, `${L3.subnet}.1`)('success', 'root')}\n`,
      }),
    );
  });

  it('goes dark below a bricked intermediate, leaving no trace anywhere', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));

    const result = await handleHydraCrackInnerGateway(
      chainEnvelope(),
      chainDeps(
        { [INNER3_ID]: [innerForward], [L2CHILD_ID]: [l2Forward, bootTombstone] },
        { upsertPatch },
      ),
    );

    // The L3 gateway is intact and its password is in the wordlist. It is unreachable
    // anyway, because the box that forwards to it cannot boot.
    expect(result).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

// ─── the other kind of door on the same layer ───
//
// A store has no accounts at all: its secret belongs to the SERVICE, so the sweep has
// nothing to enumerate and a password with no login to report. Nothing below is
// redis-specific machinery — the catalog row carries `secretOn`, and this handler was
// already generic over it — which is exactly why it needs saying out loud.

describe('a store on the deep layer', () => {
  const LOCKED = deepStoreFixture({ locked: true });
  const OPEN = deepStoreFixture({ locked: false });

  /** Neither the store's own port nor 22: what a player opened on the gateway has
   *  nothing to do with what the daemon holds behind it. */
  const STORE_FORWARD_PORT = 36379;

  const forwardOnto = (fixture: DeepStoreFixture): OwnerPatchRow => ({
    ...forwardPatch,
    content: `forward ${STORE_FORWARD_PORT} to ${fixture.layer.host.ip}:${fixture.port}`,
  });

  const sweepStore = async (
    fixture: DeepStoreFixture,
    over: DepOverrides = {},
  ) =>
    handleHydraCrackInnerGateway(
      await signRequest(ATTACKER, 'hydraCrackInnerGateway', {
        essid: fixture.essid,
        target: fixture.gateway.ip,
        service: 'redis',
        port: STORE_FORWARD_PORT,
        caller_machine_id: ATTACKER_MACHINE,
      }),
      depsWith({ gatewayPatches: [forwardOnto(fixture)], ...over }),
    );

  it('reports the store password with no login field at all', async () => {
    const password = LOCKED.password;
    if (password === null) throw new Error('the locked fixture is not locked');

    const { status, body } = await sweepStore(LOCKED, { wordlist: ['hunter2', password] });

    // No `username` key, rather than an empty one: a blank column reads as an account
    // whose name was lost, and this door never had one to lose.
    expect(status).toBe(200);
    expect(body).toEqual({
      port: STORE_FORWARD_PORT,
      cracked: [{ password }],
      wordlistFound: true,
    });
  });

  it('answers an OPEN deep store as open access rather than as an empty sweep', async () => {
    const { status, body } = await sweepStore(OPEN, { wordlist: ['hunter2'] });

    // Reporting nothing found would tell the player the store held, when in fact it was
    // never shut — and four stores in ten are never shut.
    expect(status).toBe(404);
    expect(body).toEqual({ error: 'no_password_set' });
  });

  it('finds nothing when the store password is outside the caller wordlist', async () => {
    const { status, body } = await sweepStore(LOCKED, { wordlist: ['hunter2', 'letmein'] });

    // Membership in the file is the only thing that decides it, at depth as on the LAN.
    expect(status).toBe(200);
    expect(body).toEqual({ port: STORE_FORWARD_PORT, cracked: [], wordlistFound: true });
  });

  it('refuses the store port on a gateway that forwards it nowhere', async () => {
    const { status } = await sweepStore(LOCKED, { gatewayPatches: [] });

    // Without the forward the deep box has no address anyone can name, so there is
    // nothing on that port to attack.
    expect(status).toBe(404);
  });

  it('records the sweep on the DEEP box, at the address NAT showed it', async () => {
    const password = LOCKED.password;
    if (password === null) throw new Error('the locked fixture is not locked');
    const upsertPatch = vi.fn(async () => ({ error: null }));

    await sweepStore(LOCKED, { wordlist: [password], upsertPatch });

    // The store's own log, not `auth.log`: the secret belongs to the service, so the
    // daemon that refused it is the one that writes it down.
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: LOCKED.machineId,
        content: expect.stringContaining(`Client ${LOCKED.natIp} authenticated successfully`),
      }),
    );
  });
});
