/**
 * handleResolveHttpFetch — the server-side gate for a CROSS-PLAYER web fetch.
 * `curl http://<public IP>[:port][/path]` resolves the public IP to the ACCESS POINT
 * that bears it, materializes the ESSID's shared GATEWAY, and decides which machine the
 * requested port reaches — the same `machineServing` routing the cross-player ssh gate
 * uses, so a scan, a login and a fetch can never disagree about what sits behind a
 * forward.
 *
 * This is the one door that opens with NO session and NO credential: a web server
 * publishes its document root to anybody who can reach the port. So reachability is the
 * whole gate, and it is deliberately narrow — the destination port must be serving the
 * WEB. A forward onto an `sshd` reaches a listening daemon that is not a web server, and
 * refuses exactly like a closed port.
 *
 * Two failure shapes, and the split is the security boundary:
 *
 *   - `host_unreachable` — a connect-level refusal. Every cause collapses into it (no
 *     such public IP, bricked gateway, bricked occupant, a forward to an address nobody
 *     leases, an occupant who left the WiFi, no forward, nothing serving the web there)
 *     so a prober cannot tell which gate stopped it.
 *   - `not_found` — the HTTP 404 a reachable server returns for a path it does not
 *     publish. It admits a web server is there, which is what answering the port admits
 *     anyway.
 *
 * The request path arrives RAW and is resolved HERE, through the same `resolveWebPath`
 * the own-LAN client uses. That placement is the confinement: a hostile client is
 * assumed, so it must never be able to name a file on the target directly — it names a
 * URL path, and the server decides what file (if any) that is.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { materializeApGatewayFs } from './materializeRouterFs';
import type { OwnerPatchRow } from './materializeWorkstationFs';
import { machineServing, type ServedMachine } from './machineServing';
import { bootableOccupantFs } from './natHosts';
import { lanAddressesByOwner, type LanLeaseRow } from './lanAddress';
import { readOpenPorts } from '../services/pidfile';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import { canBoot } from '../boot/bootFiles';
import { createFsView } from '../filesystem/fsView';
import { HTTP_DEFAULT_PORT, resolveWebPath } from './http';
import type { OccupantWorkstation } from '../patches/remoteWritePermission';
import type { Directory } from '../filesystem/types';
import type { NonceStore } from '../signedRequest/nonceStore';

/** One occupant a NAT forward can land a fetch on: the identity fields that rebuild its
 *  tree, plus the machine id its journal is scoped to. Composed from the shared
 *  `OccupantWorkstation` rather than restated, so the tree this handler serves from is
 *  built by the same generator the write and read paths check against. */
export type HttpFetchOccupant = OccupantWorkstation & {
  readonly workstation_machine_id: string;
};

/** What a public IP resolves to: the AP that bears it. The gateway always exists — it is
 *  the access point's own infrastructure rather than a machine that joins — so both its
 *  journal scope and the ESSID that seeds it are always present. */
export type ApNetworkLookup = {
  readonly router_machine_id: string;
  readonly essid: string;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

export type ResolveHttpFetchDeps = {
  readonly nonceStore: NonceStore;
  readonly findNetworkByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }>;
  /** A machine's FULL patch journal (scoped to `machine_id`, server order) — the gateway's,
   *  for the boot gate and the live forward table, then the reached box's, for its running
   *  services and the page itself. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is half the reachability test, so a forward
   *  naming the address of somebody who has left the WiFi reaches nothing. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly HttpFetchOccupant[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record, the same read
   *  the ssh gate resolves a forward through. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
};

const UNREACHABLE: HandlerResponse = { status: 404, body: { error: 'host_unreachable' } };
const NOT_FOUND: HandlerResponse = { status: 404, body: { error: 'not_found' } };

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey).
const resolveHttpFetchSchema = z
  .looseObject({
    action: z.literal('resolveHttpFetch'),
    target: z.string().min(1),
    port: z.number().int().positive().optional(),
    /** The URL path as written by the client, NOT a filesystem path. Resolved
     *  server-side — see the module doc. */
    path: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

/** The box a destination port reaches, and the port that box must be serving the web on
 *  for the connection to succeed: a forward's INTERNAL port, or the destination port
 *  itself when the gateway serves it directly. */
type FetchTarget = { readonly fs: Directory; readonly servicePort: number };

/**
 * Resolve a NAT-forwarded port to the box behind it: the occupant leasing the address the
 * forward names. Both halves of that lookup matter — the lease says which address a box
 * answers to, occupancy says the box is still on the WiFi — so a forward to an unleased
 * address, or to a lease whose holder has disconnected, reaches nothing.
 */
const resolveForwardTarget = async (
  deps: ResolveHttpFetchDeps,
  network: ApNetworkLookup,
  forwarded: { readonly internalIp: string; readonly internalPort: number },
): Promise<FetchTarget | HandlerResponse> => {
  const occupants = await deps.listOccupantsByEssid(network.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const leases = await deps.listLeasesByEssid(network.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(network.essid, leases.data ?? []);
  const occupant = (occupants.data ?? []).find(
    (row) => addresses.get(row.owner_key) === forwarded.internalIp,
  );
  if (occupant === undefined) {
    return UNREACHABLE;
  }

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const occupantFs = bootableOccupantFs(occupant, patches.data);
  // A bricked box behind the NAT cannot come up, so the forward reaches a dead host —
  // whatever its document root still holds.
  if (occupantFs === null) {
    return UNREACHABLE;
  }
  return { fs: occupantFs, servicePort: forwarded.internalPort };
};

export const handleResolveHttpFetch = async (
  body: unknown,
  deps: ResolveHttpFetchDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveHttpFetchSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { payload } = verified;

  const { data, error } = await deps.findNetworkByPublicIp(payload.target);
  if (error) {
    return { status: 500, body: { error: 'network_lookup_failed' } };
  }
  if (data === null) {
    return UNREACHABLE;
  }

  // Materialize the GATEWAY once: it drives the boot gate and the port routing, off one
  // consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const gatewayFs = materializeApGatewayFs(data, patches.data);

  // A bricked gateway takes the whole public IP dark — nothing behind it is reachable
  // even if the box itself is up and serving.
  if (!canBoot(gatewayFs).ok) {
    return UNREACHABLE;
  }

  const port = payload.port ?? HTTP_DEFAULT_PORT;
  const served: ServedMachine = machineServing({ routerFs: gatewayFs, port });
  if (served.kind === 'none') {
    return UNREACHABLE;
  }
  const target =
    served.kind === 'router'
      ? { fs: gatewayFs, servicePort: port }
      : await resolveForwardTarget(deps, data, served);
  if ('status' in target) {
    return target;
  }

  // ONE liveness check for both arms, and it is service-specific: reaching a listening
  // daemon is not reaching a web server. A forward onto `sshd`, or the gateway's own
  // `:22`, refuses exactly like a closed port.
  const serving = readOpenPorts(target.fs).some(
    (openPort) =>
      openPort.port === target.servicePort && openPort.service === SERVICE_CATALOG.http.service,
  );
  if (!serving) {
    return UNREACHABLE;
  }

  // The document-root confinement, applied to the RAW client path. A path that climbs out
  // names nothing, and says so the same way a missing file does — telling a caller their
  // traversal was spotted is itself a hint worth withholding.
  const filePath = resolveWebPath(payload.path);
  if (filePath === null) {
    return NOT_FOUND;
  }

  // Read as the SERVER, not as the caller: the requester has no account on this box at
  // all, and a page published under the document root is written by root and so readable
  // by root alone. The confinement is the document root, not the file permissions.
  const page = createFsView(target.fs, { userType: 'root' }).read(filePath);
  if (!page.ok) {
    return NOT_FOUND;
  }

  return { status: 200, body: { ok: true, content: page.content } };
};
