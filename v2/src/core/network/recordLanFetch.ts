/**
 * handleRecordLanFetch — the server-side action behind an own-LAN `curl`, and the
 * own-LAN twin of `resolveHttpFetch`'s cross-player append.
 *
 * An access log belongs to the SERVER, not to the network path: a web server writes a
 * line for every request it serves, and where the request came from only decides what
 * lands in the source-IP field. An own-LAN fetch resolves entirely client-side, so this
 * handler exists to give it the round-trip it needs to leave that line — exactly as
 * `handleNmapScan` does for a scan that also resolved client-side.
 *
 * The client names a target address, a port and a url path. It never names a MACHINE:
 * the server REGENERATES the caller's own LAN from the verified pubkey + essid and
 * decides for itself which box answered — the caller's own workstation when they
 * fetched their own leased address, otherwise a generated NPC sibling. Own address is
 * checked FIRST, matching `curl`'s own resolution, so a lease that happens to collide
 * with a generated host still reads the player's real box.
 *
 * Nor does the client name a time, a status or a size. The server reads the resolved
 * tree and works those out itself, so a crafted request can never author a line
 * claiming something was served that never was.
 *
 * Writer key is the CALLER's in both cases, which is why this slice needs no
 * owner-vs-caller distinction: a generated host has no owner, so its log is per-viewer
 * (the fetcher is its only reader), and the player's own box is owned by the caller
 * anyway.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs';
import { createFsView } from '../filesystem/fsView';
import { resolveWebPath } from './http';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog';
import { appendMachineLog, type MachineLogReadQuery, type MachineLogReadResult } from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { Directory } from '../filesystem/types';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

/** The occupancy fields an own-LAN fetch trace needs: whose row it is (to spot the
 *  caller fetching THEMSELVES) and the identity fields that rebuild their box so the
 *  server can read what it actually served. No machine NAME — unlike a syslog line,
 *  an access-log line carries no hostname. */
export type FetchOccupant = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type RecordLanFetchDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the access.log line. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every occupant of the ESSID — read to recognise the caller's OWN workstation
   *  and to rebuild it. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly FetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease on the ESSID — the caller's own LAN address is a lease, not a
   *  derivation, so this is what says whether they fetched themselves. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** The caller's own workstation journal, replayed over its seeded base — a fresh box
   *  serves nothing, so whether it is serving at all lives in these rows. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied player_key (the server stamps it from the verified
// pubkey). `path` is REQUIRED: defaulting it would let a caller omit the one field the
// line is written about. Any other field a client sends is simply not read.
const recordLanFetchSchema = z
  .looseObject({
    action: z.literal('recordLanFetch'),
    essid: z.string().min(1),
    target: z.string().min(1),
    port: z.number().int(),
    path: z.string().min(1),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Which machine answered, and the tree it answered from. */
type FetchTarget = {
  readonly machineId: string;
  readonly fs: Directory;
};

/** The caller's OWN workstation, when `target` is the address they hold on this LAN.
 *  Every read here is load-bearing — a failure means we cannot tell whether this was a
 *  self-fetch, and guessing would land the line on a generated host that shares the
 *  octet. Null falls through to the generated-host path, which will find nothing for an
 *  address only a player holds. */
const ownWorkstationTarget = async (
  deps: RecordLanFetchDeps,
  essid: string,
  callerKey: string,
  target: string,
): Promise<FetchTarget | null> => {
  const leases = await deps.listLeasesByEssid(essid);
  if (leases.error) return null;
  if (lanAddressesByOwner(essid, leases.data ?? []).get(callerKey) !== target) return null;

  const occupants = await deps.listOccupantsByEssid(essid);
  if (occupants.error) return null;
  const own = (occupants.data ?? []).find((row) => row.owner_key === callerKey);
  if (own === undefined) return null;

  const patches = await deps.findPatches({ machine_id: own.workstation_machine_id });
  if (patches.error) return null;
  return {
    machineId: own.workstation_machine_id,
    fs: materializeWorkstationFs(own, patches.data),
  };
};

/** The generated NPC sibling at `target` on the caller's regenerated LAN, resolved
 *  through the SAME identity map scan and ssh use so the three can never disagree
 *  about which box an address is. */
const generatedHostTarget = (essid: string, target: string): FetchTarget | null => {
  const host = generateHomeLan(essid).hosts.find((candidate) => candidate.ip === target);
  if (host === undefined) return null;
  const identity = resolveLanHostIdentity(host, essid);
  return { machineId: identity.machineId, fs: identity.baseFs };
};

export const handleRecordLanFetch = async (
  body: unknown,
  deps: RecordLanFetchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, recordLanFetchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const target =
    (await ownWorkstationTarget(deps, payload.essid, publicKey, payload.target)) ??
    generatedHostTarget(payload.essid, payload.target);
  if (target === null) return { status: 200, body: { ok: true } };

  // Only a REACHED server logs. The client already decided something answered; the
  // server checks the tree it resolved rather than taking that on trust, and a web
  // server is service-specific — a box listening on ssh answered nothing here.
  const serving = readOpenPorts(target.fs).some(
    (entry) => entry.port === payload.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!serving) return { status: 200, body: { ok: true } };

  const filePath = resolveWebPath(payload.path);
  const page = filePath === null ? null : createFsView(target.fs, { userType: 'root' }).read(filePath);
  const content = page === null || !page.ok ? null : page.content;

  try {
    await appendMachineLog(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: publicKey,
        machineId: target.machineId,
        path: ACCESS_LOG_PATH,
        owner: ACCESS_LOG_OWNER,
        permissions: ACCESS_LOG_PERMISSIONS,
      },
      formatAccessLogLine({
        time: asGameTime(deps.now()),
        sourceIp: payload.source_ip ?? 'unknown',
        // The path AS ASKED FOR, never as resolved: a request that resolved to nothing
        // is exactly the line a defender needs to see.
        path: payload.path,
        status: content === null ? 404 : 200,
        size: content === null ? 0 : content.length,
      }),
    );
  } catch {
    // best-effort: the fetch already happened, and a logging failure must not surface.
  }

  return { status: 200, body: { ok: true } };
};
