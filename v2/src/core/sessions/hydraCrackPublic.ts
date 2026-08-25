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
 * Which address that is comes from the box the caller is STANDING on, not the one
 * they own. A session row carries the network its box was generated from, stamped
 * server-side when the hop was made, so a sweep launched from somebody else's box is
 * traced to their network — the pivot, and the only honest answer, since their box is
 * what the target actually saw. No session means the caller's own workstation, whose
 * network is found from their verified key.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from '../patches/authorizeMachineAccess';
import {
  resolvePublicTarget,
  type ResolvePublicTargetDeps,
} from '../network/resolvePublicTarget';
import {
  resolveVantageSourceIp,
  type FindHomeNetworkByOwnerKey,
  type FindPublicIpByEssid,
} from '../logging/crossPlayerSourceIp';
import { readOpenPorts } from '../services/pidfile';
import { serviceByName } from '../services/serviceCatalog';
import { sweepAccounts, wordlistOn } from '../wordlist/passwordSweep';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist';
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
   *  truthful origin of anything launched from their own workstation. */
  readonly findHomeNetworkByOwnerKey: FindHomeNetworkByOwnerKey;
  /** Resolve one network's public IP from its ESSID — the origin of anything launched
   *  from a box the caller is standing on but does not own. */
  readonly findPublicIpByEssid: FindPublicIpByEssid;
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
    // The destination port behind the public IP — the ADDRESS, since a public IP names
    // an access point rather than a machine. Absent means the gateway's own sshd.
    port: z.number().int().positive().optional(),
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

  const resolved = await resolvePublicTarget(deps, {
    publicIp: payload.target,
    port: payload.port,
  });
  if (!resolved.ok) {
    return { status: resolved.status, body: { error: resolved.error } };
  }
  const target = resolved.target;

  // A service the world has no row for is answered exactly like one that is not
  // running, and resolving the row is what gives the trace below a log to land in.
  const spec = serviceByName(payload.service);
  if (spec === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }

  // The pidfiles are the truth about what is listening: a stopped daemon leaves
  // nothing to attack, exactly as it leaves nothing to connect to. It must be the
  // daemon on the port this request REACHED — a forward to nginx is not a door to
  // sshd, and `ssh` on that port would meet the web server too.
  const open = readOpenPorts(target.fs).find(
    (port) => port.port === target.reachedPort && port.service === spec.service,
  );
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }
  // The port a result names is the door the player knocked on, never the far side of
  // the forward: on this address the occupant's own :22 belongs to the GATEWAY.
  const knockedPort = payload.port ?? open.port;


  // A door whose secret belongs to the SERVICE has one lock or none at all. None is not
  // an empty sweep: reporting nothing found would tell the player the store held, when
  // in fact it was never shut.
  const secret = spec.secretOn?.(target.fs);
  if (spec.secretOn !== undefined && secret === undefined) {
    return { status: 404, body: { error: 'no_password_set' } };
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
    return { status: 200, body: { port: knockedPort, cracked: [], wordlistFound: false } };
  }

  const { cracked, trace } = sweepAccounts({
    accounts: spec.accountsOn(target.fs),
    database: spec.databaseOn?.(target.fs),
    secret,
    username: payload.username,
    wordlist: content,
    hostname: target.hostname,
    fromIp: await resolveVantageSourceIp(deps, {
      actorKey: publicKey,
      standingEssid: access.session === null ? null : access.session.essid,
    }),
    stamp: deps.now(),
    formatAttempt: spec.sweepLog.formatAttempt,
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
          path: spec.sweepLog.path,
          owner: spec.sweepLog.owner,
          permissions: spec.sweepLog.permissions,
        },
        trace.join('\n'),
      );
    } catch {
      // best-effort: the sweep's result stands regardless of a logging failure.
    }
  }

  return { status: 200, body: { port: knockedPort, cracked, wordlistFound: true } };
};
