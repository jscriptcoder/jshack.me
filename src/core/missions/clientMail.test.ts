import { describe, expect, it } from 'vitest';
import { answerClientMail, type ClientMailStore } from './clientMail.js';
import type { ContractMail } from '../hireme/contracts.js';
import { missionKey } from './missionSecret.js';
import { missionTerms, type MissionClient } from './missionTerms.js';

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
const HOST_NUMBERS = Array.from({ length: 4000 }, (_unused, index) => index * 257 + 1000).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
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

const mailTo = (
  store: ClientMailStore,
  mail: { readonly to?: MissionClient; readonly subject?: string; readonly body?: string } = {},
) =>
  answerClientMail({
    login: LOGIN,
    client: mail.to ?? TERMS.client,
    subject: mail.subject ?? 'the job',
    body: mail.body ?? `${KEY}\n${WALLET}\n`,
    secret: SECRET,
    store,
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
  `Key received. ${TERMS.pay.toLocaleString('en-US')} JSC sent to ${wallet}. Pleasure doing business.`;
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
