import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrackPublic, type HydraCrackPublicDeps } from './hydraCrackPublic';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { computeApGatewayId } from '../identity/router';
import { generateHomeLan } from '../generation/generateHomeLan';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { seedApGatewayAdminPw, seedApGatewayHostname } from '../generation/routerFs';
import { WORDLIST_PATH, formatWordlist } from '../wordlist/defaultWordlist';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import { asAbsPath, asGameTime } from '../types';
import type { ApNetworkLookup, NatOccupantRow } from '../network/resolvePublicTarget';
import type { LanLeaseRow } from '../network/lanAddress';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { MachineLogReadResult } from '../patches/appendMachineLog';
import type { ListPathPatchesResult, PathPatchRow, PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleHydraCrackPublic` is hydra pointed at an address outside the player's own
 * generated world — the first credential the credential layer lets anyone earn
 * against a box that belongs to somebody else.
 *
 * A public IP names an ACCESS POINT, and its default port is the gateway's own
 * sshd, so a bare `hydra <public ip>` attacks the shared AP gateway rather than any
 * player's workstation. That is the best root target in the game by design, and it
 * is reached through the SAME resolver `ssh` authenticates against, so a password
 * this reports is one `ssh` then accepts.
 *
 * Two things separate it from the own-LAN sweep. The trace is written under the
 * TARGET's log-writer key rather than the attacker's, because the system owns its
 * logs and two attackers must not overwrite each other's lines. And the source IP
 * is SERVER-derived from the attacker's verified key — a cross-player log entry is
 * evidence, so the address in it is never a client claim.
 *
 * The wordlist is still the one on the box the player is standing on, and standing
 * somewhere the server cannot place on the player's own network is refused rather
 * than traced to a guessed address.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

const ATTACKER = generateIdentity();
const HOME_ESSID = 'BEAN-THERE-WIFI';
const ATTACKER_MACHINE = computeWorkstationId('skylab', ATTACKER.publicKeyHex);
// The attacker's own home public IP, as the server resolves it from their owner
// key. Server-derived; NEVER the client-supplied address.
const ATTACKER_PUBLIC_IP = '198.51.100.22';

// The stranger's access point: a different ESSID, reached only by its public IP.
const TARGET_IP = '203.0.113.7';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const ADMIN_PW = seedApGatewayAdminPw(TARGET_ESSID);
const GATEWAY_HOSTNAME = seedApGatewayHostname(TARGET_ESSID);
const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };
// Somebody who actually lives on the stranger's AP. The gateway is ownerless, so its
// log accretes under the lowest-octet lease holder there — never the attacker's key.
const RESIDENT = generateIdentity();

// 2026-08-09 11:04:07 UTC — the clock every trace line here is stamped with.
const FIXED_NOW = Date.UTC(2026, 7, 9, 11, 4, 7);

/** A box on the attacker's OWN LAN — a legitimate place to launch from, since
 *  everything on their home network leaves through their home public IP. */
const ownLanHost = () => {
  const host = generateHomeLan(HOME_ESSID).hosts.find((candidate) => candidate.kind === 'machine');
  if (host === undefined) throw new Error('no machine on home LAN');
  return host;
};

/** A root `rm /boot/vmlinuz` tombstone on the GATEWAY's journal — replayed over its
 *  seeded base it deletes the kernel, taking the whole public IP dark. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-08-09T10:00:00.000Z',
  writer_key: ATTACKER.publicKeyHex,
};

const wordlistRow = (words: readonly string[], over: Partial<PathPatchRow> = {}): PathPatchRow => ({
  content: formatWordlist(words),
  updated_at: '2026-08-09T11:00:00.000Z',
  writer_key: ATTACKER.publicKeyHex,
  ...over,
});

type DepOverrides = Partial<HydraCrackPublicDeps> & {
  /** The wordlist on the box the caller is standing on. `null` means no file. */
  readonly wordlist?: readonly string[] | null;
  readonly gatewayPatches?: readonly OwnerPatchRow[];
};

const depsWith = (over: DepOverrides = {}): HydraCrackPublicDeps => {
  const { wordlist = [ADMIN_PW], gatewayPatches = [], ...rest } = over;
  return {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findNetworkByPublicIp: async () => ({ data: REGISTERED, error: null }),
    findPatches: async () => ({ data: gatewayPatches, error: null }),
    listOccupantsByEssid: async () => ({
      data: [] as readonly NatOccupantRow[],
      error: null,
    }),
    listLeasesByEssid: async () => ({
      data: [{ owner_key: RESIDENT.publicKeyHex, octet: 84 }] as readonly LanLeaseRow[],
      error: null,
    }),
    findActiveSession: async () => ({ data: null, error: null }),
    listPathPatches: async (): Promise<ListPathPatchesResult> => ({
      data: wordlist === null ? [] : [wordlistRow(wordlist)],
      error: null,
    }),
    findHomeNetworkByOwnerKey: async () => ({
      data: { public_ip: ATTACKER_PUBLIC_IP },
      error: null,
    }),
    readAuthLog: async (): Promise<MachineLogReadResult> => ({ data: null, error: null }),
    upsertPatch: async () => ({ error: null }),
    ...rest,
  };
};

const envelope = (over: Record<string, unknown> = {}) =>
  signRequest(ATTACKER, 'hydraCrackPublic', {
    essid: HOME_ESSID,
    target: TARGET_IP,
    service: 'ssh',
    caller_machine_id: ATTACKER_MACHINE,
    ...over,
  });

/** The line the gateway's own log records for one attempt. */
const traceLine = (outcome: 'success' | 'failure', user: string) =>
  formatSshdAuthLine({
    outcome,
    user,
    fromIp: ATTACKER_PUBLIC_IP,
    hostname: GATEWAY_HOSTNAME,
    time: asGameTime(FIXED_NOW),
    pid: derivePid(FIXED_NOW),
  });

describe('handleHydraCrackPublic', () => {
  it('cracks the gateway behind a stranger public IP when its admin password is in the wordlist', async () => {
    const { status, body } = await handleHydraCrackPublic(envelope(), depsWith());

    expect(status).toBe(200);
    expect(body).toEqual({
      port: 22,
      cracked: [{ username: 'root', password: ADMIN_PW }],
      wordlistFound: true,
    });
  });

  it('reports nothing cracked when the wordlist does not hold the admin password', async () => {
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({ wordlist: ['hunter2', 'letmein'] }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ port: 22, cracked: [], wordlistFound: true });
  });

  it('writes one auth.log line per password TRIED, at the server-derived source IP', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    await handleHydraCrackPublic(
      envelope(),
      depsWith({ wordlist: ['hunter2', ADMIN_PW], upsertPatch }),
    );

    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        machine_id: AP_GATEWAY_ID,
        path: asAbsPath(AUTH_LOG_PATH),
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
        // Trailing newline: the log primitive terminates every line, as a log file does.
        content: `${[traceLine('failure', 'root'), traceLine('success', 'root')].join('\n')}\n`,
      }),
    );
  });

  it('never writes the trace under the attacker key — the system owns its logs', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    await handleHydraCrackPublic(envelope(), depsWith({ upsertPatch }));

    const [row] = upsertPatch.mock.calls[0] as unknown as [PatchRow];
    expect(row.writer_key).not.toBe(ATTACKER.publicKeyHex);
  });

  it('trusts no client-supplied source IP for the trace', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    await handleHydraCrackPublic(
      envelope({ source_ip: '10.0.0.9' }),
      depsWith({ upsertPatch }),
    );

    const [row] = upsertPatch.mock.calls[0] as unknown as [PatchRow];
    expect(row.content).toContain(ATTACKER_PUBLIC_IP);
    expect(row.content).not.toContain('10.0.0.9');
  });

  it('refuses a public IP no access point bears, and writes no trace', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({ findNetworkByPublicIp: async () => ({ data: null, error: null }), upsertPatch }),
    );

    expect({ status, body }).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a bricked gateway before attacking it, and writes no trace', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({ gatewayPatches: [bootTombstone], upsertPatch }),
    );

    expect({ status, body }).toEqual({ status: 404, body: { error: 'host_unreachable' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a missing wordlist as a real state rather than a hardened target', async () => {
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({ wordlist: null }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({ port: 22, cracked: [], wordlistFound: false });
  });

  it('reads the wordlist from the machine the caller is standing on', async () => {
    const listPathPatches = vi.fn(async (): Promise<ListPathPatchesResult> => ({
      data: [wordlistRow([ADMIN_PW])],
      error: null,
    }));
    await handleHydraCrackPublic(envelope(), depsWith({ listPathPatches }));

    expect(listPathPatches).toHaveBeenCalledWith({
      machine_id: ATTACKER_MACHINE,
      path: WORDLIST_PATH,
    });
  });

  it('lets a player attack from a box on their own LAN, since it leaves by their own address', async () => {
    const standing = ownLanHost();
    const { status, body } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: machineIdForLanHost(standing, HOME_ESSID) }),
      depsWith({ findActiveSession: async () => ({ data: { userType: 'root', essid: HOME_ESSID }, error: null }) }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      port: 22,
      cracked: [{ username: 'root', password: ADMIN_PW }],
      wordlistFound: true,
    });
  });

  it('refuses a caller standing somewhere it cannot place on their own network', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: 'workstation-somebody-else' }),
      depsWith({
        findActiveSession: async () => ({ data: { userType: 'guest', essid: 'ELSEWHERE' }, error: null }),
        upsertPatch,
      }),
    );

    expect({ status, body }).toEqual({ status: 403, body: { error: 'caller_not_on_lan' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller holding no session on the machine they name', async () => {
    const { status, body } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: 'workstation-not-mine' }),
      depsWith(),
    );

    expect({ status, body }).toEqual({ status: 403, body: { error: 'no_session' } });
  });
  it('sweeps only the account named, when one is named', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { body } = await handleHydraCrackPublic(
      envelope({ username: 'nobody' }),
      depsWith({ upsertPatch }),
    );

    // The gateway is root-only, so naming any other account attacks nothing at all —
    // the same silence a real sweep gives, revealing no account list.
    expect(body).toEqual({ port: 22, cracked: [], wordlistFound: true });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('resolves the target the caller actually named', async () => {
    const findNetworkByPublicIp = vi.fn(async () => ({ data: REGISTERED, error: null }));
    await handleHydraCrackPublic(envelope(), depsWith({ findNetworkByPublicIp }));

    expect(findNetworkByPublicIp).toHaveBeenCalledWith(TARGET_IP);
  });

  it('refuses when the target is not running the service asked for, and writes no trace', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope({ service: 'ftp' }),
      depsWith({ upsertPatch }),
    );

    expect({ status, body }).toEqual({ status: 404, body: { error: 'service_not_running' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('reports a wordlist the store could not read as a failure, not as an empty list', async () => {
    // Distinct from "no wordlist": one is a real state of the box, the other means
    // the player should retry. Collapsing them would teach a player to go curate a
    // list that was never the problem.
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({
        listPathPatches: async (): Promise<ListPathPatchesResult> => ({
          data: null,
          error: new Error('store down'),
        }),
      }),
    );

    expect({ status, body }).toEqual({ status: 500, body: { error: 'wordlist_lookup_failed' } });
  });

  it('writes nothing when the wordlist is empty — nothing was tried', async () => {
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({ wordlist: [], upsertPatch }),
    );

    expect(body).toEqual({ port: 22, cracked: [], wordlistFound: true });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('keeps no log on an access point nobody has ever leased an address on', async () => {
    // The gateway is ownerless, so its log has to accrete under a STABLE key or a
    // later row silently erases an earlier one. With no lease there is no such key,
    // and the AP keeps no log rather than inventing one.
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope(),
      depsWith({
        listLeasesByEssid: async () => ({ data: [] as readonly LanLeaseRow[], error: null }),
        upsertPatch,
      }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      port: 22,
      cracked: [{ username: 'root', password: ADMIN_PW }],
      wordlistFound: true,
    });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('rejects a tampered envelope without touching the target', async () => {
    const findNetworkByPublicIp = vi.fn(async () => ({ data: REGISTERED, error: null }));
    const signed = envelope();

    const { status, body } = await handleHydraCrackPublic(
      { ...signed, payload: `${signed.payload} ` },
      depsWith({ findNetworkByPublicIp }),
    );

    expect({ status, body }).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects a request that names no target, before any lookup', async () => {
    const findNetworkByPublicIp = vi.fn(async () => ({ data: REGISTERED, error: null }));
    const signed = signRequest(ATTACKER, 'hydraCrackPublic', {
      essid: HOME_ESSID,
      service: 'ssh',
      caller_machine_id: ATTACKER_MACHINE,
    });

    const { status } = await handleHydraCrackPublic(signed, depsWith({ findNetworkByPublicIp }));

    expect(status).toBe(400);
    expect(findNetworkByPublicIp).not.toHaveBeenCalled();
  });

  it('rejects a payload that claims an identity', async () => {
    // The caller is the verified signature, never a field. A request that names a
    // player_key is refused outright rather than having it quietly ignored.
    const { status } = await handleHydraCrackPublic(
      envelope({ player_key: 'somebody-else' }),
      depsWith(),
    );

    expect(status).toBe(400);
  });
});
