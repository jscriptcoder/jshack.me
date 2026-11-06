/**
 * A mail to a client's handle: the proof of a job, read by the client and answered at once.
 *
 * SERVER ONLY by discipline, as the terms and the key are. emailit.io's mail handler hands
 * a send addressed to a client handle here instead of delivering it: a client has no inbox,
 * so the mail is read as it is sent and kept nowhere.
 *
 * The client reads the mail by shape, not by format: the first key (`ACCESS-` and three
 * groups of four from the key's alphabet) and the first wallet address (`jsc` and 40 hex),
 * in the subject and then the body, in either case. A body line starting with `>` is the
 * sender quoting someone else, the briefing's own example key among them, so neither is
 * read from one.
 *
 * Opening the sender's contracts checks the password and counts the mail as one of the
 * sender's sends, in one step, so a proof is held to the same hourly limit as any mail.
 * The client looks only at the sender's jobs with itself, accepted or completed (a dropped
 * job is no contract), and answers with the first of these that fits:
 *
 *   - no accepted job here, and the key is not a completed job's: no contract;
 *   - an accepted job, and no key: ask for the key;
 *   - the accepted job's key: completed, paying the wallet when one was named;
 *   - a completed job's key: the job is already closed;
 *   - otherwise: the key opens nothing.
 *
 * Completing is one step in the store under the handle's lock: a second right mail racing
 * the first finds the job completed and is told it is closed, so a job pays once. A store
 * that failed, or answered a word nobody taught it, has not said what happened, so the door
 * answers nothing rather than a reply that would be a guess.
 */

import { z } from 'zod';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import type { ContractMail } from '../hireme/contracts.js';
import { writeAmount } from '../wallet/amount.js';
import { missionKey } from './missionSecret.js';
import { missionTerms, type MissionClient, type MissionTerms } from './missionTerms.js';

type StoreReply = Promise<{ readonly data: unknown; readonly error: unknown }>;

export type ClientMailStore = {
  /** Check the sender's password and count the send, answering with the sender's accepted
   *  and completed jobs, or the word that refused it. */
  readonly open: (login: {
    readonly handle: string;
    readonly passwordMd5: string;
    readonly playerKey: string;
  }) => StoreReply;
  /** Close the job numbered `number` as completed, minting `pay` to the wallet when there is
   *  one and delivering the reply: `completed`, `already_done` or `no_contract`. */
  readonly complete: (request: {
    readonly handle: string;
    readonly number: number;
    readonly wallet: string | null;
    readonly pay: number;
    readonly reply: ContractMail;
  }) => StoreReply;
  /** Deliver one of the client's other replies as system mail: `replied`. */
  readonly reply: (request: {
    readonly handle: string;
    readonly reply: ContractMail;
  }) => StoreReply;
};

/** What became of the mail: answered by the client, or refused before it was read. */
export type ClientMailAnswer = 'replied' | 'login_failed' | 'throttled' | 'send_limited';

const openedSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('opened'),
    jobs: z.array(z.object({ number: z.number().int(), state: z.enum(['accepted', 'completed']) })),
  }),
  z.object({ outcome: z.enum(['login_failed', 'throttled', 'send_limited']) }),
]);

const completeOutcomeSchema = z.enum(['completed', 'already_done', 'no_contract']);
const replyOutcomeSchema = z.literal('replied');

/** The key's alphabet has no I, L, O or U; no symbol may run on past the last group. */
const KEY_SHAPE = /\bACCESS(?:-[0-9A-HJKMNP-TV-Z]{4}){3}(?![0-9A-Z])/i;
const WALLET_SHAPE = /\bjsc[0-9a-f]{40}(?![0-9a-f])/i;

const NO_KEY = 'No key, no money. Send the key.';
const NO_WALLET =
  'Key received. You sent no wallet, so there is nothing to pay. No wallet, no money.';
const WRONG_KEY = 'That key opens nothing of ours.';
const CLOSED = 'That job is already closed.';
const NO_CONTRACT = 'We have no contract with you.';

/** The subject, then the body without the lines it quotes. */
const readableText = (subject: string, body: string): string =>
  [subject, ...body.split('\n').filter((line) => !line.startsWith('>'))].join('\n');

const firstMatch = (text: string, shape: RegExp): string | null => shape.exec(text)?.[0] ?? null;

const signed = (line: string, company: string): string =>
  [line, '', `-- ${company}`, ''].join('\n');

const replyAbout = (terms: MissionTerms, line: string): ContractMail => ({
  sender: `${terms.client.handle}@${EMAILIT_DOMAIN}`,
  subject: `Contract: ${terms.targetCompany}`,
  body: signed(line, terms.client.company),
});

const noContractFrom = (client: MissionClient): ContractMail => ({
  sender: `${client.handle}@${EMAILIT_DOMAIN}`,
  subject: 'No contract',
  body: signed(NO_CONTRACT, client.company),
});

type Decision =
  | { readonly kind: 'complete'; readonly number: number }
  | { readonly kind: 'reply'; readonly reply: ContractMail };

const decide = ({
  client,
  jobs,
  key,
  secret,
}: {
  readonly client: MissionClient;
  readonly jobs: readonly { readonly number: number; readonly state: string }[];
  readonly key: string | null;
  readonly secret: string;
}): Decision => {
  const withClient = jobs.filter((job) => missionTerms(job.number).client.handle === client.handle);
  const accepted = withClient.find((job) => job.state === 'accepted');
  const closed = withClient.find(
    (job) => job.state === 'completed' && missionKey(job.number, secret) === key,
  );
  const reply = (missionNumber: number, line: string): Decision => ({
    kind: 'reply',
    reply: replyAbout(missionTerms(missionNumber), line),
  });

  if (accepted === undefined) {
    return closed === undefined
      ? { kind: 'reply', reply: noContractFrom(client) }
      : reply(closed.number, CLOSED);
  }
  if (key === null) return reply(accepted.number, NO_KEY);
  if (missionKey(accepted.number, secret) === key) {
    return { kind: 'complete', number: accepted.number };
  }
  if (closed !== undefined) return reply(closed.number, CLOSED);
  return reply(accepted.number, WRONG_KEY);
};

const sendReply = async (
  store: ClientMailStore,
  handle: string,
  reply: ContractMail,
): Promise<ClientMailAnswer | null> => {
  const answer = await store.reply({ handle, reply });
  return answer.error || !replyOutcomeSchema.safeParse(answer.data).success ? null : 'replied';
};

/** Read a mail sent to `client` and answer it, or null when the store could not say what
 *  happened. */
export const answerClientMail = async ({
  login,
  client,
  subject,
  body,
  secret,
  store,
}: {
  readonly login: {
    readonly handle: string;
    readonly passwordMd5: string;
    readonly playerKey: string;
  };
  readonly client: MissionClient;
  readonly subject: string;
  readonly body: string;
  /** The deployment's mission secret, already checked present. */
  readonly secret: string;
  readonly store: ClientMailStore;
}): Promise<ClientMailAnswer | null> => {
  const opened = await store.open(login);
  const read = openedSchema.safeParse(opened.data);
  if (opened.error || !read.success) return null;
  if (read.data.outcome !== 'opened') return read.data.outcome;

  const text = readableText(subject, body);
  const key = firstMatch(text, KEY_SHAPE)?.toUpperCase() ?? null;
  const decision = decide({ client, jobs: read.data.jobs, key, secret });
  if (decision.kind === 'reply') return sendReply(store, login.handle, decision.reply);

  const terms = missionTerms(decision.number);
  const wallet = firstMatch(text, WALLET_SHAPE)?.toLowerCase() ?? null;
  const completed = await store.complete({
    handle: login.handle,
    number: decision.number,
    wallet,
    pay: terms.pay,
    reply: replyAbout(
      terms,
      wallet === null
        ? NO_WALLET
        : `Key received. ${writeAmount(terms.pay)} sent to ${wallet}. Pleasure doing business.`,
    ),
  });
  const outcome = completeOutcomeSchema.safeParse(completed.data);
  if (completed.error || !outcome.success) return null;
  if (outcome.data === 'completed') return 'replied';
  if (outcome.data === 'already_done') {
    return sendReply(store, login.handle, replyAbout(terms, CLOSED));
  }
  return sendReply(store, login.handle, noContractFrom(client));
};
