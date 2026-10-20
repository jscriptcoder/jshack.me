import { describe, expect, it } from 'vitest';
import { answerApply, type BoardApplication } from './apply.js';

/**
 * Applying at hireme.io: a form POSTed to `/apply` becomes a mail holding the applicant's
 * private board address, or the reason it did not. What the store answers and which
 * addresses are drawn are scripted here; what the store is asked, and the page the reader
 * gets back, are the behaviour.
 */

/** What the store answers, as it comes off the wire. */
type StoreReply = { readonly data: unknown; readonly error: unknown };

/** The store's word for an outcome, as it comes back. */
const answered = (word: unknown): StoreReply => ({ data: word, error: null });

const UNREACHABLE: StoreReply = { data: null, error: { message: 'connection refused' } };

/** A store that answers each application with the next of `replies`, the last one from
 *  then on, and remembers what it was asked. */
const storeAnswering = (replies: readonly StoreReply[]) => {
  const asked: BoardApplication[] = [];
  return {
    asked,
    apply: async (application: BoardApplication) => {
      asked.push(application);
      return replies[Math.min(asked.length, replies.length) - 1] ?? UNREACHABLE;
    },
  };
};

/** Addresses drawn in turn: 194.0.0.2, 194.0.0.3, and on. */
const scriptedDraw = () => {
  let drawn = 0;
  return () => {
    drawn += 1;
    return `194.0.0.${drawn + 1}`;
  };
};

/** The page an application answers with, as a reader sees it: the text, markup and
 *  entities gone. Null when there was no page to see. */
const applyWith = async (form: string, replies: readonly StoreReply[] = [answered('sent')]) => {
  const store = storeAnswering(replies);
  const page = await answerApply({ form, apply: store.apply, drawBoardAddress: scriptedDraw() });
  const text =
    page === null
      ? null
      : (new DOMParser().parseFromString(page, 'text/html').body.textContent ?? '');
  return { page, text, asked: store.asked };
};

const MAIL_TO_NEO = [
  'Thanks for applying, neo.',
  '',
  'Your contractor board is at http://{address}/',
  '',
  'Open it with lynx or curl:',
  '',
  '  lynx http://{address}/',
  '',
  '-- hireme.io',
  '',
].join('\n');

const THANKS_NEO = 'Thanks, neo. We have sent your contractor board to neo@emailit.io.';

describe('an application the store sends', () => {
  it('thanks the applicant and says where the board was sent', async () => {
    const { text } = await applyWith('email=neo@emailit.io');

    expect(text).toContain(THANKS_NEO);
  });

  // Anyone may apply for any handle, so a page showing the address would hand the board
  // to whoever typed the handle.
  it('never shows the board address on the page', async () => {
    const { page } = await applyWith('email=neo@emailit.io');

    expect(page).not.toContain('194.');
  });

  it('asks the store for the handle, a drawn address and the mail to deliver', async () => {
    const { asked } = await applyWith('email=neo@emailit.io');

    expect(asked).toEqual([
      {
        handle: 'neo',
        candidateAddress: '194.0.0.2',
        mail: {
          sender: 'jobs@hireme.io',
          subject: 'Your hireme.io application',
          body: MAIL_TO_NEO,
        },
      },
    ]);
  });

  it.each([
    ['a bare handle', 'email=neo'],
    ['a handle in capitals', 'email=Neo'],
    ['an address padded with spaces', 'email=+neo+'],
    ['an address in capitals', 'email=NEO%40EMAILIT.IO'],
  ])('reads %s as the one lowercase address', async (_case, form) => {
    const { asked, text } = await applyWith(form);

    expect(asked.map((application) => application.handle)).toEqual(['neo']);
    expect(text).toContain(THANKS_NEO);
  });
});

describe('an address another handle already holds', () => {
  it('is drawn again, and the applicant still gets a board', async () => {
    const { asked, text } = await applyWith('email=neo', [answered('collision'), answered('sent')]);

    expect(asked.map((application) => application.candidateAddress)).toEqual([
      '194.0.0.2',
      '194.0.0.3',
    ]);
    expect(text).toContain(THANKS_NEO);
  });

  it('is drawn again after four collisions in a row', async () => {
    const collision = answered('collision');
    const { asked, text } = await applyWith('email=neo', [
      collision,
      collision,
      collision,
      collision,
      answered('sent'),
    ]);

    expect(asked).toHaveLength(5);
    expect(text).toContain(THANKS_NEO);
  });

  it('answers with no page after five collisions in a row', async () => {
    const { asked, page } = await applyWith('email=neo', [answered('collision')]);

    expect(asked).toHaveLength(5);
    expect(page).toBeNull();
  });
});

describe('an application refused', () => {
  it.each([
    ['no field', '', 'Enter your emailit.io address'],
    ['an empty address', 'email=', 'Enter your emailit.io address'],
    ['only spaces', 'email=+++', 'Enter your emailit.io address'],
    ['another domain', 'email=neo@gmail.com', 'Only emailit.io addresses can apply'],
    ['a handle no account could hold', 'email=a!b', 'No such mailbox'],
    ['a system name no account is given', 'email=root', 'No such mailbox'],
    ['an address with no handle', 'email=@emailit.io', 'No such mailbox'],
  ])('refuses %s without asking the store', async (_case, form, message) => {
    const { asked, text } = await applyWith(form);

    expect(asked).toEqual([]);
    expect(text).toContain(message);
    expect(text).not.toContain(THANKS_NEO);
  });

  it('says there is no such mailbox when the store has no account for the handle', async () => {
    const { asked, text } = await applyWith('email=smith', [answered('no_mailbox')]);

    expect(asked).toHaveLength(1);
    expect(text).toContain('No such mailbox');
    expect(text).not.toContain(THANKS_NEO);
  });

  it('says the application is already in when the last mail was too recent', async () => {
    const { asked, page, text } = await applyWith('email=neo', [answered('recent')]);

    expect(asked).toHaveLength(1);
    expect(text).toContain('We already have your application. Check your inbox.');
    expect(text).not.toContain(THANKS_NEO);
    expect(page).not.toContain('194.');
  });
});

describe('a store that has not said what happened', () => {
  it('answers with no page when the store cannot be reached', async () => {
    const { page } = await applyWith('email=neo', [UNREACHABLE]);

    expect(page).toBeNull();
  });

  it('answers with no page when the store fails on a redraw', async () => {
    const { asked, page } = await applyWith('email=neo', [answered('collision'), UNREACHABLE]);

    expect(asked).toHaveLength(2);
    expect(page).toBeNull();
  });

  it.each([
    ['a word it does not know', answered('maybe')],
    ['nothing at all', answered(null)],
    ['a word alongside an error', { data: 'sent', error: { message: 'timeout' } }],
  ])('answers with no page when the store says %s, rather than guessing', async (_case, reply) => {
    const { page } = await applyWith('email=neo', [reply]);

    expect(page).toBeNull();
  });
});

describe('where a refused application says why', () => {
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

  // Said next to what the reader has to change; under the button when nothing typed is
  // wrong and only time will help.
  it.each([
    ['nothing typed', 'email=', answered('sent'), 'Enter your emailit.io address', 'email'],
    [
      'another domain',
      'email=neo@gmail.com',
      answered('sent'),
      'Only emailit.io addresses can apply',
      'email',
    ],
    ['an impossible handle', 'email=a!b', answered('sent'), 'No such mailbox', 'email'],
    ['a handle with no account', 'email=smith', answered('no_mailbox'), 'No such mailbox', 'email'],
    [
      'an application too soon',
      'email=neo',
      answered('recent'),
      'We already have your application. Check your inbox.',
      'submit',
    ],
  ])('says why for %s, as an alert under its line', async (_case, form, reply, message, line) => {
    const { page } = await applyWith(form, [reply]);

    expect(alertOn(page)).toEqual({ count: 1, text: message, under: line });
  });
});

describe('the form a refused application comes back with', () => {
  const typedOn = (page: string | null) =>
    new DOMParser()
      .parseFromString(page ?? '', 'text/html')
      .querySelector('input[name="email"]')
      ?.getAttribute('value');

  it.each([
    ['refused before the store is asked', 'email=Neo@Gmail.com', answered('sent'), 'Neo@Gmail.com'],
    ['refused by the store', 'email=+Smith', answered('no_mailbox'), ' Smith'],
    ['too soon', 'email=Neo', answered('recent'), 'Neo'],
  ])('keeps the address as it was typed, %s', async (_case, form, reply, typed) => {
    const { page } = await applyWith(form, [reply]);

    expect(typedOn(page)).toBe(typed);
  });

  it('writes an address made of markup back as the characters that were typed', async () => {
    const { page } = await applyWith('email=%22%3E%3Cb%3Ex');
    const document = new DOMParser().parseFromString(page ?? '', 'text/html');

    expect(typedOn(page)).toBe('"><b>x');
    expect(document.querySelector('b')).toBeNull();
  });
});
