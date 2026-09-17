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
 * Ownership is enforced the same way `endSession` enforces it — by SCOPING the
 * update to the verified `player_key`, stamped from the envelope and never a
 * client claim. So today this ends the CALLER's rows on that machine and nobody
 * else's. Reaching a stranger's row is the point of the feature and needs a
 * server-derived authority (owning the box, or holding root on it) that this
 * handler does not have yet; until it does, the narrow scope is the authorization.
 *
 * Why the row closed is the server's word: the reason is stamped here, not read
 * off the wire, so a caller cannot ask for its rows to be recorded as anything
 * other than rebooted.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus';
import type { NonceStore } from '../signedRequest/nonceStore';
import type { EndReason } from './endSession';

export type EndMachineSessionsParams = {
  readonly machine_id: string;
  readonly player_key: string;
  readonly reason: EndReason;
};

export type WriteBootIdParams = {
  readonly machine_id: string;
  readonly player_key: string;
  readonly boot_id: string;
};

export type RebootMachineDeps = {
  readonly nonceStore: NonceStore;
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
  const { error } = await deps.endMachineSessions({
    machine_id: payload.machine_id,
    player_key: publicKey,
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
