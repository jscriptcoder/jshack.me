/**
 * handlePasswdChange — `passwd` on a box that is not the caller's own, answered by the
 * server. The caller already holds a ROOT shell there (they rooted it) and asks to rewrite
 * an account's md5 hash in that box's `/etc/passwd`, locking the owner out of the next
 * `su`/`ssh` with the old password.
 *
 * Why the server: the box's `/etc/passwd` is not the browser's to read, and a rewrite must
 * compose against the box as it STANDS — the same file every login already checks against —
 * not against a stale client copy that would revert another writer. So the handler finds
 * the box from the caller's own session row (that network's gateway, a machine it generates,
 * or another player's workstation found through occupancy), reads it with its journal
 * replayed, rewrites the one row, and stamps the `passwd` trace — ONE authorized act, so a
 * tampered client can neither write the row without the trace nor forge the time.
 *
 * Authorization mirrors every foreign write: L1 is the active session on the box (its
 * absence is the refusal), L2 is that session being ROOT — only root may write the
 * root-owned `/etc/passwd`. A non-root shell is refused without the box being read or
 * written. The new hash crosses in the request (there is nothing to compare, only to
 * store); the server never sees the plaintext.
 *
 * The `/etc/passwd` row is written under the CALLER's verified key (its provenance — who
 * changed the password), while the auth.log trace is written under the key that owns the
 * BOX's logs (the system owns its logs), so several visitors' lines accrete into one row
 * instead of colliding under the last-write-wins fold.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { createFsView } from '../filesystem/fsView.js';
import { accountIn, withAccountHash, PASSWD_OWNER, PASSWD_PATH } from './passwdAccount.js';
import {
  resolveStoodOnBox,
  type FindOccupantWorkstationByMachineId,
  type StoodOnBox,
} from './stoodOnBox.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatPasswdLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import { appendMachineLog, type AppendLog } from '../patches/appendMachineLog.js';
import { asGameTime } from '../types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { HandlerResponse } from './authCreateSession.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { FindActiveSession, StandingSession } from '../patches/authorizeMachineAccess.js';

export type PasswdChangeDeps = {
  readonly nonceStore: NonceStore;
  /** Whose workstation this is. Asked only for a machine the shell's network does not make,
   *  so a `passwd` on a box whose owner has taken it off the network collapses to a 404. */
  readonly findOccupantWorkstationByMachineId: FindOccupantWorkstationByMachineId;
  /** The caller's live shell on the box. Its absence is the refusal; its network locates
   *  the box, and its tier (root) is what L2 turns on. */
  readonly findActiveSession: FindActiveSession<StandingSession>;
  /** The machine's whole journal, every writer's rows, replayed over the generated tree so
   *  the rewrite composes against the box as it stands now. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the auth.log trace line. */
  readonly now: () => number;
  readonly appendLog: AppendLog;
  /** Write a patch: the rewritten `/etc/passwd` row, then the appended auth.log line. */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

// The server always stamps the writer, so a client-supplied player_key/writer_key is forged
// provenance and rejected outright.
const noStampedKeys = (payload: Record<string, unknown>): boolean =>
  !('player_key' in payload) && !('writer_key' in payload);

// Loose so the always-present envelope fields (action/ts/nonce) pass through. The new hash
// is the one the account answers to afterwards; the server never sees the plaintext, which
// is why nothing here resembles a password check.
const passwdChangeSchema = z
  .looseObject({
    action: z.literal('passwdChange'),
    machine_id: z.string().min(1),
    username: z.string().min(1),
    new_hash: z.string().min(1),
  })
  .refine(noStampedKeys);

/** Stamp the change onto the box's `/var/log/auth.log` via the shared system-log
 *  primitive, under the key that owns the BOX's logs. Best-effort: the password has
 *  already changed, so a logging failure must never undo (or fabricate) it. */
const logPasswd = async (
  deps: PasswdChangeDeps,
  box: StoodOnBox,
  targetUser: string,
): Promise<void> => {
  const stamp = deps.now();
  const line = formatPasswdLine({
    user: targetUser,
    hostname: box.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  try {
    await appendMachineLog(
      { appendLog: deps.appendLog },
      {
        writerKey: box.logWriterKey,
        machineId: box.machineId,
        path: AUTH_LOG_PATH,
        owner: AUTH_LOG_OWNER,
        permissions: AUTH_LOG_PERMISSIONS,
      },
      line,
    );
  } catch {
    // best-effort: the change stands regardless of a logging failure.
  }
};

export const handlePasswdChange = async (
  body: unknown,
  deps: PasswdChangeDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, passwdChangeSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const standing = await deps.findActiveSession({
    player_key: publicKey,
    machine_id: payload.machine_id,
  });
  if (standing.error) {
    return { status: 500, body: { error: 'session_lookup_failed' } };
  }
  // `passwd` on a foreign box is typed into a shell. A caller with none on this machine is
  // not on it, and nothing about the box is read or written for them.
  const shell = standing.data;
  if (shell === null) {
    return { status: 403, body: { error: 'no_session' } };
  }
  // L2: only root may write the root-owned `/etc/passwd` on a box that isn't yours. A
  // non-root shell is refused before the box is read.
  if (shell.userType !== 'root') {
    return { status: 403, body: { error: 'not_authorized' } };
  }

  const resolved = await resolveStoodOnBox(
    deps.findOccupantWorkstationByMachineId,
    payload.machine_id,
    shell.essid,
  );
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const box = resolved.box;

  // The box as it stands, not as it was generated: a rewrite that composed against the
  // generated tree would revert any prior write to `/etc/passwd` (another occupant's, or
  // the systemctl-hole row append) rather than build on it.
  const journal = await deps.findPatches({ machine_id: box.machineId });
  if (journal.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const fs = materializeMachineFs(box.baseFs, journal.data);
  const account = accountIn(fs, payload.username);
  if (account === null) {
    return { status: 404, body: { error: 'user_not_found' } };
  }

  // Preserve the file's owner and perms off the node the box actually holds, so a rewrite
  // can never quietly widen who may read the account hashes.
  const passwdNode = createFsView(fs, { userType: 'root' }).stat(PASSWD_PATH);
  const { error } = await deps.upsertPatch({
    writer_key: publicKey,
    machine_id: box.machineId,
    path: PASSWD_PATH,
    content: withAccountHash(fs, payload.username, payload.new_hash),
    owner: passwdNode?.kind === 'file' ? passwdNode.owner : PASSWD_OWNER,
    ...(passwdNode?.kind === 'file' ? { permissions: passwdNode.perms } : {}),
    node_type: 'file',
  });
  if (error) {
    return { status: 500, body: { error: 'upsert_failed' } };
  }

  // The change has landed; the trace is best-effort and never gates the result.
  await logPasswd(deps, box, payload.username);

  return { status: 200, body: { ok: true } };
};
