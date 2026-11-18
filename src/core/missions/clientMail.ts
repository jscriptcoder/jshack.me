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
 * down, or says it is still up. A backdoor job asks for none either: the client reads its target
 * and completes the job when a listener holds the port the briefing named, whoever left it, or
 * says nothing is listening there, the same words for no listener, one on another port and a box
 * that no longer boots. A portforward job asks for none either: the client reads the contract's
 * router, never the machine, and completes the job when the port the briefing named reaches the
 * machine on its own port, whoever forwarded it, or says it does not, the same words for no
 * forward, one to another machine or port, and a router that no longer boots. Once any of them is
 * completed, and nothing else is accepted here, any mail is told the job is closed without the
 * box or the router being read.
 *
 * A file job asks for the file, not a key: the client compares the file the mail carries with the
 * one the server laid on the target, character for character, and answers as for a key, with
 * "file" for "key". The file's name does not matter, the client never reads the box, and a key in
 * the text proves nothing. Every other kind ignores the file a mail carries.
 *
 * A credential job asks for a password that works now: the client reads the first line of the body,
 * outside the quotes, that starts with `password:`, whatever the label's case or the spaces before
 * it, and tests what follows, trimmed and case-sensitive, against root's login on the target as it
 * stands. So a password found and a password set with `passwd` both pay, and one changed since does
 * not. One line is one guess: a mail cannot try a list of words. No line, an empty or wrong password
 * and a target that no longer boots get the same words.
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
import { missionFileContent, missionFilePath, missionPlantContent } from './missionFileItem.js';
import { missionKind, missionTopology } from './missionShape.js';
import { recordsLookRight } from './missionRecords.js';
import { backdoorJob, credentialRole } from './targetRoles.js';
import { portforwardJob } from './portforwardJob.js';
import { md5 } from '../generation/md5.js';
import { accountIn } from '../sessions/passwdAccount.js';
import { missionEssid } from './missionNetwork.js';
import { machineServing } from '../network/machineServing.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import { listenerOn } from '../services/pidfile.js';
import { createFsView } from '../filesystem/fsView.js';
import { asAbsPath } from '../types.js';
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

/** The box a tamper, sabotage, backdoor or infiltrate job is about, or a portforward job's router,
 *  as it stands: up with its tree, not up, or not readable. */
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
const NO_FILE = 'No file, no money. Send the file.';
const KEY_RECEIVED = 'Key received.';
const FILE_RECEIVED = 'File received.';
const RECORDS_RECEIVED = 'The records look right.';
const MACHINE_DOWN = 'The machine is down.';
const LISTENING = "We're in.";
const IN_PLACE = "It's in place.";
const THROUGH = "We're through.";
const LOGIN_WORKS = 'That login works.';
const NO_WALLET = 'You sent no wallet, so there is nothing to pay. No wallet, no money.';
const RECORDS_WRONG = "Our records don't look right. No change, no money.";
const STILL_UP = 'Their machine is still up. No outage, no money.';
/** One reply for every miss: no listener, one on another port, or a box that no longer boots. */
const nothingListening = (port: number): string =>
  `Nothing is listening on port ${port}. No listener, no money.`;
const notInPlace = (path: string): string =>
  `Our file is not at ${path}. No file in place, no money.`;
/** One reply for every miss: no forward, one to another machine or port, or a router that no
 *  longer boots. */
const noWayIn = (port: number, noun: string): string =>
  `Port ${port} doesn't reach their ${noun}. No way in, no money.`;
/** One reply for every miss: no password line, an empty or wrong password, or a target that no
 *  longer boots. */
const loginRefused = (noun: string): string =>
  `That login doesn't open their ${noun}. No login, no money.`;
const WRONG_KEY = 'That key opens nothing of ours.';
const WRONG_FILE = "That's not the file we asked for.";
const CLOSED = 'That job is already closed.';
const NO_CONTRACT = 'We have no contract with you.';

/** The body without the lines it quotes. */
const unquotedLines = (body: string): readonly string[] =>
  body.split('\n').filter((line) => !line.startsWith('>'));

/** The subject, then the body without the lines it quotes. */
const readableText = (subject: string, body: string): string =>
  [subject, ...unquotedLines(body)].join('\n');

const PASSWORD_LABEL = /^\s*password:/i;

/** What the first password line of the body gives, or null for a body with none. The subject is
 *  never read for one: `mail reply` fills it in. */
const mailedPassword = (body: string): string | null => {
  const line = unquotedLines(body).find((candidate) => PASSWORD_LABEL.test(candidate));
  return line === undefined ? null : line.replace(PASSWORD_LABEL, '').trim();
};

/** Whether `password` opens the box's root login as it stands. An empty password opens nothing,
 *  whatever the box's root is set to. */
const opensRoot = (fs: Directory, password: string | null): boolean =>
  password !== null && password !== '' && accountIn(fs, 'root')?.hash === md5(password);

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
  | { readonly kind: 'completeFile'; readonly number: number }
  | { readonly kind: 'checkRecords'; readonly number: number }
  | { readonly kind: 'checkDown'; readonly number: number }
  | { readonly kind: 'checkListening'; readonly number: number }
  | { readonly kind: 'checkPlanted'; readonly number: number }
  | { readonly kind: 'checkForward'; readonly number: number }
  | { readonly kind: 'checkLogin'; readonly number: number }
  | { readonly kind: 'reply'; readonly reply: ContractMail };

/** How the client opens its reply to a job done: the key or the file it was sent, the records it
 *  read, the machine it found down, the listener it found, its own file found in place, the way
 *  in it found open, or the login it found working. */
const RECEIVED: Readonly<Record<Exclude<Decision['kind'], 'reply'>, string>> = {
  complete: KEY_RECEIVED,
  completeFile: FILE_RECEIVED,
  checkRecords: RECORDS_RECEIVED,
  checkDown: MACHINE_DOWN,
  checkListening: LISTENING,
  checkPlanted: IN_PLACE,
  checkForward: THROUGH,
  checkLogin: LOGIN_WORKS,
};

/** What the client says on a job the mail itself proves: when the mail carries no proof, when it
 *  carries the wrong one, and how it completes on the right one. */
const MAILED_PROOF = {
  key: { none: NO_KEY, wrong: WRONG_KEY, done: 'complete' },
  file: { none: NO_FILE, wrong: WRONG_FILE, done: 'completeFile' },
} as const;

const decide = ({
  client,
  jobs,
  key,
  file,
  secret,
}: {
  readonly client: MissionClient;
  readonly jobs: readonly { readonly number: number; readonly state: string }[];
  readonly key: string | null;
  readonly file: string | null;
  readonly secret: string;
}): Decision => {
  /** Whether the mail carries the proof of the job numbered so: its key on a key job, its file on
   *  a file job. A job the box proves needs nothing from the mail. */
  const proves = (missionNumber: number): boolean => {
    const kind = missionKind(missionNumber);
    if (kind === 'key') return missionKey(missionNumber, secret) === key;
    if (kind === 'file') return missionFileContent(missionNumber, secret) === file;
    return true;
  };
  const withClient = jobs.filter((job) => missionTerms(job.number).client.handle === client.handle);
  const accepted = withClient.find((job) => job.state === 'accepted');
  const closed = withClient.find((job) => job.state === 'completed' && proves(job.number));
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
  if (acceptedKind === 'backdoor') return { kind: 'checkListening', number: accepted.number };
  if (acceptedKind === 'infiltrate') return { kind: 'checkPlanted', number: accepted.number };
  if (acceptedKind === 'portforward') return { kind: 'checkForward', number: accepted.number };
  if (acceptedKind === 'credential') return { kind: 'checkLogin', number: accepted.number };
  const said = MAILED_PROOF[acceptedKind];
  if ((acceptedKind === 'file' ? file : key) === null) return reply(accepted.number, said.none);
  if (proves(accepted.number)) return { kind: said.done, number: accepted.number };
  if (closed !== undefined) return reply(closed.number, CLOSED);
  return reply(accepted.number, said.wrong);
};

/** Whether the router sends the port the client named to the machine it wants reached, on the
 *  machine's own port. The router's routing decides, not the file's text: a port the router
 *  itself answers on reaches the router, whatever a forward says. */
const reachesMachine = (routerFs: Directory, missionNumber: number): boolean => {
  const { machine, publicPort } = portforwardJob(missionNumber);
  const served = machineServing({ routerFs, port: publicPort });
  const machineIp = `${lanSubnetPrefix(missionEssid(missionNumber))}.${missionTopology(missionNumber).keyBoxOctet}`;
  return (
    served.kind === 'forward' &&
    served.internalIp === machineIp &&
    served.internalPort === machine.insidePort
  );
};

/** Whether the box holds, at the path the client named, exactly the file the client sent. */
const holdsPlant = (fs: Directory, missionNumber: number, secret: string): boolean => {
  const read = createFsView(fs, { userType: 'root' }).read(
    asAbsPath(missionFilePath(missionNumber)),
  );
  return read.ok && read.content === missionPlantContent(missionNumber, secret);
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
  file,
  secret,
  store,
  readTargetBox,
  readRouter,
}: {
  readonly login: {
    readonly handle: string;
    readonly passwordMd5: string;
    readonly playerKey: string;
  };
  readonly client: MissionClient;
  readonly subject: string;
  readonly body: string;
  /** The content of the file the mail carries, or null for a mail carrying none. */
  readonly file: string | null;
  /** The deployment's mission secret, already checked present. */
  readonly secret: string;
  readonly store: ClientMailStore;
  /** The box the tamper, sabotage, backdoor or infiltrate job numbered so is about, as it stands
   *  now. */
  readonly readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>;
  /** The router of the portforward job numbered so, as it stands now. */
  readonly readRouter: (missionNumber: number) => Promise<TargetBoxRead>;
}): Promise<ClientMailAnswer | null> => {
  const opened = await store.open(login);
  const read = openedSchema.safeParse(opened.data);
  if (opened.error || !read.success) return null;
  if (read.data.outcome !== 'opened') return read.data.outcome;

  const text = readableText(subject, body);
  const key = firstMatch(text, KEY_SHAPE)?.toUpperCase() ?? null;
  const decision = decide({ client, jobs: read.data.jobs, key, file, secret });
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
  if (decision.kind === 'checkListening') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const { port } = backdoorJob(decision.number);
    // Anyone's listener counts, as anyone's brick does on a sabotage job: the client wants a
    // way in, not to know who left it.
    if (box.kind === 'absent' || listenerOn(box.fs, port) === null) {
      return sendReply(store, login.handle, replyAbout(terms, nothingListening(port)));
    }
  }
  if (decision.kind === 'checkPlanted') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const path = missionFilePath(decision.number);
    // Anyone's placing counts, as anyone's listener does on a backdoor job: the client wants
    // its file there, not to know who put it there.
    if (box.kind === 'absent' || !holdsPlant(box.fs, decision.number, secret)) {
      return sendReply(store, login.handle, replyAbout(terms, notInPlace(path)));
    }
  }
  if (decision.kind === 'checkForward') {
    const router = await readRouter(decision.number);
    if (router.kind === 'error') return null;
    // Anyone's forward counts, as anyone's listener does on a backdoor job. A router that no
    // longer boots reaches nothing, so a bricked router loses the job for good.
    if (router.kind === 'absent' || !reachesMachine(router.fs, decision.number)) {
      const { machine, publicPort } = portforwardJob(decision.number);
      return sendReply(store, login.handle, replyAbout(terms, noWayIn(publicPort, machine.noun)));
    }
  }
  if (decision.kind === 'checkLogin') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    if (box.kind === 'absent' || !opensRoot(box.fs, mailedPassword(body))) {
      const { noun } = credentialRole(decision.number);
      return sendReply(store, login.handle, replyAbout(terms, loginRefused(noun)));
    }
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
