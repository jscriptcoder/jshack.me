/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER login, at
 * whichever door the caller knocked on. `ssh [-p port] <user>@<public IP>` and
 * `ftp [-p port] <public IP>` reach whatever `resolvePublicTarget` says that address
 * and port reach — the AP's own gateway, or an occupant behind a NAT forward — and
 * validate the password against THAT box's `/etc/passwd`. The session lands on the
 * machine id the resolver named, so a login can never authenticate against one tree and
 * land on another.
 *
 * The door is a `kind`, not a second endpoint: one passwd, one tier, one resolution.
 * All it changes is which log the visit is written in (`SERVICE_CATALOG[kind].sweepLog`)
 * and which daemon has to be answering on the port the request reached — a forward names
 * ONE internal port, so without that check a forward to one daemon is a door to every
 * daemon.
 *
 * Reachability lives in the resolver rather than here deliberately: `hydra` attacks the
 * same addresses, and a password cracked against a different tree than the one `ssh`
 * authenticates against is a credential the game hands a player and then refuses.
 *
 * What stays this handler's own: a resolved attempt leaves an `auth.log` trace on that
 * machine's shared record — on BOTH outcomes, with the attacker's server-derived source
 * IP. The own-workstation bypass does not apply — a public target is foreign by design,
 * so the passwd check IS the authorization boundary. Unknown-user and wrong-password
 * collapse to one 401.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { md5 } from '../generation/md5';
import { accountIn } from './passwdAccount';
import {
  resolvePublicTarget,
  type PublicTarget,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import { derivePid } from '../logging/syslog';
import type { SweepLog } from '../services/serviceCatalog';
import { standingVantage, type FindActiveSession } from '../patches/authorizeMachineAccess';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import { asGameTime } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import {
  DOOR_KINDS,
  reachDoor,
  type AuthSessionRow,
  type HandlerResponse,
} from './authCreateSession';
import type { NonceStore } from '../signedRequest/nonceStore';

export type AuthCreateSessionPublicDeps = ResolvePublicTargetDeps & {
  readonly nonceStore: NonceStore;
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
  /** Resolve one network's public IP from its ESSID — the origin of a login launched
   *  from a box the caller is standing on but does not own. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
  /** Whether the caller holds a session on the machine they say they are standing on
   *  — the L1 rule shared with the patch endpoints, and what turns a claimed vantage
   *  into an established one. */
  readonly findActiveSession: FindActiveSession;
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide
// posture that a client never claims identity (the caller is the verified pubkey).
const authCreateSessionPublicSchema = z
  .looseObject({
    action: z.literal('authCreateSessionPublic'),
    session_id: z.string().min(1),
    target: z.string().min(1),
    // Optional for the same reason the own-LAN gate's are: a backdoor has no
    // credential to send. A password door still requires both.
    username: z.string().min(1).optional(),
    password: z.string().optional(),
    port: z.number().int().positive().optional(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
    // Absent means ssh, so every shipped caller keeps working untouched.
    kind: z.enum(DOOR_KINDS).default('ssh'),
    // The box the caller is standing on. Optional because `ssh` names none and its
    // trace has always carried the address the caller owns; a door that DOES name one
    // gets the honest answer — the network the target actually saw.
    caller_machine_id: z.string().min(1).optional(),
  })
  .refine((payload) => !('player_key' in payload));

/** Stamp the login attempt onto the TARGET machine's `/var/log/auth.log` via the
 *  shared system-log primitive — on BOTH outcomes (sshd records accepted AND rejected
 *  logins). The keystone: the line is NOT written under the attacker's key — the system
 *  owns its logs, so every attacker's line accretes into ONE row instead of colliding
 *  under the last-write-wins fold; the attacker's identity lives in the line's source
 *  IP. Best-effort: a logging failure must never break (or fabricate) the auth. */
const logCrossPlayerAuth = async (
  deps: AuthCreateSessionPublicDeps,
  writerKey: string,
  target: PublicTarget,
  attempt: {
    readonly outcome: 'success' | 'failure';
    readonly user: string;
    readonly fromIp: string;
    /** How the door being knocked on records an attempt — the same catalog column the
     *  own-LAN gate and hydra's sweep write through, so one service's login, sweep and
     *  cross-network break-in can never disagree about which file the defender reads. */
    readonly sweepLog: SweepLog;
  },
): Promise<void> => {
  const stamp = deps.now();
  const record = {
    outcome: attempt.outcome,
    user: attempt.user,
    fromIp: attempt.fromIp,
    hostname: target.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  };
  // A daemon that records arrivals separately writes both in one append: they are one
  // event to the box, and two appends would be two read-modify-writes racing.
  const line = [attempt.sweepLog.formatArrival?.(record), attempt.sweepLog.formatAttempt(record)]
    .filter((entry) => entry !== undefined)
    .join('\n');
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey,
        machineId: target.machineId,
        path: attempt.sweepLog.path,
        owner: attempt.sweepLog.owner,
        permissions: attempt.sweepLog.permissions,
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

  // Where the caller is standing, established rather than believed. `ssh` names no box
  // and resolves to the address it always did.
  const vantage = await standingVantage(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!vantage.ok) {
    return { status: vantage.status, body: { error: vantage.error } };
  }

  // Reachability, port routing and the boot gate all live in the shared resolver, so
  // the tree this login is checked against is the same tree an attack sweeps.
  const resolved = await resolvePublicTarget(deps, {
    publicIp: payload.target,
    port: payload.port,
  });
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const target = resolved.target;

  // The daemon on the port this request REACHED has to be the one being logged into.
  // A forward names a specific internal port, so without this a forward to one daemon
  // is a door to every daemon — you would `ftp` into a box that only runs sshd, and the
  // wrong log would carry the visit. The far side's liveness is already the resolver's;
  // WHICH service answers there is this handler's, because only it knows the door.
  const reached = reachDoor(payload.kind, target.fs, target.reachedPort);
  if (reached === null) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  // A backdoor reached across the network behaves exactly as one reached from the
  // next desk: it admits whoever its pidfile names and records nothing. The forward
  // changed how far the knock travelled, not what is behind the door.
  if (reached.kind === 'listener') {
    const { user, userType } = reached.admits;
    const { error } = await deps.insertSession({
      session_id: payload.session_id,
      player_key: publicKey,
      machine_id: target.machineId,
      credentials: { username: user, userType },
      parent_session_id: payload.parent_session_id ?? null,
      source_ip: payload.source_ip ?? null,
      kind: payload.kind,
      essid: target.essid,
    });
    if (error) {
      return { status: 500, body: { error: 'insert_failed' } };
    }
    return {
      status: 200,
      body: { ok: true, username: user, userType, machine_id: target.machineId },
    };
  }

  const spec = reached.spec;
  if (payload.username === undefined || payload.password === undefined) {
    return { status: 401, body: { error: 'invalid_credentials' } };
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
    const sourceIp = await resolveVantageSourceIp(deps, {
      actorKey: publicKey,
      standingEssid: vantage.standingEssid,
    });
    await logCrossPlayerAuth(deps, target.logWriterKey, target, {
      outcome: passwordOk ? 'success' : 'failure',
      user: payload.username,
      fromIp: sourceIp,
      sweepLog: spec.sweepLog,
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
    kind: payload.kind,
    essid: target.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return {
    status: 200,
    body: { ok: true, userType: account.userType, machine_id: target.machineId },
  };
};
