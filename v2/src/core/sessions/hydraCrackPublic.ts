/**
 * handleHydraCrackPublic — hydra pointed at an address outside the player's own
 * generated world. The first credential the layer lets anyone earn against a box
 * that belongs to somebody else.
 *
 * A public IP names an ACCESS POINT, so the port decides what is attacked, and the
 * default is the gateway's own sshd: a bare `hydra <public ip>` sweeps the shared AP
 * GATEWAY, root-only and seeded from the ESSID. That resolution is `resolvePublicTarget`
 * — the same one `ssh` authenticates through — so a password reported here is one
 * `ssh` then accepts, by construction rather than by two rules staying in step.
 *
 * Two things separate this from the own-LAN sweep, and both are about the trace:
 *
 *   - it is written under the TARGET's log-writer key, never the attacker's. The
 *     system owns its logs, so every attacker's lines accrete into ONE row instead
 *     of colliding under the last-write-wins fold.
 *   - the source IP is SERVER-derived from the verified owner key. On your own LAN
 *     hydra matches `ssh` and trusts the client's address, because the occupant
 *     there is an NPC and there is nobody to frame. Across the network there is,
 *     and a log line is the defender's only evidence.
 *
 * Which is also why the box the caller stands on must be one the server can place
 * on their OWN network. Everything on that network leaves through their home public
 * IP, so the derived address is truthful. Standing anywhere else, it would not be —
 * so it is refused rather than guessed at.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { generateHomeLan } from '../generation/generateHomeLan';
import { machineIdForLanHost } from '../generation/lanHostIdentity';
import { isOwnWorkstation } from '../identity/workstation';
import { authorizeMachineAccess, type FindActiveSession } from '../patches/authorizeMachineAccess';
import {
  resolvePublicTarget,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import {
  resolveCrossPlayerSourceIp,
  type FindHomeNetworkByOwnerKey,
} from '../logging/crossPlayerSourceIp';
import { readOpenPorts } from '../services/pidfile';
import { accountsIn } from './passwdAccount';
import { sweepAccounts, wordlistOn } from '../wordlist/passwordSweep';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist';
import {
  AUTH_LOG_OWNER,
  AUTH_LOG_PATH,
  AUTH_LOG_PERMISSIONS,
} from '../logging/authLog';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch';
import type { HandlerResponse } from './hydraCrack';
import type { NonceStore } from '../signedRequest/nonceStore';

export type HydraCrackPublicDeps = ResolvePublicTargetDeps & {
  readonly nonceStore: NonceStore;
  /** Whether the caller currently holds a session on the machine they say they are
   *  standing on — the L1 rule shared with the patch endpoints. */
  readonly findActiveSession: FindActiveSession;
  /** The server's wall clock, epoch-ms (UTC). One sweep is one attack, so every
   *  line in it carries the same stamp. */
  readonly now: () => number;
  /** Every writer's rows at the wordlist path on the machine the caller is standing
   *  on — the file belongs to the box, not to whoever wrote it last. */
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
  /** Resolve the ATTACKER's own home public IP from their verified owner key — the
   *  truthful origin of anything launched from their network. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** The TARGET's current auth.log content — the read half of the appended trace. */
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  /** Write a patch (here: the whole sweep, appended to the target's auth.log). */
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

// Loose so the envelope fields pass through; the refine rejects a client-supplied
// player_key. `username` optional: absent means sweep every account the box has.
const hydraCrackPublicSchema = z
  .looseObject({
    action: z.literal('hydraCrackPublic'),
    essid: z.string().min(1),
    target: z.string().min(1),
    service: z.string().min(1),
    username: z.string().min(1).optional(),
    caller_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleHydraCrackPublic = async (
  body: unknown,
  deps: HydraCrackPublicDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, hydraCrackPublicSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  // The same L1 rule the patch endpoints use, so a sweep and a write from one shell
  // cannot disagree about where the player is standing.
  const access = await authorizeMachineAccess(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  // Anywhere on the caller's own network leaves by their own public address, so the
  // derived source IP is honest. A box the server cannot place there would need an
  // address it has no way to know — refused, never guessed.
  const onOwnLan = generateHomeLan(payload.essid).hosts.some(
    (candidate) => machineIdForLanHost(candidate, payload.essid) === payload.caller_machine_id,
  );
  if (!onOwnLan && !isOwnWorkstation(payload.caller_machine_id, publicKey)) {
    return { status: 403, body: { error: 'caller_not_on_lan' } };
  }

  const resolved = await resolvePublicTarget(deps, {
    publicIp: payload.target,
    port: undefined,
  });
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const target = resolved.target;

  // The pidfiles are the truth about what is listening: a stopped daemon leaves
  // nothing to attack, exactly as it leaves nothing to connect to.
  const open = readOpenPorts(target.fs).find((port) => port.service === payload.service);
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  const wordlist = await deps.listPathPatches({
    machine_id: payload.caller_machine_id,
    path: WORDLIST_PATH,
  });
  if (wordlist.error) {
    return { status: 500, body: { error: 'wordlist_lookup_failed' } };
  }

  // A missing file is a real state, not an error: the wordlist is an ordinary file
  // and root can remove it. Say so, rather than reporting an empty sweep that looks
  // like a hardened target.
  const content = wordlistOn(wordlist.data);
  if (content === null) {
    return { status: 200, body: { port: open.port, cracked: [], wordlistFound: false } };
  }

  const { cracked, trace } = sweepAccounts({
    accounts: accountsIn(target.fs),
    username: payload.username,
    wordlist: content,
    hostname: target.hostname,
    fromIp: await resolveCrossPlayerSourceIp(deps.findHomeNetworkByOwnerKey, publicKey),
    stamp: deps.now(),
  });

  // Nothing tried, nothing recorded. Nobody to record it under is the same silence:
  // an AP nobody has ever leased an address on keeps no log at all.
  if (trace.length > 0 && target.logWriterKey !== null) {
    try {
      await appendMachineLog(
        { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
        {
          writerKey: target.logWriterKey,
          machineId: target.machineId,
          path: AUTH_LOG_PATH,
          owner: AUTH_LOG_OWNER,
          permissions: AUTH_LOG_PERMISSIONS,
        },
        trace.join('\n'),
      );
    } catch {
      // best-effort: the sweep's result stands regardless of a logging failure.
    }
  }

  return { status: 200, body: { port: open.port, cracked, wordlistFound: true } };
};
