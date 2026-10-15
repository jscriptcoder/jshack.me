/**
 * handleResolveMail — the server side of `mail`: an inbox opened to whoever holds its
 * password, and mail sent from it.
 *
 * The request names what it wants in `op`: the `list`, one message to `read`, a message
 * to `send`, or one to `delete`. A send names the recipient by handle (mail goes between emailit.io
 * addresses only), and its subject and body are held to 80 and 4,000 characters here, as
 * a reader counts them, whatever the client checked first.
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
 * Wrong passwords are held back per guesser: the store counts each player's failures by
 * the key that signed the request, and refuses every check from a player with 5 in the
 * last minute (`throttled`). No account is ever locked, so nobody can lock anybody out
 * of their mail by guessing at it.
 *
 * Sends are held back per sender the same way: 20 in the last hour by one player's key,
 * from whichever addresses, and the next is refused (`send_limited`) until the oldest is
 * an hour old. A bounce counts, so probing handles by mailing them is held to 20 an hour
 * too; a failed login is no send and counts nothing.
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

/** Open one message by its number, marking it read when `mark` says to, or say the login
 *  failed or the inbox holds no such message: the store's reply as it came off the wire,
 *  read here. */
export type OpenMessage = (
  request: InboxLogin & { readonly number: number; readonly mark: boolean },
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** Deliver a message into the recipient's inbox, or say why not: the store's reply as it
 *  came off the wire, read here. `to` is the recipient's handle. */
export type SendMessage = (
  request: InboxLogin & {
    readonly to: string;
    readonly subject: string;
    readonly body: string;
  },
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

/** Delete one message by its number, or say the login failed or the inbox holds no such
 *  message: the store's reply as it came off the wire, read here. */
export type DeleteMessage = (
  request: InboxLogin & { readonly number: number },
) => Promise<{ readonly data: unknown; readonly error: unknown }>;

export type ResolveMailDeps = WebTargetDeps & {
  readonly nonceStore: NonceStore;
  readonly openInbox: OpenInbox;
  readonly openMessage: OpenMessage;
  readonly sendMessage: SendMessage;
  readonly deleteMessage: DeleteMessage;
};

const inboxAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('opened'), messages: z.array(listedMessageSchema) }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
]);

const messageAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('opened'), message: openedMessageSchema }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
  z.object({ outcome: z.literal('no_message') }),
]);

const sendAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('sent') }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
  z.object({ outcome: z.literal('no_mailbox') }),
  z.object({ outcome: z.literal('mailbox_full') }),
  z.object({ outcome: z.literal('send_limited') }),
]);

const deleteAnswerSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('deleted') }),
  z.object({ outcome: z.literal('login_failed') }),
  z.object({ outcome: z.literal('throttled') }),
  z.object({ outcome: z.literal('no_message') }),
]);

/** A string of at most `limit` characters as a reader counts them: an emoji is one,
 *  where JavaScript's `length` would count two. The store counts the same way. */
const textOfAtMost = (limit: number) => z.string().refine((text) => [...text].length <= limit);

const SUBJECT_LIMIT = 80;
const BODY_LIMIT = 4000;

const login = {
  action: z.literal('resolveMail'),
  handle: z.string().min(1),
  password: z.string(),
};

// Loose so the envelope fields pass through; the refine keeps the codebase-wide posture
// that a client never claims identity (the caller is the verified pubkey).
const resolveMailSchema = z
  .discriminatedUnion('op', [
    z.looseObject({ ...login, op: z.literal('list') }),
    z.looseObject({
      ...login,
      op: z.literal('read'),
      number: z.number().int().positive(),
      /** Whether the message is marked read: `read` marks it, a reply quoting it does not. */
      mark: z.boolean(),
    }),
    z.looseObject({
      ...login,
      op: z.literal('send'),
      to: z.string().min(1),
      subject: textOfAtMost(SUBJECT_LIMIT),
      body: textOfAtMost(BODY_LIMIT),
    }),
    z.looseObject({ ...login, op: z.literal('delete'), number: z.number().int().positive() }),
  ])
  .refine((payload) => !('player_key' in payload));

const EMAILIT_IP = siteAddress(EMAILIT_DOMAIN) ?? '';

const MAIL_FAILED: HandlerResponse = { status: 500, body: { error: 'mail_failed' } };

/** Every word the store refuses with, and the status the player's client is told it with.
 *  The word itself goes on as the error. */
const STATUS_BY_REFUSAL = {
  login_failed: 401,
  throttled: 429,
  no_message: 404,
  no_mailbox: 404,
  mailbox_full: 409,
  send_limited: 429,
} as const;

const refused = (outcome: keyof typeof STATUS_BY_REFUSAL): HandlerResponse => ({
  status: STATUS_BY_REFUSAL[outcome],
  body: { error: outcome },
});

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

  const asked = {
    handle: payload.handle,
    passwordMd5: md5(payload.password),
    playerKey: publicKey,
  };
  // A store that failed, or answered in a shape nobody taught it, has not said whether the
  // password was right: telling the player it was wrong would be a guess.
  if (payload.op === 'send') {
    const reply = await deps.sendMessage({
      ...asked,
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
    });
    const answer = sendAnswerSchema.safeParse(reply.data);
    if (reply.error || !answer.success) return MAIL_FAILED;
    if (answer.data.outcome !== 'sent') return refused(answer.data.outcome);
    return { status: 200, body: { ok: true } };
  }

  if (payload.op === 'delete') {
    const reply = await deps.deleteMessage({ ...asked, number: payload.number });
    const answer = deleteAnswerSchema.safeParse(reply.data);
    if (reply.error || !answer.success) return MAIL_FAILED;
    if (answer.data.outcome !== 'deleted') return refused(answer.data.outcome);
    return { status: 200, body: { ok: true } };
  }

  if (payload.op === 'read') {
    const reply = await deps.openMessage({ ...asked, number: payload.number, mark: payload.mark });
    const answer = messageAnswerSchema.safeParse(reply.data);
    if (reply.error || !answer.success) return MAIL_FAILED;
    if (answer.data.outcome !== 'opened') return refused(answer.data.outcome);
    return { status: 200, body: { ok: true, message: answer.data.message } };
  }

  const reply = await deps.openInbox(asked);
  const answer = inboxAnswerSchema.safeParse(reply.data);
  if (reply.error || !answer.success) return MAIL_FAILED;
  if (answer.data.outcome !== 'opened') return refused(answer.data.outcome);
  return { status: 200, body: { ok: true, messages: answer.data.messages } };
};
