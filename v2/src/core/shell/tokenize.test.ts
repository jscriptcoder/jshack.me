import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

/** Slice 1 of the shell parser: whitespace-only tokenisation. Quoted strings
 *  and the unterminated-quote error are added in Slice 3, which reshapes
 *  the return type to a Result. */

describe('tokenize', () => {
  it('returns no tokens for empty input', () => {
    expect(tokenize('')).toEqual([]);
  });

  it('returns no tokens for whitespace-only input', () => {
    expect(tokenize('   \t  ')).toEqual([]);
  });

  it('returns a single unchanged token', () => {
    expect(tokenize('cat')).toEqual(['cat']);
  });

  it('splits on internal whitespace', () => {
    expect(tokenize('cat /etc/passwd')).toEqual(['cat', '/etc/passwd']);
  });

  it('trims surrounding whitespace', () => {
    expect(tokenize('   cat /etc/passwd   ')).toEqual(['cat', '/etc/passwd']);
  });

  it('collapses runs of whitespace between tokens', () => {
    expect(tokenize('cat    /etc/passwd')).toEqual(['cat', '/etc/passwd']);
  });

  it('treats tabs as whitespace separators', () => {
    expect(tokenize('cat\t/etc/passwd\tnotes.txt')).toEqual(['cat', '/etc/passwd', 'notes.txt']);
  });

  it('preserves dash-prefixed tokens for the binder', () => {
    // Tokeniser is command-agnostic — it doesn't know `-n` is a flag, it
    // just yields the token. The binder decides what to do with it.
    expect(tokenize('cat -n /etc/passwd')).toEqual(['cat', '-n', '/etc/passwd']);
  });
});
