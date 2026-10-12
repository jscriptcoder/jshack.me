/**
 * handleAuthElevateSession — `su` on a box that is not the caller's own, answered by
 * the server. The caller already holds a shell there (they logged in, or an exploit
 * landed one) and asks to become another of the box's accounts.
 *
 * Why the server and not the client: a write is authorized at the tier of the caller's
 * ACTIVE session row. A switch made only in the browser leaves no row, so the next write
 * is still judged at the tier beneath it. Only a `kind:'su'` row moves it — and
 * `findActiveSession` returns the latest live row, so the new one outranks the shell it
 * was typed into with nothing else changing.
 *
 * Everything starts from that shell's row, never from the request. No row means the
 * caller is not on the machine, and a password alone opens nothing. The row names the
 * network the shell was opened on, which says which machine this is: that network's own
 * gateway, a machine it generates, or else another player's workstation, found through
 * occupancy. The row also carries the tier that lets root switch unasked, and the account
 * the trace names as the one switching.
 *
 * The password is checked against the box as it is — its generated tree with its journal
 * replayed — so `su` and every login agree about a password somebody changed. An unknown
 * user and a wrong password collapse to one 401. Once the box resolves, the attempt
 * leaves a `su` line in its `auth.log` on both outcomes, under the key that owns that
 * machine's logs (su lines carry no source IP).
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import { buildWorkstationBaseFsFromIdentity } from '../generation/workstationFs.js';
import { networkBaseFsForMachineId } from '../generation/lanHostIdentity.js';
import { hostnameForMachineId } from '../generation/lanTopology.js';
import { apGatewayLogWriterKey } from '../logging/apGatewayLogWriter.js';
import type { Directory } from '../filesystem/types.js';
import { materializeMachineFs, type OwnerPatchRow } from '../network/materializeMachineFs.js';
import { md5 } from '../generation/md5.js';
import { accountIn } from './passwdAccount.js';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
  formatSuAuthLine,
} from '../logging/authLog.js';
import { derivePid } from '../logging/syslog.js';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog.js';
import { asGameTime, type UserType } from '../types.js';
import type { PatchRow } from '../patches/upsertPatch.js';
import type { HandlerResponse } from './authCreateSession.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import type { FindActiveSession, StandingSession } from '../patches/authorizeMachineAccess.js';

/** The occupancy row of another player's workstation: who owns it (the key its logs file
 *  under), the persisted identity its tree is rebuilt from, and the name it answers to.
 *  The network on it is not read here: one player on several access points has a row on
 *  each, and the one the shell is on is the one its own session row names. */
export type OccupantWorkstation = {
  readonly owner_key: string;
  readonly workstation_machine_id: string;
  readonly essid: string;
  readonly workstation_username: string;
  /** The owner's player-chosen workstation hostname — the name the `su` auth.log
   *  trace line carries, mirroring the ssh trace's hostname. */
  readonly workstation_machine_name: string;
  readonly workstation_root_hash: string;
};

/** The `sessions` row an elevation inserts. Mirrors the ssh `AuthSessionRow` but
 *  `kind:'su'` — the credential is server-derived, the player_key server-stamped, and
 *  `essid` carried on from the shell it was typed into. */
export type SuSessionRow = {
  readonly session_id: string;
  readonly player_key: string;
  readonly machine_id: string;
  readonly credentials: { readonly username: string; readonly userType: UserType };
  readonly parent_session_id: string | null;
  readonly source_ip: string | null;
  readonly kind: 'su';
  readonly essid: string;
};

export type AuthElevateSessionDeps = {
  readonly nonceStore: NonceStore;
  /** Whose workstation this is, from `home_network_occupants` (PK `(essid, owner_key)`),
   *  which carries the identity fields the reconstructed passwd is derived from. Asked
   *  only for a machine the shell's network does not make. Occupancy means "this machine
   *  is on that WiFi", so a `su` on a box whose owner has taken it off the network
   *  resolves to nothing and collapses to a 404 rather than elevating on a machine nobody
   *  can reach. */
  readonly findOccupantWorkstationByMachineId: (
    machineId: string,
  ) => Promise<{ readonly data: OccupantWorkstation | null; readonly error: unknown }>;
  /** The caller's live shell on the box — the one `su` is typed into. Its absence is the
   *  refusal; its network locates the box, its tier decides whether a password is asked
   *  for, its account is who the trace names, and its login address is carried on. */
  readonly findActiveSession: FindActiveSession<StandingSession>;
  /** The machine's whole journal, every writer's rows, replayed over the generated tree
   *  so the password checked is the one the box holds now. */
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly insertSession: (row: SuSessionRow) => Promise<{ readonly error: unknown }>;
  /** The server's wall clock, epoch-ms (UTC) — stamps the auth.log trace line. */
  readonly now: () => number;
  /** Read the current content of the box's auth.log on the shared journal, keyed
   *  `(machine_id, path, writer_key)` — the read half of the append. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the appended su auth.log line on the box). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

// Loose so the envelope fields pass through; the refine rejects a client-supplied
// player_key OR userType (the server stamps the player_key from the verified pubkey
// and DERIVES the userType from the box's passwd — neither is a client claim). Nor is
// the account doing the switching: that is read off the caller's session row.
const authElevateSessionSchema = z
  .looseObject({
    action: z.literal('suElevate'),
    session_id: z.string().min(1),
    machine_id: z.string().min(1),
    username: z.string().min(1),
    password: z.string(),
    parent_session_id: z.string().min(1).nullable().optional(),
    // Accepted but never read: the row's address is the one the server derives.
    source_ip: z.string().min(1).nullable().optional(),
  })
  .refine((payload) => !('player_key' in payload) && !('userType' in payload));

/** Stamp the elevation attempt onto the box's `/var/log/auth.log` via the shared
 *  system-log primitive — on BOTH outcomes (su records successful AND failed switches).
 *  The keystone: `writerKey` is the key that owns the BOX's logs, never the caller's —
 *  the system owns its logs, so every visitor's line accretes into ONE row instead of
 *  colliding under the last-write-wins fold; who it was lives in the line's `by <from>`
 *  user (su lines carry no source IP). Best-effort: a logging failure must never break
 *  (or fabricate) the elevation. */
const logSu = async (
  deps: AuthElevateSessionDeps,
  box: StoodOnBox,
  attempt: {
    readonly outcome: 'success' | 'failure';
    readonly targetUser: string;
    readonly fromUser: string;
  },
): Promise<void> => {
  const stamp = deps.now();
  const line = formatSuAuthLine({
    outcome: attempt.outcome,
    targetUser: attempt.targetUser,
    fromUser: attempt.fromUser,
    hostname: box.hostname,
    time: asGameTime(stamp),
    pid: derivePid(stamp),
  });
  try {
    await appendMachineLog(
      { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
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
    // best-effort: the elevation result stands regardless of a logging failure.
  }
};

/** The box `su` is typed on: its tree as generated, the name it answers to, and the
 *  journal row its own log lines accrete under. */
type StoodOnBox = {
  readonly machineId: string;
  readonly baseFs: Directory;
  readonly hostname: string;
  readonly logWriterKey: string;
};

type StoodOnBoxResult =
  | { readonly ok: true; readonly box: StoodOnBox }
  | { readonly ok: false; readonly status: number; readonly error: string };

const resolveStoodOnBox = async (
  deps: AuthElevateSessionDeps,
  machineId: string,
  essid: string,
): Promise<StoodOnBoxResult> => {
  // A machine the shell's own network makes belongs to nobody, so every caller's line on
  // it files under the network's key, where one would otherwise erase another.
  const networkFs = networkBaseFsForMachineId(essid, machineId);
  if (networkFs !== null) {
    return {
      ok: true,
      box: {
        machineId,
        baseFs: networkFs,
        // A deep machine has no name the topology knows, and its id leads with one.
        hostname: hostnameForMachineId(essid, machineId) ?? machineId,
        logWriterKey: apGatewayLogWriterKey(essid),
      },
    };
  }

  // Otherwise it is another player's workstation. Occupancy is both its identity and its
  // reachability: a machine on no WiFi is not there to elevate on.
  const occupant = await deps.findOccupantWorkstationByMachineId(machineId);
  if (occupant.error) {
    return { ok: false, status: 500, error: 'occupant_lookup_failed' };
  }
  if (occupant.data === null) {
    return { ok: false, status: 404, error: 'host_unreachable' };
  }
  return {
    ok: true,
    box: {
      machineId,
      baseFs: buildWorkstationBaseFsFromIdentity({
        ownerKeyHex: occupant.data.owner_key,
        username: occupant.data.workstation_username,
        rootPasswordHash: occupant.data.workstation_root_hash,
      }),
      hostname: occupant.data.workstation_machine_name,
      logWriterKey: occupant.data.owner_key,
    },
  };
};

export const handleAuthElevateSession = async (
  body: unknown,
  deps: AuthElevateSessionDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, authElevateSessionSchema, {
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
  // `su` is typed into a shell. A caller with none on this machine is not on it, and a
  // password is no way in: it would open a box whose every door is shut.
  const shell = standing.data;
  if (shell === null) {
    return { status: 403, body: { error: 'no_session' } };
  }

  const resolved = await resolveStoodOnBox(deps, payload.machine_id, shell.essid);
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const box = resolved.box;

  // The box as it is, not as it was generated: a password somebody changed since is the
  // password, and the one every login to this box is already checked against.
  const journal = await deps.findPatches({ machine_id: box.machineId });
  if (journal.error) {
    return { status: 500, body: { error: 'patches_lookup_failed' } };
  }
  const fs = materializeMachineFs(box.baseFs, journal.data);
  const account = accountIn(fs, payload.username);
  // Root becomes anyone the box has without being asked. Everyone else gives the
  // account's password, which an account with none can never be given: md5 of anything
  // is never '', so the owner's own passwordless user is out of reach from below.
  const passwordOk =
    account !== null && (shell.userType === 'root' || md5(payload.password) === account.hash);

  // The box is resolved, so the attempt CAN be logged — su records both successful and
  // failed elevations. (The refusals above log nothing: there is no reachable box to log
  // on, or nobody on it.)
  await logSu(deps, box, {
    outcome: passwordOk ? 'success' : 'failure',
    targetUser: payload.username,
    // Off the row, so the line names the account the shell really is.
    fromUser: shell.username,
  });

  if (account === null || !passwordOk) {
    return { status: 401, body: { error: 'invalid_credentials' } };
  }

  // `su` crosses no wire, so the elevated shell came from wherever the login under it
  // came from: carry that login's address on, so a reboot from the root shell names the
  // visitor the box's auth.log already does.
  const { error: insertError } = await deps.insertSession({
    session_id: payload.session_id,
    player_key: publicKey,
    machine_id: box.machineId,
    credentials: { username: payload.username, userType: account.userType },
    parent_session_id: payload.parent_session_id ?? null,
    source_ip: shell.sourceIp,
    kind: 'su',
    essid: shell.essid,
  });
  if (insertError) {
    return { status: 500, body: { error: 'insert_failed' } };
  }

  return { status: 200, body: { ok: true, userType: account.userType } };
};
