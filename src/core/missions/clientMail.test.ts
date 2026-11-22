import { describe, expect, it } from 'vitest';
import { answerClientMail, type ClientMailStore, type TargetBoxRead } from './clientMail.js';
import type { ContractMail } from '../hireme/contracts.js';
import { missionKey } from './missionSecret.js';
import { missionTerms, type MissionClient } from './missionTerms.js';
import { chainFinal, missionKind, missionShape } from './missionShape.js';
import { missionFiles } from './missionLeak.js';
import { missionAction, missionRecords } from './missionRecords.js';
import {
  missionFileContent,
  missionFileItem,
  missionFilePath,
  missionPlantContent,
} from './missionFileItem.js';
import { runStatement } from '../mysql/statements.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { buildMissionFrontBoxFs, buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { DATADIR_FILE, PASSWD_FILE, ROOT_FILE, file, withFiles } from '../generation/baseFs.js';
import { md5 } from '../generation/md5.js';
import { PASSWD_PATH, withAccountHash } from '../sessions/passwdAccount.js';
import type { Directory } from '../filesystem/types.js';
import { backdoorJob, chainJob, cleanupJob, credentialRole } from './targetRoles.js';
import { cleanupFiles, cleanupPlant } from './cleanupPlant.js';
import { portforwardJob } from './portforwardJob.js';
import { missionEssid } from './missionNetwork.js';
import { buildApGatewayBaseFs } from '../generation/routerFs.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import {
  RULES_V4_PATH,
  RULES_V4_PERMISSIONS,
  readRulesV4,
  withForward,
} from '../network/iptablesRules.js';
import {
  PIDFILE_PERMISSIONS,
  formatListenerContent,
  listenerPidfilePath,
} from '../services/pidfile.js';

/**
 * A mail to a client's handle: the client reads the sender's contracts with it, finds the key
 * and the wallet in the mail by their shape, and either completes the job (paying the wallet)
 * or answers why not. What the store answers is faked; what it is asked to complete or to
 * mail, and the word the door answers, are the behaviour.
 */

const SECRET = 'client-mail-test-secret';
const HANDLE = 'neo';
const LOGIN = { handle: HANDLE, passwordMd5: 'a'.repeat(32), playerKey: 'b'.repeat(64) };
const WALLET = `jsc${'0123456789abcdef'.repeat(2)}01234567`;

/** Contract numbers whose last octet is a host octet. */
const ALL_HOST_NUMBERS = Array.from(
  { length: 4000 },
  (_unused, index) => index * 257 + 1000,
).filter((missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254);

/** The key jobs among them, which is what the mails proving a key are about. */
const HOST_NUMBERS = ALL_HOST_NUMBERS.filter(
  (missionNumber) => missionKind(missionNumber) === 'key',
);

/** The job the sender holds, and its client. */
const JOB = HOST_NUMBERS[0]!;
const TERMS = missionTerms(JOB);
const CLIENT = TERMS.client.handle;
const KEY = missionKey(JOB, SECRET);

/** An earlier job for the same client, and a job for another client. */
const EARLIER = HOST_NUMBERS.find(
  (missionNumber) => missionNumber !== JOB && missionTerms(missionNumber).client.handle === CLIENT,
)!;
const ELSEWHERE = HOST_NUMBERS.find(
  (missionNumber) => missionTerms(missionNumber).client.handle !== CLIENT,
)!;

type Job = { readonly number: number; readonly state: 'accepted' | 'completed' };
type StoreReply = { readonly data: unknown; readonly error: unknown };

/** A store answering as the functions do, with the words it is told. */
const clientStore = ({
  jobs = [{ number: JOB, state: 'accepted' }],
  opened = { outcome: 'opened', jobs },
  openError = null,
  completeWord = 'completed',
  completeError = null,
  replyWord = 'replied',
  replyError = null,
}: {
  readonly jobs?: readonly Job[];
  readonly opened?: unknown;
  readonly openError?: unknown;
  readonly completeWord?: unknown;
  readonly completeError?: unknown;
  readonly replyWord?: unknown;
  readonly replyError?: unknown;
} = {}) => {
  const opens: unknown[] = [];
  const completes: {
    number: number;
    wallet: string | null;
    pay: number;
    reply: ContractMail;
  }[] = [];
  const replies: ContractMail[] = [];
  const answer = (data: unknown, error: unknown): StoreReply => ({ data, error });

  const store: ClientMailStore = {
    open: async (login) => {
      opens.push(login);
      return answer(opened, openError);
    },
    complete: async ({ handle, number, wallet, pay, reply }) => {
      expect(handle).toBe(HANDLE);
      completes.push({ number, wallet, pay, reply });
      return answer(completeWord, completeError);
    },
    reply: async ({ handle, reply }) => {
      expect(handle).toBe(HANDLE);
      replies.push(reply);
      return answer(replyWord, replyError);
    },
  };
  return { store, opens, completes, replies };
};

/** A box nobody should be asked for: a key job's mail never reads one. */
const NO_TARGET_BOX = async (): Promise<TargetBoxRead> => {
  throw new Error('a key job read a box');
};

/** A router nobody should be asked for: only a portforward job's mail reads one. */
const NO_ROUTER = async (): Promise<TargetBoxRead> => {
  throw new Error('a job read a router');
};

/** A front box nobody should be asked for: only a chain or two-hop cleanup job's mail reads one. */
const NO_FRONT_BOX = async (): Promise<TargetBoxRead> => {
  throw new Error('a job read a front box');
};

const mailTo = (
  store: ClientMailStore,
  mail: {
    readonly to?: MissionClient;
    readonly subject?: string;
    readonly body?: string;
    readonly file?: string;
    readonly readTargetBox?: (missionNumber: number) => Promise<TargetBoxRead>;
    readonly readRouter?: (missionNumber: number) => Promise<TargetBoxRead>;
    readonly readFrontBox?: (missionNumber: number) => Promise<TargetBoxRead>;
  } = {},
) =>
  answerClientMail({
    login: LOGIN,
    client: mail.to ?? TERMS.client,
    subject: mail.subject ?? 'the job',
    body: mail.body ?? `${KEY}\n${WALLET}\n`,
    file: mail.file ?? null,
    secret: SECRET,
    store,
    readTargetBox: mail.readTargetBox ?? NO_TARGET_BOX,
    readRouter: mail.readRouter ?? NO_ROUTER,
    readFrontBox: mail.readFrontBox ?? NO_FRONT_BOX,
  });

/** What the client signs every reply with. */
const signed = (line: string, company = TERMS.client.company): string =>
  [line, '', `-- ${company}`, ''].join('\n');

const fromClient = (line: string): ContractMail => ({
  sender: `${CLIENT}@emailit.io`,
  subject: `Contract: ${TERMS.targetCompany}`,
  body: signed(line),
});

const NO_CONTRACT: ContractMail = {
  sender: `${CLIENT}@emailit.io`,
  subject: 'No contract',
  body: signed('We have no contract with you.'),
};

const paidLine = (wallet: string) =>
  `Key received. §${TERMS.pay.toLocaleString('en-US')} sent to ${wallet}. Pleasure doing business.`;
const NO_WALLET_LINE =
  'Key received. You sent no wallet, so there is nothing to pay. No wallet, no money.';
const NO_KEY_LINE = 'No key, no money. Send the key.';
const WRONG_KEY_LINE = 'That key opens nothing of ours.';
const CLOSED_LINE = 'That job is already closed.';

describe('a mail with the right key', () => {
  it('completes the job, paying the wallet the quoted pay, with the client saying so', async () => {
    const { store, completes, replies } = clientStore();

    expect(await mailTo(store)).toBe('replied');
    expect(completes).toEqual([
      { number: JOB, wallet: WALLET, pay: TERMS.pay, reply: fromClient(paidLine(WALLET)) },
    ]);
    expect(replies).toEqual([]);
  });

  it('opens the contracts of the login that sent it', async () => {
    const { store, opens } = clientStore();

    await mailTo(store);

    expect(opens).toEqual([LOGIN]);
  });

  it('completes the job and pays nothing when the mail holds no wallet', async () => {
    const { store, completes } = clientStore();

    await mailTo(store, { body: `here you go: ${KEY}\n` });

    expect(completes).toEqual([
      { number: JOB, wallet: null, pay: TERMS.pay, reply: fromClient(NO_WALLET_LINE) },
    ]);
  });

  it('finds the key and the wallet in the subject or the body, in either case', async () => {
    const { store, completes } = clientStore();

    await mailTo(store, {
      subject: `key ${KEY.toLowerCase()}`,
      body: `pay me at ${WALLET.toUpperCase()} please`,
    });

    expect(completes).toEqual([
      { number: JOB, wallet: WALLET, pay: TERMS.pay, reply: fromClient(paidLine(WALLET)) },
    ]);
  });

  it('reads past a quote, wherever the key is typed', async () => {
    const { store, completes } = clientStore();
    const quoted = `> Somewhere on it is the key. It looks like this:\n>\n>   ACCESS-XXXX-XXXX-XXXX\n`;

    await mailTo(store, { body: `${quoted}\n${KEY} ${WALLET}\n` });

    expect(completes.map(({ number, wallet }) => ({ number, wallet }))).toEqual([
      { number: JOB, wallet: WALLET },
    ]);
  });

  it('reads no wallet from a quoted line', async () => {
    const { store, completes } = clientStore();

    await mailTo(store, { body: `${KEY}\n> ${WALLET}\n` });

    expect(completes.map(({ wallet }) => wallet)).toEqual([null]);
  });

  it('pays the first wallet named when the mail names several', async () => {
    const other = `jsc${'f'.repeat(40)}`;
    const { store, completes } = clientStore();

    await mailTo(store, { subject: `to ${other}`, body: `${KEY} ${WALLET}\n` });

    expect(completes.map(({ wallet }) => wallet)).toEqual([other]);
  });

  it('says the job is already closed when the store finds it completed', async () => {
    const { store, replies } = clientStore({ completeWord: 'already_done' });

    expect(await mailTo(store)).toBe('replied');
    expect(replies).toEqual([fromClient(CLOSED_LINE)]);
  });

  it('says there is no contract when the store finds the job no longer held', async () => {
    const { store, replies } = clientStore({ completeWord: 'no_contract' });

    expect(await mailTo(store)).toBe('replied');
    expect(replies).toEqual([NO_CONTRACT]);
  });
});

describe('a mail without the right key', () => {
  it('asks for the key when the mail holds none', async () => {
    const { store, completes, replies } = clientStore();

    expect(await mailTo(store, { subject: 'done', body: `pay me at ${WALLET}\n` })).toBe('replied');
    expect(replies).toEqual([fromClient(NO_KEY_LINE)]);
    expect(completes).toEqual([]);
  });

  it('asks for the key when the only key is in a quote of the briefing', async () => {
    const { store, replies } = clientStore();

    await mailTo(store, { body: `done\n\n>   ACCESS-XXXX-XXXX-XXXX\n` });

    expect(replies).toEqual([fromClient(NO_KEY_LINE)]);
  });

  it('refuses a wrong key', async () => {
    const { store, completes, replies } = clientStore();

    await mailTo(store, { body: `ACCESS-0000-0000-0000 ${WALLET}\n` });

    expect(replies).toEqual([fromClient(WRONG_KEY_LINE)]);
    expect(completes).toEqual([]);
  });

  it('reads only the first key, the subject before the body', async () => {
    const { store, replies } = clientStore();

    await mailTo(store, { subject: 'ACCESS-0000-0000-0000', body: `${KEY} ${WALLET}\n` });

    expect(replies).toEqual([fromClient(WRONG_KEY_LINE)]);
  });

  it.each([
    ['eleven symbols', `${KEY.slice(0, -1)} ${WALLET}`],
    ['a letter the key never uses', `${KEY.slice(0, -1)}I ${WALLET}`],
    ['thirteen symbols', `${KEY}0 ${WALLET}`],
  ])('takes %s for no key at all', async (_label, body) => {
    const { store, replies } = clientStore();

    await mailTo(store, { body });

    expect(replies).toEqual([fromClient(NO_KEY_LINE)]);
  });

  it.each([
    ['39 hex digits', WALLET.slice(0, -1)],
    ['41 hex digits', `${WALLET}0`],
  ])('takes a wallet of %s for no wallet at all', async (_label, wallet) => {
    const { store, completes } = clientStore();

    await mailTo(store, { body: `${KEY} ${wallet}\n` });

    expect(completes.map(({ wallet: paid }) => paid)).toEqual([null]);
  });
});

describe('a mail about a contract the sender does not hold', () => {
  it('says there is no contract when the sender holds none at all', async () => {
    const { store, completes, replies } = clientStore({ jobs: [] });

    expect(await mailTo(store)).toBe('replied');
    expect(replies).toEqual([NO_CONTRACT]);
    expect(completes).toEqual([]);
  });

  it("says there is no contract when the sender's job is for another client", async () => {
    const { store, replies } = clientStore({ jobs: [{ number: ELSEWHERE, state: 'accepted' }] });

    await mailTo(store, { body: `${missionKey(ELSEWHERE, SECRET)} ${WALLET}\n` });

    expect(replies).toEqual([NO_CONTRACT]);
  });

  it('says the job is already closed for the key of a job completed with this client', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: JOB, state: 'completed' }],
    });

    await mailTo(store);

    expect(replies).toEqual([fromClient(CLOSED_LINE)]);
    expect(completes).toEqual([]);
  });

  it('says the job is already closed for an earlier job while another is held', async () => {
    const earlier = missionTerms(EARLIER);
    const { store, replies } = clientStore({
      jobs: [
        { number: JOB, state: 'accepted' },
        { number: EARLIER, state: 'completed' },
      ],
    });

    await mailTo(store, { body: `${missionKey(EARLIER, SECRET)} ${WALLET}\n` });

    expect(replies).toEqual([
      {
        sender: `${CLIENT}@emailit.io`,
        subject: `Contract: ${earlier.targetCompany}`,
        body: signed(CLOSED_LINE),
      },
    ]);
  });

  it('says there is no contract for a completed job mailed without its key', async () => {
    const { store, replies } = clientStore({ jobs: [{ number: JOB, state: 'completed' }] });

    await mailTo(store, { body: 'hello again\n' });

    expect(replies).toEqual([NO_CONTRACT]);
  });

  it('answers as the client the mail was sent to', async () => {
    const otherClient = missionTerms(ELSEWHERE).client;
    const { store, replies } = clientStore();

    await mailTo(store, { to: otherClient });

    expect(replies).toEqual([
      {
        sender: `${otherClient.handle}@emailit.io`,
        subject: 'No contract',
        body: signed('We have no contract with you.', otherClient.company),
      },
    ]);
  });
});

describe('a mail the client never reads', () => {
  it.each(['login_failed', 'throttled', 'send_limited'])(
    'passes on %s and mails nothing',
    async (outcome) => {
      const { store, completes, replies } = clientStore({ opened: { outcome } });

      expect(await mailTo(store)).toBe(outcome);
      expect(completes).toEqual([]);
      expect(replies).toEqual([]);
    },
  );

  it.each([
    ['a store it could not ask', { openError: 'down' }],
    ['an answer it cannot read', { opened: { outcome: 'opened', jobs: [{ number: JOB }] } }],
    ['a job in a state it was never told of', { jobs: [{ number: JOB, state: 'abandoned' }] }],
  ])('answers nothing for %s', async (_label, over) => {
    const { store, completes, replies } = clientStore(over as Parameters<typeof clientStore>[0]);

    expect(await mailTo(store)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it.each([
    ['a completion it could not ask for', { completeError: 'down' }],
    ['a completion word nobody taught it', { completeWord: 'maybe' }],
  ])('answers nothing for %s', async (_label, over) => {
    const { store, replies } = clientStore(over);

    expect(await mailTo(store)).toBeNull();
    expect(replies).toEqual([]);
  });

  it.each([
    ['a reply it could not send', { replyError: 'down' }],
    ['a reply word nobody taught it', { replyWord: 'maybe' }],
  ])('answers nothing for %s', async (_label, over) => {
    const { store } = clientStore({ jobs: [], ...over });

    expect(await mailTo(store)).toBeNull();
  });
});

describe('a mail on a tamper job', () => {
  /** A tamper job whose records box needs no secret to lay, and its client. */
  const TAMPER_JOB = ALL_HOST_NUMBERS.find((missionNumber) => {
    const shape = missionShape(missionNumber);
    return (
      shape.kind === 'tamper' &&
      shape.keyBox.route === 'hydra' &&
      shape.storage === 'database' &&
      missionAction(missionNumber) === 'change'
    );
  })!;
  const TAMPER_TERMS = missionTerms(TAMPER_JOB);
  const { target } = missionRecords(TAMPER_JOB);
  if (target.action !== 'change') throw new Error('the job asks for no change');

  /** The records box as the server lays it, after the application account ran `lines`. */
  const recordsBoxAfter = (...lines: readonly string[]): Directory => {
    const laid = withFiles(
      buildMissionKeyBoxFs(TAMPER_JOB),
      missionFiles(
        { missionNumber: TAMPER_JOB, role: 'key' },
        { keySecret: undefined, rawSecrets: undefined },
      ).map(({ path, content, perms }) => [path, file(content, perms)] as const),
    );
    const database = lines.reduce(
      (current, line) =>
        runStatement({
          database: current,
          line,
          username: 'app',
          userType: 'user',
          sourceIp: '198.51.100.7',
        }).database ?? current,
      databaseIn(laid)!,
    );
    return withFiles(laid, [[DATADIR_PATH, file(JSON.stringify(database), DATADIR_FILE)]]);
  };

  const CHANGED = `UPDATE ${target.table} SET ${target.column} = '${target.to}' WHERE ${Object.entries(
    target.namedBy,
  )
    .map(([column, value]) => `${column} = '${value}'`)
    .join(' AND ')}`;

  /** A box read answering with `read`, keeping every number it was asked for. */
  const recordsBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  const fromTamperClient = (line: string): ContractMail => ({
    sender: `${TAMPER_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${TAMPER_TERMS.targetCompany}`,
    body: signed(line, TAMPER_TERMS.client.company),
  });

  const mailOnTamperJob = (
    store: ClientMailStore,
    readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>,
    body = `it is done\n${WALLET}\n`,
  ) => mailTo(store, { to: TAMPER_TERMS.client, body, readTargetBox });

  const RIGHT_LINE = `The records look right. §${TAMPER_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`;
  const WRONG_LINE = "Our records don't look right. No change, no money.";

  it('reads the records box of the job held, and pays once they read right', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: TAMPER_JOB, state: 'accepted' }],
    });
    const box = recordsBox({ kind: 'up', fs: recordsBoxAfter(CHANGED) });

    expect(await mailOnTamperJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([TAMPER_JOB]);
    expect(completes).toEqual([
      {
        number: TAMPER_JOB,
        wallet: WALLET,
        pay: TAMPER_TERMS.pay,
        reply: fromTamperClient(RIGHT_LINE),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = clientStore({ jobs: [{ number: TAMPER_JOB, state: 'accepted' }] });
    const box = recordsBox({ kind: 'up', fs: recordsBoxAfter(CHANGED) });

    expect(await mailOnTamperJob(store, box.readTargetBox, 'done.\n')).toBe('replied');
    expect(completes).toEqual([
      {
        number: TAMPER_JOB,
        wallet: null,
        pay: TAMPER_TERMS.pay,
        reply: fromTamperClient(
          'The records look right. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it.each([
    [
      'the records still hold the old grade',
      (): TargetBoxRead => ({ kind: 'up', fs: recordsBoxAfter() }),
    ],
    [
      'every row was given the new grade',
      (): TargetBoxRead => ({
        kind: 'up',
        fs: recordsBoxAfter(`UPDATE grades SET grade = '${target.to}'`),
      }),
    ],
    ['the box is not up', (): TargetBoxRead => ({ kind: 'absent' })],
  ])('says the records do not look right when %s, and keeps the job open', async (_why, read) => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: TAMPER_JOB, state: 'accepted' }],
    });

    expect(await mailOnTamperJob(store, recordsBox(read()).readTargetBox)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromTamperClient(WRONG_LINE)]);
  });

  it('answers nothing when the box could not be read', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: TAMPER_JOB, state: 'accepted' }],
    });

    expect(await mailOnTamperJob(store, recordsBox({ kind: 'error' }).readTargetBox)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the box', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: TAMPER_JOB, state: 'completed' }],
    });
    const box = recordsBox({ kind: 'up', fs: recordsBoxAfter(CHANGED) });

    expect(await mailOnTamperJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromTamperClient(CLOSED_LINE)]);
  });

  it('says the job is already closed when the store finds it completed in between', async () => {
    const { store, replies } = clientStore({
      jobs: [{ number: TAMPER_JOB, state: 'accepted' }],
      completeWord: 'already_done',
    });
    const box = recordsBox({ kind: 'up', fs: recordsBoxAfter(CHANGED) });

    expect(await mailOnTamperJob(store, box.readTargetBox)).toBe('replied');
    expect(replies).toEqual([fromTamperClient(CLOSED_LINE)]);
  });

  it('says there is no contract when the tamper job is for another client', async () => {
    const otherClient = [JOB, ELSEWHERE]
      .map((missionNumber) => missionTerms(missionNumber).client)
      .find(({ handle }) => handle !== TAMPER_TERMS.client.handle)!;
    const { store, replies } = clientStore({ jobs: [{ number: TAMPER_JOB, state: 'accepted' }] });
    const box = recordsBox({ kind: 'up', fs: recordsBoxAfter(CHANGED) });

    expect(await mailTo(store, { to: otherClient, readTargetBox: box.readTargetBox })).toBe(
      'replied',
    );
    expect(box.reads).toEqual([]);
    expect(replies).toEqual([
      {
        sender: `${otherClient.handle}@emailit.io`,
        subject: 'No contract',
        body: signed('We have no contract with you.', otherClient.company),
      },
    ]);
  });
});

describe('a mail on a sabotage job', () => {
  const SABOTAGE_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'sabotage',
  )!;
  const SABOTAGE_TERMS = missionTerms(SABOTAGE_JOB);

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** The target as it was laid: up, every boot file in place. */
  const STILL_UP: TargetBoxRead = { kind: 'up', fs: buildMissionKeyBoxFs(SABOTAGE_JOB) };
  const DOWN: TargetBoxRead = { kind: 'absent' };

  const fromSabotageClient = (line: string): ContractMail => ({
    sender: `${SABOTAGE_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${SABOTAGE_TERMS.targetCompany}`,
    body: signed(line, SABOTAGE_TERMS.client.company),
  });

  const mailOnSabotageJob = (
    store: ClientMailStore,
    readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>,
    body = `it is done\n${WALLET}\n`,
  ) => mailTo(store, { to: SABOTAGE_TERMS.client, body, readTargetBox });

  it('reads the target of the job held, and pays once it no longer comes up', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: SABOTAGE_JOB, state: 'accepted' }],
    });
    const box = targetBox(DOWN);

    expect(await mailOnSabotageJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([SABOTAGE_JOB]);
    expect(completes).toEqual([
      {
        number: SABOTAGE_JOB,
        wallet: WALLET,
        pay: SABOTAGE_TERMS.pay,
        reply: fromSabotageClient(
          `The machine is down. §${SABOTAGE_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = clientStore({
      jobs: [{ number: SABOTAGE_JOB, state: 'accepted' }],
    });

    expect(await mailOnSabotageJob(store, targetBox(DOWN).readTargetBox, 'done.\n')).toBe(
      'replied',
    );
    expect(completes).toEqual([
      {
        number: SABOTAGE_JOB,
        wallet: null,
        pay: SABOTAGE_TERMS.pay,
        reply: fromSabotageClient(
          'The machine is down. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it('says the machine is still up while it comes up, and keeps the job open', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: SABOTAGE_JOB, state: 'accepted' }],
    });

    expect(await mailOnSabotageJob(store, targetBox(STILL_UP).readTargetBox)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([
      fromSabotageClient('Their machine is still up. No outage, no money.'),
    ]);
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: SABOTAGE_JOB, state: 'accepted' }],
    });

    expect(await mailOnSabotageJob(store, targetBox({ kind: 'error' }).readTargetBox)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: SABOTAGE_JOB, state: 'completed' }],
    });
    const box = targetBox(DOWN);

    expect(await mailOnSabotageJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromSabotageClient(CLOSED_LINE)]);
  });
});

describe('a mail on a backdoor job', () => {
  const BACKDOOR_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'backdoor',
  )!;
  const BACKDOOR_TERMS = missionTerms(BACKDOOR_JOB);
  const { port: PORT } = backdoorJob(BACKDOOR_JOB);
  /** A classic port the client did not name. */
  const OTHER_PORT = PORT === 4444 ? 5555 : 4444;

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** The target up, with a root's listener on each of `ports`. */
  const listeningOn = (...ports: readonly number[]): TargetBoxRead => ({
    kind: 'up',
    fs: withFiles(
      buildMissionKeyBoxFs(BACKDOOR_JOB),
      ports.map((port) => [
        listenerPidfilePath(port),
        file(formatListenerContent({ port, user: 'root', userType: 'root' }), PIDFILE_PERMISSIONS),
      ]),
    ),
  });

  const fromBackdoorClient = (line: string): ContractMail => ({
    sender: `${BACKDOOR_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${BACKDOOR_TERMS.targetCompany}`,
    body: signed(line, BACKDOOR_TERMS.client.company),
  });

  const NOTHING_LISTENING = `Nothing is listening on port ${PORT}. No listener, no money.`;

  const mailOnBackdoorJob = (
    store: ClientMailStore,
    readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>,
    body = `it is listening\n${WALLET}\n`,
  ) => mailTo(store, { to: BACKDOOR_TERMS.client, body, readTargetBox });

  it('reads the target of the job held, and pays once a listener holds the port named', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: BACKDOOR_JOB, state: 'accepted' }],
    });
    const box = targetBox(listeningOn(PORT));

    expect(await mailOnBackdoorJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([BACKDOOR_JOB]);
    expect(completes).toEqual([
      {
        number: BACKDOOR_JOB,
        wallet: WALLET,
        pay: BACKDOOR_TERMS.pay,
        reply: fromBackdoorClient(
          `We're in. §${BACKDOOR_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('pays whatever else the box listens on beside the port named', async () => {
    const { store, completes } = clientStore({
      jobs: [{ number: BACKDOOR_JOB, state: 'accepted' }],
    });

    await mailOnBackdoorJob(store, targetBox(listeningOn(OTHER_PORT, PORT)).readTargetBox);

    expect(completes.map(({ number }) => number)).toEqual([BACKDOOR_JOB]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = clientStore({
      jobs: [{ number: BACKDOOR_JOB, state: 'accepted' }],
    });

    expect(
      await mailOnBackdoorJob(store, targetBox(listeningOn(PORT)).readTargetBox, 'done.\n'),
    ).toBe('replied');
    expect(completes).toEqual([
      {
        number: BACKDOOR_JOB,
        wallet: null,
        pay: BACKDOOR_TERMS.pay,
        reply: fromBackdoorClient(
          "We're in. You sent no wallet, so there is nothing to pay. No wallet, no money.",
        ),
      },
    ]);
  });

  it.each([
    ['nothing listens on the box', listeningOn()],
    ['the listener holds another port', listeningOn(OTHER_PORT)],
    ['the target no longer boots', { kind: 'absent' } as const],
  ])(
    'says nothing is listening on the port named when %s, and keeps the job open',
    async (_case, read) => {
      const { store, completes, replies } = clientStore({
        jobs: [{ number: BACKDOOR_JOB, state: 'accepted' }],
      });

      expect(await mailOnBackdoorJob(store, targetBox(read).readTargetBox)).toBe('replied');
      expect(completes).toEqual([]);
      expect(replies).toEqual([fromBackdoorClient(NOTHING_LISTENING)]);
    },
  );

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: BACKDOOR_JOB, state: 'accepted' }],
    });

    expect(await mailOnBackdoorJob(store, targetBox({ kind: 'error' }).readTargetBox)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: BACKDOOR_JOB, state: 'completed' }],
    });
    const box = targetBox(listeningOn());

    expect(await mailOnBackdoorJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromBackdoorClient(CLOSED_LINE)]);
  });
});

describe('a mail on a credential job', () => {
  const CREDENTIAL_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'credential',
  )!;
  const CREDENTIAL_TERMS = missionTerms(CREDENTIAL_JOB);
  const { noun: MACHINE } = credentialRole(CREDENTIAL_JOB);
  const PASSWORD = 'Tr0ub4dor-3';

  /** The target up, its root's password set to `password`. */
  const rootAnswersTo = (password: string): TargetBoxRead => {
    const fs = buildMissionKeyBoxFs(CREDENTIAL_JOB);
    return {
      kind: 'up',
      fs: withFiles(fs, [
        [PASSWD_PATH, file(withAccountHash(fs, 'root', md5(password)), PASSWD_FILE)],
      ]),
    };
  };

  /** The target up, with no account called root left on it. */
  const NO_ROOT_ACCOUNT: TargetBoxRead = {
    kind: 'up',
    fs: withFiles(buildMissionKeyBoxFs(CREDENTIAL_JOB), [
      [PASSWD_PATH, file('guest:x:1000:1000:guest:/home/guest:/bin/bash\n', PASSWD_FILE)],
    ]),
  };

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  const fromCredentialClient = (line: string): ContractMail => ({
    sender: `${CREDENTIAL_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${CREDENTIAL_TERMS.targetCompany}`,
    body: signed(line, CREDENTIAL_TERMS.client.company),
  });

  const REFUSED = `That login doesn't open their ${MACHINE}. No login, no money.`;

  const acceptedStore = () =>
    clientStore({ jobs: [{ number: CREDENTIAL_JOB, state: 'accepted' }] });

  const mailOnCredentialJob = (
    store: ClientMailStore,
    read: TargetBoxRead,
    mail: { readonly body: string; readonly subject?: string },
  ) =>
    mailTo(store, {
      to: CREDENTIAL_TERMS.client,
      readTargetBox: targetBox(read).readTargetBox,
      ...mail,
    });

  it("reads the target of the job held, and pays once the password opens its root's login", async () => {
    const { store, completes, replies } = acceptedStore();
    const box = targetBox(rootAnswersTo(PASSWORD));

    expect(
      await mailTo(store, {
        to: CREDENTIAL_TERMS.client,
        body: `password: ${PASSWORD}\n${WALLET}\n`,
        readTargetBox: box.readTargetBox,
      }),
    ).toBe('replied');
    expect(box.reads).toEqual([CREDENTIAL_JOB]);
    expect(completes).toEqual([
      {
        number: CREDENTIAL_JOB,
        wallet: WALLET,
        pay: CREDENTIAL_TERMS.pay,
        reply: fromCredentialClient(
          `That login works. §${CREDENTIAL_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), { body: `password: ${PASSWORD}\n` });

    expect(completes).toEqual([
      {
        number: CREDENTIAL_JOB,
        wallet: null,
        pay: CREDENTIAL_TERMS.pay,
        reply: fromCredentialClient(
          'That login works. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it.each([
    ['indented as the briefing shows it', `  password: ${PASSWORD}`],
    ['indented with a tab', `\tpassword: ${PASSWORD}`],
    ['with a capital label', `Password: ${PASSWORD}`],
    ['with the label in capitals', `PASSWORD: ${PASSWORD}`],
    ['with no space after the label', `password:${PASSWORD}`],
    ['with spaces around the password', `password:    ${PASSWORD}   `],
    ['ending in a carriage return', `password: ${PASSWORD}\r`],
  ])('reads the password line %s', async (_case, line) => {
    const { store, completes } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), { body: `${line}\n${WALLET}\n` });

    expect(completes.map(({ number }) => number)).toEqual([CREDENTIAL_JOB]);
  });

  it('reads a password line below the briefing it quotes', async () => {
    const { store, completes } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), {
      body: `> password: <the password>\npassword: ${PASSWORD}\n${WALLET}\n`,
    });

    expect(completes.map(({ number }) => number)).toEqual([CREDENTIAL_JOB]);
  });

  it('counts the first password line and no other, so a right word above a wrong one pays', async () => {
    const { store, completes } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), {
      body: `password: ${PASSWORD}\npassword: wrong\n${WALLET}\n`,
    });

    expect(completes.map(({ number }) => number)).toEqual([CREDENTIAL_JOB]);
  });

  it('reads past a line that only mentions a password, to the line that starts with the label', async () => {
    const { store, completes } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), {
      body: `my password: is below\npassword: ${PASSWORD}\n${WALLET}\n`,
    });

    expect(completes.map(({ number }) => number)).toEqual([CREDENTIAL_JOB]);
  });

  // A mail with no line tests no word at all, not the word a missing value would print as.
  it('refuses a mail with no password line, even with a root whose password is "null"', async () => {
    const { store, completes, replies } = acceptedStore();

    await mailOnCredentialJob(store, rootAnswersTo('null'), { body: `here it is\n${WALLET}\n` });

    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCredentialClient(REFUSED)]);
  });

  it.each([
    ['carries no password line', { body: `here it is\n${WALLET}\n` }],
    ['carries a wrong password', { body: `password: wrong\n${WALLET}\n` }],
    ['changes the case of the password', { body: `password: ${PASSWORD.toUpperCase()}\n` }],
    ['tries a second word below a wrong one', { body: `password: wrong\npassword: ${PASSWORD}\n` }],
    ['gives the password only in a quote', { body: `> password: ${PASSWORD}\n${WALLET}\n` }],
    ['gives the password in the middle of a line', { body: `my password: ${PASSWORD}\n` }],
    ['gives the password only in its subject', { subject: `password: ${PASSWORD}`, body: 'hi\n' }],
  ])('refuses a mail that %s, and keeps the job open', async (_case, mail) => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnCredentialJob(store, rootAnswersTo(PASSWORD), mail)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCredentialClient(REFUSED)]);
  });

  it.each(['password:', 'password:   '])(
    'refuses the empty password line %j, even with a root whose password is empty',
    async (line) => {
      const { store, completes, replies } = acceptedStore();

      await mailOnCredentialJob(store, rootAnswersTo(''), { body: `${line}\n${WALLET}\n` });

      expect(completes).toEqual([]);
      expect(replies).toEqual([fromCredentialClient(REFUSED)]);
    },
  );

  it('tests the password root has now, so a password changed since is refused and the new one pays', async () => {
    const before = acceptedStore();
    await mailOnCredentialJob(before.store, rootAnswersTo('changed-since'), {
      body: `password: ${PASSWORD}\n`,
    });
    expect(before.completes).toEqual([]);

    const after = acceptedStore();
    await mailOnCredentialJob(after.store, rootAnswersTo('changed-since'), {
      body: 'password: changed-since\n',
    });
    expect(after.completes.map(({ number }) => number)).toEqual([CREDENTIAL_JOB]);
  });

  it.each([
    ['the target no longer boots', { kind: 'absent' } as const],
    ['the target has no root account', NO_ROOT_ACCOUNT],
  ])('refuses the right password when %s', async (_case, read) => {
    const { store, completes, replies } = acceptedStore();

    expect(
      await mailOnCredentialJob(store, read, { body: `password: ${PASSWORD}\n${WALLET}\n` }),
    ).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCredentialClient(REFUSED)]);
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = acceptedStore();

    expect(
      await mailOnCredentialJob(store, { kind: 'error' }, { body: `password: ${PASSWORD}\n` }),
    ).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: CREDENTIAL_JOB, state: 'completed' }],
    });
    const box = targetBox(rootAnswersTo(PASSWORD));

    await mailTo(store, {
      to: CREDENTIAL_TERMS.client,
      body: `password: ${PASSWORD}\n${WALLET}\n`,
      readTargetBox: box.readTargetBox,
    });

    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCredentialClient(CLOSED_LINE)]);
  });
});

describe('a mail on a portforward job', () => {
  const PORTFORWARD_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'portforward',
  )!;
  const PORTFORWARD_TERMS = missionTerms(PORTFORWARD_JOB);
  const { machine: MACHINE, publicPort: PUBLIC_PORT } = portforwardJob(PORTFORWARD_JOB);
  const SUBNET = lanSubnetPrefix(missionEssid(PORTFORWARD_JOB));
  const TARGET_OCTET = missionShape(PORTFORWARD_JOB).keyBox.octet;
  const TARGET_IP = `${SUBNET}.${TARGET_OCTET}`;

  /** A router read answering with `read`, keeping every number it was asked for. */
  const router = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readRouter: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** The contract's router up, its decoys forwarded as it generates plus each of `forwards`. */
  const forwarding = (
    ...forwards: readonly (readonly [
      publicPort: number,
      internalIp: string,
      internalPort: number,
    ])[]
  ): TargetBoxRead => {
    const generated = buildApGatewayBaseFs(missionEssid(PORTFORWARD_JOB));
    const rules = forwards.reduce(
      (table, [publicPort, internalIp, internalPort]) =>
        withForward(table, publicPort, { internalIp, internalPort }),
      readRulesV4(generated),
    );
    return {
      kind: 'up',
      fs: withFiles(generated, [[RULES_V4_PATH, file(rules, RULES_V4_PERMISSIONS)]]),
    };
  };

  const fromPortforwardClient = (line: string): ContractMail => ({
    sender: `${PORTFORWARD_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${PORTFORWARD_TERMS.targetCompany}`,
    body: signed(line, PORTFORWARD_TERMS.client.company),
  });

  const NO_WAY_IN = `Port ${PUBLIC_PORT} doesn't reach their ${MACHINE.noun}. No way in, no money.`;

  const mailOnPortforwardJob = (
    store: ClientMailStore,
    readRouter: (missionNumber: number) => Promise<TargetBoxRead>,
    body = `it is open\n${WALLET}\n`,
  ) => mailTo(store, { to: PORTFORWARD_TERMS.client, body, readRouter });

  it('reads the router of the job held, and pays once the port named reaches the machine', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: PORTFORWARD_JOB, state: 'accepted' }],
    });
    const read = router(forwarding([PUBLIC_PORT, TARGET_IP, MACHINE.insidePort]));

    expect(await mailOnPortforwardJob(store, read.readRouter)).toBe('replied');
    expect(read.reads).toEqual([PORTFORWARD_JOB]);
    expect(completes).toEqual([
      {
        number: PORTFORWARD_JOB,
        wallet: WALLET,
        pay: PORTFORWARD_TERMS.pay,
        reply: fromPortforwardClient(
          `We're through. §${PORTFORWARD_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = clientStore({
      jobs: [{ number: PORTFORWARD_JOB, state: 'accepted' }],
    });
    const read = router(forwarding([PUBLIC_PORT, TARGET_IP, MACHINE.insidePort]));

    expect(await mailOnPortforwardJob(store, read.readRouter, 'done.\n')).toBe('replied');
    expect(completes).toEqual([
      {
        number: PORTFORWARD_JOB,
        wallet: null,
        pay: PORTFORWARD_TERMS.pay,
        reply: fromPortforwardClient(
          "We're through. You sent no wallet, so there is nothing to pay. No wallet, no money.",
        ),
      },
    ]);
  });

  /** A box on the LAN that is not the target. */
  const OTHER_IP = `${SUBNET}.${TARGET_OCTET === 2 ? 3 : 2}`;

  it.each([
    ['the router forwards nothing on the port named', forwarding()],
    [
      'the port named reaches another machine',
      forwarding([PUBLIC_PORT, OTHER_IP, MACHINE.insidePort]),
    ],
    [
      'the port named reaches the machine on another port',
      forwarding([PUBLIC_PORT, TARGET_IP, MACHINE.insidePort + 1]),
    ],
    ['the port named reaches the router itself', forwarding([PUBLIC_PORT, `${SUBNET}.1`, 22])],
    [
      'another port reaches the machine',
      forwarding([PUBLIC_PORT + 1, TARGET_IP, MACHINE.insidePort]),
    ],
    ['the router no longer boots', { kind: 'absent' } as const],
  ])(
    "says the port named doesn't reach the machine when %s, and keeps the job open",
    async (_case, read) => {
      const { store, completes, replies } = clientStore({
        jobs: [{ number: PORTFORWARD_JOB, state: 'accepted' }],
      });

      expect(await mailOnPortforwardJob(store, router(read).readRouter)).toBe('replied');
      expect(completes).toEqual([]);
      expect(replies).toEqual([fromPortforwardClient(NO_WAY_IN)]);
    },
  );

  it('answers nothing when the router could not be read', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: PORTFORWARD_JOB, state: 'accepted' }],
    });

    expect(await mailOnPortforwardJob(store, router({ kind: 'error' }).readRouter)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the router', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: PORTFORWARD_JOB, state: 'completed' }],
    });
    const read = router(forwarding());

    expect(await mailOnPortforwardJob(store, read.readRouter)).toBe('replied');
    expect(read.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromPortforwardClient(CLOSED_LINE)]);
  });

  it('never reads the target, only the router', async () => {
    const { store } = clientStore({ jobs: [{ number: PORTFORWARD_JOB, state: 'accepted' }] });

    await mailTo(store, {
      to: PORTFORWARD_TERMS.client,
      readRouter: router(forwarding([PUBLIC_PORT, TARGET_IP, MACHINE.insidePort])).readRouter,
    });
  });
});

describe('a mail on a destroy job', () => {
  const DESTROY_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'destroy',
  )!;
  const DESTROY_TERMS = missionTerms(DESTROY_JOB);
  const PATH = missionFilePath(DESTROY_JOB);
  const THEIRS = missionFileContent(DESTROY_JOB, SECRET);

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** The target up, holding `content` at the file's path, or nothing there. */
  const holding = (content: string | null): TargetBoxRead => ({
    kind: 'up',
    fs:
      content === null
        ? buildMissionKeyBoxFs(DESTROY_JOB)
        : withFiles(buildMissionKeyBoxFs(DESTROY_JOB), [[PATH, file(content, ROOT_FILE)]]),
  });

  const fromDestroyClient = (line: string): ContractMail => ({
    sender: `${DESTROY_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${DESTROY_TERMS.targetCompany}`,
    body: signed(line, DESTROY_TERMS.client.company),
  });

  const NOT_GONE = "We can't confirm that file is gone. Not gone, no money.";

  const acceptedStore = () => clientStore({ jobs: [{ number: DESTROY_JOB, state: 'accepted' }] });

  const mailOnDestroyJob = (
    store: ClientMailStore,
    read: TargetBoxRead,
    body = `it is gone\n${WALLET}\n`,
  ) =>
    mailTo(store, { to: DESTROY_TERMS.client, body, readTargetBox: targetBox(read).readTargetBox });

  it('reads the target of the job held, and pays once the file is gone from its path', async () => {
    const { store, completes, replies } = acceptedStore();
    const box = targetBox(holding(null));

    expect(
      await mailTo(store, {
        to: DESTROY_TERMS.client,
        body: `it is gone\n${WALLET}\n`,
        readTargetBox: box.readTargetBox,
      }),
    ).toBe('replied');
    expect(box.reads).toEqual([DESTROY_JOB]);
    expect(completes).toEqual([
      {
        number: DESTROY_JOB,
        wallet: WALLET,
        pay: DESTROY_TERMS.pay,
        reply: fromDestroyClient(
          `It's gone. §${DESTROY_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = acceptedStore();

    await mailOnDestroyJob(store, holding(null), 'it is gone\n');

    expect(completes).toEqual([
      {
        number: DESTROY_JOB,
        wallet: null,
        pay: DESTROY_TERMS.pay,
        reply: fromDestroyClient(
          "It's gone. You sent no wallet, so there is nothing to pay. No wallet, no money.",
        ),
      },
    ]);
  });

  it.each([
    ['overwritten with other bytes', holding('nothing to see here\n')],
    ['emptied', holding('')],
    ['changed by one character at the end', holding(`${THEIRS.slice(0, -1)}#`)],
    ['longer by a newline', holding(`${THEIRS}\n`)],
    [
      'moved to another path',
      {
        kind: 'up',
        fs: withFiles(buildMissionKeyBoxFs(DESTROY_JOB), [
          [`${PATH}.bak`, file(THEIRS, ROOT_FILE)],
        ]),
      } as const,
    ],
  ])('pays for a file %s', async (_case, read) => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnDestroyJob(store, read)).toBe('replied');
    expect(completes.map(({ number }) => number)).toEqual([DESTROY_JOB]);
    expect(replies).toEqual([]);
  });

  it.each([
    ['the file is untouched', holding(THEIRS)],
    [
      'the same bytes were put back with other permissions',
      {
        kind: 'up',
        fs: withFiles(buildMissionKeyBoxFs(DESTROY_JOB), [[PATH, file(THEIRS, PASSWD_FILE)]]),
      } as const,
    ],
    ['the target no longer boots', { kind: 'absent' } as const],
  ])('cannot confirm the file is gone when %s, and keeps the job open', async (_case, read) => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnDestroyJob(store, read)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromDestroyClient(NOT_GONE)]);
  });

  // The client looks at the box, not the mail: the file mailed back proves nothing either way.
  it('ignores a copy of the file carried by the mail', async () => {
    const untouched = acceptedStore();
    await mailTo(untouched.store, {
      to: DESTROY_TERMS.client,
      body: `it is gone\n${WALLET}\n`,
      file: 'not their file',
      readTargetBox: targetBox(holding(THEIRS)).readTargetBox,
    });
    expect(untouched.completes).toEqual([]);

    const destroyed = acceptedStore();
    await mailTo(destroyed.store, {
      to: DESTROY_TERMS.client,
      body: `it is gone\n${WALLET}\n`,
      file: THEIRS,
      readTargetBox: targetBox(holding(null)).readTargetBox,
    });
    expect(destroyed.completes.map(({ number }) => number)).toEqual([DESTROY_JOB]);
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnDestroyJob(store, { kind: 'error' })).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: DESTROY_JOB, state: 'completed' }],
    });
    const box = targetBox(holding(null));

    await mailTo(store, {
      to: DESTROY_TERMS.client,
      body: `it is gone\n${WALLET}\n`,
      readTargetBox: box.readTargetBox,
    });

    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromDestroyClient(CLOSED_LINE)]);
  });
});

describe('a mail on a cleanup job', () => {
  const cleanupNumber = (twoHop: boolean): number =>
    ALL_HOST_NUMBERS.find(
      (missionNumber) =>
        missionKind(missionNumber) === 'cleanup' &&
        (missionShape(missionNumber).frontBox !== null) === twoHop,
    )!;
  const CLEANUP_JOB = cleanupNumber(false);
  const TWO_HOP_JOB = cleanupNumber(true);
  const CLEANUP_TERMS = missionTerms(CLEANUP_JOB);
  const { port: PORT } = cleanupJob(CLEANUP_JOB);
  const { implant: IMPLANT } = cleanupPlant(CLEANUP_JOB, SECRET);
  const PIDFILE = listenerPidfilePath(PORT);

  /** The target as the server lays it, less the paths `removed`, plus `extra`. */
  const laid = (
    missionNumber: number,
    {
      removed = [],
      extra = [],
    }: {
      readonly removed?: readonly string[];
      readonly extra?: readonly (readonly [string, string])[];
    } = {},
  ): TargetBoxRead => ({
    kind: 'up',
    fs: withFiles(buildMissionKeyBoxFs(missionNumber), [
      ...cleanupFiles(missionNumber, SECRET)
        .filter(({ path }) => !removed.includes(path))
        .map(({ path, content, perms }) => [path, file(content, perms)] as const),
      ...extra.map(([path, content]) => [path, file(content, ROOT_FILE)] as const),
    ]),
  });

  /** The job done: the listener killed and the implant removed. */
  const cleaned = (missionNumber: number): TargetBoxRead => {
    const { implant } = cleanupPlant(missionNumber, SECRET);
    const pidfile = listenerPidfilePath(cleanupJob(missionNumber).port);
    return laid(missionNumber, { removed: [implant.path, pidfile] });
  };

  /** A box read answering with `read`, keeping every number it was asked for. */
  const boxReader = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      read: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  const fromCleanupClient = (line: string, terms = CLEANUP_TERMS): ContractMail => ({
    sender: `${terms.client.handle}@emailit.io`,
    subject: `Contract: ${terms.targetCompany}`,
    body: signed(line, terms.client.company),
  });

  const STILL_ANSWERS = `Something still answers on port ${PORT}. Still there, no money.`;
  const STILL_ON_THE_MACHINE =
    'It has stopped, but it is still on the machine. Still there, no money.';
  const TOOK_IT_DOWN = 'You took our machine down. No money.';

  const acceptedStore = (number = CLEANUP_JOB) =>
    clientStore({ jobs: [{ number, state: 'accepted' }] });

  const mailOnCleanupJob = (
    store: ClientMailStore,
    read: TargetBoxRead,
    body = `all clean\n${WALLET}\n`,
  ) => mailTo(store, { to: CLEANUP_TERMS.client, body, readTargetBox: boxReader(read).read });

  it('reads the target of the job held, and pays once the listener and the implant are gone', async () => {
    const { store, completes, replies } = acceptedStore();
    const box = boxReader(cleaned(CLEANUP_JOB));

    expect(
      await mailTo(store, {
        to: CLEANUP_TERMS.client,
        body: `all clean\n${WALLET}\n`,
        readTargetBox: box.read,
      }),
    ).toBe('replied');
    expect(box.reads).toEqual([CLEANUP_JOB]);
    expect(completes).toEqual([
      {
        number: CLEANUP_JOB,
        wallet: WALLET,
        pay: CLEANUP_TERMS.pay,
        reply: fromCleanupClient(
          `It's gone. §${CLEANUP_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Thank you for the help.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = acceptedStore();

    await mailOnCleanupJob(store, cleaned(CLEANUP_JOB), 'all clean\n');

    expect(completes).toEqual([
      {
        number: CLEANUP_JOB,
        wallet: null,
        pay: CLEANUP_TERMS.pay,
        reply: fromCleanupClient(
          "It's gone. You sent no wallet, so there is nothing to pay. No wallet, no money.",
        ),
      },
    ]);
  });

  // The client only knows the port answers, so any listener there is a miss: the intruder's,
  // or one somebody started after it was killed.
  it.each([
    ['nothing has been touched', laid(CLEANUP_JOB)],
    [
      'the implant is gone but its listener still runs',
      laid(CLEANUP_JOB, { removed: [IMPLANT.path] }),
    ],
    [
      'somebody else listens there once it was killed',
      laid(CLEANUP_JOB, {
        removed: [IMPLANT.path, PIDFILE],
        extra: [
          [PIDFILE, formatListenerContent({ port: PORT, user: 'mallory', userType: 'root' })],
        ],
      }),
    ],
  ])('says something still answers when %s, and keeps the job open', async (_case, read) => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnCleanupJob(store, read)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCleanupClient(STILL_ANSWERS)]);
  });

  it.each([
    ['left where it was', laid(CLEANUP_JOB, { removed: [PIDFILE] })],
    [
      'put back byte for byte',
      laid(CLEANUP_JOB, {
        removed: [IMPLANT.path, PIDFILE],
        extra: [[IMPLANT.path, IMPLANT.content]],
      }),
    ],
  ])(
    'says it is still on the machine once stopped, when the implant is %s',
    async (_case, read) => {
      const { store, completes, replies } = acceptedStore();

      expect(await mailOnCleanupJob(store, read)).toBe('replied');
      expect(completes).toEqual([]);
      expect(replies).toEqual([fromCleanupClient(STILL_ON_THE_MACHINE)]);
    },
  );

  // "Gone" is the destroy job's rule: the implant's path no longer holds the bytes laid there.
  it.each([
    ['overwritten', [[IMPLANT.path, 'exit 0\n']] as const],
    ['moved', [[`${IMPLANT.path}.bak`, IMPLANT.content]] as const],
  ])('pays for an implant %s once its listener is stopped', async (_case, extra) => {
    const { store, completes, replies } = acceptedStore();

    await mailOnCleanupJob(store, laid(CLEANUP_JOB, { removed: [IMPLANT.path, PIDFILE], extra }));

    expect(completes.map(({ number }) => number)).toEqual([CLEANUP_JOB]);
    expect(replies).toEqual([]);
  });

  it('tells a contractor who bricked the target there is no money, and keeps the job open', async () => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnCleanupJob(store, { kind: 'absent' })).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCleanupClient(TOOK_IT_DOWN)]);
  });

  describe('on two hops', () => {
    const TWO_HOP_TERMS = missionTerms(TWO_HOP_JOB);

    const mailOnTwoHops = (target: TargetBoxRead, front: TargetBoxRead) => {
      const { store, completes, replies } = acceptedStore(TWO_HOP_JOB);
      const targetReads = boxReader(target);
      const frontReads = boxReader(front);
      const answer = mailTo(store, {
        to: TWO_HOP_TERMS.client,
        body: `all clean\n${WALLET}\n`,
        readTargetBox: targetReads.read,
        readFrontBox: frontReads.read,
      });
      return { answer, completes, replies, targetReads, frontReads };
    };

    it('reads both machines, and pays once the target is clean and the edge machine still boots', async () => {
      const { answer, completes, targetReads, frontReads } = mailOnTwoHops(cleaned(TWO_HOP_JOB), {
        kind: 'up',
        fs: buildMissionFrontBoxFs(TWO_HOP_JOB),
      });

      expect(await answer).toBe('replied');
      expect(targetReads.reads).toEqual([TWO_HOP_JOB]);
      expect(frontReads.reads).toEqual([TWO_HOP_JOB]);
      expect(completes.map(({ number }) => number)).toEqual([TWO_HOP_JOB]);
    });

    it('tells a contractor who bricked the edge machine there is no money', async () => {
      const { answer, completes, replies } = mailOnTwoHops(cleaned(TWO_HOP_JOB), {
        kind: 'absent',
      });

      expect(await answer).toBe('replied');
      expect(completes).toEqual([]);
      expect(replies).toEqual([fromCleanupClient(TOOK_IT_DOWN, TWO_HOP_TERMS)]);
    });

    it('answers nothing when the edge machine could not be read', async () => {
      const { answer, completes, replies } = mailOnTwoHops(cleaned(TWO_HOP_JOB), {
        kind: 'error',
      });

      expect(await answer).toBeNull();
      expect(completes).toEqual([]);
      expect(replies).toEqual([]);
    });
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnCleanupJob(store, { kind: 'error' })).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: CLEANUP_JOB, state: 'completed' }],
    });
    const box = boxReader(cleaned(CLEANUP_JOB));

    await mailTo(store, {
      to: CLEANUP_TERMS.client,
      body: `all clean\n${WALLET}\n`,
      readTargetBox: box.read,
    });

    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromCleanupClient(CLOSED_LINE)]);
  });
});

describe('a mail on a wipe job', () => {
  /** A wipe job whose records box keeps a database and needs no secret to lay. */
  const WIPE_JOB = ALL_HOST_NUMBERS.find((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'wipe' && shape.keyBox.route === 'hydra' && shape.storage === 'database';
  })!;
  const WIPE_TERMS = missionTerms(WIPE_JOB);
  const [TARGET, BESIDE] = missionRecords(WIPE_JOB).tables;

  /** The records box as the server lays it, after the application account ran `lines`. */
  const recordsBoxAfter = (...lines: readonly string[]): TargetBoxRead => {
    const laid = withFiles(
      buildMissionKeyBoxFs(WIPE_JOB),
      missionFiles(
        { missionNumber: WIPE_JOB, role: 'key' },
        { keySecret: undefined, rawSecrets: undefined },
      ).map(({ path, content, perms }) => [path, file(content, perms)] as const),
    );
    const database = lines.reduce(
      (current, line) =>
        runStatement({
          database: current,
          line,
          username: 'app',
          userType: 'user',
          sourceIp: '198.51.100.7',
        }).database ?? current,
      databaseIn(laid)!,
    );
    return {
      kind: 'up',
      fs: withFiles(laid, [[DATADIR_PATH, file(JSON.stringify(database), DATADIR_FILE)]]),
    };
  };

  const WIPED = `DELETE FROM ${TARGET?.name}`;

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  const fromWipeClient = (line: string): ContractMail => ({
    sender: `${WIPE_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${WIPE_TERMS.targetCompany}`,
    body: signed(line, WIPE_TERMS.client.company),
  });

  const NOT_WIPED = "That's not what we asked for. Not wiped, no money.";

  const acceptedStore = () => clientStore({ jobs: [{ number: WIPE_JOB, state: 'accepted' }] });

  const mailOnWipeJob = (
    store: ClientMailStore,
    read: TargetBoxRead,
    body = `it is wiped\n${WALLET}\n`,
  ) => mailTo(store, { to: WIPE_TERMS.client, body, readTargetBox: targetBox(read).readTargetBox });

  it('reads the records box of the job held, and pays once the table is empty', async () => {
    const { store, completes, replies } = acceptedStore();
    const box = targetBox(recordsBoxAfter(WIPED));

    expect(
      await mailTo(store, {
        to: WIPE_TERMS.client,
        body: `it is wiped\n${WALLET}\n`,
        readTargetBox: box.readTargetBox,
      }),
    ).toBe('replied');
    expect(box.reads).toEqual([WIPE_JOB]);
    expect(completes).toEqual([
      {
        number: WIPE_JOB,
        wallet: WALLET,
        pay: WIPE_TERMS.pay,
        reply: fromWipeClient(
          `The records are gone. §${WIPE_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = acceptedStore();

    await mailOnWipeJob(store, recordsBoxAfter(WIPED), 'it is wiped\n');

    expect(completes).toEqual([
      {
        number: WIPE_JOB,
        wallet: null,
        pay: WIPE_TERMS.pay,
        reply: fromWipeClient(
          'The records are gone. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it.each([
    ['the records are untouched', recordsBoxAfter()],
    [
      'a row is left',
      recordsBoxAfter(`DELETE FROM ${TARGET?.name} WHERE id = '${TARGET?.table.rows[0]?.['id']}'`),
    ],
    ['the table beside it was emptied too', recordsBoxAfter(WIPED, `DELETE FROM ${BESIDE?.name}`)],
    ['the target no longer boots', { kind: 'absent' } as const],
  ])('says it is not what was asked when %s, and keeps the job open', async (_case, read) => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnWipeJob(store, read)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromWipeClient(NOT_WIPED)]);
  });

  it('pays once the wipe is finished after a mail that came too early', async () => {
    const { store, completes, replies } = acceptedStore();

    await mailOnWipeJob(store, recordsBoxAfter());
    await mailOnWipeJob(store, recordsBoxAfter(WIPED));

    expect(replies).toEqual([fromWipeClient(NOT_WIPED)]);
    expect(completes.map(({ number }) => number)).toEqual([WIPE_JOB]);
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = acceptedStore();

    expect(await mailOnWipeJob(store, { kind: 'error' })).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: WIPE_JOB, state: 'completed' }],
    });
    const box = targetBox(recordsBoxAfter(WIPED));

    await mailTo(store, {
      to: WIPE_TERMS.client,
      body: `it is wiped\n${WALLET}\n`,
      readTargetBox: box.readTargetBox,
    });

    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromWipeClient(CLOSED_LINE)]);
  });
});

describe('a mail on an infiltrate job', () => {
  const INFILTRATE_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) => missionKind(missionNumber) === 'infiltrate',
  )!;
  const INFILTRATE_TERMS = missionTerms(INFILTRATE_JOB);
  const PATH = missionFilePath(INFILTRATE_JOB);
  const OURS = missionPlantContent(INFILTRATE_JOB, SECRET);
  const THEIRS = missionFileContent(INFILTRATE_JOB, SECRET);

  /** A box read answering with `read`, keeping every number it was asked for. */
  const targetBox = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      readTargetBox: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** The target up, holding `content` at the path the client named, or nothing there. */
  const holding = (content: string | null): TargetBoxRead => ({
    kind: 'up',
    fs:
      content === null
        ? buildMissionKeyBoxFs(INFILTRATE_JOB)
        : withFiles(buildMissionKeyBoxFs(INFILTRATE_JOB), [[PATH, file(content, ROOT_FILE)]]),
  });

  const fromInfiltrateClient = (line: string): ContractMail => ({
    sender: `${INFILTRATE_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${INFILTRATE_TERMS.targetCompany}`,
    body: signed(line, INFILTRATE_TERMS.client.company),
  });

  const NOT_IN_PLACE = `Our file is not at ${PATH}. No file in place, no money.`;

  const mailOnInfiltrateJob = (
    store: ClientMailStore,
    readTargetBox: (missionNumber: number) => Promise<TargetBoxRead>,
    mail: { readonly body?: string; readonly file?: string } = {},
  ) =>
    mailTo(store, {
      to: INFILTRATE_TERMS.client,
      body: mail.body ?? `it is there\n${WALLET}\n`,
      ...(mail.file === undefined ? {} : { file: mail.file }),
      readTargetBox,
    });

  it('reads the target of the job held, and pays once its file is at the path named', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'accepted' }],
    });
    const box = targetBox(holding(OURS));

    expect(await mailOnInfiltrateJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([INFILTRATE_JOB]);
    expect(completes).toEqual([
      {
        number: INFILTRATE_JOB,
        wallet: WALLET,
        pay: INFILTRATE_TERMS.pay,
        reply: fromInfiltrateClient(
          `It's in place. §${INFILTRATE_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'accepted' }],
    });

    expect(
      await mailOnInfiltrateJob(store, targetBox(holding(OURS)).readTargetBox, { body: 'done.\n' }),
    ).toBe('replied');
    expect(completes).toEqual([
      {
        number: INFILTRATE_JOB,
        wallet: null,
        pay: INFILTRATE_TERMS.pay,
        reply: fromInfiltrateClient(
          "It's in place. You sent no wallet, so there is nothing to pay. No wallet, no money.",
        ),
      },
    ]);
  });

  it.each([
    ['nothing is at the path', holding(null)],
    ["the company's own file is still there", holding(THEIRS)],
    ['the file there is ours with a newline added', holding(`${OURS}\n`)],
    ['the file there is ours less its last character', holding(OURS.slice(0, -1))],
    ['the target no longer boots', { kind: 'absent' } as const],
  ])('says its file is not in place when %s, and keeps the job open', async (_case, read) => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'accepted' }],
    });

    expect(await mailOnInfiltrateJob(store, targetBox(read).readTargetBox)).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromInfiltrateClient(NOT_IN_PLACE)]);
  });

  // The client looks at the box, not the mail: its own file sent back proves nothing.
  it('ignores its own file mailed back, while the path holds something else', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'accepted' }],
    });

    await mailOnInfiltrateJob(store, targetBox(holding(THEIRS)).readTargetBox, { file: OURS });

    expect(completes).toEqual([]);
    expect(replies).toEqual([fromInfiltrateClient(NOT_IN_PLACE)]);
  });

  it('answers nothing when the target could not be read', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'accepted' }],
    });

    expect(await mailOnInfiltrateJob(store, targetBox({ kind: 'error' }).readTargetBox)).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading the target', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: INFILTRATE_JOB, state: 'completed' }],
    });
    const box = targetBox(holding(null));

    expect(await mailOnInfiltrateJob(store, box.readTargetBox)).toBe('replied');
    expect(box.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromInfiltrateClient(CLOSED_LINE)]);
  });
});

describe('a mail on a file job', () => {
  const FILE_JOBS = ALL_HOST_NUMBERS.filter(
    (missionNumber) => missionKind(missionNumber) === 'file',
  );
  const FILE_JOB = FILE_JOBS[0]!;
  const FILE_TERMS = missionTerms(FILE_JOB);
  const FILE = missionFileContent(FILE_JOB, SECRET);
  /** An earlier file job for the same client. */
  const EARLIER_FILE_JOB = FILE_JOBS.find(
    (missionNumber) =>
      missionNumber !== FILE_JOB &&
      missionTerms(missionNumber).client.handle === FILE_TERMS.client.handle,
  )!;

  const fromFileClient = (line: string, missionNumber = FILE_JOB): ContractMail => ({
    sender: `${FILE_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${missionTerms(missionNumber).targetCompany}`,
    body: signed(line, FILE_TERMS.client.company),
  });

  const holding = (state: 'accepted' | 'completed' = 'accepted') =>
    clientStore({ jobs: [{ number: FILE_JOB, state }] });

  /** A mail to the file job's client carrying `file`. The client never reads the target: the
   *  default box read fails the test. */
  const mailOnFileJob = (
    store: ClientMailStore,
    { file, body = `here it is\n${WALLET}\n` }: { readonly file?: string; readonly body?: string },
  ) => mailTo(store, { to: FILE_TERMS.client, body, ...(file === undefined ? {} : { file }) });

  it('completes the job when the mail carries the file laid, paying the wallet', async () => {
    const { store, completes, replies } = holding();

    expect(await mailOnFileJob(store, { file: FILE })).toBe('replied');
    expect(completes).toEqual([
      {
        number: FILE_JOB,
        wallet: WALLET,
        pay: FILE_TERMS.pay,
        reply: fromFileClient(
          `File received. §${FILE_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it.each([
    'prototype render',
    'site photo',
    'signed contract',
    'firmware image',
    'customer export',
    'key ring',
  ])('completes a job asking for a %s when the mail carries its bytes', async (noun) => {
    const missionNumber = FILE_JOBS.find((job) => missionFileItem(job).noun === noun)!;
    const { client } = missionTerms(missionNumber);
    const { store, completes } = clientStore({
      jobs: [{ number: missionNumber, state: 'accepted' }],
    });

    await mailTo(store, {
      to: client,
      body: `here it is\n${WALLET}\n`,
      file: missionFileContent(missionNumber, SECRET),
    });

    expect(completes.map(({ number, wallet }) => ({ number, wallet }))).toEqual([
      { number: missionNumber, wallet: WALLET },
    ]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = holding();

    expect(await mailOnFileJob(store, { file: FILE, body: 'here it is\n' })).toBe('replied');
    expect(completes).toEqual([
      {
        number: FILE_JOB,
        wallet: null,
        pay: FILE_TERMS.pay,
        reply: fromFileClient(
          'File received. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it('asks for the file when the mail carries none', async () => {
    const { store, completes, replies } = holding();

    expect(await mailOnFileJob(store, {})).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromFileClient('No file, no money. Send the file.')]);
  });

  it('asks for the file whatever key the mail holds, as a file job proves no key', async () => {
    const { store, completes, replies } = holding();

    expect(
      await mailOnFileJob(store, { body: `${missionKey(FILE_JOB, SECRET)}\n${WALLET}\n` }),
    ).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromFileClient('No file, no money. Send the file.')]);
  });

  it.each([
    ['another file', 'FWIMG v1.0.0 ctl not the one'],
    ['the file with a line added, as nano saves it', `${FILE}\n`],
    ['the file one character short', FILE.slice(0, -1)],
    ['the file with its last character changed', `${FILE.slice(0, -1)}x`],
  ])('refuses %s, and keeps the job open', async (_label, file) => {
    const { store, completes, replies } = holding();

    expect(await mailOnFileJob(store, { file })).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromFileClient("That's not the file we asked for.")]);
  });

  it("says the job is already closed for a completed job's file", async () => {
    const { store, completes, replies } = holding('completed');

    expect(await mailOnFileJob(store, { file: FILE })).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromFileClient(CLOSED_LINE)]);
  });

  it("says the job is already closed for an earlier job's file while another is held", async () => {
    const { store, completes, replies } = clientStore({
      jobs: [
        { number: FILE_JOB, state: 'accepted' },
        { number: EARLIER_FILE_JOB, state: 'completed' },
      ],
    });

    expect(await mailOnFileJob(store, { file: missionFileContent(EARLIER_FILE_JOB, SECRET) })).toBe(
      'replied',
    );
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromFileClient(CLOSED_LINE, EARLIER_FILE_JOB)]);
  });

  it('says there is no contract for a completed job mailed any other file, or none', async () => {
    for (const file of ['something else', undefined]) {
      const { store, replies } = holding('completed');

      expect(await mailOnFileJob(store, file === undefined ? {} : { file })).toBe('replied');
      expect(replies).toEqual([
        {
          sender: `${FILE_TERMS.client.handle}@emailit.io`,
          subject: 'No contract',
          body: signed('We have no contract with you.', FILE_TERMS.client.company),
        },
      ]);
    }
  });
});

describe('a mail carrying a file on a key job', () => {
  const SOME_FILE = missionFileContent(
    ALL_HOST_NUMBERS.find((missionNumber) => missionKind(missionNumber) === 'file')!,
    SECRET,
  );

  it('completes the job on its key, whatever file it carries', async () => {
    const { store, completes } = clientStore();

    expect(await mailTo(store, { file: SOME_FILE })).toBe('replied');
    expect(completes.map(({ number, reply }) => [number, reply])).toEqual([
      [
        JOB,
        fromClient(
          `Key received. §${TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      ],
    ]);
  });

  it('asks for the key when the mail carries a file and no key', async () => {
    const { store, completes, replies } = clientStore();

    expect(await mailTo(store, { body: `${WALLET}\n`, file: SOME_FILE })).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromClient('No key, no money. Send the key.')]);
  });
});

describe('a mail on a chain job', () => {
  /** A chain job whose last step takes the machine inside down. */
  const CHAIN_JOB = ALL_HOST_NUMBERS.find(
    (missionNumber) =>
      missionKind(missionNumber) === 'chain' && chainFinal(missionNumber) === 'sabotage',
  )!;
  const CHAIN_TERMS = missionTerms(CHAIN_JOB);
  const { port: PORT } = chainJob(CHAIN_JOB);
  /** A classic port the client did not name. */
  const OTHER_PORT = PORT === 4444 ? 5555 : 4444;

  /** A box read answering with `read`, keeping every number it was asked for. */
  const boxRead = (read: TargetBoxRead) => {
    const reads: number[] = [];
    return {
      reads,
      read: async (missionNumber: number): Promise<TargetBoxRead> => {
        reads.push(missionNumber);
        return read;
      },
    };
  };

  /** `fs` up, with a root's listener on each of `ports`. */
  const upListeningOn = (fs: Directory, ...ports: readonly number[]): TargetBoxRead => ({
    kind: 'up',
    fs: withFiles(
      fs,
      ports.map((port) => [
        listenerPidfilePath(port),
        file(formatListenerContent({ port, user: 'root', userType: 'root' }), PIDFILE_PERMISSIONS),
      ]),
    ),
  });

  /** The front box up, with a listener on each of `ports`. */
  const frontListeningOn = (...ports: readonly number[]): TargetBoxRead =>
    upListeningOn(buildMissionFrontBoxFs(CHAIN_JOB), ...ports);

  /** The machine to take down, still up, with a listener on each of `ports`. */
  const targetListeningOn = (...ports: readonly number[]): TargetBoxRead =>
    upListeningOn(buildMissionKeyBoxFs(CHAIN_JOB), ...ports);

  const DOWN: TargetBoxRead = { kind: 'absent' };

  const fromChainClient = (line: string): ContractMail => ({
    sender: `${CHAIN_TERMS.client.handle}@emailit.io`,
    subject: `Contract: ${CHAIN_TERMS.targetCompany}`,
    body: signed(line, CHAIN_TERMS.client.company),
  });

  const NO_LISTENER = `Nothing is listening on port ${PORT} on the edge. No listener, no money.`;
  const STILL_UP = 'Their machine is still up. No outage, no money.';

  const mailOnChainJob = (
    store: ClientMailStore,
    boxes: { readonly front: TargetBoxRead; readonly target: TargetBoxRead },
    body = `both done\n${WALLET}\n`,
  ) =>
    mailTo(store, {
      to: CHAIN_TERMS.client,
      body,
      readFrontBox: boxRead(boxes.front).read,
      readTargetBox: boxRead(boxes.target).read,
    });

  const acceptedChainJob = () => clientStore({ jobs: [{ number: CHAIN_JOB, state: 'accepted' }] });

  it('reads both boxes of the job held, and pays once the listener holds the port and the machine is down', async () => {
    const { store, completes, replies } = acceptedChainJob();
    const front = boxRead(frontListeningOn(PORT));
    const target = boxRead(DOWN);

    expect(
      await mailTo(store, {
        to: CHAIN_TERMS.client,
        body: `both done\n${WALLET}\n`,
        readFrontBox: front.read,
        readTargetBox: target.read,
      }),
    ).toBe('replied');
    expect(front.reads).toEqual([CHAIN_JOB]);
    expect(target.reads).toEqual([CHAIN_JOB]);
    expect(completes).toEqual([
      {
        number: CHAIN_JOB,
        wallet: WALLET,
        pay: CHAIN_TERMS.pay,
        reply: fromChainClient(
          `Both done. §${CHAIN_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
        ),
      },
    ]);
    expect(replies).toEqual([]);
  });

  it('pays whatever else the front box listens on beside the port named', async () => {
    const { store, completes } = acceptedChainJob();

    await mailOnChainJob(store, { front: frontListeningOn(OTHER_PORT, PORT), target: DOWN });

    expect(completes.map(({ number }) => number)).toEqual([CHAIN_JOB]);
  });

  it('completes and pays nothing when the mail names no wallet', async () => {
    const { store, completes } = acceptedChainJob();

    await mailOnChainJob(store, { front: frontListeningOn(PORT), target: DOWN }, 'done.\n');

    expect(completes).toEqual([
      {
        number: CHAIN_JOB,
        wallet: null,
        pay: CHAIN_TERMS.pay,
        reply: fromChainClient(
          'Both done. You sent no wallet, so there is nothing to pay. No wallet, no money.',
        ),
      },
    ]);
  });

  it.each([
    ['neither step is done', frontListeningOn(), targetListeningOn()],
    ['only the machine is down', frontListeningOn(), DOWN],
    ['the listener on the edge holds another port', frontListeningOn(OTHER_PORT), DOWN],
    [
      'the listener is on the machine inside, not the edge',
      frontListeningOn(),
      targetListeningOn(PORT),
    ],
    ['the front box no longer boots, though the machine is down', DOWN, DOWN],
  ])(
    'says nothing is listening on the edge when %s, and keeps the job open',
    async (_case, front, target) => {
      const { store, completes, replies } = acceptedChainJob();

      expect(await mailOnChainJob(store, { front, target })).toBe('replied');
      expect(completes).toEqual([]);
      expect(replies).toEqual([fromChainClient(NO_LISTENER)]);
    },
  );

  it('says the machine is still up when only the listener is left, and keeps the job open', async () => {
    const { store, completes, replies } = acceptedChainJob();

    expect(
      await mailOnChainJob(store, { front: frontListeningOn(PORT), target: targetListeningOn() }),
    ).toBe('replied');
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromChainClient(STILL_UP)]);
  });

  it.each([
    ['the front box', { kind: 'error' } as const, DOWN],
    ['the machine', frontListeningOn(PORT), { kind: 'error' } as const],
  ])('answers nothing when %s could not be read', async (_case, front, target) => {
    const { store, completes, replies } = acceptedChainJob();

    expect(await mailOnChainJob(store, { front, target })).toBeNull();
    expect(completes).toEqual([]);
    expect(replies).toEqual([]);
  });

  it('says the job is already closed once it is completed, without reading either box', async () => {
    const { store, completes, replies } = clientStore({
      jobs: [{ number: CHAIN_JOB, state: 'completed' }],
    });
    const front = boxRead(frontListeningOn());
    const target = boxRead(targetListeningOn());

    expect(
      await mailTo(store, {
        to: CHAIN_TERMS.client,
        body: `both done\n${WALLET}\n`,
        readFrontBox: front.read,
        readTargetBox: target.read,
      }),
    ).toBe('replied');
    expect(front.reads).toEqual([]);
    expect(target.reads).toEqual([]);
    expect(completes).toEqual([]);
    expect(replies).toEqual([fromChainClient(CLOSED_LINE)]);
  });

  describe('ending in a file destroyed', () => {
    const DESTROYING = ALL_HOST_NUMBERS.find(
      (missionNumber) =>
        missionKind(missionNumber) === 'chain' && chainFinal(missionNumber) === 'destroy',
    )!;
    const DESTROYING_TERMS = missionTerms(DESTROYING);
    const { port: DESTROYING_PORT } = chainJob(DESTROYING);

    /** The machine inside up, holding the company's file at its path or with it gone. */
    const inside = (fileThere: boolean): TargetBoxRead => ({
      kind: 'up',
      fs: fileThere
        ? withFiles(buildMissionKeyBoxFs(DESTROYING), [
            [missionFilePath(DESTROYING), file(missionFileContent(DESTROYING, SECRET), ROOT_FILE)],
          ])
        : buildMissionKeyBoxFs(DESTROYING),
    });

    const edge = (...ports: readonly number[]): TargetBoxRead =>
      upListeningOn(buildMissionFrontBoxFs(DESTROYING), ...ports);

    const fromClient = (line: string): ContractMail => ({
      sender: `${DESTROYING_TERMS.client.handle}@emailit.io`,
      subject: `Contract: ${DESTROYING_TERMS.targetCompany}`,
      body: signed(line, DESTROYING_TERMS.client.company),
    });

    const mail = async (front: TargetBoxRead, target: TargetBoxRead) => {
      const { store, completes, replies } = clientStore({
        jobs: [{ number: DESTROYING, state: 'accepted' }],
      });
      const answer = await mailTo(store, {
        to: DESTROYING_TERMS.client,
        body: `both done\n${WALLET}\n`,
        readFrontBox: boxRead(front).read,
        readTargetBox: boxRead(target).read,
      });
      return { answer, completes, replies };
    };

    it('pays once the listener holds the port and the file is gone from its path', async () => {
      const { answer, completes, replies } = await mail(edge(DESTROYING_PORT), inside(false));

      expect(answer).toBe('replied');
      expect(completes).toEqual([
        {
          number: DESTROYING,
          wallet: WALLET,
          pay: DESTROYING_TERMS.pay,
          reply: fromClient(
            `Both done. §${DESTROYING_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
          ),
        },
      ]);
      expect(replies).toEqual([]);
    });

    it.each([
      ['the file is still at its path', true],
      ['the machine no longer boots', null],
    ])(
      "gives a destroy job's miss when the listener is in place and %s, and keeps the job open",
      async (_case, fileThere) => {
        const target: TargetBoxRead = fileThere === null ? { kind: 'absent' } : inside(fileThere);
        const { completes, replies } = await mail(edge(DESTROYING_PORT), target);

        expect(completes).toEqual([]);
        expect(replies).toEqual([
          fromClient("We can't confirm that file is gone. Not gone, no money."),
        ]);
      },
    );

    it('says nothing is listening on the edge when the file is gone but no listener holds the port', async () => {
      const { completes, replies } = await mail(edge(), inside(false));

      expect(completes).toEqual([]);
      expect(replies).toEqual([
        fromClient(
          `Nothing is listening on port ${DESTROYING_PORT} on the edge. No listener, no money.`,
        ),
      ]);
    });
  });

  describe('ending in records wiped', () => {
    /** A chain job wiping records its target keeps in a database, which needs no secret to lay. */
    const WIPING = ALL_HOST_NUMBERS.find((missionNumber) => {
      const shape = missionShape(missionNumber);
      return (
        shape.kind === 'chain' &&
        chainFinal(missionNumber) === 'wipe' &&
        shape.keyBox.route === 'hydra' &&
        shape.storage === 'database'
      );
    })!;
    const WIPING_TERMS = missionTerms(WIPING);
    const { port: WIPING_PORT } = chainJob(WIPING);
    const [WIPE_TARGET, WIPE_BESIDE] = missionRecords(WIPING).tables;

    /** The machine inside as the server lays it, after the application account ran `lines`. */
    const insideAfter = (...lines: readonly string[]): TargetBoxRead => {
      const laid = withFiles(
        buildMissionKeyBoxFs(WIPING),
        missionFiles(
          { missionNumber: WIPING, role: 'key' },
          { keySecret: undefined, rawSecrets: undefined },
        ).map(({ path, content, perms }) => [path, file(content, perms)] as const),
      );
      const database = lines.reduce(
        (current, line) =>
          runStatement({
            database: current,
            line,
            username: 'app',
            userType: 'user',
            sourceIp: '198.51.100.7',
          }).database ?? current,
        databaseIn(laid)!,
      );
      return {
        kind: 'up',
        fs: withFiles(laid, [[DATADIR_PATH, file(JSON.stringify(database), DATADIR_FILE)]]),
      };
    };

    const WIPED = `DELETE FROM ${WIPE_TARGET?.name}`;

    const edge = (...ports: readonly number[]): TargetBoxRead =>
      upListeningOn(buildMissionFrontBoxFs(WIPING), ...ports);

    const fromClient = (line: string): ContractMail => ({
      sender: `${WIPING_TERMS.client.handle}@emailit.io`,
      subject: `Contract: ${WIPING_TERMS.targetCompany}`,
      body: signed(line, WIPING_TERMS.client.company),
    });

    const mail = async (front: TargetBoxRead, target: TargetBoxRead) => {
      const { store, completes, replies } = clientStore({
        jobs: [{ number: WIPING, state: 'accepted' }],
      });
      const answer = await mailTo(store, {
        to: WIPING_TERMS.client,
        body: `both done\n${WALLET}\n`,
        readFrontBox: boxRead(front).read,
        readTargetBox: boxRead(target).read,
      });
      return { answer, completes, replies };
    };

    const NOT_WIPED = "That's not what we asked for. Not wiped, no money.";

    it('pays once the listener holds the port and the table the briefing describes is empty', async () => {
      const { answer, completes, replies } = await mail(edge(WIPING_PORT), insideAfter(WIPED));

      expect(answer).toBe('replied');
      expect(completes).toEqual([
        {
          number: WIPING,
          wallet: WALLET,
          pay: WIPING_TERMS.pay,
          reply: fromClient(
            `Both done. §${WIPING_TERMS.pay.toLocaleString('en-US')} sent to ${WALLET}. Pleasure doing business.`,
          ),
        },
      ]);
      expect(replies).toEqual([]);
    });

    it.each([
      ['the table still holds its rows', []],
      ['a table beside it was emptied too', [WIPED, `DELETE FROM ${WIPE_BESIDE?.name}`]],
      ['the machine no longer boots', null],
    ])(
      "gives a wipe job's miss when the listener is in place and %s, and keeps the job open",
      async (_case, lines) => {
        const target: TargetBoxRead = lines === null ? { kind: 'absent' } : insideAfter(...lines);
        const { completes, replies } = await mail(edge(WIPING_PORT), target);

        expect(completes).toEqual([]);
        expect(replies).toEqual([fromClient(NOT_WIPED)]);
      },
    );

    it('says nothing is listening on the edge when the table is empty but no listener holds the port', async () => {
      const { completes, replies } = await mail(edge(), insideAfter(WIPED));

      expect(completes).toEqual([]);
      expect(replies).toEqual([
        fromClient(
          `Nothing is listening on port ${WIPING_PORT} on the edge. No listener, no money.`,
        ),
      ]);
    });
  });
});
