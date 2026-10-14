import { describe, expect, it, vi } from 'vitest';
import { handleRecordLanFetch, type FetchOccupant, type RecordLanFetchDeps } from './recordLanFetch.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan.js';
import { buildRemoteHostFs } from '../generation/remoteHostFs.js';
import { machineIdForLanHost } from '../generation/lanHostIdentity.js';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { formatPidfileContent, readOpenPorts } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { createFsView } from '../filesystem/fsView.js';
import { resolveWebPath } from './http.js';
import { ACCESS_LOG_PATH, formatAccessLogLine } from '../logging/accessLog.js';
import { asGameTime } from '../types.js';
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

/** The page the caller's own box publishes, and the address it holds on the LAN. */
const OWN_PAGE = '<html>mine</html>';
const OWN_IP = HOME_SOURCE;

const ownRow = (
  caller: ReturnType<typeof generateIdentity>,
  path: string,
  content: string,
): OwnerPatchRow => ({
  path,
  content,
  owner: 'root',
  permissions: null,
  node_type: 'file',
  updated_at: '2026-07-30T00:00:01.000Z',
  writer_key: caller.publicKeyHex,
});

/** The caller's own box running sshd and nothing else: an open port that is no web. */
const sshdUp = (caller: ReturnType<typeof generateIdentity>): OwnerPatchRow =>
  ownRow(
    caller,
    `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
    formatPidfileContent(SERVICE_CATALOG.ssh, SERVICE_CATALOG.ssh.defaultPort),
  );

/** Deps for a caller at home whose own box serves `OWN_PAGE` on port 80, with `journal`
 *  in place of that when a test needs another box. */
const servingOwnDeps = (
  caller: ReturnType<typeof generateIdentity>,
  over: Partial<RecordLanFetchDeps> = {},
  journal: readonly OwnerPatchRow[] = [
    nginxUp(caller),
    ownRow(caller, '/var/www/html/index.html', OWN_PAGE),
  ],
) =>
  selfServingDeps(caller, SOURCE_OCTET, {
    findPatches: async () => ({ data: journal, error: null }),
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

  it('leaves no line on a host the network generates, which the server records when it serves it', async () => {
    // A generated box is served by the server off its journal, and the visit is
    // written there in the same request. A report naming one here would be a second
    // line for one visit, or a line for a visit that never happened.
    const caller = generateIdentity();
    const host = servingHost();
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordLanFetch(
      await envelope(caller, { target: host.ip, port: httpPortOf(host)!, paths: ['/'] }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
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
    const { deps, upsertPatch } = servingOwnDeps(caller);

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/admin', '/', '/backup'] }),
      deps,
    );

    const line = (path: string, status: number, size: number) =>
      formatAccessLogLine({ time: asGameTime(FIXED_NOW), sourceIp: OWN_IP, path, status, size });
    // `writtenLog` throws unless there was exactly ONE access.log write.
    expect(writtenLog(upsertPatch).content).toBe(
      [line('/admin', 404, 0), line('/', 200, OWN_PAGE.length), line('/backup', 404, 0), ''].join(
        '\n',
      ),
    );
  });

  it('stamps every line of a sweep with the one time the request arrived', async () => {
    // The server handled a single request, so it reads its clock once. A stamp per
    // line would spread one arrival across a span the server never observed.
    const caller = generateIdentity();
    let readings = 0;
    const { deps, upsertPatch } = servingOwnDeps(caller, {
      now: () => FIXED_NOW + 60_000 * readings++,
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/', '/admin'] }),
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
    const { deps, upsertPatch } = servingOwnDeps(caller);

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/wp-admin/setup-config.php'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toBe(
      `${formatAccessLogLine({
        time: asGameTime(FIXED_NOW),
        sourceIp: OWN_IP,
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
    const { deps, upsertPatch } = servingOwnDeps(caller);

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/../../etc/passwd'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain('"GET /../../etc/passwd HTTP/1.1" 404 0');
  });

  it('leaves no line on a box whose open port is ssh rather than a web server', async () => {
    // Reaching a listening daemon is not reaching a web server. The port matches
    // exactly; the SERVICE behind it is what refuses.
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller, {}, [sshdUp(caller)]);

    await handleRecordLanFetch(
      await envelope(caller, {
        target: OWN_IP,
        port: SERVICE_CATALOG.ssh.defaultPort,
        paths: ['/'],
      }),
      deps,
    );

    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('records the fetch on a box that runs ssh AND a web server', async () => {
    // The web service has to be picked OUT of the open-port list, not required to be
    // the only thing on it — most real boxes run more than one daemon.
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller, {}, [sshdUp(caller), nginxUp(caller)]);

    await handleRecordLanFetch(await envelope(caller, { target: OWN_IP, port: 80, paths: ['/'] }), deps);

    expect(writtenLog(upsertPatch).machine_id).toBe(OWN_WS);
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

  it('leaves no line on a serving box asked for a port it is not listening on', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller);

    const result = await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 81, paths: ['/'] }),
      deps,
    );

    // Nothing answered, which is not a failure of the report: the caller is told it landed.
    expect(result).toEqual({ status: 200, body: { ok: true } });
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
    const earlier = '10.0.0.9 - - [29/Jul/2026:11:00:00 +0000] "GET / HTTP/1.1" 200 12';
    const { deps, upsertPatch } = servingOwnDeps(caller, {
      readLog: async () => logRead(`${earlier}\n`),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/'] }),
      deps,
    );

    const added = formatAccessLogLine({
      time: asGameTime(FIXED_NOW),
      sourceIp: OWN_IP,
      path: '/',
      status: 200,
      size: OWN_PAGE.length,
    });
    expect(writtenLog(upsertPatch).content).toBe(`${earlier}\n${added}\n`);
  });

  it('records a caller it cannot place at an address as `unknown` rather than blank', async () => {
    // The caller's vantage holds no address, so the server has nowhere to put them. The
    // line is still written — the visit happened — with the source left as `unknown`,
    // never blank.
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller, {
      findHomeVantage: async () => ({ data: { essid: ESSID, octet: null }, error: null }),
    });

    await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/'] }),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain('unknown - - [');
  });

  it('ignores a client-supplied machine id: the server decides where the line lands', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller);

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: OWN_IP, port: 80, paths: ['/'] },
        { machine_id: 'somebody-elses-box' },
      ),
      deps,
    );

    expect(writtenLog(upsertPatch).machine_id).toBe(OWN_WS);
  });

  it('ignores a client-supplied status and size: the server reads the page itself', async () => {
    const caller = generateIdentity();
    const { deps, upsertPatch } = servingOwnDeps(caller);

    await handleRecordLanFetch(
      await envelope(
        caller,
        { target: OWN_IP, port: 80, paths: ['/'] },
        { status: 500, size: 999999, time: 0 },
      ),
      deps,
    );

    expect(writtenLog(upsertPatch).content).toContain(`"GET / HTTP/1.1" 200 ${OWN_PAGE.length}`);
  });

  it('answers the caller even when the log write fails — recording is best-effort', async () => {
    const caller = generateIdentity();
    const { deps } = servingOwnDeps(caller, {
      upsertPatch: async () => ({ error: new Error('write refused') }),
    });

    const result = await handleRecordLanFetch(
      await envelope(caller, { target: OWN_IP, port: 80, paths: ['/'] }),
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

  it('leaves no line for a fetch in a shell on a box the network generates', async () => {
    // The server serves that box off its journal and records the visit as it does, by
    // loopback, by its own address, or on a deep layer the shell reaches.
    const caller = generateIdentity();
    const host = servingHost();
    const hopMachineId = machineIdForLanHost(host, ESSID);
    const { deps, upsertPatch } = makeDeps(shellOn(ESSID));

    for (const target of ['127.0.0.1', host.ip]) {
      await handleRecordLanFetch(
        hopEnvelope(caller, ESSID, { target, port: httpPortOf(host)!, paths: ['/'] }, hopMachineId),
        deps,
      );
    }

    expect(upsertPatch).not.toHaveBeenCalled();
  });

});

describe('handleRecordLanFetch — a caller in a shell on another player’s workstation', () => {
  const OWNER_WS = 'the-owners-workstation';

  /** Octets no generated host occupies, one for each player a test seats on the LAN. */
  const [OWNER_OCTET, VISITOR_OCTET, BYSTANDER_OCTET] = ((): readonly number[] => {
    const taken = new Set(
      generateHomeLan(ESSID).hosts.map((host) => Number(host.ip.split('.')[3])),
    );
    return Array.from({ length: 253 }, (_unused, index) => index + 2)
      .filter((octet) => !taken.has(octet))
      .slice(0, 3);
  })() as readonly [number, number, number];
  const OWNER_IP = lanAddressFor(ESSID, OWNER_OCTET);

  type Resident = { readonly occupant: FetchOccupant; readonly octet: number };

  const resident = (
    player: ReturnType<typeof generateIdentity>,
    machineId: string,
    octet: number,
  ): Resident => ({
    occupant: { ...ownOccupant(player), workstation_machine_id: machineId },
    octet,
  });

  /** Deps for a visitor whose place on the network is the shell they hold on the owner's
   *  workstation. Every workstation on the LAN is serving the web, so a line filed on the
   *  wrong one would be written rather than quietly dropped. */
  const shellOnOwnerBox = (
    owner: ReturnType<typeof generateIdentity>,
    others: readonly Resident[] = [],
  ) => {
    const residents = [resident(owner, OWNER_WS, OWNER_OCTET), ...others];
    return makeDeps({
      findActiveSession: async () => ({
        data: { username: 'guest', userType: 'guest', essid: ESSID },
        error: null,
      }),
      findHomeVantage: async () => ({ data: null, error: null }),
      findWorkstationLease: async () => ({ data: OWNER_OCTET, error: null }),
      listOccupantsByEssid: async () => ({
        data: residents.map((entry) => entry.occupant),
        error: null,
      }),
      listLeasesByEssid: async () => ({
        data: residents.map((entry) => ({
          owner_key: entry.occupant.owner_key,
          octet: entry.octet,
        })),
        error: null,
      }),
      // Keyed on the machine asked for, so a journal read under any other id finds a
      // box that serves nothing.
      findPatches: async ({ machine_id }) => ({
        data: residents.some((entry) => entry.occupant.workstation_machine_id === machine_id)
          ? [nginxUp(owner)]
          : [],
        error: null,
      }),
    });
  };

  const fromOwnerBox = (visitor: ReturnType<typeof generateIdentity>, target: string) =>
    envelope(visitor, { target, port: 80, paths: ['/'] }, { caller_machine_id: OWNER_WS });

  // The server serves that box to the shell, by loopback and by its address both, and
  // records the visit as it does. A trace reported from there would be a second line for
  // one request. The visitor lives on the network too, so a line filed on the wrong
  // workstation would be written rather than quietly dropped.
  it.each([
    ['loopback', '127.0.0.1'],
    ['its own LAN address', OWNER_IP],
  ])('leaves no line for a fetch of that workstation by %s', async (_named, target) => {
    const owner = generateIdentity();
    const visitor = generateIdentity();
    const { deps, upsertPatch } = shellOnOwnerBox(owner, [
      resident(visitor, 'the-visitors-own-workstation', VISITOR_OCTET),
    ]);

    const result = await handleRecordLanFetch(await fromOwnerBox(visitor, target), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('leaves no line on a third player’s workstation, which the shell does not stand on', async () => {
    // Nothing on the LAN serves another player's pages to a shell that is not on their
    // box, so a request naming one is a line for a visit that never happened.
    const owner = generateIdentity();
    const visitor = generateIdentity();
    const bystander = generateIdentity();
    const { deps, upsertPatch } = shellOnOwnerBox(owner, [
      resident(bystander, 'the-bystanders-workstation', BYSTANDER_OCTET),
    ]);

    const result = await handleRecordLanFetch(
      await fromOwnerBox(visitor, lanAddressFor(ESSID, BYSTANDER_OCTET)),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});

