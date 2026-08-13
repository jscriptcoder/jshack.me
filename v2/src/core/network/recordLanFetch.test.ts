import { describe, expect, it, vi } from 'vitest';
import { handleRecordLanFetch, type FetchOccupant, type RecordLanFetchDeps } from './recordLanFetch';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs';
import { lanAddressFor, type LanLeaseRow } from './lanAddress';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { createFsView } from '../filesystem/fsView';
import { resolveWebPath } from './http';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog';
import { asGameTime } from '../types';
import type { MachineLogReadQuery, MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

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
    ...over,
  };
  return { deps, upsertPatch, readLog, listOccupantsByEssid, listLeasesByEssid, findPatches };
};

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
    source_ip: lanAddressFor(ESSID, freeOctet()),
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

  it('records the fetch on the LAN host that served it, under the fetcher own key', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const sourceIp = lanAddressFor(ESSID, freeOctet());
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }, { source_ip: sourceIp }),
      deps,
    );

    // The row is keyed to the CALLER: a generated host has no owner, so its log is
    // per-viewer — the fetcher is the only identity that will ever read this line.
    const row = writtenLog(upsertPatch);
    expect(row.machine_id).toBe(resolveLanHostIdentity(host, ESSID).machineId);
    expect(row.writer_key).toBe(caller.publicKeyHex);
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
    const octet = freeOctet();
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
      await envelope(caller, { target: ownIp, port: 80, paths: ['/'] }, { source_ip: ownIp }),
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
    const sourceIp = lanAddressFor(ESSID, freeOctet());
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: host.ip, port, paths: ['/admin', '/', '/backup'] },
        { source_ip: sourceIp },
      ),
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
    const sourceIp = lanAddressFor(ESSID, freeOctet());
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: host.ip, port, paths: ['/wp-admin/setup-config.php'] },
        { source_ip: sourceIp },
      ),
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
    const sourceIp = lanAddressFor(ESSID, freeOctet());
    const { deps, upsertPatch } = makeDeps({
      readLog: async () => ({ data: { content: `${earlier}\n` }, error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }, { source_ip: sourceIp }),
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

  it('records a source it was not told as `unknown` rather than leaving the field blank', async () => {
    const caller = generateIdentity();
    const host = servingHost();
    const port = httpPortOf(host)!;
    const { deps, upsertPatch } = makeDeps();

    await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port, paths: ['/'] }, { source_ip: null }),
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
