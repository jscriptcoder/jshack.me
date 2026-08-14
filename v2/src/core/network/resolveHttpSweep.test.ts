import { describe, expect, it, vi } from 'vitest';
import {
  handleResolveHttpSweep,
  type ResolveHttpSweepDeps,
} from './resolveHttpSweep';
import type { ApNetworkLookup, HttpFetchOccupant } from './resolveHttpFetch';
import { md5 } from '../generation/md5';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { computeApGatewayId } from '../identity/router';
import { computeWorkstationId } from '../identity/workstation';
import { lanAddressFor, type LanLeaseRow } from './lanAddress';
import type { OwnerPatchRow } from './materializeWorkstationFs';
import { defaultFilePermissions } from '../filesystem/defaultPermissions';
import { formatPidfileContent } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { HTTP_DEFAULT_PORT } from './http';
import { DIRLIST_PATH } from './defaultDirlist';
import { ACCESS_LOG_PATH, formatAccessLogLine } from '../logging/accessLog';
import { asGameTime } from '../types';
import type { ActiveSession } from '../patches/authorizeMachineAccess';
import type { ListPathPatchesResult } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { MachineLogReadResult } from '../patches/appendMachineLog';
import type { PatchRow } from '../patches/upsertPatch';

/**
 * `handleResolveHttpSweep` is the path sweep pointed at another player. It answers the
 * question a single fetch cannot: what is on that box that nothing linked to?
 *
 * The list never crosses the wire. The caller names the machine they are STANDING on and
 * the server reads the path list off its journal, the way a credential sweep reads the
 * password list — so a request can only ask with words the player really grew, and
 * pivoting onto somebody else's box means using whatever list is on it.
 *
 * One request, one append. Forty round-trips would scatter the defender's whole tell
 * across forty timestamps, when the wall of 404s under one stamp IS the tell.
 */

const freshStore: NonceStore = async () => ({ fresh: true });
const TARGET = '203.0.113.7';
const ESSID = 'BEAN-THERE-WIFI';

// ALICE publishes; BOB sweeps. Bob holds no credential on Alice's box — reachability is
// the whole gate, exactly as it is for a fetch.
const ALICE = generateIdentity();
const BOB = generateIdentity();

const AP_GATEWAY_ID = computeApGatewayId(ESSID);
const ALICE_WS = 'workstation-a1b2c3d4';
const ALICE_OCTET = 84;
const ALICE_LAN_IP = lanAddressFor(ESSID, ALICE_OCTET);

/** Bob's own box: derived from his key, so the server recognises it without a session. */
const BOB_MACHINE = computeWorkstationId('skylab', BOB.publicKeyHex);
/** A box Bob only holds a session on, living on somebody else's network. */
const PIVOT_BOX = 'workstation-c9d8e7f6';
const PIVOT_ESSID = 'ROUTER-OF-REQUIREMENT';
const PIVOT_PUBLIC_IP = '192.0.2.55';
/** Bob's own home address — what a sweep from his own box is traced to. */
const BOB_PUBLIC_IP = '198.51.100.22';

const aliceOccupant: HttpFetchOccupant = {
  owner_key: ALICE.publicKeyHex,
  workstation_machine_id: ALICE_WS,
  workstation_username: 'neo',
  workstation_root_hash: md5('toor'),
};
const OCCUPANTS: readonly HttpFetchOccupant[] = [aliceOccupant];
const LEASES: readonly LanLeaseRow[] = [{ owner_key: ALICE.publicKeyHex, octet: ALICE_OCTET }];
const REGISTERED: ApNetworkLookup = { router_machine_id: AP_GATEWAY_ID, essid: ESSID };

const journalRow = (fields: {
  readonly path: string;
  readonly content: string | null;
  readonly permissions?: OwnerPatchRow['permissions'];
  readonly nodeType?: OwnerPatchRow['node_type'];
}): OwnerPatchRow => ({
  path: fields.path,
  content: fields.content,
  owner: 'root',
  permissions: fields.permissions ?? null,
  node_type: fields.nodeType ?? 'file',
  updated_at: '2026-08-14T00:00:00.000Z',
  writer_key: ALICE.publicKeyHex,
});

const forwards = (...lines: readonly string[]): OwnerPatchRow =>
  journalRow({ path: '/etc/iptables/rules.v4', content: lines.join('\n') });
const forwardTo = (publicPort: number, internalIp: string, internalPort: number): string =>
  `forward ${publicPort} to ${internalIp}:${internalPort}`;

const webServerUp = (port = HTTP_DEFAULT_PORT): OwnerPatchRow =>
  journalRow({
    path: `/var/run/${SERVICE_CATALOG.http.pidfile}`,
    content: formatPidfileContent(SERVICE_CATALOG.http, port),
  });

const sshdUp = journalRow({
  path: `/var/run/${SERVICE_CATALOG.ssh.pidfile}`,
  content: formatPidfileContent(SERVICE_CATALOG.ssh, HTTP_DEFAULT_PORT),
});

/** A page published under the document root as root — root-readable and nothing else,
 *  so a server that read it as its (accountless) caller would miss the owner's page. */
const publishedPage = (path: string, content: string): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html${path}`,
    content,
    permissions: defaultFilePermissions('root'),
  });

const publishedDir = (path: string): OwnerPatchRow =>
  journalRow({
    path: `/var/www/html${path}`,
    content: null,
    nodeType: 'directory',
    permissions: defaultFilePermissions('root'),
  });

const bootTombstone = journalRow({ path: '/boot/vmlinuz', content: null, nodeType: null });

/** The path list `apt install gobuster` left on the box the caller is standing on. */
const dirlistRow = (words: readonly string[]): OwnerPatchRow =>
  journalRow({ path: DIRLIST_PATH, content: words.join('\n') });

const SWEEP_TIME = Date.UTC(2026, 7, 14, 13, 55, 36);

type PatchesResult = { data: readonly OwnerPatchRow[] | null; error: unknown };

const patchesByMachine =
  (byId: Readonly<Record<string, readonly OwnerPatchRow[]>>) =>
  async ({ machine_id }: { machine_id: string }): Promise<PatchesResult> => ({
    data: byId[machine_id] ?? [],
    error: null,
  });

type SweepOverrides = {
  lookup?: (publicIp: string) => Promise<{ data: ApNetworkLookup | null; error: unknown }>;
  patches?: (query: { machine_id: string }) => Promise<PatchesResult>;
  findActiveSession?: () => Promise<{ data: ActiveSession | null; error: unknown }>;
  listPathPatches?: (query: {
    machine_id: string;
    path: string;
  }) => Promise<ListPathPatchesResult>;
  upsertPatch?: (row: PatchRow) => Promise<{ error: unknown }>;
  findPublicIpByEssid?: (essid: string) => Promise<{
    data: { readonly public_ip: string } | null;
    error: unknown;
  }>;
  listLeasesByEssid?: (
    essid: string,
  ) => Promise<{ data: readonly LanLeaseRow[] | null; error: unknown }>;
};

/** Alice forwards :80 to her own box, which is serving. The reachable baseline every
 *  refusal below breaks in exactly one way. */
const aliceServing = (...pages: readonly OwnerPatchRow[]) =>
  patchesByMachine({
    [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
    [ALICE_WS]: [webServerUp(), ...pages],
  });

const makeDeps = (over: SweepOverrides = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(
    over.upsertPatch ?? (async () => ({ error: null })),
  );
  const listPathPatches = vi.fn(
    over.listPathPatches ??
      (async (): Promise<ListPathPatchesResult> => ({
        data: [dirlistRow(['index.html'])],
        error: null,
      })),
  );
  const deps: ResolveHttpSweepDeps = {
    nonceStore: freshStore,
    findNetworkByPublicIp: over.lookup ?? (async () => ({ data: REGISTERED, error: null })),
    findPatches: over.patches ?? aliceServing(publishedPage('/index.html', 'hello')),
    listOccupantsByEssid: async () => ({ data: OCCUPANTS, error: null }),
    listLeasesByEssid: over.listLeasesByEssid ?? (async () => ({ data: LEASES, error: null })),
    now: () => SWEEP_TIME,
    readLog: async (): Promise<MachineLogReadResult> => ({ data: null, error: null }),
    upsertPatch,
    findHomeNetworkByOwnerKey: async () => ({ data: { public_ip: BOB_PUBLIC_IP }, error: null }),
    findPublicIpByEssid:
      over.findPublicIpByEssid ?? (async () => ({ data: { public_ip: PIVOT_PUBLIC_IP }, error: null })),
    findActiveSession: over.findActiveSession ?? (async () => ({ data: null, error: null })),
    listPathPatches,
  };
  return { deps, upsertPatch, listPathPatches };
};

const envelope = (fields: Record<string, unknown> = {}) =>
  signRequest(BOB, 'resolveHttpSweep', {
    target: TARGET,
    port: HTTP_DEFAULT_PORT,
    caller_machine_id: BOB_MACHINE,
    ...fields,
  });

/** What the target was told, as one appended block of lines. */
const appendedLines = (upsertPatch: { mock: { calls: readonly (readonly PatchRow[])[] } }) =>
  upsertPatch.mock.calls
    .filter(([row]) => row.path === ACCESS_LOG_PATH)
    .map(([row]) => (row.content ?? '').split('\n').filter((line) => line.length > 0));

const logLine = (path: string, status: number, size: number, sourceIp = BOB_PUBLIC_IP): string =>
  formatAccessLogLine({ time: asGameTime(SWEEP_TIME), sourceIp, path, status, size });

describe('a stranger sweeps a box for paths nobody linked', () => {
  it('reports what each word found, and the size of what came back', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedPage('/index.html', 'hello there')),
      listPathPatches: async () => ({ data: [dirlistRow(['index.html', 'admin'])], error: null }),
    });

    // A word naming a served file is a hit with its size; a word naming nothing is a
    // miss, reported as the 404 it is rather than omitted — the caller counts both.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 200,
      body: {
        ok: true,
        dirlistFound: true,
        results: [
          { path: '/index.html', status: 200, size: 'hello there'.length },
          { path: '/admin', status: 404, size: 0 },
        ],
      },
    });
  });

  it('reports a directory holding an index as the form a server redirects to', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedDir('/hidden'), publishedPage('/hidden/index.html', 'notes')),
      listPathPatches: async () => ({ data: [dirlistRow(['hidden'])], error: null }),
    });

    // The find a player acts on is the address they can go and fetch, which for a
    // directory is the trailing-slash form — the same two-request semantics a sweep
    // on the player's own network already has.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 200,
      body: {
        ok: true,
        dirlistFound: true,
        results: [{ path: '/hidden/', status: 200, size: 'notes'.length }],
      },
    });
  });

  it('never hands over what it found, only that it is there', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedPage('/index.html', 'SECRET CONTENT')),
    });

    const { body } = await handleResolveHttpSweep(envelope(), deps);

    // Finding a page and reading it are two acts. Returning the body here would
    // deliver every page found under the sweep's own wall of 404s, with no line
    // saying the attacker ever read them.
    expect(JSON.stringify(body)).not.toContain('SECRET CONTENT');
  });
});

describe('the box being swept records the whole run', () => {
  it('writes every path it was asked about as ONE append under one timestamp', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(publishedPage('/index.html', 'hello')),
      listPathPatches: async () => ({
        data: [dirlistRow(['index.html', 'admin', 'backup'])],
        error: null,
      }),
    });

    await handleResolveHttpSweep(envelope(), deps);

    // The wall IS the tell. One append, in the order tried, hits and misses alike —
    // a write per path would re-read and re-upsert the whole log forty times over,
    // and spread the run across forty stamps a defender cannot read as one act.
    expect(appendedLines(upsertPatch)).toEqual([
      [
        logLine('/index.html', 200, 'hello'.length),
        logLine('/admin', 404, 0),
        logLine('/backup', 404, 0),
      ],
    ]);
  });

  it('records both requests a directory word costs, not only the one that answered', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(publishedDir('/hidden'), publishedPage('/hidden/index.html', 'notes')),
      listPathPatches: async () => ({ data: [dirlistRow(['hidden'])], error: null }),
    });

    await handleResolveHttpSweep(envelope(), deps);

    // The bare path a real server redirects, and the form it redirects TO. The
    // attacker is shown one find; the defender is shown both requests it took.
    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/hidden', 404, 0), logLine('/hidden/', 200, 'notes'.length)],
    ]);
  });

  it('is not fooled by a directory with nothing in it, and records both tries', async () => {
    const { deps, upsertPatch } = makeDeps({
      patches: aliceServing(publishedDir('/empty')),
      listPathPatches: async () => ({ data: [dirlistRow(['empty'])], error: null }),
    });

    // A folder a player made and never filled serves nothing, so it is not a find —
    // reporting it would send them to fetch a page that does not exist. The target
    // still hears both requests it took to establish that.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 200,
      body: {
        ok: true,
        dirlistFound: true,
        results: [{ path: '/empty', status: 404, size: 0 }],
      },
    });
    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/empty', 404, 0), logLine('/empty/', 404, 0)],
    ]);
  });

  it('records a path that climbed out of the document root exactly as asked', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [dirlistRow(['../../etc/passwd'])], error: null }),
    });

    const { body } = await handleResolveHttpSweep(envelope(), deps);

    // Silence is owed to the attacker, not to the box's owner: the traversal is
    // indistinguishable from a miss in the answer, and written down verbatim for
    // the person whose box it was aimed at.
    expect(body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/../../etc/passwd', status: 404, size: 0 }],
    });
    expect(appendedLines(upsertPatch)).toEqual([[logLine('/../../etc/passwd', 404, 0)]]);
  });

  it('traces a sweep launched from somebody else’s box to THAT box’s network', async () => {
    const { deps, upsertPatch } = makeDeps({
      findActiveSession: async () => ({
        data: { userType: 'root', essid: PIVOT_ESSID },
        error: null,
      }),
    });

    await handleResolveHttpSweep(envelope({ caller_machine_id: PIVOT_BOX }), deps);

    // The packets came from the box that was used, and the defender's log says so.
    // A line naming the attacker's home would be a falsehood the owner acts on —
    // and taking somebody else's box would cost the attacker nothing to hide behind.
    expect(appendedLines(upsertPatch)).toEqual([
      [logLine('/index.html', 200, 'hello'.length, PIVOT_PUBLIC_IP)],
    ]);
  });
});

describe('a sweep with nothing to ask, and a box that will not answer', () => {
  it('reports a missing path list instead of an empty run, and asks the target nothing', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [], error: null }),
    });

    // An absent file is a real state, not an error. Reporting zero findings would
    // read as a server with nothing on it rather than a tool with nothing to ask.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, dirlistFound: false, results: [] },
    });
    expect(appendedLines(upsertPatch)).toEqual([]);
  });

  it('reads the list off the box being stood on, not the player’s own', async () => {
    const { deps, listPathPatches } = makeDeps({
      findActiveSession: async () => ({
        data: { userType: 'root', essid: PIVOT_ESSID },
        error: null,
      }),
    });

    await handleResolveHttpSweep(envelope({ caller_machine_id: PIVOT_BOX }), deps);

    // Tools run where you stand, and so does the ammunition.
    expect(listPathPatches).toHaveBeenCalledWith({ machine_id: PIVOT_BOX, path: DIRLIST_PATH });
  });

  it('refuses a caller who neither owns the machine they named nor holds a session on it', async () => {
    const { deps, upsertPatch, listPathPatches } = makeDeps({
      findActiveSession: async () => ({ data: null, error: null }),
    });

    // Otherwise a request could sweep with any box's curated list — including one
    // belonging to a player who did the growing.
    expect(await handleResolveHttpSweep(envelope({ caller_machine_id: PIVOT_BOX }), deps)).toEqual({
      status: 403,
      body: { error: 'no_session' },
    });
    expect(listPathPatches).not.toHaveBeenCalled();
    expect(appendedLines(upsertPatch)).toEqual([]);
  });

  it('sweeps nothing and says nothing when the list is present but empty', async () => {
    const { deps, upsertPatch } = makeDeps({
      listPathPatches: async () => ({ data: [dirlistRow([])], error: null }),
    });

    // A curated list a player emptied is not a missing one: the file is there, so the
    // tool has it — it simply has nothing to ask, and an unasked box hears nothing.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 200,
      body: { ok: true, dirlistFound: true, results: [] },
    });
    expect(appendedLines(upsertPatch)).toEqual([]);
  });

  it('distinguishes a list it could not read from a list that is not there', async () => {
    const { deps } = makeDeps({
      listPathPatches: async () => ({ data: null, error: new Error('journal offline') }),
    });

    // Telling a player to reinstall the package would send them to overwrite a list they
    // spent the game growing, on the word of a storage failure that had nothing to do
    // with it.
    expect(await handleResolveHttpSweep(envelope(), deps)).toEqual({
      status: 500,
      body: { error: 'dirlist_lookup_failed' },
    });
  });

  it('sweeps a box whose log has nobody to key it to, and simply leaves no record', async () => {
    const { deps, upsertPatch } = makeDeps({
      // The AP's own gateway, on an ESSID nobody has ever leased an address on: it is
      // reachable and serving, but there is nobody whose row the log accretes under.
      patches: patchesByMachine({
        [AP_GATEWAY_ID]: [webServerUp(), publishedPage('/index.html', 'ap portal')],
      }),
      listLeasesByEssid: async () => ({ data: [], error: null }),
      listPathPatches: async () => ({ data: [dirlistRow(['index.html'])], error: null }),
    });

    const { status, body } = await handleResolveHttpSweep(envelope(), deps);

    // The findings stand; the record is what is missing. Failing the sweep over a
    // logging detail would tell the attacker something about the target's storage.
    expect(status).toBe(200);
    expect(body).toEqual({
      ok: true,
      dirlistFound: true,
      results: [{ path: '/index.html', status: 200, size: 'ap portal'.length }],
    });
    expect(appendedLines(upsertPatch)).toEqual([]);
  });

  it('refuses every unreachable target the same way, and writes nothing anywhere', async () => {
    const unreachable = { status: 404, body: { error: 'host_unreachable' } };
    const cases = [
      // No access point bears the address.
      makeDeps({ lookup: async () => ({ data: null, error: null }) }),
      // The gateway is bricked, so everything behind it is dark.
      makeDeps({ patches: patchesByMachine({ [AP_GATEWAY_ID]: [bootTombstone] }) }),
      // Nothing is forwarded on the port.
      makeDeps({ patches: patchesByMachine({ [AP_GATEWAY_ID]: [] }) }),
      // The forward lands on a box whose web server is not running.
      makeDeps({ patches: aliceServing() && patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
        [ALICE_WS]: [publishedPage('/index.html', 'hello')],
      }) }),
      // Something IS listening there, but it is not a web server.
      makeDeps({ patches: patchesByMachine({
        [AP_GATEWAY_ID]: [forwards(forwardTo(HTTP_DEFAULT_PORT, ALICE_LAN_IP, HTTP_DEFAULT_PORT))],
        [ALICE_WS]: [sshdUp],
      }) }),
    ];

    for (const { deps, upsertPatch } of cases) {
      // One answer for every cause, so a prober learns nothing from which gate
      // stopped them — and an unreached box keeps no record, because nothing was
      // there to write one.
      expect(await handleResolveHttpSweep(envelope(), deps)).toEqual(unreachable);
      expect(appendedLines(upsertPatch)).toEqual([]);
    }
  });
});

describe('the envelope', () => {
  it('refuses a tampered envelope without looking anything up', async () => {
    const { deps, listPathPatches } = makeDeps();
    const signed = envelope();

    expect(
      await handleResolveHttpSweep({ ...signed, payload: `${signed.payload} ` }, deps),
    ).toEqual({ status: 401, body: { error: 'signature_invalid' } });
    expect(listPathPatches).not.toHaveBeenCalled();
  });

  it('refuses a request that claims an identity', async () => {
    // The caller IS the verified pubkey. A payload naming a player key is a client
    // asserting who it is, which is the one thing no request may do — here it would
    // sweep with somebody else's list and trace to somebody else's network.
    const { deps } = makeDeps();
    const claiming = signRequest(BOB, 'resolveHttpSweep', {
      target: TARGET,
      port: HTTP_DEFAULT_PORT,
      caller_machine_id: BOB_MACHINE,
      player_key: ALICE.publicKeyHex,
    });

    expect((await handleResolveHttpSweep(claiming, deps)).status).toBe(400);
  });

  it('sweeps port 80 when the envelope carries no port', async () => {
    const { deps } = makeDeps({
      patches: aliceServing(publishedPage('/index.html', 'hello')),
    });
    const noPort = signRequest(BOB, 'resolveHttpSweep', {
      target: TARGET,
      caller_machine_id: BOB_MACHINE,
    });

    expect(await handleResolveHttpSweep(noPort, deps)).toEqual({
      status: 200,
      body: {
        ok: true,
        dirlistFound: true,
        results: [{ path: '/index.html', status: 200, size: 'hello'.length }],
      },
    });
  });
});
