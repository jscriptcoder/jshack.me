import { describe, expect, it, vi } from 'vitest';
import { handleRecordZoneTransfer, type RecordZoneTransferDeps } from './recordZoneTransfer.js';
import type { PatchRow } from './upsertPatch.js';
import type { MachineLogReadQuery, MachineLogReadResult } from './appendMachineLog.js';
import type {
  FindActiveSession,
  FindActiveSessionResult,
} from './authorizeMachineAccess.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { signRequest } from '../signedRequest/sign.js';
import { generateIdentity } from '../identity/identity.js';
import { computeWorkstationId } from '../identity/workstation.js';
import { asGameTime } from '../types.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import { lanZoneName } from '../network/resolveName.js';
import { leasedAddress } from '../network/lanAddress.js';
import { chainLinks, segmentsReachedFrom } from '../generation/lanTopology.js';
import { resolveDeepScanHosts } from '../scan/deepScanHosts.js';
import { buildDirectory } from '../../test/factories/filesystem.js';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../generation/generateDnsZone.js';
import { NAMED_LOG_OWNER, NAMED_LOG_PATH, NAMED_LOG_PERMISSIONS, formatNamedXfrLine } from '../logging/namedLog.js';

/**
 * handleRecordZoneTransfer — the server side of the door's one trace. A zone
 * transfer runs entirely client-side (dig reads generation), so the box would
 * otherwise learn nothing; this action is how the transfer leaves its mark. The
 * client says only WHICH network, WHICH server it aimed at, and the box it ran from
 * (`caller_machine_id`) — it does not get to say who it is, when, or whether the box
 * agreed: the source IP is the address the server places the caller's box at on the
 * name server's own segment, the clock is the server's, and the verdict (handed over
 * vs refused) is recomputed from generation, the same authority dig transferred from.
 * A defender's log a visitor can author is not evidence.
 *
 * The line lands under the NETWORK's own key (`ap:<essid>`): every occupant transfers
 * from the identical box, so a row per caller would let each transfer erase the last.
 * The write is the shared appendMachineLog primitive.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock: 2026-09-05 22:13:20.456 UTC.
const STAMP = Date.UTC(2026, 8, 5, 22, 13, 20, 456);

// Real generation: GRAD-STUDENT-WIFI carries an OPEN name server deep at ns-116, on the
// layer its inner gateway fronts — reached by standing on that gateway, not from home.
// OSCORP-GUEST carries a CLOSED one on its Layer-1 LAN, reached from home. A GRAD
// database machine answers for nothing.
const GRAD_ESSID = 'GRAD-STUDENT-WIFI';
const GRAD_NS_IP = '10.165.42.116';
const GRAD_NON_NS_IP = '192.168.112.241';
const OSCORP_ESSID = 'OSCORP-GUEST';
const OSCORP_NS_IP = '192.168.118.224';

// The lease octet a from-home caller holds — any octet; the source is derived from it.
const HOME_OCTET = 37;

/** The gateway whose fronted layer carries `serverIp` — the box a player stands on to
 *  reach a deep name server, derived so an octet reshuffle cannot rot the fixture. */
const gatewayReaching = (essid: string, serverIp: string): string => {
  for (const link of chainLinks(essid)) {
    const resolution = resolveDeepScanHosts(essid, link, buildDirectory({}));
    if (resolution.hosts.some((entry) => entry.host.ip === serverIp)) return link.machineId;
  }
  throw new Error(`no gateway fronts ${serverIp} on ${essid}`);
};

/** The address a box standing at `callerMachineId` is seen at on the segment carrying
 *  `serverIp` — the source the trace must record. */
const sourceFor = (essid: string, callerMachineId: string, serverIp: string): string => {
  const segment = (segmentsReachedFrom(essid, callerMachineId) ?? []).find((reached) =>
    serverIp.startsWith(`${reached.subnet}.`),
  );
  if (segment?.address == null) throw new Error(`no source for ${serverIp} from ${callerMachineId}`);
  return segment.address;
};

const makeDeps = (over: Partial<RecordZoneTransferDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(async () => ({
    data: null,
    error: null,
  }));
  // A caller standing at home on GRAD by default — placed by their lease there.
  const findHomeVantage = vi.fn<RecordZoneTransferDeps['findHomeVantage']>(async () => ({
    data: { essid: GRAD_ESSID, octet: HOME_OCTET },
    error: null,
  }));
  const findActiveSession = vi.fn<FindActiveSession>(async () => ({ data: null, error: null }));
  const findWorkstationLease = vi.fn<RecordZoneTransferDeps['findWorkstationLease']>(async () => ({
    data: null,
    error: null,
  }));
  const deps: RecordZoneTransferDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    readLog,
    upsertPatch,
    findActiveSession,
    findHomeVantage,
    findWorkstationLease,
    ...over,
  };
  return { deps, upsertPatch, readLog, findActiveSession, findHomeVantage };
};

/** A deps set whose caller holds a live session on the box they name, network `essid` —
 *  a hop. The stubbed lookup admits any box; the payload's `caller_machine_id` is what
 *  the handler then places from. */
const onHop = (essid: string, over: Partial<RecordZoneTransferDeps> = {}) => {
  const session: FindActiveSessionResult = {
    data: { username: 'mallory', userType: 'root', essid },
    error: null,
  };
  return makeDeps({ findActiveSession: async () => session, ...over });
};

const fire = (essid: string, serverIp: string, extra: Record<string, unknown> = {}) =>
  signRequest(generateIdentity(), 'recordZoneTransfer', {
    essid,
    server_ip: serverIp,
    ...extra,
  });

describe('handleRecordZoneTransfer', () => {
  it('records a completed transfer from the box the caller stands on, naming its segment address', async () => {
    // A precondition the golden line rests on: this deep box hands its zone over.
    expect(allowsZoneTransfer(GRAD_ESSID, GRAD_NS_IP)).toBe(true);
    const gateway = gatewayReaching(GRAD_ESSID, GRAD_NS_IP);
    const { deps, upsertPatch } = onHop(GRAD_ESSID);

    const result = await handleRecordZoneTransfer(
      fire(GRAD_ESSID, GRAD_NS_IP, { caller_machine_id: gateway }),
      deps,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      // The network's own key, never the caller's: every occupant transfers from the
      // identical box, so a row per caller would let each transfer erase the last.
      writer_key: apGatewayLogWriterKey(GRAD_ESSID),
      // The box the log lands on is the name server dig aimed at, at any depth.
      machine_id: nameServerMachineIdAt(GRAD_ESSID, GRAD_NS_IP),
      path: NAMED_LOG_PATH,
      content: `${formatNamedXfrLine({
        time: asGameTime(STAMP),
        // The box's address on the name server's own (deep) segment — not its home IP.
        sourceIp: sourceFor(GRAD_ESSID, gateway, GRAD_NS_IP),
        zone: lanZoneName(GRAD_ESSID),
        outcome: { verdict: 'transferred', records: zoneRecordsFor(GRAD_ESSID).length },
      })}\n`,
      owner: NAMED_LOG_OWNER,
      permissions: NAMED_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('records a refused transfer, from home, as the denied line on the box that refused', async () => {
    // The other precondition: this Layer-1 box refuses, so the line must be the denial.
    expect(allowsZoneTransfer(OSCORP_ESSID, OSCORP_NS_IP)).toBe(false);
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: OSCORP_ESSID, octet: HOME_OCTET }, error: null }),
    });

    const result = await handleRecordZoneTransfer(fire(OSCORP_ESSID, OSCORP_NS_IP), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(
      nameServerMachineIdAt(OSCORP_ESSID, OSCORP_NS_IP),
    );
    // From home, the source is the caller's own lease on the network.
    const homeSource = leasedAddress(OSCORP_ESSID, HOME_OCTET);
    if (homeSource === null) throw new Error('expected a home lease address');
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `${formatNamedXfrLine({
        time: asGameTime(STAMP),
        sourceIp: homeSource,
        zone: lanZoneName(OSCORP_ESSID),
        outcome: { verdict: 'denied' },
      })}\n`,
    );
  });

  it('writes nothing when no name server stands at the target — there is no daemon to log it', async () => {
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordZoneTransfer(fire(GRAD_ESSID, GRAD_NON_NS_IP), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('writes nothing for a name server the caller cannot reach from where it stands', async () => {
    // ns-116 is a real, open name server — but deep, on a layer a caller at home does not
    // reach. There is no segment the transfer could have travelled over, so no truthful
    // source and no line.
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordZoneTransfer(fire(GRAD_ESSID, GRAD_NS_IP), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller on a network it is not standing on (wrong_network), and writes nothing', async () => {
    // The caller holds a shell, but on OSCORP — a transfer it addresses to GRAD is a
    // network it is not on, and the own-LAN boundary refuses it.
    const { deps, upsertPatch } = onHop(OSCORP_ESSID);

    const result = await handleRecordZoneTransfer(
      fire(GRAD_ESSID, GRAD_NS_IP, { caller_machine_id: gatewayReaching(GRAD_ESSID, GRAD_NS_IP) }),
      deps,
    );

    expect(result.status).toBe(403);
    expect(result.body).toEqual({ error: 'wrong_network' });
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a caller naming a box it holds no shell on (no_session), and writes nothing', async () => {
    // No active session on the named box — authorization fails before any network is
    // regenerated, so a box a caller merely names answers for nothing.
    const { deps, upsertPatch } = makeDeps({ findActiveSession: async () => ({ data: null, error: null }) });

    const result = await handleRecordZoneTransfer(
      fire(GRAD_ESSID, GRAD_NS_IP, { caller_machine_id: 'inner-gw-unheld' }),
      deps,
    );

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('places a caller who names their own workstation at home, from their lease', async () => {
    // At home the client sends its own workstation as `caller_machine_id`; the network
    // does not generate that box, so its reach falls through to the home LAN the caller
    // holds a lease on — the source is that lease, not a crash on an empty reach.
    const actor = generateIdentity();
    const workstation = computeWorkstationId('rig', actor.publicKeyHex);
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: OSCORP_ESSID, octet: HOME_OCTET }, error: null }),
    });
    const envelope = signRequest(actor, 'recordZoneTransfer', {
      essid: OSCORP_ESSID,
      server_ip: OSCORP_NS_IP,
      caller_machine_id: workstation,
    });

    const result = await handleRecordZoneTransfer(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    const homeSource = leasedAddress(OSCORP_ESSID, HOME_OCTET);
    if (homeSource === null) throw new Error('expected a home lease address');
    expect(upsertPatch.mock.calls[0]![0].content).toContain(`client ${homeSource} (`);
  });

  it('degrades the source to unknown rather than guessing when the caller holds no lease', async () => {
    const { deps, upsertPatch } = makeDeps({
      findHomeVantage: async () => ({ data: { essid: OSCORP_ESSID, octet: null }, error: null }),
    });

    await handleRecordZoneTransfer(fire(OSCORP_ESSID, OSCORP_NS_IP), deps);

    expect(upsertPatch.mock.calls[0]![0].content).toContain('client unknown (');
  });

  it('refuses an unsigned request and writes nothing — the wire is the threat surface', async () => {
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordZoneTransfer(
      { action: 'recordZoneTransfer', essid: GRAD_ESSID, server_ip: GRAD_NS_IP },
      deps,
    );

    expect(result.status).toBeGreaterThanOrEqual(400);
    // The refusal names why, so the caller is not left guessing whether the wire or
    // the box turned them away.
    expect(result.body).toHaveProperty('error');
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a request whose payload forges a player_key, and writes nothing', async () => {
    // The wire may say WHICH network, WHICH server, and the box it ran from, and nothing
    // else. A payload that carries an identity field is refused outright, not quietly
    // honoured: the source is the placed box, so a line a visitor could address to someone
    // else is never written — that is the whole of why the log is evidence.
    const { deps, upsertPatch } = makeDeps();
    const forged = signRequest(generateIdentity(), 'recordZoneTransfer', {
      essid: GRAD_ESSID,
      server_ip: GRAD_NS_IP,
      player_key: generateIdentity().publicKeyHex,
    });

    const result = await handleRecordZoneTransfer(forged, deps);

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a request whose payload forges a writer_key, and writes nothing', async () => {
    // The other half of the same guard: neither the player key nor the row's writer key
    // is the caller's to assert.
    const { deps, upsertPatch } = makeDeps();
    const forged = signRequest(generateIdentity(), 'recordZoneTransfer', {
      essid: GRAD_ESSID,
      server_ip: GRAD_NS_IP,
      writer_key: generateIdentity().publicKeyHex,
    });

    const result = await handleRecordZoneTransfer(forged, deps);

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });

  it('refuses a request that names no target server, and writes nothing', async () => {
    // essid + server_ip are the whole of what the caller supplies; a request missing one
    // is malformed, not a transfer of the empty string against a box that does not exist.
    const { deps, upsertPatch } = makeDeps();
    const envelope = signRequest(generateIdentity(), 'recordZoneTransfer', { essid: GRAD_ESSID });

    const result = await handleRecordZoneTransfer(envelope, deps);

    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(upsertPatch).not.toHaveBeenCalled();
  });
});
