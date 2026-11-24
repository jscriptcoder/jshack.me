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
 * A destroy job asks for the company's file gone: the client reads the target as it stands and
 * completes the job once the file's path no longer holds exactly the bytes the server laid, whoever
 * deleted, overwrote or moved it. The same bytes put back count as still there. A target that no
 * longer boots cannot be looked at, so it gets the same words as a file still in place, even if the
 * file went first.
 *
 * A wipe job asks for the records emptied: the client reads the target as it stands and completes
 * the job once the table the briefing describes holds nothing and the two beside it read exactly as
 * they were laid, whoever emptied it. A table with rows left, a file the client cannot read as rows,
 * either table beside it changed in any way, and a target that no longer boots get the same words,
 * and the job stays open, so finishing the wipe then pays.
 *
 * A cleanup job is white-hat work, done for the client's customer, and asks for the intruder's
 * listener and implant both gone from the target: the client reads it as it stands and completes
 * the job once no listener holds the port the briefing named and the implant's path no longer
 * holds exactly the bytes the server laid, the destroy job's rule, whoever did either. Before
 * that it reads whether every machine it let the contractor into still boots, the target and on
 * two hops the edge machine too: one that no longer boots means the help broke what it was meant
 * to mend, and the job can never pay, though it stays open as every miss does. Any listener on the
 * port is a miss, since the client only knows the port answers, and the listener is read before
 * the implant.
 *
 * A lock-them-out job is white-hat work too, and asks that the root password that leaked, and the
 * account the intruder added with it, let nobody in: the client reads the target's `/etc/passwd`
 * as it stands, after the same boot rule, and completes the job once root takes neither the word
 * that leaked nor no word at all, every row stands under a name the customer had, once each, and
 * every one of the customer's own rows reads as it was laid, root's hash aside. Anyone's change
 * counts, and row order is nobody's business. A way still in answers before an account of theirs
 * spoiled, and neither reply says which.
 *
 * A chain job asks for two steps and pays for both or neither: the client reads the front box and
 * then the target as they stand, and completes the job once a listener holds the port the briefing
 * named on the front box and the target shows the last step done, as a sabotage, destroy or wipe
 * job's target would: no longer booting, its file gone, or its records emptied, whoever did either
 * and in whichever order. The first step unfinished answers: no listener on the front box, one on
 * another port, one on the target instead, and a front box that no longer boots get the
 * listener's words, and with the listener in place an unfinished last step gets that kind's. Either
 * miss keeps the job open.
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
import {
  MISSION_ROUTE_DAY,
  chainFinal,
  missionKind,
  missionShape,
  missionTopology,
  patchHole,
  type ChainFinal,
} from './missionShape.js';
import { recordsLookRight, recordsWiped } from './missionRecords.js';
import {
  backdoorJob,
  chainJob,
  cleanupJob,
  credentialRole,
  lockoutJob,
  patchJob,
} from './targetRoles.js';
import { parseDpkgVersions, readDpkgStatus } from '../packages/dpkgStatus.js';
import { installedRelease } from '../cve/packageTimeline.js';
import { cleanupPlant } from './cleanupPlant.js';
import { portforwardJob } from './portforwardJob.js';
import { closeDoorJob } from './closeDoorJob.js';
import { md5 } from '../generation/md5.js';
import { accountIn, passwdFields } from '../sessions/passwdAccount.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { missionEssid } from './missionNetwork.js';
import { machineServing } from '../network/machineServing.js';
import { parseForwardRules, readRulesV4 } from '../network/iptablesRules.js';
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

/** The box a tamper, sabotage, backdoor, infiltrate, credential, destroy, wipe, chain, cleanup or
 *  lock-them-out job is about, a chain or two-hop cleanup or lock-them-out job's front box, or a
 *  portforward or close-the-door job's router, as it stands: up with its tree, not up, or not
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
const NO_FILE = 'No file, no money. Send the file.';
const KEY_RECEIVED = 'Key received.';
const FILE_RECEIVED = 'File received.';
const RECORDS_RECEIVED = 'The records look right.';
const MACHINE_DOWN = 'The machine is down.';
const LISTENING = "We're in.";
const IN_PLACE = "It's in place.";
const THROUGH = "We're through.";
const LOGIN_WORKS = 'That login works.';
const FILE_GONE = "It's gone.";
const RECORDS_GONE = 'The records are gone.';
const SHUT = "It's shut.";
const LOCKED_OUT = "They're locked out.";
const PATCHED = "It's patched.";
const BOTH_DONE = 'Both done.';
/** A white-hat client closes with thanks, not with the black-hat clients' sign-off. */
const THANKS = 'Thank you for the help.';
const PLEASURE = 'Pleasure doing business.';
const TOOK_IT_DOWN = 'You took our machine down. No money.';
const STILL_ON_THE_MACHINE =
  'It has stopped, but it is still on the machine. Still there, no money.';
const NO_WALLET = 'You sent no wallet, so there is nothing to pay. No wallet, no money.';
const RECORDS_WRONG = "Our records don't look right. No change, no money.";
const STILL_UP = 'Their machine is still up. No outage, no money.';
/** One reply for every miss: no listener, one on another port, or a box that no longer boots. */
const nothingListening = (port: number): string =>
  `Nothing is listening on port ${port}. No listener, no money.`;
/** One reply for every miss on a chain job's first step: no listener on the front box, one on
 *  another port, one on the machine inside, or a front box that no longer boots. */
const nothingOnTheEdge = (port: number): string =>
  `Nothing is listening on port ${port} on the edge. No listener, no money.`;
/** Any listener on the port the briefing named, the intruder's or anyone's since. */
const stillAnswers = (port: number): string =>
  `Something still answers on port ${port}. Still there, no money.`;
const notInPlace = (path: string): string =>
  `Our file is not at ${path}. No file in place, no money.`;
/** One reply for every miss: no forward, one to another machine or port, or a router that no
 *  longer boots. */
const noWayIn = (port: number, noun: string): string =>
  `Port ${port} doesn't reach their ${noun}. No way in, no money.`;
/** Any forward that still reaches the machine's service, the one laid or anyone's since. Never
 *  the port: which forward it is, is the job. */
const stillReachable = (noun: string): string =>
  `Their ${noun} still answers from outside. Still open, no money.`;
/** Any forward the customer wants kept that no longer reaches where it did. Never which. */
const NOT_ALL_CLOSED =
  "That's not all you closed. Something they use no longer answers from outside. No money.";
/** Any way still in as the intruder: the word that leaked, an emptied root, or an account the
 *  customer never had. Never which: finding the way in is the job. */
const stillGetsIn = (noun: string): string =>
  `Whoever has that password can still get into their ${noun}. Still open, no money.`;
/** Any of the customer's own accounts that no longer reads as it did. Never which. */
const NOT_ALL_CHANGED =
  "That's not all you changed. One of their own accounts no longer works as it did. No money.";
/** The holed package still on its release or an earlier one, or gone from the manifest. Never
 *  which package: finding the hole is the job. */
const stillHoled = (noun: string): string =>
  `Their ${noun} still runs the release with that hole. Still open, no money.`;
/** Any other package the customer runs no longer on its version, or gone. Never which. */
const notAllMoved = (noun: string): string =>
  `That's not all you moved. Something else on their ${noun} is no longer on the version they run. No money.`;
/** One reply for every miss: no password line, an empty or wrong password, or a target that no
 *  longer boots. */
const loginRefused = (noun: string): string =>
  `That login doesn't open their ${noun}. No login, no money.`;
/** One reply for every miss: the file still in place, or a target that no longer boots. */
const NOT_GONE = "We can't confirm that file is gone. Not gone, no money.";
/** One reply for every miss: rows left, a table beside it touched, or a target that no longer
 *  boots. */
const NOT_WIPED = "That's not what we asked for. Not wiped, no money.";
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
  | { readonly kind: 'checkGone'; readonly number: number }
  | { readonly kind: 'checkWiped'; readonly number: number }
  | { readonly kind: 'checkChain'; readonly number: number }
  | { readonly kind: 'checkCleanup'; readonly number: number }
  | { readonly kind: 'checkClosed'; readonly number: number }
  | { readonly kind: 'checkLockout'; readonly number: number }
  | { readonly kind: 'checkPatch'; readonly number: number }
  | { readonly kind: 'reply'; readonly reply: ContractMail };

/** How the client opens its reply to a job done: the key or the file it was sent, the records it
 *  read, the machine it found down, the listener it found, its own file found in place, the way
 *  in it found open, the login it found working, the company's file it found gone, the records
 *  it found emptied, both steps of a chain job found done, the intruder's implant found gone, the
 *  way in someone opened found shut, the intruder found locked out, or the hole found patched. */
const RECEIVED: Readonly<Record<Exclude<Decision['kind'], 'reply'>, string>> = {
  complete: KEY_RECEIVED,
  completeFile: FILE_RECEIVED,
  checkRecords: RECORDS_RECEIVED,
  checkDown: MACHINE_DOWN,
  checkListening: LISTENING,
  checkPlanted: IN_PLACE,
  checkForward: THROUGH,
  checkLogin: LOGIN_WORKS,
  checkGone: FILE_GONE,
  checkWiped: RECORDS_GONE,
  checkChain: BOTH_DONE,
  checkCleanup: FILE_GONE,
  checkClosed: SHUT,
  checkLockout: LOCKED_OUT,
  checkPatch: PATCHED,
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
  if (acceptedKind === 'destroy') return { kind: 'checkGone', number: accepted.number };
  if (acceptedKind === 'wipe') return { kind: 'checkWiped', number: accepted.number };
  if (acceptedKind === 'chain') return { kind: 'checkChain', number: accepted.number };
  if (acceptedKind === 'cleanup') return { kind: 'checkCleanup', number: accepted.number };
  if (acceptedKind === 'closedoor') return { kind: 'checkClosed', number: accepted.number };
  if (acceptedKind === 'lockout') return { kind: 'checkLockout', number: accepted.number };
  if (acceptedKind === 'patch') return { kind: 'checkPatch', number: accepted.number };
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

/** What the client says of a close-the-door job's router that is not yet right: some public port
 *  still reaches the machine's service, through the forward laid or anyone's since, or a forward
 *  the customer wants kept no longer reaches where it did. Null once the one is shut and the rest
 *  stand. The router's routing decides, as on a portforward job: a forward moved elsewhere or a
 *  router listener answering on the port first shuts it, and a router `deny` stops no forward. */
const closeDoorMiss = (routerFs: Directory, missionNumber: number): string | null => {
  const { machine, publicPort } = closeDoorJob(missionNumber);
  const { forwards, keyBox } = missionShape(missionNumber);
  const subnet = lanSubnetPrefix(missionEssid(missionNumber));
  const reaches = (port: number, internalIp: string, internalPort: number): boolean => {
    const served = machineServing({ routerFs, port });
    return (
      served.kind === 'forward' &&
      served.internalIp === internalIp &&
      served.internalPort === internalPort
    );
  };
  const machineIp = `${subnet}.${keyBox.octet}`;
  const open = parseForwardRules(readRulesV4(routerFs)).some(({ publicPort: port }) =>
    reaches(port, machineIp, machine.insidePort),
  );
  if (open) return stillReachable(machine.noun);
  const kept = forwards.filter((forward) => forward.publicPort !== publicPort);
  const allKept = kept.every((forward) =>
    reaches(forward.publicPort, `${subnet}.${forward.boxOctet}`, forward.internalPort),
  );
  return allKept ? null : NOT_ALL_CLOSED;
};

/** What the client says of a lock-them-out target not yet locked: still open while root takes the
 *  word that leaked or no word at all, or while any row stands under a name the customer never
 *  had or a second row under one of theirs; then, the customer's own rows matched by name, any
 *  gone or reading other than laid, root's hash aside. Null once locked, whoever did it. Row order
 *  is nobody's business. */
const lockoutMiss = (missionNumber: number, fs: Directory): string | null => {
  const { role, account } = lockoutJob(missionNumber);
  const theirs = passwdFields(buildMissionKeyBoxFs(missionNumber)).filter(
    ([name]) => name !== account,
  );
  const theirNames = new Set(theirs.map(([name]) => name));
  const rows = passwdFields(fs);
  const names = rows.map(([name]) => name);
  const strange = names.some(
    (name, index) => !theirNames.has(name) || names.indexOf(name) !== index,
  );
  const rootHash = rows.find(([name]) => name === 'root')?.[1];
  const leakedHash = missionShape(missionNumber).keyBox.rootHash;
  if (strange || rootHash === leakedHash || rootHash === '') return stillGetsIn(role.noun);
  const asLaid = theirs.every((laid) => {
    const now = rows.find(([name]) => name === laid[0]);
    if (now === undefined || now.length !== laid.length) return false;
    return laid.every((field, index) => (laid[0] === 'root' && index === 1) || now[index] === field);
  });
  return asLaid ? null : NOT_ALL_CHANGED;
};

/** What the client says of a patch-it target not yet right: still open while the holed package
 *  has no row or sits on its laid release or an earlier one, a version read as every reader of a
 *  box's exposure reads it (the newest release at or below it); then any other package the box was
 *  laid with gone or on another version. A package installed since is the customer's business.
 *  Null once patched, whoever did it.
 *
 *  Resolved on the route day: the hole's next release is on the timeline by then, so a later day
 *  gives every version the same answer, and the check needs no clock. */
const patchMiss = (missionNumber: number, fs: Directory): string | null => {
  const { noun } = patchJob(missionNumber).role;
  const hole = patchHole(missionNumber);
  const laid = parseDpkgVersions(readDpkgStatus(buildMissionKeyBoxFs(missionNumber)));
  const now = parseDpkgVersions(readDpkgStatus(fs));
  const holeNow = now.get(hole.package);
  const releaseOf = (version: string) =>
    installedRelease(hole.package, version, MISSION_ROUTE_DAY)?.index ?? -1;
  if (holeNow === undefined || releaseOf(holeNow) <= releaseOf(hole.version)) {
    return stillHoled(noun);
  }
  const othersAsLaid = [...laid].every(
    ([pkg, version]) => pkg === hole.package || now.get(pkg) === version,
  );
  return othersAsLaid ? null : notAllMoved(noun);
};

/** Whether the box holds exactly `content` at the job's file path. */
const holdsAtFilePath = (fs: Directory, missionNumber: number, content: string): boolean => {
  const read = createFsView(fs, { userType: 'root' }).read(
    asAbsPath(missionFilePath(missionNumber)),
  );
  return read.ok && read.content === content;
};

/** The step each job read off its target asks, as a chain job's last step names it. */
const STEP_CHECKED = {
  checkDown: 'sabotage',
  checkGone: 'destroy',
  checkWiped: 'wipe',
} as const satisfies Partial<Record<Decision['kind'], ChainFinal>>;

/** What the client says of a target that does not yet show the step `kind` asks of it, a sabotage,
 *  destroy or wipe job's or a chain job's last: still up, its file still there, or its records
 *  not emptied. Null once the step is done, and anyone's doing counts. The target always stands at
 *  its address, so a box that is not up is one that no longer boots: down, and a box nobody can
 *  look into for a file or records. */
const stepMiss = (
  kind: ChainFinal,
  missionNumber: number,
  box: Exclude<TargetBoxRead, { readonly kind: 'error' }>,
  secret: string,
): string | null => {
  if (kind === 'sabotage') return box.kind === 'up' ? STILL_UP : null;
  if (kind === 'destroy') {
    const theirs = missionFileContent(missionNumber, secret);
    return box.kind === 'absent' || holdsAtFilePath(box.fs, missionNumber, theirs)
      ? NOT_GONE
      : null;
  }
  return box.kind === 'absent' || !recordsWiped(missionNumber, box.fs) ? NOT_WIPED : null;
};

/** What the client says of a cleanup target that is not yet clean: something still answers on the
 *  port, or the implant is still where it was laid. Null once both are gone, whoever did it. */
const cleanupMiss = (missionNumber: number, fs: Directory, secret: string): string | null => {
  const { port } = cleanupJob(missionNumber);
  if (listenerOn(fs, port) !== null) return stillAnswers(port);
  const { implant } = cleanupPlant(missionNumber, secret);
  const read = createFsView(fs, { userType: 'root' }).read(asAbsPath(implant.path));
  return read.ok && read.content === implant.content ? STILL_ON_THE_MACHINE : null;
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
  readFrontBox,
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
  /** The box the tamper, sabotage, backdoor, infiltrate, credential, destroy, wipe, chain,
   *  cleanup or lock-them-out job numbered so is about, as it stands now. */
  readonly readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>;
  /** The router of the portforward job numbered so, as it stands now. */
  readonly readRouter: (missionNumber: number) => Promise<TargetBoxRead>;
  /** The front box of the chain or two-hop cleanup or lock-them-out job numbered so, as it
   *  stands now. */
  readonly readFrontBox: (missionNumber: number) => Promise<TargetBoxRead>;
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
  if (
    decision.kind === 'checkDown' ||
    decision.kind === 'checkGone' ||
    decision.kind === 'checkWiped'
  ) {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const miss = stepMiss(STEP_CHECKED[decision.kind], decision.number, box, secret);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
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
    const ours = missionPlantContent(decision.number, secret);
    if (box.kind === 'absent' || !holdsAtFilePath(box.fs, decision.number, ours)) {
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
  if (decision.kind === 'checkChain') {
    // The first unfinished step answers, the listener before the outage. Both are read as they
    // stand on every mail, so the steps can be done in either order, and anyone's counts.
    const front = await readFrontBox(decision.number);
    if (front.kind === 'error') return null;
    const { port } = chainJob(decision.number);
    // A bricked front box holds no listener, so it loses the job for good.
    if (front.kind === 'absent' || listenerOn(front.fs, port) === null) {
      return sendReply(store, login.handle, replyAbout(terms, nothingOnTheEdge(port)));
    }
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const miss = stepMiss(chainFinal(decision.number), decision.number, box, secret);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
  }
  if (decision.kind === 'checkCleanup') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const front =
      missionTopology(decision.number).frontBoxOctet === null
        ? null
        : await readFrontBox(decision.number);
    if (front?.kind === 'error') return null;
    if (box.kind === 'absent' || front?.kind === 'absent') {
      return sendReply(store, login.handle, replyAbout(terms, TOOK_IT_DOWN));
    }
    const miss = cleanupMiss(decision.number, box.fs, secret);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
  }
  if (decision.kind === 'checkLockout') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const front =
      missionTopology(decision.number).frontBoxOctet === null
        ? null
        : await readFrontBox(decision.number);
    if (front?.kind === 'error') return null;
    if (box.kind === 'absent' || front?.kind === 'absent') {
      return sendReply(store, login.handle, replyAbout(terms, TOOK_IT_DOWN));
    }
    const miss = lockoutMiss(decision.number, box.fs);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
  }
  if (decision.kind === 'checkPatch') {
    const box = await readTargetBox(decision.number);
    if (box.kind === 'error') return null;
    const front =
      missionTopology(decision.number).frontBoxOctet === null
        ? null
        : await readFrontBox(decision.number);
    if (front?.kind === 'error') return null;
    if (box.kind === 'absent' || front?.kind === 'absent') {
      return sendReply(store, login.handle, replyAbout(terms, TOOK_IT_DOWN));
    }
    const miss = patchMiss(decision.number, box.fs);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
  }
  if (decision.kind === 'checkClosed') {
    const router = await readRouter(decision.number);
    if (router.kind === 'error') return null;
    // A router that no longer boots is help that broke what it was meant to mend, whoever did it.
    if (router.kind === 'absent') {
      return sendReply(store, login.handle, replyAbout(terms, TOOK_IT_DOWN));
    }
    const miss = closeDoorMiss(router.fs, decision.number);
    if (miss !== null) return sendReply(store, login.handle, replyAbout(terms, miss));
  }
  const received = RECEIVED[decision.kind];
  const signOff =
    terms.job === 'cleanup' ||
    terms.job === 'closedoor' ||
    terms.job === 'lockout' ||
    terms.job === 'patch'
      ? THANKS
      : PLEASURE;
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
        : `${received} ${writeAmount(terms.pay)} sent to ${wallet}. ${signOff}`,
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
