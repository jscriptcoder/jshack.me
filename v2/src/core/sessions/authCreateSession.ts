/**
 * handleAuthCreateSession — the server-side gate for an ssh session on a FOREIGN
 * host (ssh epic, PR 3b). Ported from legacy `authCreateSession`, adapted to v2's
 * pure generation: instead of reading a stored `machine_filesystems` projection,
 * the server REGENERATES the target's filesystem from the VERIFIED pubkey + the
 * payload's essid + ip, reads its real `/etc/passwd`, server-derives the userType
 * (never a client claim), and validates `md5(password)` against the stored hash
 * before persisting the row.
 *
 * Auth model: the own-workstation gate does NOT apply — an ssh target is foreign
 * by design, so the passwd check IS the authorization boundary. Resolving the
 * target on the caller's own regenerated LAN also proves `target_ip` is a real
 * reachable host (not an arbitrary address). Unknown-user and wrong-password
 * collapse to ONE 401 so the response never reveals which accounts exist (real
 * ssh / legacy parity).
 *
 * Stored: `essid` (the regeneration key the later L1/L2 write path needs to
 * rebuild this host's FS). NOT stored: `target_ip` — it is recoverable from
 * `(essid, machine_id)` via `hostForMachineId`, so it stays out of the row.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan, type LanHost } from '../generation/generateHomeLan';
import { resolveLanHostIdentity } from '../generation/lanHostIdentity';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs';
import { canBoot } from '../boot/bootFiles';
import { md5 } from '../generation/md5';
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
import { accountIn } from './passwdAccount';
import { asGameTime, type UserType } from '../types';
import type { PatchRow } from '../patches/upsertPatch';
import type { NonceStore } from '../signedRequest/nonceStore';

export type AuthSessionRow = {
  readonly session_id: string;
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: 'ssh';
  readonly essid: string;
};

export type AuthCreateSessionDeps = {
  readonly nonceStore: NonceStore;
  /** The server's wall clock, epoch-ms (UTC) — stamps the auth.log line. */
  readonly now: () => number;
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
  /** The resolved host's FULL patch journal (scoped to `machine_id`, server order),
   *  replayed over its seeded base so the gate sees the box's REAL state: a `/boot`
   *  tombstone makes it unbootable, and any journal write to `/etc/passwd` is the
   *  credential actually in force. Without this the handler could only ever see the
   *  pristine regenerated tree. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** Read the current content of a log file on the host's shared journal, keyed
   *  `(machine_id, path, writer_key)` — the read half of the system-written
   *  auth.log line. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended auth.log line on the remote host). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

// Loose so the always-present envelope fields (action/ts/nonce) pass through; the
// refine rejects a client-supplied player_key (the server stamps it). There is no
// `userType` field — the server derives it from the regenerated passwd.
const authCreateSessionSchema = z
  .looseObject({
    action: z.literal('authCreateSession'),
    session_id: z.string().min(1),
    essid: z.string().min(1),
    target_ip: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    parent_session_id: z.string().min(1).nullable().optional(),
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload));

type SshAttempt = {
  readonly publicKey: string;
  readonly machineId: string;
  readonly host: LanHost;
  readonly username: string;
  readonly fromIp: string;
  readonly outcome: 'success' | 'failure';
};

/** Stamp the attempt onto the REMOTE host's `/var/log/auth.log` via the shared
 *  system-log primitive — the same seam nmap/ftp/nc/mysqld/redis will reuse.
 *  Best-effort: a logging failure must never break (or fabricate) the auth. */
const logSshAttempt = async (deps: AuthCreateSessionDeps, attempt: SshAttempt): Promise<void> => {
  const stamp = deps.now();
  const line = formatSshdAuthLine({
    outcome: attempt.outcome,
    user: attempt.username,
    fromIp: attempt.fromIp,
    hostname: attempt.host.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
      {
        writerKey: attempt.publicKey,
        machineId: attempt.machineId,
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

export const handleAuthCreateSession = async (
  body: unknown,
  deps: AuthCreateSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authCreateSessionSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // Resolve the target on the caller's OWN regenerated LAN: gives the host needed
  // to rebuild its FS, and proves target_ip is a real reachable host.
  const host = generateHomeLan(payload.essid).hosts.find(
    (candidate) => candidate.ip === payload.target_ip,
  );
  if (host === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate the credential against the host's real /etc/passwd. Unknown user and
  // bad password are indistinguishable in the response. The shared resolver maps the
  // host to its machine id + seeded FS: the edge router (`.1`), an inner gateway, or
  // a coordinate-seeded sibling — the same mapping the client uses, so the session
  // lands on the box both agree on.
  const { machineId, baseFs } = resolveLanHostIdentity(host, payload.essid);

  // Replay the host's journal over its seeded base so the gate reads the box's REAL
  // state rather than the pristine regeneration. A read failure is a 500: never a
  // false login, and never a false dark either.
  const patches = await deps.findPatches({ machine_id: machineId });
  if (patches.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const hostFs = materializeMachineFs(baseFs, patches.data);

  // A bricked box (a root `rm /boot/vmlinuz` tombstone) is dark on EVERY interface,
  // not just the WAN — refuse before the password is checked, so no credential
  // reaches a dead machine and nothing is logged on it. What survives a gateway
  // brick is the NETWORK, not the box: the ESSID keeps broadcasting and occupants
  // still reach each other over the LAN.
  if (!canBoot(hostFs).ok) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  const account = accountIn(hostFs, payload.username);
  const passwordOk = account !== null && md5(payload.password) === account.hash;

  // The host is resolved by now, so the attempt CAN be logged — sshd records both
  // accepted and rejected logins. (A 404 host_unreachable above logs nothing —
  // there is no machine to log on.)
  await logSshAttempt(deps, {
    publicKey,
    machineId,
    host,
    username: payload.username,
    fromIp: payload.source_ip ?? 'unknown',
    outcome: passwordOk ? 'success' : 'failure',
  });

  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: machineId,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: payload.source_ip ?? null,
    kind: 'ssh',
    essid: payload.essid,
  });
  if (error) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { ok: true, userType: account.userType } };
};
