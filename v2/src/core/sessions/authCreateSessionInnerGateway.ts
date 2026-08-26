/**
 * handleAuthCreateSessionInnerGateway — the server gate for `ssh user@<inner>:<fwd
 * port>`, the multi-layer payoff: logging into a hidden Layer-2 machine THROUGH a NAT
 * forward the player configured on their own inner gateway.
 *
 * WHERE that port leads is `resolveInnerGatewayTarget` — the shared resolver `hydra`
 * sweeps through too, so a credential this gate accepts is one hydra can report, by
 * construction rather than by two chain walks staying in step. It replays the gateway's
 * journal (the forwards live there, not in the client's static world), boot-gates every
 * hop, and routes the destination port: a forward reaches the deep layer's terminal NPC
 * or the child gateway fronting the next layer down; a gateway's own `:22` lands on that
 * gateway.
 *
 * This gate owns what happens once the box is known: authenticate against the TARGET's
 * own `/etc/passwd` (the deep NPC, or the gateway for its own port), stamp the deep
 * reach onto its auth.log, and land the session on the resolved machine id.
 *
 * The chain is regenerated from the ESSID and the shared journal, never from the
 * caller's key — every occupant of an ESSID walks the same gateway to the same deep
 * boxes. It needs no cross-player lookup, which is a different claim from the layer
 * being private, and only the first one is true.
 *
 * Unknown-user and wrong-password collapse to one 401; a child-journal fetch failure
 * mid-walk is a 500, kept distinct from a port that simply leads nowhere.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { resolveInnerGatewayTarget } from '../network/resolveInnerGatewayTarget';
import { accountIn } from './passwdAccount';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSshdAuthLine,
} from '../logging/authLog';
import { derivePid } from '../logging/syslog';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import { DOOR_KINDS, type AuthSessionRow, type HandlerResponse } from './authCreateSession';
import { listenerOn, readOpenPorts } from '../services/pidfile';
import type { NonceStore } from '../signedRequest/nonceStore';

export type AuthCreateSessionInnerGatewayDeps = {
  readonly nonceStore: NonceStore;
  /** The inner gateway's FULL patch journal (scoped to its `machine_id`, server
   *  order) so the gate can replay it over the seeded gateway base — both to ask
   *  `canBoot` and to read the live `rules.v4` forward off the materialized tree. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the deep-reach auth.log line. */
  readonly now: () => number;
  /** Read the current content of the landed deep box's auth.log on the shared journal,
   *  keyed `(machine_id, path, writer_key)` — the read half of the appended line. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended auth.log line on the landed deep box). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

// The destination ssh port when the client sends none — a bare `ssh user@host` is
// port 22. The client always carries the resolved port, but defaulting here keeps
// the server correct for any envelope that omits it.
const DEFAULT_SSH_PORT = 22;

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const authCreateSessionInnerGatewaySchema = z
  .looseObject({
    action: z.literal('authCreateSessionInnerGateway'),
    session_id: z.string().min(1),
    essid: z.string().min(1),
    target: z.string().min(1),
    // Optional because a backdoor has neither to send — the pidfile names its own
    // user. A password door still requires both.
    username: z.string().min(1).optional(),
    password: z.string().optional(),
    port: z.number().int().positive().optional(),
    // Absent means ssh, so every shipped caller keeps working untouched.
    kind: z.enum(DOOR_KINDS).default('ssh'),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Stamp the deep reach onto the landed box's `/var/log/auth.log` via the shared
 *  system-log primitive — on BOTH outcomes (sshd records accepted AND rejected logins).
 *  The source IP is the fronting gateway's `.1` — NAT is all a deep box is ever shown,
 *  whoever is behind it. Best-effort: a logging failure must never break (or fabricate)
 *  the auth.
 *
 *  The writer is the CALLER's own key, which is a KNOWN DEFECT rather than a decision:
 *  these boxes are ESSID-seeded and shared, so two occupants reaching one of them write
 *  two rows, and the fold takes the later one — hiding the earlier player's line. The fix
 *  is a box-owned key on this write and on hydra's, together; see the backlog entry in
 *  `docs/conventions-and-gotchas.md` §9. */
const logDeepReachAuth = async (
  deps: AuthCreateSessionInnerGatewayDeps,
  target: {
    readonly machineId: string;
    readonly hostname: string;
    readonly sourceIp: string;
    readonly writerKey: string;
  },
  attempt: { readonly outcome: 'success' | 'failure'; readonly user: string },
): Promise<void> => {
  const stamp = deps.now();
  const line = formatSshdAuthLine({
    outcome: attempt.outcome,
    user: attempt.user,
    fromIp: target.sourceIp,
    hostname: target.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: target.writerKey,
        machineId: target.machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the reach stands regardless of a logging failure.
  }
};

export const handleAuthCreateSessionInnerGateway = async (
  body: unknown,
  deps: AuthCreateSessionInnerGatewayDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionInnerGatewaySchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Where the destination port leads — the shared walk, which also decides that the
  // target is a genuine inner gateway, that its journal read succeeded, and that nothing
  // on the chain is bricked. A child journal fetch that failed mid-walk surfaces as a
  // 500, kept distinct from the 404 a port leading nowhere produces.
  const resolved = await resolveInnerGatewayTarget(deps, {
    essid: payload.essid,
    target: payload.target,
    port: payload.port ?? DEFAULT_SSH_PORT,
  });
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const resolution = resolved.target;

  // Only a backdoor asks who is behind the port here. An ssh reach is already routed
  // by `machineServing`, and putting a service check on that path would change a
  // shipped one this slice has no business changing.
  if (payload.kind === 'nc') {
    const admits = listenerOn(resolution.fs, resolution.reachedPort);
    if (admits === null) {
      return { status: 404, body: { error: 'host_unreachable' } };
    }
    const { error } = await deps.insertSession({
      session_id: payload.session_id,
      player_key: publicKey,
      machine_id: resolution.machineId,
      credentials: { username: admits.user, userType: admits.userType },
      parent_session_id: payload.parent_session_id ?? null,
      source_ip: payload.source_ip ?? null,
      kind: payload.kind,
      essid: payload.essid,
    });
    if (error) {
      return { status: 500, body: { error: 'insert_failed' } };
    }
    return {
      status: 200,
      body: {
        ok: true,
        username: admits.user,
        userType: admits.userType,
        machine_id: resolution.machineId,
      },
    };
  }

  // A forward names a box and a PORT; the resolver stops at the box, because whether the
  // daemon a caller wants is up is the caller's own question — the same one `nc` asks
  // above and every data door asks against `reachedPort`. A forward to a port nothing
  // serves reaches no sshd, so it is dark rather than a credential prompt, and it is
  // refused before anything is written to the box's auth.log: nothing there heard it.
  if (!readOpenPorts(resolution.fs).some((open) => open.port === resolution.reachedPort)) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  if (payload.username === undefined || payload.password === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // Validate against the TARGET's own /etc/passwd (the deep NPC, or the gateway for
  // its own port). An unknown user OR a wrong password is one 401 — the response
  // never reveals which accounts exist.
  const account = accountIn(resolution.fs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;

  // A DEEP reach (resolved through a forward) leaves an sshd auth.log line on the landed
  // box — on both outcomes, readable once the player is in — sourced from the fronting
  // gateway's `.1`. Landing on the inner gateway's own `:22` is a Layer-1 box (sourceIp
  // null), not a deep one, so it records nothing here.
  if (resolution.sourceIp !== null) {
    await logDeepReachAuth(
      deps,
      {
        machineId: resolution.machineId,
        hostname: resolution.hostname,
        sourceIp: resolution.sourceIp,
        writerKey: publicKey,
      },
      { outcome: passwordOk ? 'success' : 'failure', user: payload.username },
    );
  }

  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: resolution.machineId,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'ssh',
    essid: payload.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: resolution.machineId },
  };
};
