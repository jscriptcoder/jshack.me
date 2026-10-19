import { describe, expect, it } from 'vitest';
import { answerComment, type NewComment } from './answerComment.js';
import { md5 } from '../generation/md5.js';
import type { MailLogin } from '../commands/types.js';

/**
 * Commenting on a thread at talkit.io: a form POSTed to `/comment`, naming the thread and
 * signed with the login the commenter keeps for emailit.io, becomes a numbered comment or
 * the reason it did not. What the store answers is faked here; what it is asked, and the
 * page the commenter gets back, are the behaviour.
 */

const PLAYER_KEY = 'b'.repeat(64);
const NEO: MailLogin = { handle: 'neo', password: 's3cret' };

/** What the store answers, as it comes off the wire. */
type StoreReply = { readonly data: unknown; readonly error: unknown };

const COMMENTED: StoreReply = { data: { outcome: 'commented', number: 3 }, error: null };

const UNREACHABLE: StoreReply = { data: null, error: { message: 'connection refused' } };

/** A form as a browser encodes it. */
const form = (fields: Readonly<Record<string, string>>): string =>
  new URLSearchParams(Object.entries(fields)).toString();

/** A comment of `fields`, signed with `login`, against a store answering `reply`: what the
 *  store was asked, what came back, and the page as a reader sees it. */
const comment = async ({
  fields = { id: '12', body: 'Mine blinks too.' },
  login = NEO,
  reply = COMMENTED,
}: {
  readonly fields?: Readonly<Record<string, string>>;
  readonly login?: MailLogin | null;
  readonly reply?: StoreReply;
} = {}) => {
  const asked: NewComment[] = [];
  const answer = await answerComment({
    form: form(fields),
    login,
    playerKey: PLAYER_KEY,
    postComment: async (newComment) => {
      asked.push(newComment);
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

const NO_SUCH_THREAD = 'No such thread.';

describe('commenting on a thread at talkit.io', () => {
  it('asks the store to post the comment on the thread, as the login, by the player who sent it', async () => {
    const { asked } = await comment();

    expect(asked).toEqual([
      {
        handle: 'neo',
        passwordMd5: md5('s3cret'),
        playerKey: PLAYER_KEY,
        threadId: 12,
        body: 'Mine blinks too.',
      },
    ]);
  });

  it('says who it was posted as, links back to the thread, and names it for the log', async () => {
    const { answer, said, links, parsed } = await comment();

    expect(said).toBe('Commented as neo.');
    expect(links).toEqual([{ text: 'Back to the thread', href: '/thread?id=12' }, BACK]);
    expect(parsed?.title).toBe('Commented - talkit.io');
    expect(answer?.commented).toEqual({ threadId: 12, number: 3, handle: 'neo' });
  });

  it('refuses a comment with no login, plainly, asking nobody', async () => {
    const { asked, answer, said, links, parsed } = await comment({ login: null });

    expect(said).toBe('Not logged in to emailit.io.');
    expect(links).toEqual([BACK]);
    expect(parsed?.title).toBe('Not posted - talkit.io');
    expect(asked).toEqual([]);
    expect(answer?.commented).toBeNull();
  });

  it('refuses a comment with no login before it looks at the form', async () => {
    const { said } = await comment({ login: null, fields: { id: 'abc', body: '' } });

    expect(said).toBe('Not logged in to emailit.io.');
  });

  it.each([
    ['names no thread', {}],
    ['names an empty id', { id: '' }],
    ['names a word', { id: 'abc' }],
    ['names thread 0', { id: '0' }],
    ['names an id with a leading zero', { id: '012' }],
    ['names a negative id', { id: '-12' }],
    ['names an id with a blank before it', { id: ' 12' }],
    ['names an id longer than any thread can have', { id: '1000000000000000' }],
  ])('refuses a comment that %s, asking nobody', async (_what, idField) => {
    const { asked, said, links, answer } = await comment({
      fields: { ...idField, body: 'Mine blinks too.' },
    });

    expect(said).toBe(NO_SUCH_THREAD);
    expect(links).toEqual([BACK]);
    expect(asked).toEqual([]);
    expect(answer?.commented).toBeNull();
  });

  it('asks for the longest id a thread can have', async () => {
    const { asked } = await comment({ fields: { id: '999999999999999', body: 'Hi' } });

    expect(asked.map((newComment) => newComment.threadId)).toEqual([999_999_999_999_999]);
  });

  it('refuses an id that names no thread before it looks at the body', async () => {
    const { said } = await comment({ fields: { id: 'abc', body: '' } });

    expect(said).toBe(NO_SUCH_THREAD);
  });

  it.each([
    [{ outcome: 'login_failed' }, 'Login failed for neo@emailit.io.'],
    [{ outcome: 'throttled' }, 'Too many failed logins. Wait a minute.'],
    [{ outcome: 'capped' }, 'You have posted 20 times in the last hour. Wait a while.'],
    [{ outcome: 'no_thread' }, NO_SUCH_THREAD],
  ])('says what the store refused with: %o', async (outcome, refusal) => {
    const { answer, said, links } = await comment({ reply: { data: outcome, error: null } });

    expect(said).toBe(refusal);
    expect(links).toEqual([BACK]);
    expect(answer?.commented).toBeNull();
  });

  it('escapes the handle it names, whatever the login said', async () => {
    const { answer, said } = await comment({
      login: { handle: '<b>neo</b>', password: 's3cret' },
    });

    expect(said).toBe('Commented as <b>neo</b>.');
    expect(answer?.page).not.toContain('<b>');
  });

  it.each([
    ['the store could not be asked', UNREACHABLE],
    [
      'the store answered with a word nobody taught it',
      { data: { outcome: 'posted', id: 1 }, error: null },
    ],
    ['the store numbered no comment', { data: { outcome: 'commented' }, error: null }],
    [
      'the store numbered the comment with something not a number',
      { data: { outcome: 'commented', number: 0 }, error: null },
    ],
  ])('has no page when %s', async (_why, reply) => {
    const { answer } = await comment({ reply });

    expect(answer).toBeNull();
  });
});

describe('what a comment may say', () => {
  const LENGTH_REFUSED = 'A comment is 1 to 4,000 characters.';
  const CONTROL_REFUSED = 'A comment cannot hold control characters.';

  const commentSaying = (body: string) => comment({ fields: { id: '12', body } });

  it.each([
    ['empty', ''],
    ['only blanks and line breaks', ' \n \n '],
    ['4,001 characters', 'x'.repeat(4001)],
  ])('refuses a comment that is %s, asking nobody', async (_what, body) => {
    const { asked, said, answer } = await commentSaying(body);

    expect(said).toBe(LENGTH_REFUSED);
    expect(asked).toEqual([]);
    expect(answer?.commented).toBeNull();
  });

  it('refuses a form with no body as it would an empty one', async () => {
    expect((await comment({ fields: { id: '12' } })).said).toBe(LENGTH_REFUSED);
  });

  it.each([
    ['NUL', '\u0000'],
    ['a backspace', '\u0008'],
    ['a tab', '\t'],
    ['a vertical tab', '\u000b'],
    ['an escape', '\u001b'],
    ['a unit separator', '\u001f'],
    ['a DEL', '\u007f'],
  ])('refuses %s in a comment, asking nobody', async (_what, control) => {
    const { asked, said } = await commentSaying(`a${control}b`);

    expect(said).toBe(CONTROL_REFUSED);
    expect(asked).toEqual([]);
  });

  it('refuses a control character even in a comment that is also too long', async () => {
    const { said } = await commentSaying(`${'x'.repeat(4001)}\u001b`);

    expect(said).toBe(CONTROL_REFUSED);
  });

  it('takes a space and a tilde, the printable characters at either end of the controls', async () => {
    const { asked } = await commentSaying(' ~a b~ ');

    expect(asked.map((newComment) => newComment.body)).toEqual(['~a b~']);
  });

  it('takes a 4,000-character comment', async () => {
    const { asked } = await commentSaying('y'.repeat(4000));

    expect(asked.map((newComment) => [...newComment.body].length)).toEqual([4000]);
  });

  it('counts a character as a reader does, an emoji as one', async () => {
    const { asked } = await commentSaying('📡'.repeat(4000));

    expect(asked).toHaveLength(1);
  });

  it('trims blanks at either end, and keeps those inside', async () => {
    const { asked } = await commentSaying('\n\n  one\n\n  two  \n');

    expect(asked.map((newComment) => newComment.body)).toEqual(['one\n\n  two']);
  });

  it('turns a CRLF or a lone CR into a line break', async () => {
    const { asked } = await commentSaying('one\r\ntwo\rthree');

    expect(asked.map((newComment) => newComment.body)).toEqual(['one\ntwo\nthree']);
  });

  it('counts the length once the line breaks are turned, a CRLF as one character', async () => {
    const { asked } = await commentSaying(`${'x'.repeat(3998)}\r\nx`);

    expect(asked.map((newComment) => [...newComment.body].length)).toEqual([4000]);
  });

  it.each([
    '<script>alert(1)</script>',
    '"><form action=/comment method=post><input type=submit>',
    '</textarea>',
    '&lt;b&gt;',
    'javascript:alert(1)',
    'http://x.io/a"onmouseover="1',
  ])('stores %s exactly as typed, escaped by nobody on the way in', async (payload) => {
    const { asked } = await commentSaying(payload);

    expect(asked.map((newComment) => newComment.body)).toEqual([payload]);
  });
});
