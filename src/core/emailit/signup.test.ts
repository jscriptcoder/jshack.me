import { describe, expect, it } from 'vitest';
import { answerSignup, type NewAccount } from './signup.js';
import { md5 } from '../generation/md5.js';

/**
 * Signing up at emailit.io: a form POSTed to `/signup` becomes an account, or the reason
 * it did not. What the store answers is faked here; what it is asked, and the page the
 * reader gets back, are the behaviour.
 */

const PLAYER_KEY = 'b'.repeat(64);

/** What the store answers, as it comes off the wire. */
type StoreReply = { readonly data: unknown; readonly error: unknown };

/** A store that answers every sign-up with `reply`, and remembers what it was asked. */
const storeAnswering = (reply: StoreReply) => {
  const asked: NewAccount[] = [];
  return {
    asked,
    signUp: async (account: NewAccount) => {
      asked.push(account);
      return reply;
    },
  };
};

/** The store's word for an outcome, as it comes back. */
const answered = (word: unknown): StoreReply => ({ data: word, error: null });

const UNREACHABLE: StoreReply = { data: null, error: { message: 'connection refused' } };

/** The page a sign-up answers with, as a reader sees it: the text, markup and entities
 *  gone. Null when there was no page to see. */
const signUpWith = async (form: string, reply: StoreReply = answered('created')) => {
  const store = storeAnswering(reply);
  const page = await answerSignup({ form, playerKey: PLAYER_KEY, signUp: store.signUp });
  const text =
    page === null
      ? null
      : (new DOMParser().parseFromString(page, 'text/html').body.textContent ?? '');
  return { page, text, asked: store.asked };
};

const WELCOME_TO_NEO = [
  'Welcome to emailit.io, neo.',
  '',
  'Your address is neo@emailit.io. Anyone who knows it',
  'can write to you.',
  '',
  'We cannot reset a lost password, and we will never',
  'ask you for it.',
  '',
  'This mailbox is not read. Replies go nowhere.',
  '',
  '-- emailit.io',
  '',
].join('\n');

describe('a sign-up the store accepts', () => {
  it('welcomes the reader at their new address and says how to read their mail', async () => {
    const { text } = await signUpWith('handle=neo&password=s3cret');

    expect(text).toContain('Welcome, neo@emailit.io');
    expect(text).toContain('a welcome message is waiting');
    expect(text).toContain('apt install mailutils');
  });

  it('links the reader back to the front page', async () => {
    const { page } = await signUpWith('handle=neo&password=s3cret');
    const back = new DOMParser().parseFromString(page ?? '', 'text/html').querySelector('a');

    expect(back?.textContent).toBe('Back to emailit.io');
    expect(back?.getAttribute('href')).toBe('/');
  });

  it('stores the handle, the md5 of the password and the player who signed up', async () => {
    const { asked } = await signUpWith('handle=neo&password=s3cret');

    expect(asked).toEqual([
      {
        handle: 'neo',
        passwordMd5: md5('s3cret'),
        playerKey: PLAYER_KEY,
        welcome: {
          sender: 'noreply@emailit.io',
          subject: 'Welcome to emailit.io',
          body: WELCOME_TO_NEO,
        },
      },
    ]);
  });

  it('never hands the store the password itself', async () => {
    const { asked } = await signUpWith('handle=neo&password=s3cret');

    expect(JSON.stringify(asked)).not.toContain('s3cret');
  });

  it('takes a handle in any case as the one lowercase address', async () => {
    const { asked, text } = await signUpWith('handle=NeO&password=s3cret');

    expect(asked.map((account) => account.handle)).toEqual(['neo']);
    expect(text).toContain('Welcome, neo@emailit.io');
  });

  it('decodes the form as a browser encodes it: %XX a byte, + a space', async () => {
    const { asked } = await signUpWith('handle=neo&password=a%26b+c%C3%A9');

    expect(asked.map((account) => account.passwordMd5)).toEqual([md5('a&b c\u00e9')]);
  });

  it('takes a password of exactly the minimum length', async () => {
    const { asked } = await signUpWith('handle=neo&password=abcd');

    expect(asked).toHaveLength(1);
  });

  it('takes a handle of exactly the longest length', async () => {
    const { asked } = await signUpWith(`handle=${'n'.repeat(24)}&password=s3cret`);

    expect(asked).toHaveLength(1);
  });
});

describe('a sign-up refused before the store is asked', () => {
  it.each([
    ['no handle', 'password=s3cret', 'Enter a username'],
    ['an empty handle', 'handle=&password=s3cret', 'Enter a username'],
    [
      'a handle that starts with a digit',
      'handle=1neo&password=s3cret',
      'Start with a letter, then letters, numbers, hyphens, or underscores',
    ],
    [
      'a handle with a space',
      'handle=neo+anderson&password=s3cret',
      'Start with a letter, then letters, numbers, hyphens, or underscores',
    ],
    [
      'a handle one character too long',
      `handle=${'n'.repeat(25)}&password=s3cret`,
      'Username must be 24 characters or less',
    ],
    ['no password', 'handle=neo', 'Password must be at least 4 characters'],
    [
      'a password one character short',
      'handle=neo&password=abc',
      'Password must be at least 4 characters',
    ],
  ])('refuses %s, saying why on the front page', async (_case, form, message) => {
    const { asked, text } = await signUpWith(form);

    expect(asked).toEqual([]);
    expect(text).toContain(message);
    expect(text).toContain(
      'curl -d "handle=<handle>&password=<password>" http://emailit.io/signup',
    );
  });

  it.each([
    'postmaster',
    'admin',
    'root',
    'abuse',
    'noreply',
    'support',
    'emailit',
    'talkit',
    'hireme',
    'guest',
    'nobody',
  ])('refuses the reserved handle %s', async (handle) => {
    const { asked, text } = await signUpWith(`handle=${handle}&password=s3cret`);

    expect(asked).toEqual([]);
    expect(text).toContain(`"${handle}" is a reserved system name`);
  });

  it('refuses a reserved handle typed in capitals, which is the same handle', async () => {
    const { asked, text } = await signUpWith('handle=PostMaster&password=s3cret');

    expect(asked).toEqual([]);
    expect(text).toContain('"postmaster" is a reserved system name');
  });
});

describe('a sign-up the store refuses', () => {
  it('says the handle is taken', async () => {
    const { text } = await signUpWith('handle=neo&password=s3cret', answered('taken'));

    expect(text).toContain('That handle is taken');
    expect(text).not.toContain('Welcome, neo@emailit.io');
  });

  it('says the day’s sign-ups are spent', async () => {
    const { text } = await signUpWith('handle=neo&password=s3cret', answered('capped'));

    expect(text).toContain('You have signed up 3 addresses today. Try again tomorrow.');
    expect(text).not.toContain('Welcome, neo@emailit.io');
  });

  it('answers with no page at all when the store cannot be reached', async () => {
    const { page } = await signUpWith('handle=neo&password=s3cret', UNREACHABLE);

    expect(page).toBeNull();
  });

  it.each([
    ['a word it does not know', answered('maybe')],
    ['nothing at all', answered(null)],
    ['a word alongside an error', { data: 'created', error: { message: 'timeout' } }],
  ])('answers with no page when the store says %s, rather than guessing', async (_case, reply) => {
    const { page } = await signUpWith('handle=neo&password=s3cret', reply);

    expect(page).toBeNull();
  });
});

describe('where a refused sign-up says why', () => {
  /** The one alert on the page, and the input on the line just above it. */
  const alertOn = (page: string | null) => {
    const document = new DOMParser().parseFromString(page ?? '', 'text/html');
    const alerts = document.querySelectorAll('[role="alert"]');
    const above = alerts[0]?.previousElementSibling?.querySelector('input');
    return {
      count: alerts.length,
      text: alerts[0]?.textContent,
      under: above?.getAttribute('name') ?? above?.getAttribute('type'),
    };
  };

  // Said next to what the reader has to change, rather than at the top of the page,
  // where it is easy to read straight past.
  it.each([
    [
      'a handle the store says is taken',
      'handle=neo&password=s3cret',
      answered('taken'),
      'That handle is taken',
      'handle',
    ],
    [
      'a reserved handle',
      'handle=root&password=s3cret',
      answered('created'),
      '"root" is a reserved system name',
      'handle',
    ],
    [
      'a handle not allowed',
      'handle=1neo&password=s3cret',
      answered('created'),
      'Start with a letter, then letters, numbers, hyphens, or underscores',
      'handle',
    ],
    [
      'a password too short',
      'handle=neo&password=abc',
      answered('created'),
      'Password must be at least 4 characters',
      'password',
    ],
    [
      'a sign-up over the day',
      'handle=neo&password=s3cret',
      answered('capped'),
      'You have signed up 3 addresses today. Try again tomorrow.',
      'submit',
    ],
  ])(
    'says why %s, as an alert under the field it is about',
    async (_case, form, reply, message, field) => {
      const { page } = await signUpWith(form, reply);

      expect(alertOn(page)).toEqual({ count: 1, text: message, under: field });
    },
  );
});

describe('the form a refused sign-up comes back with', () => {
  /** The sign-up form on the page a sign-up answered with. */
  const formOn = (page: string | null) => {
    const document = new DOMParser().parseFromString(page ?? '', 'text/html');
    return {
      handle: document.querySelector('input[name="handle"]'),
      password: document.querySelector('input[name="password"]'),
      document,
    };
  };

  it.each([
    ['refused before the store is asked', 'handle=Neo&password=abc', answered('created')],
    ['refused by the store as taken', 'handle=Neo&password=s3cret', answered('taken')],
    ['refused by the store as over the day', 'handle=Neo&password=s3cret', answered('capped')],
  ])('keeps the handle as it was typed and clears the password, %s', async (_case, form, reply) => {
    const { page } = await signUpWith(form, reply);
    const { handle, password } = formOn(page);

    expect(handle?.getAttribute('value')).toBe('Neo');
    expect(password?.getAttribute('value') ?? '').toBe('');
    expect(page).not.toContain('s3cret');
  });

  it('writes a handle made of markup back as the characters that were typed', async () => {
    const { page } = await signUpWith('handle=%22%3E%3Cb%3Ex&password=s3cret');
    const { handle, document } = formOn(page);

    expect(handle?.getAttribute('value')).toBe('"><b>x');
    expect(document.querySelector('b')).toBeNull();
  });
});
