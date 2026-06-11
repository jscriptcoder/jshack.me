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
import { generateHomeLan } from '../generation/generateHomeLan';
import { buildRemoteHostFs } from '../generation/remoteHostFs';
import { hostMachineId } from '../generation/remoteHostId';
import { md5 } from '../generation/md5';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { UserType } from '../types';
import type { Directory } from '../filesystem/types';

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
  readonly insertSession: (row: AuthSessionRow) => Promise<{ readonly error: unknown }>;
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

/** The account tier from a passwd row, mirroring `su` and the generators: uid 0 →
 *  root, the literal `guest` account → guest, everyone else → user. */
const userTypeFromRow = (fields: readonly string[]): UserType =>
  Number(fields[2]) === 0 ? 'root' : fields[0] === 'guest' ? 'guest' : 'user';

/** The `{ hash, userType }` for `username` on a host's regenerated FS, or null
 *  when the account does not exist. Row shape: `name:hash:uid:gid:gecos:home:shell`. */
const accountIn = (
  fs: Directory,
  username: string,
): { readonly hash: string; readonly userType: UserType } | null => {
  const etc = fs.entries.get('etc');
  if (etc === undefined || etc.kind !== 'directory') return null;
  const passwd = etc.entries.get('passwd');
  if (passwd === undefined || passwd.kind !== 'file') return null;
  const fields = passwd.content
    .split('\n')
    .map((line) => line.split(':'))
    .find((row) => row[0] === username);
  if (fields === undefined) return null;
  return { hash: fields[1] ?? '', userType: userTypeFromRow(fields) };
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
  const host = generateHomeLan(publicKey, payload.essid).hosts.find(
    (candidate) => candidate.ip === payload.target_ip,
  );
  if (host === undefined) {
    return { status: 404, body: { error: 'host_unreachable' } };
  }

  // Validate the credential against the host's real /etc/passwd. Unknown user and
  // bad password are indistinguishable in the response.
  const account = accountIn(buildRemoteHostFs(publicKey, payload.essid, host), payload.username);
  if (account === null || md5(payload.password) !== account.hash) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  const { error } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: hostMachineId(host, payload.essid),
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
