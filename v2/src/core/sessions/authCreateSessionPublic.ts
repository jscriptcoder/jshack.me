/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER ssh login.
 * `ssh [-p port] <user>@<public IP>` resolves the public IP to the ACCESS POINT that
 * bears it, materializes the ESSID's shared GATEWAY — the box the address belongs to —
 * and decides which machine the requested port reaches:
 *
 *   - a port the GATEWAY itself serves (its seeded `sshd:22`) → log in ON the gateway,
 *     validated against its `/etc/passwd` (root-only; the admin password is seeded from
 *     the ESSID). The session lands on the gateway's machine id.
 *   - a NAT-forwarded port → the occupant who LEASES the address that forward names.
 *     Every occupant of a shared AP can publish a working forward, and two forwards on
 *     one gateway reach two different boxes. The gate refuses if nobody currently on
 *     the WiFi answers to that address, if the box is bricked, or if its internal
 *     service isn't listening (a dark DNAT target reaches nothing); otherwise the
 *     password is validated against THAT box's `/etc/passwd` and the session lands on
 *     its machine id.
 *   - any other port → host_unreachable.
 *
 * The boot gate keys on the GATEWAY: a `/boot` tombstone takes the whole public IP
 * dark, refused before any password is checked. Once a reachable target resolves, the
 * attempt leaves an `auth.log` trace on that machine's shared record — on BOTH
 * outcomes, with the attacker's server-derived source IP. The own-workstation bypass
 * does not apply — a public target is foreign by design, so the passwd check IS the
 * authorization boundary. Unknown-user and wrong-password collapse to one 401.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { seedApGatewayHostname } from '../generation/routerFs';
import { accountIn } from './passwdAccount';
import { materializeApGatewayFs } from '../network/materializeRouterFs';
import type { OwnerPatchRow } from '../network/materializeWorkstationFs';
import { machineServing, type ServedMachine } from '../network/machineServing';
import { bootableOccupantFs } from '../network/natHosts';
import { lanAddressesByOwner, type LanLeaseRow } from '../network/lanAddress';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import type { Directory } from '../filesystem/types';
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

/** One occupant a NAT forward can land a login on: its machine id (the journal scope
 *  AND the session target), the `owner_key` that rebuilds its tree and owns its logs,
 *  and the identity fields the reconstructed passwd is derived from. A structural
 *  superset of the scan path's row, so the shared resolver takes it verbatim. */
export type NatOccupantRow = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  /** The owner's player-chosen workstation hostname — the name a forwarded-port
   *  `auth.log` line carries, mirroring the gateway's seeded hostname. */
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

/** What a public IP a login targets resolves to: the AP that bears it. The GATEWAY
 *  always exists — it is the access point's own infrastructure rather than a machine
 *  that joins the network — so `router_machine_id` (its journal scope AND the port-22
 *  session target) and the `essid` (which seeds its FS, recovers its admin password and
 *  keys its occupancy) are always present. */
export type ApNetworkLookup = {
  readonly router_machine_id: string;
  readonly essid: string;
};

export type AuthCreateSessionPublicDeps = {
  readonly nonceStore: NonceStore;
  readonly findNetworkByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: ApNetworkLookup | null; readonly error: unknown }>;
  /** A machine's FULL patch journal (scoped to `machine_id`, server order). Used for
   *  the GATEWAY — replayed over its seeded base for the boot gate and the live forward
   *  table — and for the box a forward reaches, for its services and its passwd. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Who is currently ON the ESSID. Occupancy is the reachability test, so a forward
   *  naming the address of somebody who has left the WiFi reaches nothing. Read only
   *  when the requested port is actually forwarded. */
  readonly listOccupantsByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly NatOccupantRow[] | null; readonly error: unknown }>;
  /** Every lease held on this ESSID, in ONE read — the addresses of record. The same
   *  read the same-LAN path resolves addresses from, so the two gates can never
   *  disagree on where a box is. Also fixes whose row the gateway's own log accretes
   *  under. */
  readonly listLeasesByEssid: (
    essid: string,
  ) => Promise<{ readonly data: readonly LanLeaseRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the auth.log trace line. */
  readonly now: () => number;
  /** Read the current content of the target machine's auth.log on the shared journal,
   *  keyed `(machine_id, path, writer_key)` — the read half of the appended line. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended auth.log line on the target machine). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
  /** Resolve the ATTACKER's (caller's) own home public IP from their verified owner
   *  key — the truthful source IP of the login, server-derived so a client cannot
   *  forge it or frame another network. `null` (no home network) → source unknown. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
};

// The destination ssh port when the client sends none — a bare `ssh user@host` is
// port 22. The client always carries the resolved port, but defaulting here keeps
// the server correct for any envelope that omits it.
const DEFAULT_SSH_PORT = 22;

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const authCreateSessionPublicSchema = z
  .looseObject({
    action: z.literal('authCreateSessionPublic'),
    session_id: z.string().min(1),
    target: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    port: z.number().int().positive().optional(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** The resolved auth target behind the public IP: which tree to validate the password
 *  against, the machine id the session lands on, the hostname the auth.log trace line
 *  carries, and whose row that line accretes under — the reached occupant's own key, or
 *  the AP's stable log-writer key when the target is the ownerless gateway (`null` on
 *  an AP nobody has ever leased an address on, which then keeps no log). */
type AuthTarget = {
  readonly fs: Directory;
  readonly machineId: string;
  readonly hostname: string;
  readonly logWriterKey: string | null;
};

/**
 * Resolve a NAT-forwarded port to its auth target: the occupant leasing the address the
 * forward names. Both halves of that lookup matter — the lease says which address a box
 * answers to, occupancy says the box is still on the WiFi at all — so a forward to an
 * unleased address, or to a lease whose holder has disconnected, reaches nothing.
 * Returns the target, or a `HandlerResponse` to return verbatim (404 host_unreachable
 * for an unreachable/dark target, 500 when a lookup fails).
 */
const resolveForwardTarget = async (
  deps: AuthCreateSessionPublicDeps,
  network: ApNetworkLookup,
  forwarded: { readonly internalIp: string; readonly internalPort: number },
  leases: readonly LanLeaseRow[],
): Promise<AuthTarget | HandlerResponse> => {
  const occupants = await deps.listOccupantsByEssid(network.essid);
  if (occupants.error) {
    return { status: 500, body: { error: 'occupants_lookup_failed' } };
  }
  const addresses = lanAddressesByOwner(network.essid, leases);
  const occupant = (occupants.data ?? []).find(
    (row) => addresses.get(row.owner_key) === forwarded.internalIp,
  );
  // The forward points at no host: a stray internal IP, an address nobody leases, or
  // one whose holder has taken their box off this WiFi.
  if (occupant === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const patches = await deps.findPatches({ machine_id: occupant.workstation_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const occupantFs = bootableOccupantFs(occupant, patches.data);
  // A bricked box behind the NAT can't come up, so the forward reaches a dead host.
  if (occupantFs === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }
  // The internal service isn't listening (that daemon was never started): a dark DNAT
  // target. The forward's SPECIFIC internal port, not merely "any service is up".
  const listening = readOpenPorts(occupantFs).some(
    (openPort) => openPort.port === forwarded.internalPort,
  );
  if (!listening) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }
  return {
    fs: occupantFs,
    machineId: occupant.workstation_machine_id,
    hostname: occupant.workstation_machine_name,
    logWriterKey: occupant.owner_key,
  };
};

/** Stamp the login attempt onto the TARGET machine's `/var/log/auth.log` via the
 *  shared system-log primitive — on BOTH outcomes (sshd records accepted AND rejected
 *  logins). The keystone: the line is NOT written under the attacker's key — the system
 *  owns its logs, so every attacker's line accretes into ONE row instead of colliding
 *  under the last-write-wins fold; the attacker's identity lives in the line's source
 *  IP. Best-effort: a logging failure must never break (or fabricate) the auth. */
const logCrossPlayerAuth = async (
  deps: AuthCreateSessionPublicDeps,
  writerKey: string,
  target: AuthTarget,
  attempt: {
    readonly outcome: 'success' | 'failure';
    readonly user: string;
    readonly fromIp: string;
  },
): Promise<void> => {
  const stamp = deps.now();
  const line = formatSshdAuthLine({
    outcome: attempt.outcome,
    user: attempt.user,
    fromIp: attempt.fromIp,
    hostname: target.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey,
        machineId: target.machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the auth result stands regardless of a logging failure.
  }
};

/** The gateway itself as an auth target — the box the public IP belongs to, root-only,
 *  its admin password seeded from the ESSID. It has no owner, so its log accretes under
 *  the AP's stable log-writer key. */
const gatewayTarget = (
  network: ApNetworkLookup,
  gatewayFs: Directory,
  leases: readonly LanLeaseRow[],
): AuthTarget => ({
  fs: gatewayFs,
  machineId: network.router_machine_id,
  hostname: seedApGatewayHostname(network.essid),
  logWriterKey: apGatewayLogWriterKey(leases),
});

export const handleAuthCreateSessionPublic = async (
  body: unknown,
  deps: AuthCreateSessionPublicDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionPublicSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const { data, error } = await deps.findNetworkByPublicIp(payload.target);
  if (error) {
    return { status: 500, body: { error: 'network_lookup_failed' } };
  }
  if (data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Materialize the GATEWAY once: it drives the boot gate, the port routing, and — for
  // a gateway-served port — the password check, all off one consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const gatewayFs = materializeApGatewayFs(data, patches.data);

  // A bricked gateway (a `/boot` tombstone) takes the whole public IP dark: refuse
  // before the password is checked — no credentials reach a dead box.
  if (!canBoot(gatewayFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Route by destination port BEFORE any occupancy or lease work: a port nothing serves
  // reaches nothing, and asking who is on the AP would not change that.
  const served: ServedMachine = machineServing({
    routerFs: gatewayFs,
    port: payload.port ?? DEFAULT_SSH_PORT,
  });
  if (served.kind === 'none') {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // One lease read serves both halves of what follows: which box a forward reaches, and
  // whose row the gateway's own log accretes under. A failure is a clean 500 — an
  // address that cannot be read is never derived as a fallback.
  const leases = await deps.listLeasesByEssid(data.essid);
  if (leases.error) {
    return { status: 500, body: { error: 'leases_lookup_failed' } };
  }
  const target =
    served.kind === 'router'
      ? gatewayTarget(data, gatewayFs, leases.data ?? [])
      : await resolveForwardTarget(deps, data, served, leases.data ?? []);
  if ('status' in target) {
    return target;
  }

  // Validate against the TARGET's own /etc/passwd (the gateway is root-only; a
  // workstation also has its weak `guest` account). An unknown user OR a wrong
  // password is one 401 — the response never reveals which accounts exist.
  const account = accountIn(target.fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;

  // The target machine is resolved, so the attempt CAN be logged — sshd records both
  // accepted and rejected logins. (Every 404 host_unreachable above logs nothing —
  // there is no reachable machine to log on.) The line lands on the resolved machine
  // under the key that owns its logs; the source IP is the attacker's own home public
  // IP, server-derived from their verified key — never the payload's.
  if (target.logWriterKey !== null) {
    const sourceIp = await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, publicKey);
    await logCrossPlayerAuth(deps, target.logWriterKey, target, {
      outcome: passwordOk ? 'success' : 'failure',
      user: payload.username,
      fromIp: sourceIp,
    });
  }

  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: target.machineId,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'ssh',
    essid: data.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: target.machineId },
  };
};
