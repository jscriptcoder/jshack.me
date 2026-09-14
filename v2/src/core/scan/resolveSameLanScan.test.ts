import { describe, expect, it, vi } from 'vitest';
import { handleResolveSameLanScan, type ResolveSameLanScanDeps } from './resolveSameLanScan';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { crackableEssidPool } from '../generation/generateWifi';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { readOpenPorts, type OpenPort } from '../services/pidfile';
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
});
