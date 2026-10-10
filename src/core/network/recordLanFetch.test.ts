import { describe, expect, it, vi } from 'vitest';
import { handleRecordLanFetch, type FetchOccupant, type RecordLanFetchDeps } from './recordLanFetch.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { buildRemoteHostFs } from '../generation/remoteHostFs.js';
import {
  chainGatewayBaseFs,
  machineIdForLanHost,
  resolveLanHostIdentity,
} from '../generation/lanHostIdentity.js';
import { chainLinks, type ChainLink } from '../generation/lanTopology.js';
import { generateDeepLayer } from '../generation/generateDeepLayer.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { crackableEssidPool } from '../generation/generateWifi.js';
import { hostMachineId } from '../generation/remoteHostId.js';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from './http.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog.js';
import { asGameTime } from '../types.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { logRead } from '../../test/factories/logRows.js';

/**
 * `handleRecordLanFetch` is the server-side action behind an own-LAN `curl`: it
 * verifies the signed envelope, REGENERATES the caller's own LAN from the verified
 * pubkey + essid, resolves which machine actually answered — a generated NPC host,
 * or the caller's own workstation when they fetched their own address — and appends
 * one `/var/log/access.log` line to it.
 *
 * The client names a target and a path; it never names a machine, a time, a status
 * or a size. The server reads the target's tree and works those out itself, so a
 * crafted request cannot author a line that says something the server did not serve.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const ESSID = 'BEAN-THERE-WIFI';
// 2026-07-30 04:07:09 UTC — single-digit hour/minute/second on purpose, so the
// rendered line exercises zero-padding rather than hiding it behind a tidy clock.
const FIXED_NOW = Date.UTC(2026, 6, 30, 4, 7, 9);

type OccupantsResult = { data: readonly FetchOccupant[] | null; error: unknown };
type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };
type LeasesResult = { data: readonly LanLeaseRow[] | null; error: unknown };

const makeDeps = (over: Partial<RecordLanFetchDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(async () => ({
    data: null,
    error: null,
  }));
  // Default: nobody is a registered occupant and nobody holds a lease — the NPC path
  // needs neither, so the self-fetch tests are the ones that supply them.
  const listOccupantsByEssid = vi.fn<(essid: string) => Promise<OccupantsResult>>(async () => ({
    data: [],
    error: null,
  }));
  const listLeasesByEssid = vi.fn<(essid: string) => Promise<LeasesResult>>(async () => ({
    data: [],
    error: null,
  }));
  const findPatches = vi.fn<(query: { machine_id: string }) => Promise<PatchesResult>>(async () => ({
    data: [],
    error: null,
  }));
  const deps: RecordLanFetchDeps = {
    nonceStore: freshStore,
    now: () => FIXED_NOW,
    readLog,
    upsertPatch,
    listOccupantsByEssid,
    listLeasesByEssid,
    findPatches,
    // Default: the caller stands at home on this ESSID at its lease, holding no shell —
    // so the server derives the source address from here, and a crafted `source_ip` on
    // the wire is ignored. Hop tests override `findActiveSession`.
    findActiveSession: async () => ({ data: null, error: null }),
    findHomeVantage: async () => ({ data: { essid: ESSID, octet: SOURCE_OCTET }, error: null }),
    findWorkstationLease: async () => ({ data: null, error: null }),
    ...over,
  };
  return { deps, upsertPatch, readLog, listOccupantsByEssid, listLeasesByEssid, findPatches };
};

// The octet the caller holds at home, and the address a line it leaves records — the
// source the server derives, now that the client no longer sends one.
const SOURCE_OCTET = ((): number => {
  const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])));
  const free = Array.from({ length: 253 }, (_unused, index) => index + 2).find(
    (octet) => !taken.has(octet),
  );
  if (free === undefined) throw new Error('expected a free octet for the caller lease');
  return free;
})();
const HOME_SOURCE = lanAddressFor(ESSID, SOURCE_OCTET);

const httpPortOf = (host: LanHost): number | null => {
  const open = readOpenPorts(buildRemoteHostFs(ESSID, host)).find(
    (entry) => entry.service === SERVICE_CATALOG.http.service,
  );
  return open === undefined ? null : open.port;
};

/** A generated NPC sibling on the caller's LAN that actually serves a page. */
const servingHost = (): LanHost => {
  const found = generateHomeLan(ESSID).hosts.find(
    (host) => host.kind === 'machine' && httpPortOf(host) !== null,
  );
  if (found === undefined) throw new Error('expected a serving host on the generated LAN');
  return found;
};

/** A generated NPC sibling that answers nothing on the web port. */
const silentHost = (): LanHost => {
  const found = generateHomeLan(ESSID).hosts.find(
    (host) => host.kind === 'machine' && httpPortOf(host) === null,
  );
  if (found === undefined) throw new Error('expected a non-serving host on the generated LAN');
  return found;
};

const portsOf = (host: LanHost) => readOpenPorts(buildRemoteHostFs(ESSID, host));

/** A generated sibling that runs BOTH ssh and a web server — the box that proves the
 *  port check picks the web service out of a list rather than demanding it be alone. */
const alsoSshHost = (): { readonly host: LanHost; readonly port: number } => {
  const found = generateHomeLan(ESSID).hosts.find(
    (host) =>
      host.kind === 'machine' &&
      httpPortOf(host) !== null &&
      portsOf(host).some((entry) => entry.service === SERVICE_CATALOG.ssh.service),
  );
  if (found === undefined) throw new Error('expected an ssh-AND-web host on the generated LAN');
  return { host: found, port: httpPortOf(found)! };
};

/** A generated sibling that runs ssh and NO web server, with the port ssh listens on —
 *  a reachable box whose open port answered nothing a fetch could have asked for. */
const sshOnlyHost = (): { readonly host: LanHost; readonly port: number } => {
  for (const host of generateHomeLan(ESSID).hosts) {
    if (host.kind !== 'machine' || httpPortOf(host) !== null) continue;
    const ssh = portsOf(host).find((entry) => entry.service === SERVICE_CATALOG.ssh.service);
    if (ssh !== undefined) return { host, port: ssh.port };
  }
  throw new Error('expected an ssh-but-not-web host on the generated LAN');
};

/** What a generated host actually serves at `requestPath` — the same read the handler
 *  must do, so the expected size is the real page's, never a number we invented. */
const servedBy = (host: LanHost, requestPath: string): string | null => {
  const filePath = resolveWebPath(requestPath);
  if (filePath === null) return null;
  const read = createFsView(buildRemoteHostFs(ESSID, host), { userType: 'root' }).read(filePath);
  return read.ok ? read.content : null;
};

/** An octet no generated host occupies — the caller's own lease has to be somewhere
 *  the LAN generator did not already put a box. */
const freeOctet = (): number => {
  const taken = new Set(generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])));
  const free = Array.from({ length: 253 }, (_, index) => index + 2).find(
    (octet) => !taken.has(octet),
  );
  if (free === undefined) throw new Error('expected a free octet on the generated LAN');
  return free;
};

const OWN_WS = 'ws-machine-1';

const ownOccupant = (caller: ReturnType<typeof generateIdentity>): FetchOccupant => ({
  owner_key: caller.publicKeyHex,
  workstation_machine_id: OWN_WS,
  workstation_username: 'neo',
  workstation_root_hash: 'e10adc3949ba59abbe56e057f20f883e',
});

/** A workstation only serves once the player has started a web server: the pidfile is
 *  a journal patch, not part of the seeded box. */
const nginxUp = (caller: ReturnType<typeof generateIdentity>): OwnerPatchRow => ({
  path: '/var/run/nginx.pid',
  content: 'nginx:port=80',
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-07-30T00:00:00.000Z',
  writer_key: caller.publicKeyHex,
});

/** Deps for a caller who holds `octet` on this LAN and whose own box IS serving — the
 *  arrangement in which a self-fetch produces a line, so a test can show one read
 *  failing takes that line away. */
const selfServingDeps = (
  caller: ReturnType<typeof generateIdentity>,
  octet: number,
  over: Partial<RecordLanFetchDeps> = {},
) =>
  makeDeps({
    listOccupantsByEssid: async () => ({ data: [ownOccupant(caller)], error: null }),
    listLeasesByEssid: async () => ({
      data: [{ owner_key: caller.publicKeyHex, octet }],
      error: null,
    }),
    findPatches: async () => ({ data: [nginxUp(caller)], error: null }),
    ...over,
  });

const envelope = (
  id: ReturnType<typeof generateIdentity>,
  fetched: { readonly target: string; readonly port: number; readonly paths: readonly string[] },
  over: Record<string, unknown> = {},
) =>
  signRequest(id, 'recordLanFetch', {
    essid: ESSID,
    target: fetched.target,
    port: fetched.port,
    paths: fetched.paths,
    ...over,
  });

/** The one patch row the handler should have written, whatever else it did. */
const writtenLog = (upsertPatch: ReturnType<typeof makeDeps>['upsertPatch']): PatchRow => {
  const calls = upsertPatch.mock.calls.filter(([row]) => row.path === ACCESS_LOG_PATH);
  if (calls.length !== 1) throw new Error(`expected one access.log write, saw ${calls.length}`);
  return calls[0]![0];
};

describe('handleRecordLanFetch', () => {
  it('refuses a request whose envelope does not verify, and writes nothing', async () => {
    const { deps, upsertPatch } = makeDeps();
    const host = servingHost();

    const result = await handleRecordLanFetch(
      { action: 'recordLanFetch', essid: ESSID, target: host.ip, port: 80, paths: ['/'] },
      deps,
    );

    expect(result).toEqual({ status: 400, body: { error: 'envelope_invalid' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller who names their own player key rather than proving it', async () => {
    // The server stamps the writer from the VERIFIED pubkey. A payload carrying one
    // is a caller trying to write as somebody else, so the envelope is refused
    // outright rather than quietly ignoring the field.
    const caller = generateIdentity();
    const host = servingHost();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordLanFetch(
      await envelope(
        caller,
        { target: host.ip, port: httpPortOf(host)!, paths: ['/'] },
        { player_key: 'b'.repeat(64) },
      ),
      deps,
    );

    expect(result.status).not.toBe(200);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a properly signed request that names no path', async () => {
    // The lines are written ABOUT the paths, so defaulting them would let a caller
    // omit the one field the record is of. An EMPTY list is the same omission spelt
    // differently. Signed correctly in both cases, so it is the SHAPE that is refused
    // — not the signature.
    const caller = generateIdentity();
    const host = servingHost();

    for (const missing of [{}, { paths: [] }]) {
      const { deps, upsertPatch } = makeDeps();

      const result = await handleRecordLanFetch(
        await signRequest(caller, 'recordLanFetch', {
          essid: ESSID,
          target: host.ip,
          port: httpPortOf(host)!,
          ...missing,
        }),
        deps,
      );

      expect(result).toEqual({ status: 400, body: { error: 'payload_invalid' } });
      expect(upsertPatch).not.toHaveBeenCalled();
    }
  });

  it('records the fetch on the LAN host that served it, under the network’s own key', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    // The source the server derives for a caller at home — the client sends none.
    const sourceIp = HOME_SOURCE;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }),
      deps,
    );

    // The row is keyed to the NETWORK: a generated host has no owner, and every occupant
    // of the WiFi fetches from the identical box, so a row per fetcher would let each
    // visit erase the lines of the last.
    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
    expect(row.writer_key).toBe(apGatewayLogWriterKey(ESSID));
    expect(row.owner).toBe(ACCESS_LOG_OWNER);
    expect(row.permissions).toEqual(ACCESS_LOG_PERMISSIONS);
    expect(row.content).toBe(
      `${formatAccessLogLine({
        time: asGameTime(FIXED_NOW),
        sourceIp,
        path: '/',
        status: 200,
        size: servedBy(host, '/')!.length,
      })}\n`,
    );
  });

  it('records a self-fetch on the caller own workstation, where they can read it at once', async () => {
    const caller = generateIdentity();
    const stranger = generateIdentity();
    const octet = SOURCE_OCTET;
    const occupant = ownOccupant(caller);
    const started = nginxUp(caller);
    const ownIp = lanAddressFor(ESSID, octet);
    const { deps, upsertPatch } = makeDeps({
      // A fellow occupant listed FIRST: the caller has to be picked out of the LAN's
      // occupancy by key, or a two-player network files the line on the wrong box.
      listOccupantsByEssid: async () => ({
        data: [
          {
            owner_key: stranger.publicKeyHex,
            workstation_machine_id: 'somebody-elses-box',
            workstation_username: 'trinity',
            workstation_root_hash: 'e10adc3949ba59abbe56e057f20f883e',
          },
          occupant,
        ],
        error: null,
      }),
      listLeasesByEssid: async () => ({
        data: [
          { owner_key: stranger.publicKeyHex, octet: octet + 1 },
          { owner_key: caller.publicKeyHex, octet },
        ],
        error: null,
      }),
      findPatches: async () => ({ data: [started], error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: ownIp, port: 80, paths: ['/'] }),
      deps,
    );

    const own = materializeWorkstationFs(occupant, [started]);
    const page = createFsView(own, { userType: 'root' }).read(resolveWebPath('/')!);
    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(OWN_WS);
    expect(row.writer_key).toBe(caller.publicKeyHex);
    expect(row.content).toBe(
      `${formatAccessLogLine({
        time: asGameTime(FIXED_NOW),
        sourceIp: ownIp,
        path: '/',
        status: 200,
        size: page.ok ? page.content.length : -1,
      })}\n`,
    );
  });

  it('records a loopback fetch at home on the caller own workstation, as a local visit', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = selfServingDeps(caller, SOURCE_OCTET);

    await handleRecordLanFetch(
      await envelope(caller, { target: '127.0.0.1', port: 80, paths: ['/'] }),
      deps,
    );

    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(OWN_WS);
    expect(row.writer_key).toBe(caller.publicKeyHex);
    expect(row.content).toMatch(/^127\.0\.0\.1 - - \[/);
  });

  it('records a loopback fetch on the caller own workstation when they name it as where they stand', async () => {
    const caller = generateIdentity();
    // A player's box is the one kind the network does not generate, so naming it finds
    // nothing to rebuild and the lease they hold is what places it.
    const ownId = computeWorkstationId('nebuchadnezzar', caller.publicKeyHex);
    const { deps, upsertPatch } = selfServingDeps(caller, SOURCE_OCTET, {
      listOccupantsByEssid: async () => ({
        data: [{ ...ownOccupant(caller), workstation_machine_id: ownId }],
        error: null,
      }),
    });

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: '127.0.0.1', port: 80, paths: ['/'] },
        { caller_machine_id: ownId },
      ),
      deps,
    );

    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(ownId);
    expect(row.writer_key).toBe(caller.publicKeyHex);
    expect(row.content).toMatch(/^127\.0\.0\.1 - - \[/);
  });

  it('lands on the NEIGHBOUR a registered occupant fetched, never on their own box', async () => {
    // The dangerous confusion: the caller IS an occupant with a workstation, so the
    // occupancy lookup would happily hand back their own box. Only the address decides
    // — a fetch of somebody else's must be recorded on somebody else's.
    const caller = generateIdentity();
    const octet = freeOctet();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps({
      listOccupantsByEssid: async () => ({
        data: [
          {
            owner_key: caller.publicKeyHex,
            workstation_machine_id: 'the-callers-own-box',
            workstation_username: 'neo',
            workstation_root_hash: 'e10adc3949ba59abbe56e057f20f883e',
          },
        ],
        error: null,
      }),
      listLeasesByEssid: async () => ({
        data: [{ owner_key: caller.publicKeyHex, octet }],
        error: null,
      }),
    });

    await handleRecordLanFetch(await envelope(caller, { target: host.ip, port, paths: ['/'] }), deps);

    expect(writtenLog(upsertPatch).machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
  });

  it('reads the caller own journal by machine id, not whatever the store hands back', async () => {
    const caller = generateIdentity();
    const octet = freeOctet();
    const occupant: FetchOccupant = {
      owner_key: caller.publicKeyHex,
      workstation_machine_id: 'ws-machine-7',
      workstation_username: 'neo',
      workstation_root_hash: 'e10adc3949ba59abbe56e057f20f883e',
    };
    const { deps, findPatches } = makeDeps({
      listOccupantsByEssid: async () => ({ data: [occupant], error: null }),
      listLeasesByEssid: async () => ({
        data: [{ owner_key: caller.publicKeyHex, octet }],
        error: null,
      }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: lanAddressFor(ESSID, octet), port: 80, paths: ['/'] }),
      deps,
    );

    expect(findPatches).toHaveBeenCalledWith({ machine_id: 'ws-machine-7' });
  });

  it('records a whole sweep as one append, a line per path, in the order asked', async () => {
    // The volume IS the behaviour: a defender tells a sweep from a typo by the run of
    // misses around the hit, so every probe lands and the order survives. One append
    // rather than one round-trip per word — a forty-word list would otherwise be forty
    // signed requests each re-reading and re-writing the whole log.
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const sourceIp = HOME_SOURCE;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/admin', '/', '/backup'] }),
      deps,
    );

    const line = (path: string, status: number, size: number) =>
      formatAccessLogLine({ time: asGameTime(FIXED_NOW), sourceIp, path, status, size });
    // `writtenLog` throws unless there was exactly ONE access.log write.
    expect(writtenLog(upsertPatch).content).toBe(
      [
        line('/admin', 404, 0),
        line('/', 200, servedBy(host, '/')!.length),
        line('/backup', 404, 0),
        '',
      ].join('\n'),
    );
  });

  it('stamps every line of a sweep with the one time the request arrived', async () => {
    // The server handled a single request, so it reads its clock once. A stamp per
    // line would spread one arrival across a span the server never observed.
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    let readings = 0;
    const { deps, upsertPatch } = makeDeps({
      now: () => FIXED_NOW + 60_000 * readings++,
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/', '/admin'] }),
      deps,
    );

    const stamps = (writtenLog(upsertPatch).content ?? '')
      .trimEnd()
      .split('\n')
      .map((line) => line.slice(line.indexOf('['), line.indexOf(']') + 1));
    expect(stamps).toEqual(['[30/Jul/2026:04:07:09 +0000]', '[30/Jul/2026:04:07:09 +0000]']);
  });

  it('records a miss as a 404 with an empty body — the line a directory sweep leaves', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const sourceIp = HOME_SOURCE;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/wp-admin/setup-config.php'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toBe(
      `${formatAccessLogLine({
        time: asGameTime(FIXED_NOW),
        sourceIp,
        path: '/wp-admin/setup-config.php',
        status: 404,
        size: 0,
      })}\n`,
    );
  });

  it('records a traversal attempt verbatim, as asked for rather than as resolved', async () => {
    // The resolved path would say nothing happened. What the defender needs to see is
    // what the caller actually typed.
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/../../etc/passwd'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain('"GET /../../etc/passwd HTTP/1.1" 404 0');
  });

  it('leaves no line on a host that resolves but serves no web', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordLanFetch(
      await envelope(caller, { target: silentHost().ip, port: 80, paths: ['/'] }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('leaves no line on a box whose open port is ssh rather than a web server', async () => {
    // Reaching a listening daemon is not reaching a web server. The port matches
    // exactly; the SERVICE behind it is what refuses.
    const caller = generateIdentity();
    const ssh = sshOnlyHost();
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: ssh.host.ip, port: ssh.port, paths: ['/'] }),
      deps,
    );

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records the fetch on a box that runs ssh AND a web server', async () => {
    // The web service has to be picked OUT of the open-port list, not required to be
    // the only thing on it — most real boxes run more than one daemon.
    const caller = generateIdentity();
    const { host, port } = alsoSshHost();
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(await envelope(caller, { target: host.ip, port, paths: ['/'] }), deps);

    expect(writtenLog(upsertPatch).machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
  });

  it('leaves no line when a read failed, even though it came back holding rows', async () => {
    // A store that reports an error is not trusted for the rows it also returned:
    // acting on them would misfile the line — onto the caller's own box when it was a
    // neighbour they fetched, or onto a stale idea of whether their server is running.
    // Each case is arranged so that IGNORING the error would produce a line.
    const caller = generateIdentity();
    const octet = freeOctet();
    const ownIp = lanAddressFor(ESSID, octet);
    const failed = new Error('read failed');

    const failingReads: readonly Partial<RecordLanFetchDeps>[] = [
      {
        listLeasesByEssid: async () => ({
          data: [{ owner_key: caller.publicKeyHex, octet }],
          error: failed,
        }),
      },
      {
        listOccupantsByEssid: async () => ({ data: [ownOccupant(caller)], error: failed }),
      },
      {
        findPatches: async () => ({ data: [nginxUp(caller)], error: failed }),
      },
    ];

    for (const failing of failingReads) {
      const { deps, upsertPatch } = selfServingDeps(caller, octet, failing);

      await handleRecordLanFetch(
        await envelope(caller, { target: ownIp, port: 80, paths: ['/'] }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    }
  });

  it('leaves no line when the occupancy read knows nothing of the caller', async () => {
    // They hold a lease but have no registered workstation, so there is no box of
    // theirs for the line to land on.
    const caller = generateIdentity();
    const octet = freeOctet();
    const ownIp = lanAddressFor(ESSID, octet);

    for (const empty of [
      async () => ({ data: null, error: null }),
      async () => ({ data: [], error: null }),
    ]) {
      const { deps, upsertPatch } = selfServingDeps(caller, octet, {
        listOccupantsByEssid: empty,
      });

      await handleRecordLanFetch(
        await envelope(caller, { target: ownIp, port: 80, paths: ['/'] }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    }
  });

  it('leaves no line on the caller own box while their web server is not running', async () => {
    const caller = generateIdentity();
    const octet = freeOctet();
    const { deps, upsertPatch } = selfServingDeps(caller, octet, {
      // A fresh box: nothing has ever been started on it.
      findPatches: async () => ({ data: [], error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: lanAddressFor(ESSID, octet), port: 80, paths: ['/'] }),
      deps,
    );

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('leaves no line when the lease store holds nothing at all', async () => {
    // No lease is no address: the caller's own box cannot be the target of an address
    // they were never issued, so this falls through to the generated LAN and finds
    // nothing there either.
    const caller = generateIdentity();
    const octet = freeOctet();

    for (const empty of [
      async () => ({ data: null, error: null }),
      async () => ({ data: [], error: null }),
    ]) {
      const { deps, upsertPatch } = selfServingDeps(caller, octet, { listLeasesByEssid: empty });

      await handleRecordLanFetch(
        await envelope(caller, { target: lanAddressFor(ESSID, octet), port: 80, paths: ['/'] }),
        deps,
      );

      expect(upsertPatch).not.toHaveBeenCalled();
    }
  });

  it('records a page the player published as root, which only root can read', async () => {
    // The server serves the document root under its OWN account, never the
    // requester's: a page the player wrote at root tier is root-only by default, and
    // reading it as the caller would record a 404 for a page that was served.
    const caller = generateIdentity();
    const octet = freeOctet();
    const occupant: FetchOccupant = {
      owner_key: caller.publicKeyHex,
      workstation_machine_id: 'ws-machine-1',
      workstation_username: 'neo',
      workstation_root_hash: 'e10adc3949ba59abbe56e057f20f883e',
    };
    const journal: readonly OwnerPatchRow[] = [
      {
        path: '/var/run/nginx.pid',
        content: 'nginx:port=80',
        owner: 'root',
        permissions: null,
        node_type: 'file',
        updated_at: '2026-07-30T00:00:00.000Z',
        writer_key: caller.publicKeyHex,
      },
      {
        path: '/var/www/html/index.html',
        content: '<html>mine</html>',
        owner: 'root',
        permissions: { read: ['root'], write: ['root'], execute: [] },
        node_type: 'file',
        updated_at: '2026-07-30T00:00:01.000Z',
        writer_key: caller.publicKeyHex,
      },
    ];
    const { deps, upsertPatch } = makeDeps({
      listOccupantsByEssid: async () => ({ data: [occupant], error: null }),
      listLeasesByEssid: async () => ({
        data: [{ owner_key: caller.publicKeyHex, octet }],
        error: null,
      }),
      findPatches: async () => ({ data: journal, error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: lanAddressFor(ESSID, octet), port: 80, paths: ['/'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain('"GET / HTTP/1.1" 200 17');
  });

  it('leaves no line on a serving host asked for a port it is not listening on', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port: httpPortOf(host)! + 1, paths: ['/'] }),
      deps,
    );

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('leaves no line for an address no host on the LAN holds', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordLanFetch(
      await envelope(caller, {
        target: lanAddressFor(ESSID, freeOctet()),
        port: 80,
        paths: ['/'],
      }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('accretes: a second fetch appends below the first rather than replacing it', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const earlier = '10.0.0.9 - - [29/Jul/2026:11:00:00 +0000] "GET / HTTP/1.1" 200 12';
    const sourceIp = HOME_SOURCE;
    const { deps, upsertPatch } = makeDeps({
      readLog: async () => logRead(`${earlier}\n`),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }),
      deps,
    );

    const added = formatAccessLogLine({
      time: asGameTime(FIXED_NOW),
      sourceIp,
      path: '/',
      status: 200,
      size: servedBy(host, '/')!.length,
    });
    expect(writtenLog(upsertPatch).content).toBe(`${earlier}\n${added}\n`);
  });

  it('records a caller it cannot place at an address as `unknown` rather than blank', async () => {
    // The caller occupies the network but holds no lease on it, so the server has no
    // address to put them at. The line is still written — the visit happened — with the
    // source left as `unknown`, never blank.
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: ESSID, octet: null }, error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain('unknown - - [');
  });

  it('ignores a client-supplied machine id: the server decides where the line lands', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: host.ip, port, paths: ['/'] },
        { machine_id: 'somebody-elses-box' },
      ),
      deps,
    );

    expect(writtenLog(upsertPatch).machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
  });

  it('ignores a client-supplied status and size: the server reads the page itself', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: host.ip, port, paths: ['/'] },
        { status: 500, size: 999999, time: 0 },
      ),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain(
      `"GET / HTTP/1.1" 200 ${servedBy(host, '/')!.length}`,
    );
  });

  it('answers the caller even when the log write fails — recording is best-effort', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps } = makeDeps({
      upsertPatch: async () => ({ error: new Error('write refused') }),
    });

    const result = await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
  });
});

describe('handleRecordLanFetch — a caller standing on a hop', () => {
  // Deps for a caller whose only place is the shell they hold on `essid`; they occupy
  // no network at home, so the vantage comes entirely from the session row.
  const shellOn = (essid: string): Partial<RecordLanFetchDeps> => ({
    findActiveSession: async () => ({
      data: { username: 'root', userType: 'root', essid },
      error: null,
    }),
    findHomeVantage: async () => ({ data: null, error: null }),
  });

  const hopEnvelope = (
    id: ReturnType<typeof generateIdentity>,
    essid: string,
    fetched: { readonly target: string; readonly port: number; readonly paths: readonly string[] },
    callerMachineId: string,
  ) =>
    signRequest(id, 'recordLanFetch', {
      essid,
      target: fetched.target,
      port: fetched.port,
      paths: fetched.paths,
      caller_machine_id: callerMachineId,
    });

  /** The first crackable network whose inner ROUTER fronts a layer with a web host: the
   *  essid, that gateway (the hop), the fronted layer's subnet, and the host + port. */
  const deepWebTarget = (): {
    readonly essid: string;
    readonly gateway: ChainLink;
    readonly subnet: string;
    readonly host: LanHost;
    readonly machineId: string;
    readonly port: number;
  } => {
    for (const essid of crackableEssidPool) {
      for (const gateway of chainLinks(essid)) {
        if (gateway.host.kind !== 'router') continue;
        const layer = generateDeepLayer(
          essid,
          { machineId: gateway.machineId, kind: gateway.host.kind },
          { hangsChild: gateway.hangsChild },
        );
        const web = resolveDeepScanHosts(essid, gateway, chainGatewayBaseFs(essid, gateway)).hosts.find(
          (entry) => entry.host.kind === 'machine' && entry.ports.some((p) => p.service === 'http'),
        );
        if (web !== undefined) {
          const port = web.ports.find((p) => p.service === 'http')!.port;
          return {
            essid,
            gateway,
            subnet: layer.subnet,
            host: web.host,
            machineId: hostMachineId(web.host, essid),
            port,
          };
        }
      }
    }
    throw new Error('expected a crackable network with a web host on a router-fronted layer');
  };

  it('refuses a caller standing on another network, and writes nothing', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps(shellOn('SOME-OTHER-WIFI'));

    const result = await handleRecordLanFetch(
      hopEnvelope(caller, ESSID, { target: host.ip, port, paths: ['/'] }, 'a-box-on-another-net'),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'wrong_network' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller who holds no shell on the box they name, and writes nothing', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
      findHomeVantage: async () => ({ data: null, error: null }),
    });

    const result = await handleRecordLanFetch(
      hopEnvelope(caller, ESSID, { target: host.ip, port, paths: ['/'] }, 'a-box-i-do-not-hold'),
      deps,
    );

    expect(result).toEqual({ status: 403, body: { error: 'no_session' } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records a fetch of a web host on a deep layer, under the address the box is seen at there', async () => {
    const caller = generateIdentity();
    const deep = deepWebTarget();
    const { deps, upsertPatch } = makeDeps(shellOn(deep.essid));

    await handleRecordLanFetch(
      hopEnvelope(
        caller,
        deep.essid,
        { target: deep.host.ip, port: deep.port, paths: ['/'] },
        deep.gateway.machineId,
      ),
      deps,
    );

    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(deep.machineId);
    expect(row.writer_key).toBe(apGatewayLogWriterKey(deep.essid));
    // A gateway fronting a layer is seen there at the layer's `.1`.
    expect(row.content).toContain(`${deep.subnet}.1 - - [`);
    expect(row.content).toContain('" 200 ');
  });

  it('surfaces a 500 when a fronting switch’s journal cannot be read, and writes nothing', async () => {
    const caller = generateIdentity();
    // A network whose inner gateway is a SWITCH: the layer's ACL lives on its journal,
    // and a read failure there cannot be waved through as an open port.
    const essid = crackableEssidPool.find((candidate) =>
      chainLinks(candidate).some((link) => link.host.kind === 'switch'),
    )!;
    const theSwitch = chainLinks(essid).find((link) => link.host.kind === 'switch')!;
    const layer = generateDeepLayer(
      essid,
      { machineId: theSwitch.machineId, kind: theSwitch.host.kind },
      { hangsChild: theSwitch.hangsChild },
    );
    const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
    const { deps, upsertPatch } = makeDeps({ ...shellOn(essid), findPatches });

    const result = await handleRecordLanFetch(
      hopEnvelope(
        caller,
        essid,
        { target: layer.host.ip, port: 80, paths: ['/'] },
        theSwitch.machineId,
      ),
      deps,
    );

    expect(result).toEqual({ status: 500, body: { error: 'patches_lookup_failed' } });
    expect(findPatches).toHaveBeenCalledWith({ machine_id: theSwitch.machineId });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records a loopback fetch on the hop box itself, as a local visit', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const hopMachineId = machineIdForLanHost(host, ESSID);
    const { deps, upsertPatch } = makeDeps(shellOn(ESSID));

    await handleRecordLanFetch(
      hopEnvelope(caller, ESSID, { target: '127.0.0.1', port: httpPortOf(host)!, paths: ['/'] }, hopMachineId),
      deps,
    );

    const row = writtenLog(upsertPatch);
    // The hop box is a generated NPC, so its log accretes under the network's key, and
    // the line says the visit came over loopback.
    expect(row.machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
    expect(row.writer_key).toBe(apGatewayLogWriterKey(ESSID));
    expect(row.content).toContain('127.0.0.1 - - [');
  });

  it('records a loopback fetch on a box on a deep layer on that box, never on the gateway in front', async () => {
    const caller = generateIdentity();
    const deep = deepWebTarget();
    const { deps, upsertPatch } = makeDeps(shellOn(deep.essid));

    await handleRecordLanFetch(
      hopEnvelope(
        caller,
        deep.essid,
        { target: '127.0.0.1', port: deep.port, paths: ['/'] },
        deep.machineId,
      ),
      deps,
    );

    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(deep.machineId);
    expect(row.writer_key).toBe(apGatewayLogWriterKey(deep.essid));
    expect(row.content).toMatch(/^127\.0\.0\.1 - - \[/);
    expect(row.content).toContain('" 200 ');
  });

  it('leaves no line for a loopback fetch of a port the hop box serves no web on', async () => {
    const caller = generateIdentity();
    const deep = deepWebTarget();
    const { deps, upsertPatch } = makeDeps(shellOn(deep.essid));

    const result = await handleRecordLanFetch(
      hopEnvelope(
        caller,
        deep.essid,
        { target: '127.0.0.1', port: deep.port + 1, paths: ['/'] },
        deep.machineId,
      ),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

describe('handleRecordLanFetch — a deep layer fronted by a switch', () => {
  const shellOn = (essid: string): Partial<RecordLanFetchDeps> => ({
    findActiveSession: async () => ({
      data: { username: 'root', userType: 'root', essid },
      error: null,
    }),
    findHomeVantage: async () => ({ data: null, error: null }),
  });

  const hopEnvelope = (
    id: ReturnType<typeof generateIdentity>,
    essid: string,
    target: string,
    port: number,
    callerMachineId: string,
  ) => signRequest(id, 'recordLanFetch', { essid, target, port, paths: ['/'], caller_machine_id: callerMachineId });

  const aclPatch = (content: string): OwnerPatchRow => ({
    path: '/etc/switch/acl.conf',
    content,
    owner: 'root',
    permissions: null,
    node_type: 'file',
    updated_at: '2026-06-19T00:00:00.000Z',
    writer_key: 'a'.repeat(64),
  });

  /** The first crackable network whose inner SWITCH fronts a layer with a web host. */
  const switchWeb = (): {
    readonly essid: string;
    readonly switchMachineId: string;
    readonly subnet: string;
    readonly hostId: string;
    readonly ip: string;
    readonly port: number;
  } => {
    for (const essid of crackableEssidPool) {
      for (const gateway of chainLinks(essid)) {
        if (gateway.host.kind !== 'switch') continue;
        const layer = generateDeepLayer(
          essid,
          { machineId: gateway.machineId, kind: gateway.host.kind },
          { hangsChild: gateway.hangsChild },
        );
        const web = resolveDeepScanHosts(essid, gateway, chainGatewayBaseFs(essid, gateway)).hosts.find(
          (entry) => entry.host.kind === 'machine' && entry.ports.some((p) => p.service === 'http'),
        );
        if (web !== undefined) {
          return {
            essid,
            switchMachineId: gateway.machineId,
            subnet: layer.subnet,
            hostId: hostMachineId(web.host, essid),
            ip: web.host.ip,
            port: web.ports.find((p) => p.service === 'http')!.port,
          };
        }
      }
    }
    throw new Error('expected a crackable network with a web host behind a switch');
  };

  /** The first crackable network whose inner ROUTER fronts a web host — the arm that
   *  reads no journal, so a test can prove the switch read is skipped for it. */
  const routerWeb = (): {
    readonly essid: string;
    readonly gatewayMachineId: string;
    readonly hostId: string;
    readonly ip: string;
    readonly port: number;
  } => {
    for (const essid of crackableEssidPool) {
      for (const gateway of chainLinks(essid)) {
        if (gateway.host.kind !== 'router') continue;
        const web = resolveDeepScanHosts(essid, gateway, chainGatewayBaseFs(essid, gateway)).hosts.find(
          (entry) => entry.host.kind === 'machine' && entry.ports.some((p) => p.service === 'http'),
        );
        if (web !== undefined) {
          return {
            essid,
            gatewayMachineId: gateway.machineId,
            hostId: hostMachineId(web.host, essid),
            ip: web.host.ip,
            port: web.ports.find((p) => p.service === 'http')!.port,
          };
        }
      }
    }
    throw new Error('expected a crackable network with a web host behind a router');
  };

  it('reads the switch’s live ACL and records the fetch when the web port is allowed', async () => {
    const caller = generateIdentity();
    const target = switchWeb();
    // An ACL that denies some OTHER port leaves the web port open.
    const findPatches = vi.fn(async () => ({ data: [aclPatch('deny 9999')], error: null }));
    const { deps, upsertPatch } = makeDeps({ ...shellOn(target.essid), findPatches });

    await handleRecordLanFetch(
      hopEnvelope(caller, target.essid, target.ip, target.port, target.switchMachineId),
      deps,
    );

    expect(findPatches).toHaveBeenCalledWith({ machine_id: target.switchMachineId });
    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(target.hostId);
    expect(row.content).toContain(`${target.subnet}.1 - - [`);
  });

  it('leaves no line when the switch’s ACL denies the web port', async () => {
    const caller = generateIdentity();
    const target = switchWeb();
    const { deps, upsertPatch } = makeDeps({
      ...shellOn(target.essid),
      findPatches: vi.fn(async () => ({ data: [aclPatch(`deny ${target.port}`)], error: null })),
    });

    const result = await handleRecordLanFetch(
      hopEnvelope(caller, target.essid, target.ip, target.port, target.switchMachineId),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records a loopback fetch on a box behind the switch whatever its ACL denies, reading no journal', async () => {
    const caller = generateIdentity();
    const target = switchWeb();
    // The request never leaves the box to cross the switch, so neither a deny on the web
    // port nor a journal that cannot be read stands in its way.
    const findPatches = vi.fn(async () => ({ data: null, error: new Error('db down') }));
    const { deps, upsertPatch } = makeDeps({ ...shellOn(target.essid), findPatches });

    await handleRecordLanFetch(
      hopEnvelope(caller, target.essid, '127.0.0.1', target.port, target.hostId),
      deps,
    );

    expect(findPatches).not.toHaveBeenCalled();
    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(target.hostId);
    expect(row.content).toMatch(/^127\.0\.0\.1 - - \[/);
  });

  it('reads no journal for a router-fronted layer, which filters nothing', async () => {
    const caller = generateIdentity();
    const target = routerWeb();
    const findPatches = vi.fn(async () => ({ data: [], error: null }));
    const { deps, upsertPatch } = makeDeps({ ...shellOn(target.essid), findPatches });

    await handleRecordLanFetch(
      hopEnvelope(caller, target.essid, target.ip, target.port, target.gatewayMachineId),
      deps,
    );

    expect(findPatches).not.toHaveBeenCalled();
    expect(writtenLog(upsertPatch).machine_id).toBe(target.hostId);
  });
});
