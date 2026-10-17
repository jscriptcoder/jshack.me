import { describe, expect, it } from 'vitest';
import { parseSecrets } from './parseSecrets.js';

/**
 * The gate every build passes through: `JSHACK_SECRETS` arrives as one pasted JSON
 * string, and a slip in that paste would not crash anything — it would quietly ship a
 * world whose difficulty curve is wrong. These rules are the invariants the pools have
 * always had to hold, checked where the data now enters, so they run on Vercel too.
 */

const uncrackableWords = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `harbour${i}light`);

const validSecrets = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  UNCRACKABLE_PASSWORDS: uncrackableWords(41),
  CRACKABLE_PASSWORDS: ['admin', 'cisco', 'sunshine'],
  COMMON_PASSWORDS: ['123456', 'qwerty'],
  WIFI_PASSWORDS: ['coffeehouse', 'guestwifi'],
  ...overrides,
});

const parse = (overrides: Record<string, unknown> = {}) =>
  parseSecrets(JSON.stringify(validSecrets(overrides)));

describe('parseSecrets', () => {
  it('hands back all four lists, words and order untouched', () => {
    expect(parse()).toEqual({
      ok: true,
      secrets: {
        UNCRACKABLE_PASSWORDS: uncrackableWords(41),
        CRACKABLE_PASSWORDS: ['admin', 'cisco', 'sunshine'],
        COMMON_PASSWORDS: ['123456', 'qwerty'],
        WIFI_PASSWORDS: ['coffeehouse', 'guestwifi'],
      },
    });
  });

  describe('fails naming the variable when there is nothing usable to read', () => {
    it('when it is not set at all', () => {
      expect(parseSecrets(undefined)).toEqual({ ok: false, error: 'JSHACK_SECRETS: not set' });
    });

    it('when it is set to nothing', () => {
      expect(parseSecrets('')).toEqual({ ok: false, error: 'JSHACK_SECRETS: not set' });
    });

    it('when it is not JSON', () => {
      expect(parseSecrets('{UNCRACKABLE_PASSWORDS: [')).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS: not valid JSON',
      });
    });

    it('when it is JSON but not an object of lists', () => {
      expect(parseSecrets('["admin"]')).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS: must be a JSON object',
      });
    });
  });

  describe('fails naming the key when the shape is wrong', () => {
    it('when a list is missing', () => {
      const secrets = validSecrets();
      delete secrets['WIFI_PASSWORDS'];

      expect(parseSecrets(JSON.stringify(secrets))).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.WIFI_PASSWORDS: missing',
      });
    });

    it('when a key is not one of the four — a typo beside the right key must not pass', () => {
      expect(parse({ UNCRACKABLE_PASWORDS: ['typo1234'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.UNCRACKABLE_PASWORDS: not a known list',
      });
    });

    it('when a list is not a list', () => {
      expect(parse({ COMMON_PASSWORDS: 'qwerty' })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.COMMON_PASSWORDS: must be a list of words',
      });
    });

    it('when a list holds something other than a word, named once however many there are', () => {
      expect(parse({ COMMON_PASSWORDS: ['qwerty', 123456, null] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.COMMON_PASSWORDS: must be a list of words',
      });
    });
  });

  describe('fails naming the key for a list that would quietly break a door', () => {
    it('when a list is empty — a branch of the roll with nothing to draw is dead', () => {
      expect(parse({ WIFI_PASSWORDS: [] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.WIFI_PASSWORDS: empty',
      });
    });

    it('when a word is empty — an empty password is not a password', () => {
      expect(parse({ CRACKABLE_PASSWORDS: ['admin', '', 'cisco'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.CRACKABLE_PASSWORDS: holds a blank word',
      });
    });

    it('when a word is only spaces', () => {
      expect(parse({ COMMON_PASSWORDS: ['qwerty', '   '] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.COMMON_PASSWORDS: holds a blank word',
      });
    });

    it('when a word has spaces around it — a careless paste no wordlist line could match', () => {
      expect(parse({ WIFI_PASSWORDS: ['coffeehouse', ' guestwifi'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.WIFI_PASSWORDS: " guestwifi" has spaces around it',
      });
    });

    it('when a word has a space after it', () => {
      expect(parse({ WIFI_PASSWORDS: ['coffeehouse ', 'guestwifi'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.WIFI_PASSWORDS: "coffeehouse " has spaces around it',
      });
    });

    it('when a list repeats a word — a repeat is a silently doubled draw weight', () => {
      expect(parse({ COMMON_PASSWORDS: ['qwerty', '123456', 'qwerty'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.COMMON_PASSWORDS: "qwerty" appears more than once',
      });
    });

    it('names a word repeated three times once', () => {
      expect(parse({ COMMON_PASSWORDS: ['qwerty', 'qwerty', 'qwerty'] })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.COMMON_PASSWORDS: "qwerty" appears more than once',
      });
    });

    it('counts words differing only in case as two passwords, since their hashes differ', () => {
      expect(parse({ COMMON_PASSWORDS: ['Dragon', 'dragon'] })).toMatchObject({ ok: true });
    });
  });

  describe('keeps the uncrackable pool large enough that harvesting cannot exhaust it', () => {
    // Wordlist growth is the progression: harvest a plaintext, append it, and your
    // coverage widens across every machine that drew the same word. That stays a
    // progression only while the gain is incremental; a short pool means a handful of
    // finds unlocks everything.
    it('fails at 39 words', () => {
      expect(parse({ UNCRACKABLE_PASSWORDS: uncrackableWords(39) })).toEqual({
        ok: false,
        error: 'JSHACK_SECRETS.UNCRACKABLE_PASSWORDS: 39 words, needs at least 40',
      });
    });

    it('passes at exactly 40', () => {
      expect(parse({ UNCRACKABLE_PASSWORDS: uncrackableWords(40) })).toMatchObject({ ok: true });
    });

    it('fails when the crackable pool is as large', () => {
      const crackable = Array.from({ length: 41 }, (_, i) => `easy${i}`);

      expect(parse({ CRACKABLE_PASSWORDS: crackable })).toEqual({
        ok: false,
        error:
          'JSHACK_SECRETS.UNCRACKABLE_PASSWORDS: 41 words, needs more than CRACKABLE_PASSWORDS (41)',
      });
    });

    it('passes when it holds one more than the crackable pool', () => {
      const crackable = Array.from({ length: 40 }, (_, i) => `easy${i}`);

      expect(parse({ CRACKABLE_PASSWORDS: crackable })).toMatchObject({ ok: true });
    });
  });

  describe('fails when an uncrackable word is somewhere a wordlist could pick it up', () => {
    // The one invariant that cannot slip. A door that drew "uncrackable" but landed on a
    // word the shipped wordlist also holds falls despite the roll, and nothing looks
    // wrong: the curve is just wrong.
    const leaked = 'harbour7light';

    it('in the crackable pool, which ships whole in the wordlist', () => {
      expect(parse({ CRACKABLE_PASSWORDS: ['admin', leaked] })).toEqual({
        ok: false,
        error: `JSHACK_SECRETS.UNCRACKABLE_PASSWORDS: "${leaked}" is also in CRACKABLE_PASSWORDS`,
      });
    });

    it('in the common padding, which ships in the wordlist too', () => {
      expect(parse({ COMMON_PASSWORDS: ['qwerty', leaked] })).toEqual({
        ok: false,
        error: `JSHACK_SECRETS.UNCRACKABLE_PASSWORDS: "${leaked}" is also in COMMON_PASSWORDS`,
      });
    });

    it('in the wifi pool, whose keys a player cracks and reads in the clear', () => {
      expect(parse({ WIFI_PASSWORDS: ['coffeehouse', leaked] })).toEqual({
        ok: false,
        error: `JSHACK_SECRETS.UNCRACKABLE_PASSWORDS: "${leaked}" is also in WIFI_PASSWORDS`,
      });
    });
  });

  it('names every shape problem at once, one per line', () => {
    const secrets = validSecrets({ EXTRA_PASSWORDS: [] });
    delete secrets['WIFI_PASSWORDS'];

    expect(parseSecrets(JSON.stringify(secrets))).toEqual({
      ok: false,
      error: [
        'JSHACK_SECRETS.WIFI_PASSWORDS: missing',
        'JSHACK_SECRETS.EXTRA_PASSWORDS: not a known list',
      ].join('\n'),
    });
  });

  it('names every broken rule at once, one per line, so one paste fixes them all', () => {
    expect(
      parse({ COMMON_PASSWORDS: ['qwerty', ''], WIFI_PASSWORDS: ['guestwifi', 'guestwifi'] }),
    ).toEqual({
      ok: false,
      error: [
        'JSHACK_SECRETS.COMMON_PASSWORDS: holds a blank word',
        'JSHACK_SECRETS.WIFI_PASSWORDS: "guestwifi" appears more than once',
      ].join('\n'),
    });
  });
});
