import { describe, expect, it } from 'vitest';
import {
  alreadyRemovedLine,
  noCommentLine,
  noThreadLine,
  readRemovalOrder,
  removedLine,
  removingCommentLine,
  removingThreadLine,
} from './removal.js';

/**
 * What the operator's removal script reads from its words and prints. Nothing checks the
 * order again before the thread or comment is gone, so a near miss is refused, never
 * repaired; and a title or handle a player wrote reaches the operator's own terminal, so
 * nothing in it may act there.
 */

const HOST = 'db.example.co';

describe('reading what the operator asked to remove', () => {
  it('reads a thread by its id', () => {
    expect(readRemovalOrder(['thread', '12'])).toEqual({ kind: 'thread', threadId: 12 });
  });

  it('reads a comment by its thread and its number', () => {
    expect(readRemovalOrder(['comment', '12', '3'])).toEqual({
      kind: 'comment',
      threadId: 12,
      number: 3,
    });
  });

  it('reads the longest id a thread can have, and the longest number a comment can', () => {
    expect(readRemovalOrder(['comment', '999999999999999', '999999999'])).toEqual({
      kind: 'comment',
      threadId: 999999999999999,
      number: 999999999,
    });
  });

  it.each([
    ['no words', []],
    ['an unknown kind', ['post', '12']],
    ['a kind in capitals', ['Thread', '12']],
    ['a thread with no id', ['thread']],
    ['a thread with a number after its id', ['thread', '12', '3']],
    ['a comment with no number', ['comment', '12']],
    ['a comment with a word after its number', ['comment', '12', '3', 'now']],
    ['an id of 0', ['thread', '0']],
    ['a number of 0', ['comment', '12', '0']],
    ['a leading zero', ['thread', '012']],
    ['a sign', ['comment', '12', '+3']],
    ['a minus', ['thread', '-12']],
    ['a fraction', ['thread', '1.5']],
    ['a blank around the id', ['thread', '12 ']],
    ['letters', ['thread', 'abc']],
    ['an id too long to stay exact', ['thread', '1000000000000000']],
    ['a number too long for the count', ['comment', '12', '1000000000']],
  ])('refuses %s', (_case, words) => {
    expect(readRemovalOrder(words)).toBeNull();
  });
});

describe('what the script prints', () => {
  it('names the thread it is about to remove, with its comments, and the database', () => {
    expect(
      removingThreadLine(
        { kind: 'thread', threadId: 12 },
        { title: 'Free WiFi', author: 'neo', commentCount: 7 },
        HOST,
      ),
    ).toBe('Removing thread #12 "Free WiFi" by "neo", 7 comments, on db.example.co');
  });

  it('counts a thread of one comment as one', () => {
    expect(
      removingThreadLine(
        { kind: 'thread', threadId: 12 },
        { title: 'Free WiFi', author: 'neo', commentCount: 1 },
        HOST,
      ),
    ).toBe('Removing thread #12 "Free WiFi" by "neo", 1 comment, on db.example.co');
  });

  it('names the comment it is about to remove, and the database', () => {
    expect(
      removingCommentLine({ kind: 'comment', threadId: 12, number: 3 }, { author: 'neo' }, HOST),
    ).toBe('Removing comment #3 on #12 by "neo" on db.example.co');
  });

  it('says when there is nothing to remove, naming the database', () => {
    expect(noThreadLine({ kind: 'thread', threadId: 12 }, HOST)).toBe(
      'No thread #12 on db.example.co',
    );
    expect(noCommentLine({ kind: 'comment', threadId: 12, number: 9 }, HOST)).toBe(
      'No comment #9 on #12 on db.example.co',
    );
    expect(alreadyRemovedLine({ kind: 'comment', threadId: 12, number: 3 }, HOST)).toBe(
      'Comment #3 on #12 is already removed on db.example.co',
    );
  });

  it('says what it removed', () => {
    expect(removedLine({ kind: 'thread', threadId: 12 })).toBe('Removed thread #12');
    expect(removedLine({ kind: 'comment', threadId: 12, number: 3 })).toBe(
      'Removed comment #3 on #12',
    );
  });

  describe('nothing a player wrote acts on the terminal', () => {
    const titled = (title: string) =>
      removingThreadLine(
        { kind: 'thread', threadId: 12 },
        { title, author: 'neo', commentCount: 0 },
        HOST,
      );
    const character = (code: number) => String.fromCodePoint(code);

    it.each([
      ['a quote', 'say "hi"', String.raw`"say \"hi\""`],
      ['a backslash', String.raw`a\b`, String.raw`"a\\b"`],
      ['an escape', `${character(0x1b)}[2J`, String.raw`"\u001b[2J"`],
      ['a NUL', `a${character(0x00)}b`, String.raw`"a\u0000b"`],
      ['the last C0 control', `a${character(0x1f)}b`, String.raw`"a\u001fb"`],
      ['a DEL', `a${character(0x7f)}b`, String.raw`"a\u007fb"`],
      ['the first C1 control', `a${character(0x80)}b`, String.raw`"a\u0080b"`],
      ['a C1 introducer', `${character(0x9b)}2J`, String.raw`"\u009b2J"`],
      ['the last C1 control', `a${character(0x9f)}b`, String.raw`"a\u009fb"`],
      ['a right-to-left override', `a${character(0x202e)}b`, String.raw`"a\u202eb"`],
      ['a right-to-left isolate', `a${character(0x2067)}b`, String.raw`"a\u2067b"`],
      ['a zero-width joiner', `a${character(0x200d)}b`, String.raw`"a\u200db"`],
      ['a tag beyond the first plane', `a${character(0xe0001)}b`, String.raw`"a\u{e0001}b"`],
    ])('spells out %s in a title', (_case, title, shown) => {
      expect(titled(title)).toBe(`Removing thread #12 ${shown} by "neo", 0 comments, on ${HOST}`);
    });

    it.each([
      ['a tilde, the last printable before DEL', '~', '"~"'],
      ['a no-break space, the first printable after C1', character(0xa0), `"${character(0xa0)}"`],
      ['an accent', 'café', '"café"'],
      ['an emoji', '📶', '"📶"'],
    ])('leaves %s as it is', (_case, title, shown) => {
      expect(titled(title)).toBe(`Removing thread #12 ${shown} by "neo", 0 comments, on ${HOST}`);
    });

    it('spells out what a handle holds, as a title', () => {
      expect(
        removingCommentLine(
          { kind: 'comment', threadId: 12, number: 3 },
          { author: `n${character(0x9b)}o` },
          HOST,
        ),
      ).toBe(String.raw`Removing comment #3 on #12 by "n\u009bo" on db.example.co`);
    });
  });
});
