import { describe, expect, it, vi } from 'vitest';
import { handleRecordZoneTransfer, type RecordZoneTransferDeps } from './recordZoneTransfer';
import type { PatchRow } from './upsertPatch';
import type { MachineLogReadQuery, MachineLogReadResult } from './appendMachineLog';
import type { FindHomeNetworkByOwnerKey } from '../logging/crossPlayerSourceIp';
import type { NonceStore } from '../signedRequest/nonceStore';
import { signRequest } from '../signedRequest/sign';
import { generateIdentity } from '../identity/identity';
import { asGameTime } from '../types';
import { lanZoneName } from '../network/resolveName';
import {
  allowsZoneTransfer,
  nameServerMachineIdAt,
  zoneRecordsFor,
} from '../generation/generateDnsZone';
import { NAMED_LOG_OWNER, NAMED_LOG_PATH, NAMED_LOG_PERMISSIONS, formatNamedXfrLine } from '../logging/namedLog';

/**
 * handleRecordZoneTransfer — the server side of the door's one trace. A zone
 * transfer runs entirely client-side (dig reads generation), so the box would
 * otherwise learn nothing; this action is how the transfer leaves its mark. The
 * client says only WHICH network and WHICH server it aimed at — it does not get to
 * say who it is, when, or whether the box agreed: the source IP is derived from the
 * verified key, the clock is the server's, and the verdict (handed over vs refused)
 * is recomputed from generation, the same authority dig transferred from. A
 * defender's log a visitor can author is not evidence.
 *
 * The line lands under the caller's own key, exactly as the own-LAN scan trace does:
 * a player's repeated transfers accrete into one row they read back after rooting the
 * box. The write is the shared appendMachineLog primitive.
 */

const freshStore: NonceStore = async () => ({ fresh: true });

// A fixed server clock: 2026-09-05 22:13:20.456 UTC.
const STAMP = Date.UTC(2026, 8, 5, 22, 13, 20, 456);

// The address the transferring player OWNS, resolved server-side from their key.
const ACTOR_HOME_IP = '198.51.100.22';

// Real generation, confirmed live at slice 3's close-out: GRAD-STUDENT-WIFI carries an
// OPEN name server deep at ns-116, OSCORP-GUEST a CLOSED one on its Layer-1 LAN, and a
// database machine on GRAD that answers for nothing.
const GRAD_ESSID = 'GRAD-STUDENT-WIFI';
const GRAD_NS_IP = '10.165.42.116';
const GRAD_NON_NS_IP = '192.168.112.241';
const OSCORP_ESSID = 'OSCORP-GUEST';
const OSCORP_NS_IP = '192.168.118.224';

const makeDeps = (over: Partial<RecordZoneTransferDeps> = {}) => {
  const upsertPatch = vi.fn<(row: PatchRow) => Promise<{ error: unknown }>>(async () => ({
    error: null,
  }));
  const readLog = vi.fn<(query: MachineLogReadQuery) => Promise<MachineLogReadResult>>(async () => ({
    data: null,
    error: null,
  }));
  const findHomeNetworkByOwnerKey = vi.fn<FindHomeNetworkByOwnerKey>(async () => ({
    data: { public_ip: ACTOR_HOME_IP },
    error: null,
  }));
  const deps: RecordZoneTransferDeps = {
    nonceStore: freshStore,
    now: () => STAMP,
    readLog,
    upsertPatch,
    findHomeNetworkByOwnerKey,
    ...over,
  };
  return { deps, upsertPatch, readLog, findHomeNetworkByOwnerKey };
};

const fire = (essid: string, serverIp: string) =>
  signRequest(generateIdentity(), 'recordZoneTransfer', { essid, server_ip: serverIp });

describe('handleRecordZoneTransfer', () => {
  it('records a completed transfer on the name server, naming the source, the zone, and its size', async () => {
    // A precondition the golden line rests on: this deep box hands its zone over.
    expect(allowsZoneTransfer(GRAD_ESSID, GRAD_NS_IP)).toBe(true);

    const identity = generateIdentity();
    const envelope = signRequest(identity, 'recordZoneTransfer', {
      essid: GRAD_ESSID,
      server_ip: GRAD_NS_IP,
    });
    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordZoneTransfer(envelope, deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0]).toEqual({
      // The caller's own key — the row a single player's transfers accrete into.
      writer_key: identity.publicKeyHex,
      // The box the log lands on is the name server dig aimed at, at any depth.
      machine_id: nameServerMachineIdAt(GRAD_ESSID, GRAD_NS_IP),
      path: NAMED_LOG_PATH,
      content: `${formatNamedXfrLine({
        time: asGameTime(STAMP),
        sourceIp: ACTOR_HOME_IP,
        zone: lanZoneName(GRAD_ESSID),
        outcome: { verdict: 'transferred', records: zoneRecordsFor(GRAD_ESSID).length },
      })}\n`,
      owner: NAMED_LOG_OWNER,
      permissions: NAMED_LOG_PERMISSIONS,
      node_type: 'file',
    });
  });

  it('records a refused transfer as the denied line, on the box that refused', async () => {
    // The other precondition: this Layer-1 box refuses, so the line must be the denial.
    expect(allowsZoneTransfer(OSCORP_ESSID, OSCORP_NS_IP)).toBe(false);

    const { deps, upsertPatch } = makeDeps();

    const result = await handleRecordZoneTransfer(fire(OSCORP_ESSID, OSCORP_NS_IP), deps);

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(upsertPatch.mock.calls[0]![0].machine_id).toBe(
      nameServerMachineIdAt(OSCORP_ESSID, OSCORP_NS_IP),
    );
    expect(upsertPatch.mock.calls[0]![0].content).toBe(
      `${formatNamedXfrLine({
        time: asGameTime(STAMP),
        sourceIp: ACTOR_HOME_IP,
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

  it('derives the source IP from the verified key, degrading to unknown rather than guessing', async () => {
    const { deps, upsertPatch } = makeDeps({
      findHomeNetworkByOwnerKey: async () => ({ data: null, error: new Error('offline') }),
    });

    await handleRecordZoneTransfer(fire(GRAD_ESSID, GRAD_NS_IP), deps);

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
    // The wire may say WHICH network and WHICH server, and nothing else. A payload that
    // carries an identity field is refused outright, not quietly honoured: the source is
    // the verified key, so a line a visitor could address to someone else is never
    // written — that is the whole of why the log is evidence.
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
