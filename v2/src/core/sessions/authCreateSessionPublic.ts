/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER ssh login
 * (Story 2 → reshaped for Story 5.1.2: routing by DESTINATION PORT). A different
 * identity's `ssh [-p port] <user>@<A.publicIp>` resolves A's public IP in the
 * registry (Story 1), then materializes A's ROUTER — the distinct, seeded box that
 * bears the public IP — and decides which machine the requested port reaches:
 *
 *   - a port the ROUTER itself serves (its seeded `sshd:22`) → log in ON the router,
 *     validated against its `/etc/passwd` (root-only; the admin password is recovered
 *     from the owner key). The session lands on the ROUTER's machine id.
 *   - a NAT-forwarded port (Story 5.1.3c) → the ONE workstation behind the router:
 *     resolve the forward's `internalIp` to A's workstation, refuse if its internal
 *     service isn't listening (a dark DNAT target reaches nothing), validate the
 *     password against the WORKSTATION's `/etc/passwd`, and land the session on the
 *     WORKSTATION's machine id.
 *   - any other port → host_unreachable.
 *
 * The boot gate keys on the ROUTER: a `/boot` tombstone takes the whole public IP
 * dark, refused before any password is checked. Once a reachable target resolves,
 * the attempt leaves an `auth.log` trace on A's shared record (Story 6.2) — on BOTH
 * outcomes, under A's owner key (the system owns its logs), with the attacker's
 * server-derived source IP. The own-workstation bypass does not apply — a public
 * target is foreign by design, so the passwd check IS the authorization boundary.
 * Unknown-user and wrong-password collapse to one 401.
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
import { buildWorkstationResolver } from '../scan/workstationPortResolver';
import { readOpenPorts } from '../services/pidfile';
import { canBoot } from '../boot/bootFiles';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import {
  resolveCrossPlayerSourceIp,
  type FindRegistryByOwnerKey,
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

/** The registry fields a cross-player login needs. The router arm uses `owner_key`
 *  (to reconstruct the router FS + recover its seeded admin password), the router's
 *  machine id (its journal scope AND the session target), and the `essid` the session
 *  lives on. The forward → workstation arm (Story 5.1.3c) additionally needs the
 *  workstation's machine id (its journal scope + session target) and the identity
 *  fields that rebuild its tree — making this a structural superset of the scan
 *  path's `WorkstationTarget`, so the shared resolver takes it verbatim. */
export type RegistryTarget = {
  readonly owner_key: string;
  readonly router_machine_id: string;
  readonly essid: string;
  readonly workstation_machine_id: string;
  readonly workstation_username: string;
  /** The owner's player-chosen workstation hostname — the name a forwarded-port
   *  `auth.log` line (Story 6.2) carries, mirroring the router's seeded hostname. */
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

export type AuthCreateSessionPublicDeps = {
  readonly nonceStore: NonceStore;
  readonly findRegistryByPublicIp: (
    publicIp: string,
  ) => Promise<{ readonly data: RegistryTarget | null; readonly error: unknown }>;
  /** The ROUTER's FULL patch journal (scoped to `machine_id`, server order) so the
   *  gate can replay it over the seeded router base and ask `canBoot`: a bricked
   *  router (a `/boot` tombstone) takes the public IP dark, so the login is refused
   *  before the password is ever checked. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
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
  readonly findRegistryByOwnerKey: FindRegistryByOwnerKey;
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

/** The resolved auth target behind the public IP: which tree to validate the
 *  password against, the machine id the session lands on, and the hostname the
 *  auth.log trace line carries (the router's seeded name / the workstation's name). */
type AuthTarget = {
  readonly fs: Directory;
  readonly machineId: string;
  readonly hostname: string;
};

/**
 * Resolve `ssh <publicIp>:<port>` to its auth target. The router serves its own
 * ports directly (its seeded `:22`); a NAT-forwarded port reaches the ONE
 * workstation behind the router — fetch the workstation's journal, resolve it by the
 * forward's internal IP, and refuse if the forward reaches no host or its internal
 * service isn't listening. Returns the target, or a `HandlerResponse` to return
 * verbatim (404 host_unreachable for an unserved/dark port, 500 if the ws journal
 * read fails). The router's own boot/dark gate already ran upstream.
 */
const resolveAuthTarget = async (
  deps: AuthCreateSessionPublicDeps,
  registry: RegistryTarget,
  served: ServedMachine,
  routerFs: Directory,
): Promise<AuthTarget | HandlerResponse> => {
  if (served.kind === 'router') {
    return {
      fs: routerFs,
      machineId: registry.router_machine_id,
      hostname: seedApGatewayHostname(registry.essid),
    };
  }
  if (served.kind === 'none') {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const workstationPatches = await deps.findPatches({
    machine_id: registry.workstation_machine_id,
  });
  if (workstationPatches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const workstationFs = buildWorkstationResolver({
    registry,
    workstationPatches: workstationPatches.data,
  })(served.internalIp);
  // The forward points at no host (a stray internal IP), or its internal service
  // isn't listening (the workstation never started that daemon): a dark DNAT target.
  if (workstationFs === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }
  const listening = readOpenPorts(workstationFs).some(
    (openPort) => openPort.port === served.internalPort,
  );
  if (!listening) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }
  return {
    fs: workstationFs,
    machineId: registry.workstation_machine_id,
    hostname: registry.workstation_machine_name,
  };
};

/** Stamp the login attempt onto the TARGET machine's `/var/log/auth.log` via the
 *  shared system-log primitive — on BOTH outcomes (sshd records accepted AND rejected
 *  logins). The keystone (decision 1): `writerKey` is the TARGET OWNER's key — the
 *  system owns its logs, so every attacker's line accretes into ONE row instead of
 *  colliding under the last-write-wins fold; the attacker's identity lives in the
 *  line's source IP. Best-effort: a logging failure must never break (or fabricate)
 *  the auth. */
const logCrossPlayerAuth = async (
  deps: AuthCreateSessionPublicDeps,
  ownerKey: string,
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
        writerKey: ownerKey,
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

  const { data, error } = await deps.findRegistryByPublicIp(payload.target);
  if (error) {
    return { status: 500, body: { error: 'registry_lookup_failed' } };
  }
  if (data === null) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Materialize the ROUTER once: it drives the boot gate, the port routing, and —
  // for a router-served port — the password check, all off one consistent tree.
  const patches = await deps.findPatches({ machine_id: data.router_machine_id });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const routerFs = materializeApGatewayFs(data, patches.data);

  // A bricked router (a `/boot` tombstone) takes the whole public IP dark: refuse
  // before the password is checked — no credentials reach a dead box.
  if (!canBoot(routerFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Route by destination port to the auth target: the router itself (a port it
  // serves) or the workstation behind a NAT forward. An unserved/dark port resolves
  // to a host_unreachable response, returned verbatim before any password check.
  const served = machineServing({ routerFs, port: payload.port ?? DEFAULT_SSH_PORT });
  const target = await resolveAuthTarget(deps, data, served, routerFs);
  if ('status' in target) {
    return target;
  }

  // Validate against the TARGET's own /etc/passwd (the router is root-only; a
  // workstation also has its weak `guest` account). An unknown user OR a wrong
  // password is one 401 — the response never reveals which accounts exist.
  const account = accountIn(target.fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;

  // The target machine is resolved, so the attempt CAN be logged — sshd records both
  // accepted and rejected logins. (Every 404 host_unreachable above logs nothing —
  // there is no reachable machine to log on.) The line is written under the OWNER's
  // key (decision 1) on the resolved machine (router or workstation behind the NAT);
  // the source IP is the attacker's own home public IP, server-derived from their
  // verified key — never the payload's.
  const sourceIp = await resolveCrossPlayerSourceIp(deps.findRegistryByOwnerKey, publicKey);
  await logCrossPlayerAuth(deps, data.owner_key, target, {
    outcome: passwordOk ? 'success' : 'failure',
    user: payload.username,
    fromIp: sourceIp,
  });

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
