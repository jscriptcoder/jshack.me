/**
 * handleRebootMachine — the pure rebootMachine endpoint logic (no Vercel, no
 * Supabase). A box going down ends the sessions standing on it, in ONE act named
 * by the MACHINE rather than by a session id.
 *
 * That is the whole difference from `endSession`, and it is what makes the act
 * authoritative: a player can hold several sessions on one box (an ssh hop plus an
 * su elevation, or a second shell opened in another terminal), and only some of
 * them are on the hop chain the rebooting screen can see. Naming the machine
 * reaches all of them; naming session ids reaches whichever ones a client
 * remembered to name.
 *
 * It ends EVERY active row on that machine — every player, every kind. The box
 * stopped existing for a moment, and that one sentence answers every session at
 * once without a table of exceptions to maintain. The implicit base login is
 * untouched because it was never a row, so a player's own box stays reachable.
 *
 * Which means scoping can no longer be the authorization, and the authority is now
 * asked as its own question, SERVER-derived from the verified pubkey: the caller
 * owns the box (the suffix match `authorizeMachineAccess` already gates the patch
 * endpoints with), or holds a live session on it at root. Never a client claim, and
 * never widened into `endSession`, which stays scoped to its own caller.
 *
 * The owner arm is deliberately unconditional — an owner's base login is not a row,
 * so there is no tier for the server to read, and the in-game gate is real anyway
 * (`/bin/reboot` is `execute:['root']`). What it costs is that a tampered client
 * could throw intruders off its OWN box without in-game root, which is the
 * defender's own move. The gateway arm needs no branch: nobody owns an access
 * point, so only the root-session arm can ever carry it.
 *
 * Why the row closed is the server's word: the reason is stamped by the shared
 * sequence (`rebootSequence.ts`), not read off the wire, so a caller cannot ask for its
 * rows to be recorded as anything other than rebooted. That sequence also keeps the
 * box's `kern.log` note of who took it down — the defender's whole answer to the
 * question the eviction raises and cannot itself settle: you came back, your box is
 * up, your intruder is gone, and this is who it was.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import {
  authorizeMachineAccess,
  type FindActiveSession,
  type StandingSession,
} from '../patches/authorizeMachineAccess.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { rebootBox, type RebootSequenceDeps } from './rebootSequence.js';

export type RebootMachineDeps = RebootSequenceDeps & {
  readonly nonceStore: NonceStore;
  /** The caller's own live row on the target, whose tier is the authority when the
   *  box is not theirs. The same query the patch endpoints ask, so one shell's writes
   *  and its reboot agree about where the player is standing. */
  readonly findActiveSession: FindActiveSession<StandingSession>;
};

export type HandlerResponse = {
  readonly status: number;
  readonly body: Record<string, unknown>;
};

const rebootMachineSchema = z
  .looseObject({
    action: z.literal('rebootMachine'),
    machine_id: z.string().min(1),
  })
  .refine((payload) => !('player_key' in payload));

export const handleRebootMachine = async (
  body: unknown,
  deps: RebootMachineDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, rebootMachineSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }

  const { publicKey, payload } = verified;

  // Before anything moves. A machine id travels — it is on every session row and in
  // every hop the client makes — so an unauthorized reboot that reached the rows or
  // left a marker would evict the box's occupants just as effectively as one that
  // was allowed.
  const access = await authorizeMachineAccess(publicKey, payload.machine_id, deps.findActiveSession);
  if (!access.ok) {
    return { status: access.status, body: { error: access.error } };
  }
  // `null` is the owner bypass. Otherwise the tier comes off the caller's own row on
  // the target: standing on a box is not authority over it.
  if (access.session !== null && access.session.userType !== 'root') {
    return { status: 403, body: { error: 'not_root' } };
  }

  const rebooted = await rebootBox(deps, {
    machineId: payload.machine_id,
    actorKey: publicKey,
    standing: access.session,
  });
  if (!rebooted.ok) {
    return { status: 500, body: { error: 'update_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
