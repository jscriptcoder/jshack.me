import { describe, expect, it, vi } from 'vitest';
import { handleResolveSameLanScan, type ResolveSameLanScanDeps } from './resolveSameLanScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { buildApGatewayBaseFs } from '../generation/routerFs';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { hostMachineId } from '../generation/remoteHostId';
import {
  readRulesV4,
  withForward,
  withInputDeny,
  RULES_V4_OWNER,
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
  type ForwardTarget,
} from '../network/iptablesRules';
import {
  formatListenerContent,
  listenerPidfileName,
  pidfilePath,
  readOpenPorts,
  readRunningProcesses,
  UNKNOWN_SERVICE,
  type OpenPort,
} from '../services/pidfile';
import type { ServiceSpec } from '../services/serviceCatalog';
import {
  DPKG_STATUS_OWNER,
  DPKG_STATUS_PATH,
  DPKG_STATUS_PERMISSIONS,
  parseDpkgVersions,
  readDpkgStatus,
  withPackageVersion,
} from '../packages/dpkgStatus';
import { upgradeStatusFor } from '../cve/packageTimeline';
import { displayVersion } from '../packages/packageVersions';
import { serviceByName } from '../services/serviceCatalog';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import type { NonceStore } from '../signedRequest/nonceStore';

/**
 * `handleResolveSameLanScan` resolves the player's OWN-LAN `nmap` of an NPC sibling
 * against that machine's own journal, replayed over its seeded base — the read a
 * client cannot do for itself.
 *
 * Every own-LAN scan used to resolve from `buildRemoteHostFs` alone, which knows only
 * what the world SHIPPED. A box somebody has since patched, bricked, backdoored or
 * quietened therefore scanned as the box it was on day zero: a package upgraded out of
 * its vulnerable window still advertised the old version and a live CVE, while the
 * server refused the exploit one command later.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

/** The acting player. The world does not vary with an identity; what a signer decides
 *  is whose signature the envelope carries. */
const PLAYER = generateIdentity();

/** A sibling somewhere in the world that is running a service whose installed version
 *  has a LIVE hole on some day, and whose fix has already shipped by that same day —
 *  the exact situation face 4 lies about. Which network and which day satisfy that is a
 *  seeded roll, so it is searched for deterministically rather than guessed at: a
 *  hand-picked ESSID would pin the test to a draw that the generator is free to change.
 *
 *  The window is narrow by design — `CVE_TIMING` publishes a fix 1-2 days after the
 *  hole opens — so a day range is walked rather than a single day assumed. */
type VulnerableSibling = {
  readonly essid: string;
  readonly host: LanHost;
  readonly gameDay: number;
  readonly pkg: string;
  /** The seeded entry as a scan sees it today: old version, live CVE, severity. */
  readonly exposed: OpenPort;
  /** The version the published fix moves it to. */
  readonly fixedVersion: string;
};

const DAYS_SEARCHED = 40;

const findVulnerableSibling = (): VulnerableSibling => {
  for (const essid of crackableEssidPool) {
    for (const host of generateHomeLan(essid).hosts) {
      if (host.kind !== 'machine') continue;
      const seededFs = buildRemoteHostFs(essid, host);
      const installed = parseDpkgVersions(readDpkgStatus(seededFs));
      for (let gameDay = 1; gameDay <= DAYS_SEARCHED; gameDay++) {
        for (const exposed of readOpenPorts(seededFs, { gameDay })) {
          const pkg = serviceByName(exposed.service)?.package;
          if (exposed.cve === undefined || pkg === undefined) continue;
          const version = installed.get(pkg);
          if (version === undefined) continue;
          const status = upgradeStatusFor(pkg, version, gameDay);
          if (status.kind !== 'upgradable') continue;
          return { essid, host, gameDay, pkg, exposed, fixedVersion: status.target };
        }
      }
    }
  }
  throw new Error('no sibling runs a vulnerable service whose fix has shipped');
};

const VULNERABLE = findVulnerableSibling();
const { essid: ESSID, host: SIBLING, gameDay: GAME_DAY } = VULNERABLE;

const SIBLING_ID = hostMachineId(SIBLING, ESSID);

/** An address on the right subnet that the generator put no host at — what a player
 *  scanning a gap in the host list is asking about. */
const unoccupiedAddress = (): string => {
  const { subnet, hosts } = generateHomeLan(ESSID);
  const taken = new Set(hosts.map((host) => host.ip));
  for (let octet = 2; octet < 255; octet++) {
    const candidate = `${subnet}.${octet}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('this LAN has no free address');
};

/** The sibling's manifest with the vulnerable package moved to the version its fix
 *  shipped — byte for byte what `apt upgrade` writes to that box's journal. */
const upgradedManifest = (): OwnerPatchRow => ({
  path: DPKG_STATUS_PATH,
  content: withPackageVersion(
    readDpkgStatus(buildRemoteHostFs(ESSID, SIBLING)),
    VULNERABLE.pkg,
    VULNERABLE.fixedVersion,
  ),
  owner: DPKG_STATUS_OWNER,
  permissions: DPKG_STATUS_PERMISSIONS,
  node_type: 'file',
  updated_at: '2026-09-14T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});

/** A root `rm /boot/vmlinuz` tombstone on the sibling's journal — replayed over its
 *  seeded base it bricks the box, which stops answering doors it no longer holds. */
const bootTombstone: OwnerPatchRow = {
  path: '/boot/vmlinuz',
  content: null,
  owner: 'root',
  permissions: null,
  node_type: null,
  updated_at: '2026-09-14T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
};

/** One row on the target box's own journal — what somebody left behind after rooting it. */
const journalRow = (path: string, content: string | null): OwnerPatchRow => ({
  path,
  content,
  owner: 'root',
  permissions: null,
  node_type: content === null ? null : 'file',
  updated_at: '2026-09-14T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});

/** The service the sibling is seeded to run whose door the stop test closes. Read off
 *  the box rather than named, so the test keeps meaning what it says when the generator
 *  re-rolls which daemons land where. */
const seededService = (): { readonly spec: ServiceSpec; readonly port: number } => {
  const seededFs = buildRemoteHostFs(ESSID, SIBLING);
  for (const running of readRunningProcesses(seededFs)) {
    if (running.kind === 'service') return { spec: running.spec, port: running.port };
  }
  throw new Error('the sibling under test runs no seeded service');
};

/** The access point's own gateway at `.1` — the one box on this LAN that belongs to the
 *  NETWORK rather than to any occupant, and that every occupant of the ESSID therefore
 *  scans as the same machine. */
const AP_GATEWAY: LanHost = (() => {
  const { subnet, hosts } = generateHomeLan(ESSID);
  const gateway = hosts.find((host) => host.ip === `${subnet}.1`);
  if (gateway === undefined) throw new Error('this LAN has no gateway at .1');
  return gateway;
})();

const AP_GATEWAY_ID = machineIdForLanHost(AP_GATEWAY, ESSID);

/** A port the gateway is seeded to serve, read off its own tree rather than named — so
 *  the test keeps meaning what it says when the seed re-rolls what it carries. */
const seededGatewayPort = (): number => {
  const port = readOpenPorts(buildApGatewayBaseFs(ESSID))[0]?.port;
  if (port === undefined) throw new Error('the AP gateway runs no seeded service');
  return port;
};

/** A `rules.v4` row on a box's own journal, written exactly as `snmpset` writes it —
 *  same path, same owner, same permissions — so what the scan reads back is what an
 *  occupant's `inputPort.<port>=deny` or `forward.<port>=<ip>:<port>` actually leaves
 *  behind. */
const rulesV4Row = (content: string): OwnerPatchRow => ({
  path: RULES_V4_PATH,
  content,
  owner: RULES_V4_OWNER,
  permissions: RULES_V4_PERMISSIONS,
  node_type: 'file',
  updated_at: '2026-09-14T00:00:00.000Z',
  writer_key: PLAYER.publicKeyHex,
});

/** A NAT forward published on the GATEWAY — how an occupant exposes a box behind the
 *  access point to the internet. */
const gatewayForward = (publicPort: number, target: ForwardTarget): OwnerPatchRow =>
  rulesV4Row(withForward(readRulesV4(buildApGatewayBaseFs(ESSID)), publicPort, target));

/** `snmpset <gateway> <rw> inputPort.<port>=deny` — the filter that closes a port to the
 *  network while the daemon behind it keeps running for whoever owns the box. */
const gatewayDeny = (port: number): OwnerPatchRow =>
  rulesV4Row(withInputDeny(readRulesV4(buildApGatewayBaseFs(ESSID)), port, true));

/** The same filter, on an NPC SIBLING — any box keeping a `rules.v4` of its own can be
 *  closed this way, not only the gateway. */
const siblingDeny = (port: number): OwnerPatchRow =>
  rulesV4Row(withInputDeny(readRulesV4(buildRemoteHostFs(ESSID, SIBLING)), port, true));

type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const makeDeps = (journal: readonly OwnerPatchRow[] = []) => {
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async () => ({
    data: journal,
    error: null,
  }));
  const deps: ResolveSameLanScanDeps = { nonceStore: freshStore, gameDay: GAME_DAY, findPatches };
  return { deps, findPatches };
};

const envelope = (target: string, over: Record<string, unknown> = {}) =>
  signRequest(PLAYER, 'resolveSameLanScan', { essid: ESSID, target, ...over });

const portsOf = (body: Record<string, unknown>): readonly OpenPort[] =>
  body.ports as readonly OpenPort[];

describe('handleResolveSameLanScan', () => {
  it('reports an untouched sibling exactly as it shipped, hole and all', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.found).toBe(true);
    expect(portsOf(result.body)).toContainEqual(VULNERABLE.exposed);
    // The journal is read off the SIBLING's own machine id — the same id the client,
    // the ssh gate and every write to that box already agree on.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: SIBLING_ID });
  });

  it('reports the NEW version and no CVE once the box has been upgraded', async () => {
    const { deps } = makeDeps([upgradedManifest()]);

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // No cve, no severity: a defender who closed the hole can confirm it, and an
    // attacker stops being sent at a door the server will refuse.
    expect(portsOf(result.body)).toContainEqual({
      port: VULNERABLE.exposed.port,
      service: VULNERABLE.exposed.service,
      version: displayVersion(VULNERABLE.pkg, VULNERABLE.fixedVersion),
    });
  });

  it('reports host down for an address no host on this LAN answers to', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveSameLanScan(envelope(unoccupiedAddress()), deps);

    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
    // Nothing is there to have a journal, so nothing is read.
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('reports a bricked sibling down rather than as a box running nothing', async () => {
    const { deps } = makeDeps([bootTombstone]);

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // Host-down and an empty port table are two different sentences: one says the box
    // is gone, the other that it is up and quiet. A machine whose kernel has been
    // deleted is the first.
    expect(result).toEqual({ status: 200, body: { ok: true, found: false, ports: [] } });
  });

  it('answers 500 when the journal lookup fails, rather than scanning the seed', async () => {
    const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(
      async () => ({ data: null, error: { message: 'connection reset' } }),
    );
    const deps: ResolveSameLanScanDeps = { nonceStore: freshStore, gameDay: GAME_DAY, findPatches };

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // Falling back to the seeded base here would be the original defect wearing a
    // different hat: a port table that looks resolved and is not.
    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
  });

  it('rejects a tampered envelope without reading any journal', async () => {
    const { deps, findPatches } = makeDeps();
    const signed = envelope(SIBLING.ip);
    const tampered = { ...signed, payload: `${signed.payload} ` };

    const result = await handleResolveSameLanScan(tampered, deps);

    expect(result).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope that smuggles a client-supplied player_key', async () => {
    const { deps, findPatches } = makeDeps();

    const result = await handleResolveSameLanScan(
      envelope(SIBLING.ip, { player_key: 'attacker' }),
      deps,
    );

    expect(result.status).toBe(400);
    expect(findPatches).not.toHaveBeenCalled();
  });

  it('rejects an envelope missing the target', async () => {
    const { deps } = makeDeps();

    const result = await handleResolveSameLanScan(
      signRequest(PLAYER, 'resolveSameLanScan', { essid: ESSID }),
      deps,
    );

    expect(result.status).toBe(400);
  });

  /**
   * The three faces of this defect that were found before the one slice 4 hit. They
   * close here for the same reason face 4 does — one missing journal replay caused all
   * of them — and they are pinned at the handler because until it existed there was
   * nowhere for a journal to be read on an own-LAN scan at all.
   */
  it('shows a listener somebody planted on the box', async () => {
    const PLANTED_PORT = 4444;
    const { deps } = makeDeps([
      journalRow(
        `/var/run/${listenerPidfileName(PLANTED_PORT)}`,
        formatListenerContent({ port: PLANTED_PORT, user: 'mallory', userType: 'root' }),
      ),
    ]);

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // Open, and unaccounted for: the box names no software behind it, which is the
    // finding. A door planted by one occupant used to be invisible to every other.
    expect(portsOf(result.body)).toContainEqual({
      port: PLANTED_PORT,
      service: UNKNOWN_SERVICE,
    });
  });

  it('stops showing a listener once it has been removed', async () => {
    const PLANTED_PORT = 4444;
    const pidfile = `/var/run/${listenerPidfileName(PLANTED_PORT)}`;
    const rows = [
      journalRow(
        pidfile,
        formatListenerContent({ port: PLANTED_PORT, user: 'mallory', userType: 'root' }),
      ),
      { ...journalRow(pidfile, null), updated_at: '2026-09-14T00:00:01.000Z' },
    ];
    const { deps } = makeDeps(rows);

    const planted = await handleResolveSameLanScan(envelope(SIBLING.ip), makeDeps([rows[0]]).deps);
    const removed = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // Asserted as a CHANGE, so the claim cannot be satisfied by a scan that lost the
    // port for some other reason — or by a replay that reported nothing at all.
    expect(portsOf(planted.body).map((entry) => entry.port)).toContain(PLANTED_PORT);
    expect(portsOf(removed.body).map((entry) => entry.port)).not.toContain(PLANTED_PORT);
  });

  it('stops showing a service the box has been told to stop', async () => {
    const stopped = seededService();
    const running = await handleResolveSameLanScan(envelope(SIBLING.ip), makeDeps().deps);
    const { deps } = makeDeps([journalRow(pidfilePath(stopped.spec), null)]);

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // `systemctl stop` tombstones the pidfile. A scan still advertising the door would
    // send a player at a service that is no longer listening — and the same scan lied
    // about a player's OWN action, on a box they had just rooted.
    expect(portsOf(running.body).map((entry) => entry.port)).toContain(stopped.port);
    expect(portsOf(result.body).map((entry) => entry.port)).not.toContain(stopped.port);
  });
});

/**
 * The `.1` is the one box on a home LAN that every occupant shares, and the handler
 * resolves it through the same three steps a sibling takes — `generateHomeLan` places
 * it, `resolveLanHostIdentity` maps it to the ACCESS POINT's identity and the gateway
 * base tree, and its own journal replays over that.
 *
 * What makes it a different box to READ is the vantage. From inside the LAN a gateway
 * answers with its own services and never the NAT forwards behind it, so these pin the
 * split itself — the answer must not change when the reader does.
 */
describe('handleResolveSameLanScan — the access point gateway at .1', () => {
  it('replays the gateway journal, so a door planted on it is visible to every occupant', async () => {
    const PLANTED_PORT = 4444;
    const { deps, findPatches } = makeDeps([
      journalRow(
        `/var/run/${listenerPidfileName(PLANTED_PORT)}`,
        formatListenerContent({ port: PLANTED_PORT, user: 'mallory', userType: 'root' }),
      ),
    ]);

    const result = await handleResolveSameLanScan(envelope(AP_GATEWAY.ip), deps);

    expect(result.status).toBe(200);
    expect(result.body.found).toBe(true);
    expect(portsOf(result.body)).toContainEqual({ port: PLANTED_PORT, service: UNKNOWN_SERVICE });
    // Read off the ACCESS POINT's own machine id: every occupant of this ESSID is asking
    // about one box, rather than each rebuilding a private copy of it.
    expect(findPatches).toHaveBeenCalledWith({ machine_id: AP_GATEWAY_ID });
  });

  it('answers with the gateway own services and never the forward table behind it', async () => {
    const FORWARDED_PORT = 8080;
    const { deps } = makeDeps([
      gatewayForward(FORWARDED_PORT, { internalIp: SIBLING.ip, internalPort: 22 }),
    ]);

    const result = await handleResolveSameLanScan(envelope(AP_GATEWAY.ip), deps);

    const ports = portsOf(result.body).map((entry) => entry.port);
    expect(ports).toContain(seededGatewayPort());
    // A forward is how the box behind it is reached from the INTERNET, not a door on the
    // gateway. Listing it here would hand an occupant the public exposure of every
    // neighbour off a scan of their own LAN.
    expect(ports).not.toContain(FORWARDED_PORT);
  });

  it('stops showing a port an occupant filtered on the gateway', async () => {
    const filtered = seededGatewayPort();
    const open = await handleResolveSameLanScan(envelope(AP_GATEWAY.ip), makeDeps().deps);
    const { deps } = makeDeps([gatewayDeny(filtered)]);

    const result = await handleResolveSameLanScan(envelope(AP_GATEWAY.ip), deps);

    // The scan of the shared gateway and the scan of its public IP used to disagree: the
    // filter closed the port to the network and the LAN view kept advertising it. A port
    // listed here but refused at every door is an open port that lies.
    expect(portsOf(open.body).map((entry) => entry.port)).toContain(filtered);
    expect(portsOf(result.body).map((entry) => entry.port)).not.toContain(filtered);
  });
});

describe('handleResolveSameLanScan — a filter on a sibling', () => {
  it('stops showing a port an occupant filtered on an NPC sibling', async () => {
    const filtered = seededService().port;
    const open = await handleResolveSameLanScan(envelope(SIBLING.ip), makeDeps().deps);
    const { deps } = makeDeps([siblingDeny(filtered)]);

    const result = await handleResolveSameLanScan(envelope(SIBLING.ip), deps);

    // `snmpset inputPort.<port>=deny` works on any box keeping a filter of its own, so
    // the gateway is not the only place a scan can advertise a door the reach refuses.
    expect(portsOf(open.body).map((entry) => entry.port)).toContain(filtered);
    expect(portsOf(result.body).map((entry) => entry.port)).not.toContain(filtered);
  });
});
