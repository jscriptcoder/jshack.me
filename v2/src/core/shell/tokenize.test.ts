import { describe, expect, it } from 'vitest';
import { tokenize } from './tokenize';

/** Slice 3 of the shell parser adds quoted strings + the unterminated-quote
 *  error path. The Slice 1 pivot — which left `tokenize` returning a plain
 *  array — reverses here: the signature reshapes to a Result so the
 *  syntax-error branch flows through to the dispatcher. */

describe('tokenize', () => {
  it('returns no tokens for empty input', () => {
    expect(tokenize('')).toEqual({ ok: true, tokens: [] });
  });

  it('returns no tokens for whitespace-only input', () => {
    expect(tokenize('   \t  ')).toEqual({ ok: true, tokens: [] });
  });

  it('returns a single unchanged token', () => {
    expect(tokenize('cat')).toEqual({ ok: true, tokens: ['cat'] });
  });

  it('splits on internal whitespace', () => {
    expect(tokenize('cat /etc/passwd')).toEqual({ ok: true, tokens: ['cat', '/etc/passwd'] });
  });

  it('trims surrounding whitespace', () => {
    expect(tokenize('   cat /etc/passwd   ')).toEqual({
      ok: true,
      tokens: ['cat', '/etc/passwd'],
    });
  });

  it('collapses runs of whitespace between tokens', () => {
    expect(tokenize('cat    /etc/passwd')).toEqual({
      ok: true,
      tokens: ['cat', '/etc/passwd'],
    });
  });

  it('treats tabs as whitespace separators', () => {
    expect(tokenize('cat\t/etc/passwd\tnotes.txt')).toEqual({
      ok: true,
      tokens: ['cat', '/etc/passwd', 'notes.txt'],
    });
  });

  it('preserves dash-prefixed tokens for the binder', () => {
    // Tokeniser is command-agnostic — it doesn't know `-n` is a flag, it
    // just yields the token. The binder decides what to do with it.
    expect(tokenize('cat -n /etc/passwd')).toEqual({
      ok: true,
      tokens: ['cat', '-n', '/etc/passwd'],
    });
  });

  it('emits a double-quoted string with internal whitespace as a single token', () => {
    expect(tokenize('echo "hello world"')).toEqual({
      ok: true,
      tokens: ['echo', 'hello world'],
    });
  });

  it('emits a single-quoted string with internal whitespace as a single token', () => {
    expect(tokenize("echo 'hello world'")).toEqual({
      ok: true,
      tokens: ['echo', 'hello world'],
    });
  });

  it('preserves an empty quoted string as an empty token', () => {
    // `echo ""` and `echo` differ in arg count even though the rendered
    // output is the same. The tokeniser must keep that distinction.
    expect(tokenize('echo ""')).toEqual({ ok: true, tokens: ['echo', ''] });
  });

  it('preserves runs of whitespace inside a quoted string', () => {
    expect(tokenize('echo "a   b"')).toEqual({ ok: true, tokens: ['echo', 'a   b'] });
  });

  it('concatenates adjacent quoted and unquoted segments into one token', () => {
    // Real-bash behaviour — `"a"b"c"` is the single token `abc`. Falls out
    // of the state machine; locked here so a refactor can't lose it.
    expect(tokenize('"a"b"c"')).toEqual({ ok: true, tokens: ['abc'] });
  });

  it('preserves the opposite quote character inside a quoted string', () => {
    expect(tokenize(`echo "it's"`)).toEqual({ ok: true, tokens: ['echo', "it's"] });
    expect(tokenize(`echo '"foo"'`)).toEqual({ ok: true, tokens: ['echo', '"foo"'] });
  });

  it('strips quotes from a dash-prefixed quoted token (so the binder still sees the flag)', () => {
    // Real-bash semantics — quotes affect word-splitting, NOT flag-vs-positional
    // routing. The binder receives `-n` literally regardless of quoting.
    expect(tokenize('cat "-n" /etc/passwd')).toEqual({
      ok: true,
      tokens: ['cat', '-n', '/etc/passwd'],
    });
  });

  it('reports a syntax error for an unterminated double-quoted string', () => {
    expect(tokenize('echo "unterminated')).toEqual({
      ok: false,
      error: 'syntax error: unexpected end of file',
    });
  });

  it('reports a syntax error for an unterminated single-quoted string', () => {
    expect(tokenize("echo 'unterminated")).toEqual({
      ok: false,
      error: 'syntax error: unexpected end of file',
    });
  });
});
