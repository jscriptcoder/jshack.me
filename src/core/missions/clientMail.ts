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
 * A tamper job asks for no key: whatever the mail says, the client reads the job's records box
 * as it stands and completes the job when its records read right, or says they do not. A box
 * that is not up holds no records that read right. A sabotage job asks for none either: the
 * client reads its target and completes the job when the box no longer boots, whoever took it
 * down, or says it is still up. Once either is completed, and nothing else is accepted here, any
 * mail is told the job is closed without the box being read.
 *
 * Completing is one step in the store under the handle's lock: a second right mail racing
 * the first finds the job completed and is told it is closed, so a job pays once. A store
 * that failed, or answered a word nobody taught it, has not said what happened, so the door
 * answers nothing rather than a reply that would be a guess.
 */

import { z } from 'zod';
import { EMAILIT_DOMAIN } from '../generation/fixedSites.js';
import type { ContractMail } from '../hireme/contracts.js';
import type { Directory } from '../filesystem/types.js';
import { writeAmount } from '../wallet/amount.js';
import { missionKey } from './missionSecret.js';
import { missionKind } from './missionShape.js';
import { recordsLookRight } from './missionRecords.js';
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

/** The box a tamper or sabotage job is about, as it stands: up with its tree, not up, or not
 *  readable. */
export type TargetBoxRead =
  | { readonly kind: 'up'; readonly fs: Directory }
  | { readonly kind: 'absent' }
  | { readonly kind: 'error' };

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
const KEY_RECEIVED = 'Key received.';
const RECORDS_RECEIVED = 'The records look right.';
const MACHINE_DOWN = 'The machine is down.';
const NO_WALLET = 'You sent no wallet, so there is nothing to pay. No wallet, no money.';
const RECORDS_WRONG = "Our records don't look right. No change, no money.";
const STILL_UP = 'Their machine is still up. No outage, no money.';
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
  | { readonly kind: 'checkRecords'; readonly number: number }
  | { readonly kind: 'checkDown'; readonly number: number }
  | { readonly kind: 'reply'; readonly reply: ContractMail };

/** How the client opens its reply to a job done: the key it was sent, the records it read, or
 *  the machine it found down. */
const RECEIVED: Readonly<Record<Exclude<Decision['kind'], 'reply'>, string>> = {
  complete: KEY_RECEIVED,
  checkRecords: RECORDS_RECEIVED,
  checkDown: MACHINE_DOWN,
};

/** Whether the job is proved by a key mailed back, rather than by the box itself. */
const isKeyJob = (missionNumber: number): boolean => missionKind(missionNumber) === 'key';

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
    (job) =>
      job.state === 'completed' &&
      (!isKeyJob(job.number) || missionKey(job.number, secret) === key),
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
  const acceptedKind = missionKind(accepted.number);
  if (acceptedKind === 'tamper') return { kind: 'checkRecords', number: accepted.number };
  if (acceptedKind === 'sabotage') return { kind: 'checkDown', number: accepted.number };
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
  readTargetBox,
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
  /** The box the tamper or sabotage job numbered so is about, as it stands right now. */
  readonly readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>;
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
  if (decision.kind === 'checkRecords') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    if (box.kind === 'absent' || !recordsLookRight(decision.number, box.fs)) {
      return sendReply(store, login.handle, replyAbout(terms, RECORDS_WRONG));
    }
  }
  if (decision.kind === 'checkDown') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    // The target always stands at its address, so a box that is not up is one that no longer
    // boots: the job done, whoever did it.
    if (box.kind === 'up') return sendReply(store, login.handle, replyAbout(terms, STILL_UP));
  }
  const received = RECEIVED[decision.kind];
  const wallet = firstMatch(text, WALLET_SHAPE)?.toLowerCase() ?? null;
  const completed = await store.complete({
    handle: login.handle,
    number: decision.number,
    wallet,
    pay: terms.pay,
    reply: replyAbout(
      terms,
      wallet === null
        ? `${received} ${NO_WALLET}`
        : `${received} ${writeAmount(terms.pay)} sent to ${wallet}. Pleasure doing business.`,
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
