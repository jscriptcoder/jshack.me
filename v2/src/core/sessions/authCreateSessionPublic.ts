/**
 * handleAuthCreateSessionPublic — the server-side gate for a CROSS-PLAYER ssh login.
 * `ssh [-p port] <user>@<public IP>` reaches whatever `resolvePublicTarget` says that
 * address and port reach — the AP's own gateway, or an occupant behind a NAT forward —
 * and validates the password against THAT box's `/etc/passwd`. The session lands on the
 * machine id the resolver named, so a login can never authenticate against one tree and
 * land on another.
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
import type { AuthSessionRow, HandlerResponse } from './authCreateSession';
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
};

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
