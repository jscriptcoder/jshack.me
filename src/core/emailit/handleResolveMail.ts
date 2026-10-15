/**
 * handleResolveMail — the server side of `mail`: an inbox opened to whoever holds its
 * password.
 *
 * Mail is served by emailit.io's web server, so it is reached the way a fetch of
 * emailit.io is reached (`resolveWebTarget`): a bricked emailit.io, a dark gateway or a
 * stopped web server takes mail down exactly as it takes sign-up down. The request names
 * no box: mail lives at emailit.io and nowhere else.
 *
 * The server keeps no mail session. Every request carries a handle and a password, and
 * the store checks the password each time, so whoever changes it cuts off every holder of
 * the old one at once. The store is handed the md5 of the password, never the password,
 * and it answers a wrong password and a handle nobody holds the same way: a login that
 * failed says nothing about which half was wrong.
 *
 * Mail leaves no line in emailit.io's `access.log`. It is not a page fetch, and a check
 * for new mail every minute would bury the log.
 */

import { z } from 'zod';
import { verifySignedRequest } from '../signedRequest/verify.js';
import { STATUS_BY_VERIFY_REASON } from '../signedRequest/httpStatus.js';
import {
  resolveWebTarget,
  type HandlerResponse,
  type WebTargetDeps,
} from '../network/resolveHttpFetch.js';
import { HTTP_DEFAULT_PORT } from '../network/http.js';
import { siteAddress } from '../generation/publisher.js';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import { md5 } from '../generation/md5.js';
import type { NonceStore } from '../signedRequest/nonceStore.js';
import { listedMessageSchema, openedMessageSchema } from './inbox.js';

/** Whose inbox is asked for, and by which player: the handle, the md5 of the password
 *  given for it, and the key that signed the request. */
export type InboxLogin = {
  readonly handle: string;
  readonly passwordMd5: string;
  readonly playerKey: string;
};

/** Open an inbox, or say the login failed: the store's reply as it came off the wire,
 *  read here. */
export type OpenInbox = (
  login: InboxLogin,
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** Open one message by its number and mark it read, or say the login failed or the
 *  inbox holds no such message: the store's reply as it came off the wire, read here. */
export type OpenMessage = (
  request: InboxLogin & { readonly number: number },
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

export type ResolveMailDeps = WebTargetDeps & {
  readonly nonceStore: NonceStore;
  readonly openInbox: OpenInbox;
  readonly openMessage: OpenMessage;
};

const inboxAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('opened'), messages: z.array(listedMessageSchema) }),
  z.object({ outcome: z.literal('login_failed') }),
]);

const messageAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('opened'), message: openedMessageSchema }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('no_message') }),
]);

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey).
const resolveMailSchema = z
  .looseObject({
    action: z.literal('resolveMail'),
    handle: z.string().min(1),
    password: z.string(),
    /** One message to open, by its number. Absent, the request is for the list. */
    number: z.number().int().positive().optional(),
  })
  .refine((payload) => !('player_key' in payload));

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';

const MAIL_FAILED: HandlerResponse = { status: 500, body: { error: 'mail_failed' } };
const LOGIN_FAILED: HandlerResponse = { status: 401, body: { error: 'login_failed' } };

export const handleResolveMail = async (
  body: unknown,
  deps: ResolveMailDeps,
): Promise<HandlerResponse> => {
  const verified = await verifySignedRequest(body, resolveMailSchema, {
    nonceStore: deps.nonceStore,
  });
  if (!verified.ok) {
    return { status: STATUS_BY_VERIFY_REASON[verified.reason], body: { error: verified.reason } };
  }
  const { publicKey, payload } = verified;

  const emailit = await resolveWebTarget(deps, { target: EMAILIT_IP, port: HTTP_DEFAULT_PORT });
  if ('status' in emailit) return emailit;

  const login = {
    handle: payload.handle,
    passwordMd5: md5(payload.password),
    playerKey: publicKey,
  };
  // A store that failed, or answered in a shape nobody taught it, has not said whether the
  // password was right: telling the player it was wrong would be a guess.
  if (payload.number !== undefined) {
    const reply = await deps.openMessage({ ...login, number: payload.number });
    const answer = messageAnswerSchema.safeParse(reply.data);
    if (reply.error || !answer.success) return MAIL_FAILED;
    if (answer.data.outcome === 'login_failed') return LOGIN_FAILED;
    if (answer.data.outcome === 'no_message') {
      return { status: 404, body: { error: 'no_message' } };
    }
    return { status: 200, body: { ok: true, message: answer.data.message } };
  }

  const reply = await deps.openInbox(login);
  const answer = inboxAnswerSchema.safeParse(reply.data);
  if (reply.error || !answer.success) return MAIL_FAILED;
  if (answer.data.outcome === 'login_failed') return LOGIN_FAILED;
  return { status: 200, body: { ok: true, messages: answer.data.messages } };
};
