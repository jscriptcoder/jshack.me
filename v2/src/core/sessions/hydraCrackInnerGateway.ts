/**
 * handleHydraCrackInnerGateway — hydra pointed THROUGH a NAT forward on an inner
 * gateway. The deep layer's only credential door.
 *
 * Every deep host runs sshd and carries a guest account drawn from the crackable pool,
 * so the layer is furnished to be entered by a wordlist. But its addresses are absent
 * from the generated LAN, so no shell can name one, and rooting the gateway yields the
 * forward table rather than any password. Without this seam the layer is furnished and
 * sealed: a player can see a deep box in a scan and have no way in.
 *
 * Resolution is `resolveInnerGatewayTarget` — the same walk `ssh` authenticates through
 * — so a password reported here is one `ssh` then accepts, by construction rather than
 * by two chain walks staying in step. It also boot-gates every hop, so a bricked
 * intermediate darkens everything below it before any sweep runs.
 *
 * The trace's address is decided by the ROUTE, not by where the attacker stands: NAT
 * means a deep box only ever sees the fronting gateway's `.1`, whoever is behind it.
 * That is the one place this departs from the public sweep, which derives the attacker's
 * own vantage — there, the target really does see the attacker's public address.
 *
 * The writer key is the caller's, matching `ssh`'s deep write. On an ESSID-shared box
 * that is a known defect rather than a decision — two occupants write two rows and the
 * later fold hides the earlier — but hydra and `ssh` disagreeing about one box is the
 * worse failure, so both move together when it is fixed. See the backlog entry in
 * `docs/conventions-and-gotchas.md` §9.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from '../patches/authorizeMachineAccess';
import { resolveInnerGatewayTarget } from '../network/resolveInnerGatewayTarget';
import { readOpenPorts } from '../services/pidfile';
import { serviceByName } from '../services/serviceCatalog';
import { sweepAccounts, wordlistOn } from '../wordlist/passwordSweep';
import { WORDLIST_PATH } from '../wordlist/defaultWordlist';
import type { OwnerPatchRow } from '../network/materializeMachineFs';
import {
  appendMachineLog,
  type MachineLogReadQuery,
  type MachineLogReadResult,
} from '../patches/appendMachineLog';
import type { ListPathPatchesResult, PatchRow } from '../patches/upsertPatch';
import type { HandlerResponse } from './hydraCrack';
import type { NonceStore } from '../signedRequest/nonceStore';

export type HydraCrackInnerGatewayDeps = {
  readonly nonceStore: NonceStore;
  readonly findActiveSession: FindActiveSession;
  readonly now: () => number;
  readonly findPatches: (query: {
    readonly machine_id: string;
  }) => Promise<{ readonly data: readonly OwnerPatchRow[] | null; readonly error: unknown }>;
  readonly listPathPatches: (query: {
    readonly machine_id: string;
    readonly path: string;
  }) => Promise<ListPathPatchesResult>;
  readonly readAuthLog: (query: MachineLogReadQuery) => Promise<MachineLogReadResult>;
  readonly upsertPatch: (row: PatchRow) => Promise<{ readonly error: unknown }>;
};

const hydraCrackInnerGatewaySchema = z
  .looseObject({
    action: z.literal('hydraCrackInnerGateway'),
    essid: z.string().min(1),
    target: z.string().min(1),
    service: z.string().min(1),
    port: z.number().int().positive(),
    username: z.string().min(1).optional(),
    caller_machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleHydraCrackInnerGateway = async (
  body: unknown,
  deps: HydraCrackInnerGatewayDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, hydraCrackInnerGatewaySchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const access = await authorizeMachineAccess(
    publicKey,
    payload.caller_machine_id,
    deps.findActiveSession,
  );
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }

  // The same walk `ssh` authenticates through, so a password reported here is one `ssh`
  // then accepts. It also decides that the target is a genuine inner gateway and that
  // nothing on the chain is bricked — a dark entrance is refused before any sweep.
  const resolved = await resolveInnerGatewayTarget(deps, {
    essid: payload.essid,
    target: payload.target,
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

  // The pidfiles are the truth about what is listening: a stopped daemon leaves nothing
  // to attack, exactly as it leaves nothing to connect to. It must be the daemon on the
  // port this request REACHED — a forward to nginx is not a door to sshd.
  const open = readOpenPorts(target.fs).find(
    (port) => port.port === target.reachedPort && port.service === spec.service,
  );
  if (open === undefined) {
    return { status: 404, body: { error: 'service_not_running' } };
  }


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

  // A missing file is a real state, not an error: the wordlist is an ordinary file and
  // root can remove it. Say so, rather than reporting an empty sweep that looks like a
  // hardened target.
  const content = wordlistOn(wordlist.data);
  if (content === null) {
    return { status: 200, body: { port: payload.port, cracked: [], wordlistFound: false } };
  }

  // The address the target saw is the fronting gateway's `.1` — NAT is all a deep box is
  // ever shown, whoever is behind it. A reach that landed on the inner gateway ITSELF is
  // a Layer-1 box (`sourceIp` null): the address it saw is the caller's own LAN address,
  // which this seam is never told and must not invent, so that sweep goes unrecorded —
  // the same silence `ssh` keeps there, and the own-LAN sweep is what traces that target.
  const { cracked, trace } = sweepAccounts({
    accounts: spec.accountsOn(target.fs),
    database: spec.databaseOn?.(target.fs),
    secret,
    username: payload.username,
    wordlist: content,
    hostname: target.hostname,
    fromIp: target.sourceIp ?? '',
    stamp: deps.now(),
    formatAttempt: spec.sweepLog.formatAttempt,
  });

  if (trace.length > 0 && target.sourceIp !== null) {
    try {
      await appendMachineLog(
        { readLog: deps.readAuthLog, upsertPatch: deps.upsertPatch },
        {
          writerKey: publicKey,
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

  return { status: 200, body: { port: payload.port, cracked, wordlistFound: true } };
};
