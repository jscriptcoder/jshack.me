import { describe, expect, it, vi } from 'vitest';
import { handleHydraCrackPublic, type HydraCrackPublicDeps } from './hydraCrackPublic';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeWorkstationId } from '../identity/workstation';
import { computeApGatewayId } from '../identity/router';
import { generateHomeLan } from '../generation/generateHomeLan';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { seedApGatewayAdminPw, seedApGatewayHostname } from '../generation/routerFs';
import { workstationGuestPassword } from '../generation/workstationFs';
import { md5 } from '../generation/md5';
import { DATADIR_PATH } from '../mysql/datadir';
import { DATADIR_PATH as REDIS_DATADIR_PATH } from '../redis/datadir';
import { redisStoreSchema } from '../redis/types';
import { formatPidfileContent, pidfilePath } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { MYSQL_LOG_OWNER, MYSQL_LOG_PATH, MYSQL_LOG_PERMISSIONS } from '../logging/mysqlLog';
import { playerDatabaseOn } from '../../test/factories/lanDatabase';
import { lanAddressFor } from '../network/lanAddress';
import { DEFAULT_WORDLIST, WORDLIST_PATH, formatWordlist } from '../wordlist/defaultWordlist';
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

// A THIRD network — the one the attacker pivots through. A box on it is a box they
// hold a session on but do not own, and it bears an address of its own. Distinct from
// the attacker's home address on purpose: an origin derivation that read the wrong one
// of the two would be invisible if they matched.
const PIVOT_ESSID = 'MAGNOLIA-BLOSSOM';
const PIVOT_PUBLIC_IP = '192.0.2.55';
const PIVOT_BOX = 'workstation-a1b2c3d4';

// Which network bears which public IP, as the server resolves it. A network nobody has
// ever been allocated an address for is simply absent.
const PUBLIC_IP_BY_ESSID: Readonly<Record<string, string>> = {
  [HOME_ESSID]: ATTACKER_PUBLIC_IP,
  [PIVOT_ESSID]: PIVOT_PUBLIC_IP,
};

// The stranger's access point: a different ESSID, reached only by its public IP.
const TARGET_IP = '203.0.113.7';
const TARGET_ESSID = 'PIED-PIPER-GUEST';
const AP_GATEWAY_ID = computeApGatewayId(TARGET_ESSID);
const ADMIN_PW = seedApGatewayAdminPw(TARGET_ESSID);
const GATEWAY_HOSTNAME = seedApGatewayHostname(TARGET_ESSID);
const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: TARGET_ESSID };
// Somebody who actually lives on the stranger's AP. The gateway is ownerless, so its
// log accretes under the lowest-octet lease holder there — never the attacker's key.
// They are also the box behind the NAT forward below: one resident, both roles.
const RESIDENT = generateIdentity();
const RESIDENT_OCTET = 84;
const RESIDENT_LAN_IP = lanAddressFor(TARGET_ESSID, RESIDENT_OCTET);
const RESIDENT_WS = 'workstation-c3d4e5f6';
const RESIDENT_HOSTNAME = 'nebuchadnezzar';
const RESIDENT_USERNAME = 'neo';
const RESIDENT_GUEST_PW = workstationGuestPassword(RESIDENT.publicKeyHex);
// A password the PLAYER chose. Not drawn from any pool, so no wordlist the game can
// hand out contains it — which is the whole of why root holds.
const RESIDENT_ROOT_PW = 'correct-horse-battery-staple';
// The port the resident published to the outside world. Deliberately not 22: on this
// address 22 is the GATEWAY, a different machine entirely.
const FORWARD_PORT = 5544;

const residentOccupant: NatOccupantRow = {
  owner_key: RESIDENT.publicKeyHex,
  workstation_machine_id: RESIDENT_WS,
  workstation_machine_name: RESIDENT_HOSTNAME,
  workstation_username: RESIDENT_USERNAME,
  workstation_root_hash: md5(RESIDENT_ROOT_PW),
};

/** A root edit of the GATEWAY's `/etc/iptables/rules.v4` — the opt-in that exposes a
 *  box behind the NAT. The forward is a door its owner chose to open. */
const forwardRule = (publicPort: number, internalIp: string, internalPort = 22): OwnerPatchRow => ({
  path: '/etc/iptables/rules.v4',
  content: `forward ${publicPort} to ${internalIp}:${internalPort}`,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-08-09T10:00:00.000Z',
  writer_key: RESIDENT.publicKeyHex,
});
const RESIDENT_FORWARD = forwardRule(FORWARD_PORT, RESIDENT_LAN_IP);
// A second door on the SAME gateway to the SAME box, reaching a different service.
// Two forwards are how "the port is the address" becomes testable at all.
const HTTP_FORWARD_PORT = 5580;
const BOTH_FORWARDS: OwnerPatchRow = {
  ...RESIDENT_FORWARD,
  content: [
    `forward ${FORWARD_PORT} to ${RESIDENT_LAN_IP}:22`,
    `forward ${HTTP_FORWARD_PORT} to ${RESIDENT_LAN_IP}:80`,
  ].join('\n'),
};

/** The resident started their sshd. A fresh box has an empty `/var/run`, so a forward
 *  to one is dark until its owner brings the service up. */
const sshdUp: OwnerPatchRow = {
  path: '/var/run/sshd.pid',
  content: 'sshd:port=22',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-08-09T10:00:00.000Z',
  writer_key: RESIDENT.publicKeyHex,
};

/** The resident also serves a web page. A box running two daemons is what makes the
 *  destination port an ADDRESS rather than a formality. */
const nginxUp: OwnerPatchRow = { ...sshdUp, path: '/var/run/nginx.pid', content: 'nginx:port=80' };

// The resident bought a database and started it. Its accounts live in the datadir
// rather than in `/etc/passwd`, so it is a SECOND lock on the same box, opened by a
// key that cracking the shell never yields. The datadir is a journal row because that
// is how a player's box gets one at all: `apt install mysql` writes it, drawn from
// their own key, so no two players hold the same database.
const { database: RESIDENT_DATABASE, credential: RESIDENT_DB_ACCOUNT } =
  playerDatabaseOn(residentOccupant);
const mysqldUp: OwnerPatchRow = {
  ...sshdUp,
  path: pidfilePath(SERVICE_CATALOG.mysql),
  content: formatPidfileContent(SERVICE_CATALOG.mysql, SERVICE_CATALOG.mysql.defaultPort),
};
const datadirUp: OwnerPatchRow = {
  ...sshdUp,
  path: DATADIR_PATH,
  content: JSON.stringify(RESIDENT_DATABASE),
};
// The resident also runs a key-value store — the door with no accounts at all, whose
// one secret belongs to the SERVICE. Published the same way, and swept by the same rule.
const REDIS_SECRET = 'sunshine';
const redisUp: OwnerPatchRow = {
  ...sshdUp,
  path: pidfilePath(SERVICE_CATALOG.redis),
  content: formatPidfileContent(SERVICE_CATALOG.redis, SERVICE_CATALOG.redis.defaultPort),
};
const storeWith = (requirepassHash: string | null): OwnerPatchRow => ({
  ...sshdUp,
  path: REDIS_DATADIR_PATH,
  content: JSON.stringify(
    redisStoreSchema.parse({ keys: { 'sess:0a1b2c3d': '{"username":"root"}' }, requirepassHash }),
  ),
});
const REDIS_FORWARD_PORT = 6699;
const REDIS_FORWARD: OwnerPatchRow = {
  ...RESIDENT_FORWARD,
  content: `forward ${REDIS_FORWARD_PORT} to ${RESIDENT_LAN_IP}:${SERVICE_CATALOG.redis.defaultPort}`,
};

// A third door on the same gateway, and the only one that reaches 3306.
const MYSQL_FORWARD_PORT = 5533;
const MYSQL_FORWARD: OwnerPatchRow = {
  ...RESIDENT_FORWARD,
  content: `forward ${MYSQL_FORWARD_PORT} to ${RESIDENT_LAN_IP}:${SERVICE_CATALOG.mysql.defaultPort}`,
};
// Both doors on one gateway, in ONE rules file — two rows for one path would replay as
// the second erasing the first, which is the fold working rather than two forwards.
const SSH_AND_MYSQL_FORWARDS: OwnerPatchRow = {
  ...RESIDENT_FORWARD,
  content: [
    `forward ${FORWARD_PORT} to ${RESIDENT_LAN_IP}:22`,
    `forward ${MYSQL_FORWARD_PORT} to ${RESIDENT_LAN_IP}:${SERVICE_CATALOG.mysql.defaultPort}`,
  ].join('\n'),
};

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
  /** The journal of the box a forward reaches — its services and its passwd. Separate
   *  from the gateway's: the forward is what bridges two different machines. */
  readonly occupantPatches?: readonly OwnerPatchRow[];
  readonly occupants?: readonly NatOccupantRow[];
};

const depsWith = (over: DepOverrides = {}): HydraCrackPublicDeps => {
  const {
    wordlist = [ADMIN_PW],
    gatewayPatches = [],
    occupantPatches = [],
    occupants = [],
    ...rest
  } = over;
  return {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    findNetworkByPublicIp: async () => ({ data: REGISTERED, error: null }),
    findPatches: async ({ machine_id }) => ({
      data: machine_id === AP_GATEWAY_ID ? gatewayPatches : occupantPatches,
      error: null,
    }),
    listOccupantsByEssid: async () => ({ data: occupants, error: null }),
    listLeasesByEssid: async () => ({
      data: [{ owner_key: RESIDENT.publicKeyHex, octet: RESIDENT_OCTET }] as readonly LanLeaseRow[],
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
    findPublicIpByEssid: async (essid: string) => {
      const publicIp = PUBLIC_IP_BY_ESSID[essid];
      return { data: publicIp === undefined ? null : { public_ip: publicIp }, error: null };
    },
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

/** The line a target's own log records for one attempt, carrying ITS hostname. The
 *  source address is always SERVER-derived: the attacker's own public IP while they
 *  are standing on their own network, and the address of the network they are standing
 *  on when they have pivoted onto somebody else's box. */
const traceLineOn =
  (hostname: string, fromIp: string = ATTACKER_PUBLIC_IP) =>
  (outcome: 'success' | 'failure', user: string) =>
    formatSshdAuthLine({
      outcome,
      user,
      fromIp,
      hostname,
      time: asGameTime(FIXED_NOW),
      pid: derivePid(FIXED_NOW),
    });

const traceLine = traceLineOn(GATEWAY_HOSTNAME);
const residentTraceLine = traceLineOn(RESIDENT_HOSTNAME);
const pivotedTraceLine = traceLineOn(GATEWAY_HOSTNAME, PIVOT_PUBLIC_IP);

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
    // Reached by the same route as the pivot — the session names the network, and here
    // that network is home — so the answer is the address it always was.
    const standing = ownLanHost();
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: machineIdForLanHost(standing, HOME_ESSID) }),
      depsWith({
        findActiveSession: async () => ({
          data: { username: 'root', userType: 'root', essid: HOME_ESSID },
          error: null,
        }),
        upsertPatch,
      }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      port: 22,
      cracked: [{ username: 'root', password: ADMIN_PW }],
      wordlistFound: true,
    });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${traceLine('success', 'root')}\n` }),
    );
  });

  it('traces a sweep from a box deep behind the player’s own gateway to their own address', async () => {
    // A deep box is not on the generated LAN and never was placeable by address, but
    // its session carries the caller's own essid — it sits behind their own gateway, so
    // its traffic leaves by their own public IP. Nothing here walks the chain.
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: 'host-deep-9f8e7d6c' }),
      depsWith({
        findActiveSession: async () => ({
          data: { username: 'root', userType: 'root', essid: HOME_ESSID },
          error: null,
        }),
        upsertPatch,
      }),
    );

    expect(status).toBe(200);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${traceLine('success', 'root')}\n` }),
    );
  });

  it('records an unplaceable network as unknown rather than guessing, and still sweeps', async () => {
    // A network nobody has ever been allocated an address for. The sweep is not failed
    // over a logging detail, and no address is invented for the defender to chase.
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status, body } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: PIVOT_BOX }),
      depsWith({
        findActiveSession: async () => ({
          data: { username: 'root', userType: 'root', essid: 'NEVER-ALLOCATED' },
          error: null,
        }),
        upsertPatch,
      }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      port: 22,
      cracked: [{ username: 'root', password: ADMIN_PW }],
      wordlistFound: true,
    });
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        content: `${traceLineOn(GATEWAY_HOSTNAME, 'unknown')('success', 'root')}\n`,
      }),
    );
  });

  it('reads the wordlist from the box being stood on, not the player’s own', async () => {
    // Tools run where you stand, and so does the ammunition. Pivoting onto somebody
    // else's box means using whatever wordlist is on it.
    const listPathPatches = vi.fn(async (): Promise<ListPathPatchesResult> => ({
      data: [wordlistRow([ADMIN_PW])],
      error: null,
    }));
    await handleHydraCrackPublic(
      envelope({ caller_machine_id: PIVOT_BOX }),
      depsWith({
        findActiveSession: async () => ({
          data: { username: 'root', userType: 'root', essid: PIVOT_ESSID },
          error: null,
        }),
        listPathPatches,
      }),
    );

    expect(listPathPatches).toHaveBeenCalledWith({ machine_id: PIVOT_BOX, path: WORDLIST_PATH });
  });

  it('traces a sweep launched from somebody else’s box to THAT box’s network', async () => {
    // The pivot. The attacker holds a session on a box that lives on a third party's
    // network, so what the target's log records is THAT network's address — the box
    // that was actually used. Their own address never appears, which is the whole
    // reason rooting somebody else's box is worth the trouble.
    const upsertPatch = vi.fn(async () => ({ error: null }));
    const { status } = await handleHydraCrackPublic(
      envelope({ caller_machine_id: PIVOT_BOX }),
      depsWith({
        findActiveSession: async () => ({
          data: { username: 'root', userType: 'root', essid: PIVOT_ESSID },
          error: null,
        }),
        upsertPatch,
      }),
    );

    expect(status).toBe(200);
    expect(upsertPatch).toHaveBeenCalledWith(
      expect.objectContaining({ content: `${pivotedTraceLine('success', 'root')}\n` }),
    );
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

  describe('a forwarded port reaches the person behind the NAT, not their gateway', () => {
    // A forward is a door its owner chose to open so their own box is reachable. It is
    // the same door an attacker walks through, which is what makes publishing one a
    // decision rather than a freebie.
    const forwardDeps = (over: DepOverrides = {}): HydraCrackPublicDeps =>
      depsWith({
        gatewayPatches: [RESIDENT_FORWARD],
        occupantPatches: [sshdUp],
        occupants: [residentOccupant],
        wordlist: [RESIDENT_GUEST_PW],
        ...over,
      });

    it("cracks the occupant's guest account through the port they published", async () => {
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps(),
      );

      expect(status).toBe(200);
      expect(body).toEqual({
        // The port reported is the door the player knocked on, not the occupant's
        // internal 22 — on this address 22 is the gateway, a different machine.
        port: FORWARD_PORT,
        cracked: [{ username: 'guest', password: RESIDENT_GUEST_PW }],
        wordlistFound: true,
      });
    });

    it('leaves root and the owner’s own account standing against the whole default wordlist', async () => {
      // Every password the default install can crack, thrown at a player's box. Guest
      // is the only account that falls: root's password was CHOSEN, so no pool holds
      // it, and the owner's own login has no password at all — and md5 of anything is
      // never the empty hash, so it cannot be reached either. The difficulty curve,
      // asserted rather than assumed.
      const { body } = await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps({ wordlist: DEFAULT_WORDLIST }),
      );

      expect(body).toEqual({
        port: FORWARD_PORT,
        cracked: [{ username: 'guest', password: RESIDENT_GUEST_PW }],
        wordlistFound: true,
      });
    });

    it("traces the sweep on the occupant's own auth.log, under their key", async () => {
      const upsertPatch = vi.fn(async () => ({ error: null }));
      await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps({ wordlist: ['hunter2', RESIDENT_GUEST_PW], upsertPatch }),
      );

      expect(upsertPatch).toHaveBeenCalledWith(
        expect.objectContaining({
          machine_id: RESIDENT_WS,
          writer_key: RESIDENT.publicKeyHex,
          path: asAbsPath(AUTH_LOG_PATH),
          owner: AUTH_LOG_OWNER,
          permissions: AUTH_LOG_PERMISSIONS,
          // Every account, every word, until one opens: the defender sees the whole
          // sweep against their box — root and their own login included — not just
          // the account that fell.
          content: `${[
            residentTraceLine('failure', 'root'),
            residentTraceLine('failure', 'root'),
            residentTraceLine('failure', RESIDENT_USERNAME),
            residentTraceLine('failure', RESIDENT_USERNAME),
            residentTraceLine('failure', 'guest'),
            residentTraceLine('success', 'guest'),
          ].join('\n')}\n`,
        }),
      );
    });

    it('refuses a forward aimed at an address nobody on the AP leases, and writes no trace', async () => {
      const upsertPatch = vi.fn(async () => ({ error: null }));
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps({
          gatewayPatches: [forwardRule(FORWARD_PORT, lanAddressFor(TARGET_ESSID, 251))],
          upsertPatch,
        }),
      );

      expect({ status, body }).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses a forward onto a bricked box, and writes no trace', async () => {
      const upsertPatch = vi.fn(async () => ({ error: null }));
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps({ occupantPatches: [sshdUp, bootTombstone], upsertPatch }),
      );

      expect({ status, body }).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('refuses a forward whose internal service is not listening, and writes no trace', async () => {
      const upsertPatch = vi.fn(async () => ({ error: null }));
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: FORWARD_PORT }),
        forwardDeps({ occupantPatches: [], upsertPatch }),
      );

      expect({ status, body }).toEqual({ status: 404, body: { error: 'host_unreachable' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    it('reaches the http service behind the port that forwards to it', async () => {
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: HTTP_FORWARD_PORT, service: 'http' }),
        forwardDeps({ gatewayPatches: [BOTH_FORWARDS], occupantPatches: [sshdUp, nginxUp] }),
      );

      expect(status).toBe(200);
      expect(body).toEqual({
        port: HTTP_FORWARD_PORT,
        cracked: [{ username: 'guest', password: RESIDENT_GUEST_PW }],
        wordlistFound: true,
      });
    });

    it('refuses ssh through a port that forwards to http, though the box runs both', async () => {
      // The port IS the address. Resolving through a forward to nginx and then attacking
      // sshd behind it is exactly the hydra/ssh disagreement this path exists to prevent:
      // `ssh` on that port would reach the web server and refuse, so a credential
      // reported here would be one `ssh` never accepts.
      const upsertPatch = vi.fn(async () => ({ error: null }));
      const { status, body } = await handleHydraCrackPublic(
        envelope({ port: HTTP_FORWARD_PORT }),
        forwardDeps({
          gatewayPatches: [BOTH_FORWARDS],
          occupantPatches: [sshdUp, nginxUp],
          wordlist: [ADMIN_PW, RESIDENT_GUEST_PW],
          upsertPatch,
        }),
      );

      expect({ status, body }).toEqual({ status: 404, body: { error: 'service_not_running' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    });

    describe('a database published through a forward', () => {
      // The cross-player database door, from the credential end. Everything the
      // attacker needs is one address and a port their target chose to open.
      const databaseDeps = (over: DepOverrides = {}): HydraCrackPublicDeps =>
        forwardDeps({
          gatewayPatches: [MYSQL_FORWARD],
          occupantPatches: [mysqldUp, datadirUp],
          wordlist: [RESIDENT_DB_ACCOUNT.password],
          ...over,
        });

      it("earns an account in a stranger's database, published through their own forward", async () => {
        const { status, body } = await handleHydraCrackPublic(
          envelope({ port: MYSQL_FORWARD_PORT, service: 'mysql' }),
          databaseDeps(),
        );

        expect({ status, body }).toEqual({
          status: 200,
          body: {
            port: MYSQL_FORWARD_PORT,
            cracked: [RESIDENT_DB_ACCOUNT],
            wordlistFound: true,
          },
        });
      });

      it('records the sweep on the DATABASE\'s own log, on the target box, under their key', async () => {
        const upsertPatch = vi.fn(async () => ({ error: null }));
        await handleHydraCrackPublic(
          envelope({ port: MYSQL_FORWARD_PORT, service: 'mysql' }),
          databaseDeps({ upsertPatch }),
        );

        // Not auth.log: a database sweep is the daemon's business, and the defender
        // looks for it where the daemon writes. The row is the TARGET's — the system
        // owns its logs, so two attackers accrete into one file instead of erasing
        // each other.
        expect(upsertPatch).toHaveBeenCalledWith(
          expect.objectContaining({
            machine_id: RESIDENT_WS,
            writer_key: RESIDENT.publicKeyHex,
            path: asAbsPath(MYSQL_LOG_PATH),
            owner: MYSQL_LOG_OWNER,
            permissions: MYSQL_LOG_PERMISSIONS,
          }),
        );
      });

      it('leaves the database root standing against the whole default wordlist', async () => {
        // Its password is the one the OWNER chose for the box, mirrored onto the
        // database so they reach their own prompt with nothing to look up. No pool
        // holds a chosen password, so a sweep never reaches the tier that may drop a
        // table — owning the box is the only route to it.
        const { body } = await handleHydraCrackPublic(
          envelope({ port: MYSQL_FORWARD_PORT, service: 'mysql' }),
          databaseDeps({ wordlist: DEFAULT_WORDLIST }),
        );

        expect(body).toEqual({
          port: MYSQL_FORWARD_PORT,
          cracked: expect.not.arrayContaining([{ username: 'root', password: RESIDENT_ROOT_PW }]),
          wordlistFound: true,
        });
      });

      it('refuses the database through a port that forwards to sshd, though the box runs both', async () => {
        // The port IS the address. A credential reported for a door `mysql` would then
        // refuse is the tool disagreement this whole path exists to prevent.
        const upsertPatch = vi.fn(async () => ({ error: null }));
        const { status, body } = await handleHydraCrackPublic(
          envelope({ port: FORWARD_PORT, service: 'mysql' }),
          databaseDeps({
            gatewayPatches: [SSH_AND_MYSQL_FORWARDS],
            occupantPatches: [sshdUp, mysqldUp, datadirUp],
            upsertPatch,
          }),
        );

        expect({ status, body }).toEqual({ status: 404, body: { error: 'service_not_running' } });
        expect(upsertPatch).not.toHaveBeenCalled();
      });
    });

    describe('a store published through a forward', () => {
      // The point of passing the store's secret to EVERY sweep handler rather than to
      // the one this slice happened to be written against: a door crackable from the
      // LAN and silently uncrackable from a vantage away is worse than one that could
      // not be reached at all, because nothing about it looks broken.
      it('gives up its password to the same sweep, from a vantage away', async () => {
        const { status, body } = await handleHydraCrackPublic(
          envelope({ port: REDIS_FORWARD_PORT, service: 'redis' }),
          forwardDeps({
            gatewayPatches: [REDIS_FORWARD],
            occupantPatches: [redisUp, storeWith(md5(REDIS_SECRET))],
            wordlist: ['nonsense', REDIS_SECRET],
          }),
        );

        expect({ status, body }).toEqual({
          status: 200,
          body: {
            port: REDIS_FORWARD_PORT,
            cracked: [{ password: REDIS_SECRET }],
            wordlistFound: true,
          },
        });
      });

      it('says an OPEN store has no password to find here either', async () => {
        const upsertPatch = vi.fn(async () => ({ error: null }));
        const { status, body } = await handleHydraCrackPublic(
          envelope({ port: REDIS_FORWARD_PORT, service: 'redis' }),
          forwardDeps({
            gatewayPatches: [REDIS_FORWARD],
            occupantPatches: [redisUp, storeWith(null)],
            wordlist: DEFAULT_WORDLIST,
            upsertPatch,
          }),
        );

        expect({ status, body }).toEqual({ status: 404, body: { error: 'no_password_set' } });
        expect(upsertPatch).not.toHaveBeenCalled();
      });
    });

    it('still reaches the gateway when no port is named — the default is unchanged', async () => {
      const { status, body } = await handleHydraCrackPublic(
        envelope(),
        forwardDeps({ wordlist: [ADMIN_PW] }),
      );

      expect(status).toBe(200);
      expect(body).toEqual({
        port: 22,
        cracked: [{ username: 'root', password: ADMIN_PW }],
        wordlistFound: true,
      });
    });
  });
});


/**
 * The defender's own filter survives translation through their gateway's NAT.
 *
 * A forward and a local deny are two gates, and traffic needs both. Neither file knows
 * about the other: the gateway publishes a port, the box behind it refuses one, and the
 * sweep meets whichever says no first. Without this, the one place a stranger can
 * always reach — a published port — would be the one place a filter did not apply.
 */
describe('a resident who filters the port their gateway publishes', () => {
  /** The RESIDENT's own `rules.v4`, not the gateway's: the same filename, one hop
   *  further in, refusing the internal port the forward lands on. */
  const residentFilter: OwnerPatchRow = {
    ...RESIDENT_FORWARD,
    content: `deny ${SERVICE_CATALOG.ssh.defaultPort}`,
  };

  it('answers a sweep of the published port as though nothing were listening', async () => {
    const { status, body } = await handleHydraCrackPublic(
      envelope({ port: FORWARD_PORT }),
      depsWith({
        gatewayPatches: [RESIDENT_FORWARD],
        occupantPatches: [sshdUp, residentFilter],
        occupants: [residentOccupant],
        wordlist: [RESIDENT_GUEST_PW],
      }),
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: 'service_not_running' });
  });

  it('goes on answering a published port the resident left open', async () => {
    const { status } = await handleHydraCrackPublic(
      envelope({ port: FORWARD_PORT }),
      depsWith({
        gatewayPatches: [RESIDENT_FORWARD],
        occupantPatches: [sshdUp, { ...residentFilter, content: 'deny 8080' }],
        occupants: [residentOccupant],
        wordlist: [RESIDENT_GUEST_PW],
      }),
    );

    expect(status).toBe(200);
  });
});
