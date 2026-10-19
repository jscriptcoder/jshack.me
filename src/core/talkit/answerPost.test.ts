import { describe, expect, it } from 'vitest';
import { answerPost, type NewThread } from './answerPost.js';
import { md5 } from '../generation/md5.js';
import type { MailLogin } from '../commands/types.js';

/**
 * Starting a thread at talkit.io: a form POSTed to `/post`, signed with the login the
 * poster keeps for emailit.io, becomes a thread or the reason it did not. What the store
 * answers is faked here; what it is asked, and the page the poster gets back, are the
 * behaviour.
 */

const PLAYER_KEY = 'b'.repeat(64);
const NEO: MailLogin = { handle: 'neo', password: 's3cret' };

/** What the store answers, as it comes off the wire. */
type StoreReply = { readonly data: unknown; readonly error: unknown };

const POSTED: StoreReply = { data: { outcome: 'posted', id: 12 }, error: null };

const UNREACHABLE: StoreReply = { data: null, error: { message: 'connection refused' } };

/** A form as a browser encodes it. */
const form = (fields: Readonly<Record<string, string>>): string =>
  new URLSearchParams(Object.entries(fields)).toString();

/** A post of `fields`, signed with `login`, against a store answering `reply`: what the
 *  store was asked, what came back, and the page as a reader sees it. */
const post = async ({
  fields = { title: 'My new router', body: 'It blinks.' },
  login = NEO,
  reply = POSTED,
}: {
  readonly fields?: Readonly<Record<string, string>>;
  readonly login?: MailLogin | null;
  readonly reply?: StoreReply;
} = {}) => {
  const asked: NewThread[] = [];
  const answer = await answerPost({
    form: form(fields),
    login,
    playerKey: PLAYER_KEY,
    postThread: async (thread) => {
      asked.push(thread);
      return reply;
    },
  });
  const parsed = answer === null ? null : new DOMParser().parseFromString(answer.page, 'text/html');
  const paragraphs = [...(parsed?.querySelectorAll('hr ~ p') ?? [])].map(
    (paragraph) => paragraph.textContent ?? '',
  );
  const links = [...(parsed?.querySelectorAll('hr ~ p a') ?? [])].map((link) => ({
    text: link.textContent,
    href: link.getAttribute('href'),
  }));
  return { asked, answer, parsed, said: paragraphs[0] ?? null, links };
};

const BACK = { text: 'Back to talkit.io', href: '/' };

describe('starting a thread at talkit.io', () => {
  it('asks the store to post the thread as the login, by the player who sent it', async () => {
    const { asked } = await post();

    expect(asked).toEqual([
      {
        handle: 'neo',
        passwordMd5: md5('s3cret'),
        playerKey: PLAYER_KEY,
        title: 'My new router',
        body: 'It blinks.',
      },
    ]);
  });

  it('says who it was posted as, links to the new thread, and names it for the log', async () => {
    const { answer, said, links, parsed } = await post();

    expect(said).toBe('Posted as neo.');
    expect(links).toEqual([{ text: 'Read your thread', href: '/thread?id=12' }, BACK]);
    expect(parsed?.title).toBe('Posted - talkit.io');
    expect(answer?.posted).toEqual({ id: 12, handle: 'neo' });
  });

  it('refuses a post with no login, plainly, asking nobody', async () => {
    const { asked, answer, said, links, parsed } = await post({ login: null });

    expect(said).toBe('Not logged in to emailit.io.');
    expect(links).toEqual([BACK]);
    expect(parsed?.title).toBe('Not posted - talkit.io');
    expect(asked).toEqual([]);
    expect(answer?.posted).toBeNull();
  });

  it('refuses a post with no login before it looks at the form', async () => {
    const { said } = await post({ login: null, fields: { title: '', body: '' } });

    expect(said).toBe('Not logged in to emailit.io.');
  });

  it.each([
    [{ outcome: 'login_failed' }, 'Login failed for neo@emailit.io.'],
    [{ outcome: 'throttled' }, 'Too many failed logins. Wait a minute.'],
    [{ outcome: 'capped' }, 'You have posted 20 times in the last hour. Wait a while.'],
  ])('says what the store refused with: %o', async (outcome, refusal) => {
    const { answer, said, links } = await post({ reply: { data: outcome, error: null } });

    expect(said).toBe(refusal);
    expect(links).toEqual([BACK]);
    expect(answer?.posted).toBeNull();
  });

  it('escapes the handle it names, whatever the login said', async () => {
    const { answer, said } = await post({
      login: { handle: '<b>neo</b>', password: 's3cret' },
      reply: { data: { outcome: 'login_failed' }, error: null },
    });

    expect(said).toBe('Login failed for <b>neo</b>@emailit.io.');
    expect(answer?.page).not.toContain('<b>');
  });

  it.each([
    ['the store could not be asked', UNREACHABLE],
    ['the store answered with a word nobody taught it', { data: { outcome: 'sent' }, error: null }],
    ['the store named no thread', { data: { outcome: 'posted' }, error: null }],
    [
      'the store named a thread by something not an id',
      { data: { outcome: 'posted', id: 0 }, error: null },
    ],
  ])('has no page when %s', async (_why, reply) => {
    const { answer } = await post({ reply });

    expect(answer).toBeNull();
  });
});

describe('what a post may say', () => {
  const TITLE_REFUSED = 'A title is 1 to 80 characters on one line.';
  const BODY_REFUSED = 'A post is 1 to 4,000 characters.';
  const CONTROL_REFUSED = 'A post cannot hold control characters.';

  /** A post whose `field` says `text`, the other field fine. */
  const postWith = (field: 'title' | 'body', text: string) =>
    post({ fields: { title: 'Hi', body: 'there', [field]: text } });

  it.each([
    ['empty', ''],
    ['only blanks', '   '],
    ['81 characters', 'x'.repeat(81)],
    ['two lines', 'one\ntwo'],
    ['a line ended by a CR', 'one\rtwo'],
  ])('refuses a title that is %s, asking nobody', async (_what, title) => {
    const { asked, said, answer } = await postWith('title', title);

    expect(said).toBe(TITLE_REFUSED);
    expect(asked).toEqual([]);
    expect(answer?.posted).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['only blanks and line breaks', ' \n \n '],
    ['4,001 characters', 'x'.repeat(4001)],
  ])('refuses a body that is %s, asking nobody', async (_what, body) => {
    const { asked, said } = await postWith('body', body);

    expect(said).toBe(BODY_REFUSED);
    expect(asked).toEqual([]);
  });

  it('refuses a form with no title, or no body, as it would an empty one', async () => {
    expect((await post({ fields: { body: 'there' } })).said).toBe(TITLE_REFUSED);
    expect((await post({ fields: { title: 'Hi' } })).said).toBe(BODY_REFUSED);
  });

  it.each([
    ['NUL', '\u0000'],
    ['a backspace', '\u0008'],
    ['a tab', '\t'],
    ['a vertical tab', '\u000b'],
    ['an escape', '\u001b'],
    ['a unit separator', '\u001f'],
    ['a DEL', '\u007f'],
  ])('refuses %s in a title or a body, asking nobody', async (_what, control) => {
    const inTitle = await postWith('title', `a${control}b`);
    const inBody = await postWith('body', `a${control}b`);

    expect([inTitle.said, inBody.said]).toEqual([CONTROL_REFUSED, CONTROL_REFUSED]);
    expect([...inTitle.asked, ...inBody.asked]).toEqual([]);
  });

  it('refuses a control character in the body even when the title is also wrong', async () => {
    const { said } = await post({ fields: { title: '', body: 'a\u001bb' } });

    expect(said).toBe(CONTROL_REFUSED);
  });

  it('takes a space and a tilde, the printable characters at either end of the controls', async () => {
    const { asked } = await post({ fields: { title: ' ~a b~ ', body: '~ ~' } });

    expect(asked.map((thread) => [thread.title, thread.body])).toEqual([['~a b~', '~ ~']]);
  });

  it('takes an 80-character title and a 4,000-character body', async () => {
    const { asked } = await post({ fields: { title: 'x'.repeat(80), body: 'y'.repeat(4000) } });

    expect(asked.map((thread) => [[...thread.title].length, [...thread.body].length])).toEqual([
      [80, 4000],
    ]);
  });

  it('counts a character as a reader does, an emoji as one', async () => {
    const { asked } = await post({ fields: { title: '🛜'.repeat(80), body: '📡'.repeat(4000) } });

    expect(asked).toHaveLength(1);
  });

  it('trims blanks at either end of the title and the body, and keeps those inside', async () => {
    const { asked } = await post({
      fields: { title: '  My  router  ', body: '\n\n  one\n\n  two  \n' },
    });

    expect(asked.map((thread) => [thread.title, thread.body])).toEqual([
      ['My  router', 'one\n\n  two'],
    ]);
  });

  it('turns a CRLF or a lone CR in the body into a line break', async () => {
    const { asked } = await postWith('body', 'one\r\ntwo\rthree');

    expect(asked.map((thread) => thread.body)).toEqual(['one\ntwo\nthree']);
  });

  it('counts the length once the line breaks are turned, a CRLF as one character', async () => {
    const { asked } = await postWith('body', `${'x'.repeat(3998)}\r\nx`);

    expect(asked.map((thread) => [...thread.body].length)).toEqual([4000]);
  });

  it.each([
    '<script>alert(1)</script>',
    '"><form action=/comment method=post><input type=submit>',
    '</textarea>',
    '&lt;b&gt;',
    'javascript:alert(1)',
    'http://x.io/a"onmouseover="1',
  ])('stores %s exactly as typed, escaped by nobody on the way in', async (payload) => {
    const { asked } = await post({ fields: { title: payload, body: payload } });

    expect(asked.map((thread) => [thread.title, thread.body])).toEqual([[payload, payload]]);
  });
});
