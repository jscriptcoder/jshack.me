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
 * Why the row closed is the server's word: the reason is stamped here, not read
 * off the wire, so a caller cannot ask for its rows to be recorded as anything
 * other than rebooted.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import { authorizeMachineAccess, type FindActiveSession } from '../patches/authorizeMachineAccess';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { EndReason } from './endSession';

/** No `player_key`: the update is scoped to the MACHINE and nothing else, which is
 *  what lets one reboot reach a row the caller has never seen. */
export type EndMachineSessionsParams = {
  readonly machine_id: string;
  readonly reason: EndReason;
};

export type WriteBootIdParams = {
  readonly machine_id: string;
  readonly player_key: string;
  readonly boot_id: string;
};

export type RebootMachineDeps = {
  readonly nonceStore: NonceStore;
  /** The caller's own live row on the target, whose tier is the authority when the
   *  box is not theirs. Shared with the patch endpoints so one shell's writes and
   *  its reboot agree about where the player is standing. */
  readonly findActiveSession: FindActiveSession;
  readonly endMachineSessions: (
    params: EndMachineSessionsParams,
  ) => Promise<{ readonly error: unknown }>;
  /** Land the new boot id on the machine's own tree. Separate from the row close
   *  because they answer different readers: the rows are what the server enforces,
   *  the marker is what a terminal already standing on the box can see. */
  readonly writeBootId: (params: WriteBootIdParams) => Promise<{ readonly error: unknown }>;
  /** A fresh, unguessable id for this boot. Injected so tests can name it — and
   *  unguessable in production for the same reason the reason is server-stamped: a
   *  caller able to predict the next id could keep a session alive across the
   *  reboot that was meant to end it. */
  readonly newBootId: () => string;
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

  const { error } = await deps.endMachineSessions({
    machine_id: payload.machine_id,
    reason: 'rebooted',
  });
  // Loud, unlike every other session write. A swallowed failure elsewhere costs a
  // log line; swallowed here it hands the player a convincing reboot animation and
  // leaves whoever was on the box still on it.
  if (error) {
    return { status: 500, body: { error: 'update_failed' } };
  }

  // Only now, and only if they closed. The rows are the authority and the marker is
  // how a terminal finds out — so a marker landing over rows that stayed open would
  // throw players off a box that is still holding their write grant, which is the
  // one arrangement worse than telling nobody.
  const marker = await deps.writeBootId({
    machine_id: payload.machine_id,
    player_key: publicKey,
    boot_id: deps.newBootId(),
  });
  // Equally loud, because rows closed with nobody told is exactly the outcome the
  // command exists to prevent: a defender walks away believing they are clear while
  // an intruder keeps typing into a shell that no longer has a row behind it.
  if (marker.error) {
    return { status: 500, body: { error: 'update_failed' } };
  }

  return { status: 200, body: { ok: true } };
};
