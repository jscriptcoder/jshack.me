/**
 * handleRecordLanFetch — the server-side action behind a `curl`/`lynx`/`gobuster` fetch
 * of the player's OWN workstation, at home, and the own-box twin of the append every
 * served fetch makes.
 *
 * An access log belongs to the SERVER, not to the network path: a web server writes a
 * line for every request it serves, and where the request came from only decides what
 * lands in the source-IP field. The player's own box is the one box a client serves from
 * the live tree it holds, so this handler exists to give that fetch the round-trip it
 * needs to leave its line. Every other box on a network — one the network generates, or
 * another player's — is served by the server (`resolveOccupantFetch`,
 * `resolveOccupantSweep`), which records the visit in the same request, and a report
 * naming one here leaves nothing.
 *
 * It takes a RUN of paths rather than one, because a path sweep is a fetch tool that
 * asks forty questions and its whole cost to the attacker is the wall of 404s it
 * leaves behind. `curl` names one path, `gobuster` names every word it tried, and both
 * land as a single append — the alternative is one signed round-trip per word, each
 * re-reading and re-writing the entire log.
 *
 * WHERE THE CALLER STANDS IS DERIVED, NEVER CLAIMED. The client names the box it ran
 * from (`caller_machine_id`); the server places it with `resolveCallerVantage` — at home
 * on its own network, or in a shell on a box it holds a live session on — and refuses a
 * network it is not standing on (`wrong_network`) or a box it does not hold
 * (`no_session`). The source address a line records is the address that box is seen at
 * on the reached network, worked out here, so a crafted request can never author a line
 * from an address the traffic never used. This retires the own-LAN path's old trust in a
 * client `source_ip`.
 *
 * WHICH BOX ANSWERED is the caller's own workstation when the address is the lease they
 * hold, read from its live journal, because a fresh box serves nothing and an edited
 * page is what a fetch returns. The loopback address names the box the shell stands ON,
 * and the visit is recorded as local; it is traced here only when that box is the
 * caller's own, found at its lease. Any other address leaves no line.
 *
 * The client names no time, status or size — for any line, however many it asks for.
 * The server reads the resolved tree and works those out itself, so a crafted request
 * can never author a line claiming something was served that never was, and a sweep
 * cannot dress its misses up as hits.
 *
 * The line is filed under the OWNER's key, which here is the caller's own.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { lanAddressFor, type LanLeaseRow } from './lanAddress.js';
import { materializeWorkstationFs, type OwnerPatchRow } from './materializeWorkstationFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { METHOD_NOT_ALLOWED_PAGE, resolveWebPath } from './http.js';
import { readOpenPorts, type OpenPort } from '../services/pidfile.js';
import { SERVICE_CATALOG } from '../services/serviceCatalog.js';
import { LOOPBACK_IPV4 } from './interfaces.js';
import {
  ACCESS_LOG_OWNER,
  ACCESS_LOG_PATH,
  ACCESS_LOG_PERMISSIONS,
  formatAccessLogLine,
} from '../logging/accessLog.js';
import {
  appendMachineLogLines,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import { resolveCallerVantageOn, type CallerVantageDeps } from '../sessions/callerVantage.js';
import type { Directory } from '../filesystem/types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';

/** The occupancy fields an own-LAN fetch trace needs: whose row it is and which box (to
 *  spot a fetch of the caller's own workstation) and the identity fields that rebuild
 *  that box so the server can read what it actually served. No machine NAME — unlike a
 *  syslog line, an access-log line carries no hostname. */
export type FetchOccupant = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  readonly workstation_root_hash: string;
};

export type RecordLanFetchDeps = CallerVantageDeps & {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the access.log line. */
  readonly now: () => number;
  readonly readLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Every occupant of the ESSID — read to recognise the workstation that answered
   *  and to rebuild it. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly FetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease on the ESSID — a player's LAN address is a lease, not a derivation,
   *  so this is what says whose workstation an address is. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  /** The caller's workstation journal, replayed over its seeded base: a fresh box
   *  serves nothing, so whether it serves at all lives here. */
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
// pubkey). `paths` is REQUIRED and NON-EMPTY: defaulting it, or accepting an empty
// list, would let a caller omit the one field the lines are written about. Any other
// field a client sends is simply not read — a `source_ip` included, since the server
// now derives it.
const recordLanFetchSchema = z
  .looseObject({
    action: z.literal('recordLanFetch'),
    essid: z.string().min(1),
    target: z.string().min(1),
    port: z.number().int(),
    paths: z.array(z.string().min(1)).min(1),
    /** Present for a POST. No form travels: the own box refuses every one. */
    method: z.literal('POST').optional(),
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Which machine answered, the tree it answered from, the ports to judge "serving the
 *  web" against, the key its log lands under, and the address the line records it
 *  coming from. */
type FetchTarget = {
  readonly machineId: string;
  readonly fs: Directory;
  readonly ports: readonly OpenPort[];
  readonly writerKey: string;
  readonly sourceIp: string;
};

/** The caller's OWN workstation, when it is the box at `address` on this LAN — the one
 *  box a client serves from a tree it holds, and so the one this trace is asked about.
 *  Found by the lease its owner holds, and filed under that owner's key. Every read here
 *  is load-bearing — a failure means we cannot tell whose box this is, so null, and no
 *  line. */
const workstationTarget = async (
  deps: RecordLanFetchDeps,
  essid: string,
  callerKey: string,
  address: string,
  sourceIp: string,
): Promise<FetchTarget | null> => {
  const leases = await deps.listLeasesByEssid(essid);
  if (leases.error) return null;
  const lease = (leases.data ?? []).find((row) => lanAddressFor(essid, row.octet) === address);
  if (lease === undefined) return null;

  const occupants = await deps.listOccupantsByEssid(essid);
  if (occupants.error) return null;
  const holder = (occupants.data ?? []).find((row) => row.owner_key === lease.owner_key);
  if (holder === undefined || holder.owner_key !== callerKey) return null;

  const patches = await deps.findPatches({ machine_id: holder.workstation_machine_id });
  if (patches.error) return null;
  const fs = materializeWorkstationFs(holder, patches.data);
  return {
    machineId: holder.workstation_machine_id,
    fs,
    ports: readOpenPorts(fs),
    writerKey: holder.owner_key,
    sourceIp,
  };
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

  // The LAN boundary: the caller learns about — and leaves a line on — only the network
  // it is standing on, placed from where the server puts it rather than from a claim.
  const vantage = await resolveCallerVantageOn(
    deps,
    publicKey,
    payload.caller_machine_id,
    payload.essid,
  );
  if (!vantage.ok) return { status: vantage.status, body: { error: vantage.error } };

  // Loopback names the box the shell stands ON, and the line records a local visit. It
  // is traced here only when that box is the caller's own workstation, found at the
  // lease it holds; every other box is served, and its visit recorded, by the server.
  const loopback = payload.target === LOOPBACK_IPV4;
  const address = loopback ? vantage.sourceIp : payload.target;
  const resolved =
    address === null
      ? null
      : await workstationTarget(
          deps,
          payload.essid,
          publicKey,
          address,
          vantage.sourceIp ?? 'unknown',
        );
  if (resolved === null) return { status: 200, body: { ok: true } };

  // Only a REACHED web server logs. The client already decided something answered; the
  // server checks the tree it resolved rather than taking that on trust, and a web
  // server is service-specific — a box listening on ssh answered nothing here.
  const serving = resolved.ports.some(
    (entry) => entry.port === payload.port && entry.service === SERVICE_CATALOG.http.service,
  );
  if (!serving) return { status: 200, body: { ok: true } };

  const view = createFsView(resolved.fs, { userType: 'root' });
  // One clock reading for the whole request, because the server handled ONE request —
  // stamping per line would spread a sweep across a span nothing observed. A loopback
  // fetch is recorded as local, whatever the box's address on the LAN is.
  const time = asGameTime(deps.now());
  const recordedSource = loopback ? LOOPBACK_IPV4 : resolved.sourceIp;
  const lines = payload.paths.map((requestPath) => {
    // A POST is refused before any file is looked at: the box takes no form, so every
    // path answers with the same 405 page.
    if (payload.method === 'POST') {
      return formatAccessLogLine({
        time,
        method: 'POST',
        sourceIp: recordedSource,
        path: requestPath,
        status: 405,
        size: METHOD_NOT_ALLOWED_PAGE.length,
      });
    }
    const filePath = resolveWebPath(requestPath);
    const page = filePath === null ? null : view.read(filePath);
    const content = page === null || !page.ok ? null : page.content;
    return formatAccessLogLine({
      time,
      sourceIp: recordedSource,
      // The path AS ASKED FOR, never as resolved: a request that resolved to nothing
      // is exactly the line a defender needs to see.
      path: requestPath,
      status: content === null ? 404 : 200,
      size: content === null ? 0 : content.length,
    });
  });

  try {
    // ONE append for the whole run, the way the hydra sweep lands on `auth.log`: a
    // per-line write would re-read and re-upsert the entire log for every path tried.
    await appendMachineLogLines(
      { readLog: deps.readLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: resolved.writerKey,
        machineId: resolved.machineId,
        path: ACCESS_LOG_PATH,
        owner: ACCESS_LOG_OWNER,
        permissions: ACCESS_LOG_PERMISSIONS,
      },
      lines,
    );
  } catch {
    // best-effort: the fetch already happened, and a logging failure must not surface.
  }

  return { status: 200, body: { ok: true } };
};
