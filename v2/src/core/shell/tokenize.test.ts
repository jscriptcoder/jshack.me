import { describe, expect, it } from 'vitest';
import { tokenize, type Token } from './tokenize';

/** Slice 3 of the shell parser added quoted strings + the unterminated-quote
 *  error path. The pipes chunk reshapes `tokens` from a flat string array into
 *  a typed `Token` stream so `|` can be distinguished from a literal word.
 *  (The redirections chunk will add a `redirect` token alongside `pipe`.) */

const word = (value: string): Token => ({ kind: 'word', value });
const pipe: Token = { kind: 'pipe' };
const redirect: Token = { kind: 'redirect' };

describe('tokenize', () => {
  it('returns no tokens for empty input', () => {
    expect(tokenize('')).toEqual({ ok: true, tokens: [] });
  });

  it('returns no tokens for whitespace-only input', () => {
    expect(tokenize('   \t  ')).toEqual({ ok: true, tokens: [] });
  });

  it('returns a single unchanged word token', () => {
    expect(tokenize('cat')).toEqual({ ok: true, tokens: [word('cat')] });
  });

  it('splits on internal whitespace', () => {
    expect(tokenize('cat /etc/passwd')).toEqual({
      ok: true,
      tokens: [word('cat'), word('/etc/passwd')],
    });
  });

  it('trims surrounding whitespace', () => {
    expect(tokenize('   cat /etc/passwd   ')).toEqual({
      ok: true,
      tokens: [word('cat'), word('/etc/passwd')],
    });
  });

  it('collapses runs of whitespace between tokens', () => {
    expect(tokenize('cat    /etc/passwd')).toEqual({
      ok: true,
      tokens: [word('cat'), word('/etc/passwd')],
    });
  });

  it('treats tabs as whitespace separators', () => {
    expect(tokenize('cat\t/etc/passwd\tnotes.txt')).toEqual({
      ok: true,
      tokens: [word('cat'), word('/etc/passwd'), word('notes.txt')],
    });
  });

  it('preserves dash-prefixed tokens for the binder', () => {
    // Tokeniser is command-agnostic — it doesn't know `-n` is a flag, it
    // just yields the token. The binder decides what to do with it.
    expect(tokenize('cat -n /etc/passwd')).toEqual({
      ok: true,
      tokens: [word('cat'), word('-n'), word('/etc/passwd')],
    });
  });

  it('emits a double-quoted string with internal whitespace as a single token', () => {
    expect(tokenize('echo "hello world"')).toEqual({
      ok: true,
      tokens: [word('echo'), word('hello world')],
    });
  });

  it('emits a single-quoted string with internal whitespace as a single token', () => {
    expect(tokenize("echo 'hello world'")).toEqual({
      ok: true,
      tokens: [word('echo'), word('hello world')],
    });
  });

  it('preserves an empty quoted string as an empty token', () => {
    // `echo ""` and `echo` differ in arg count even though the rendered
    // output is the same. The tokeniser must keep that distinction.
    expect(tokenize('echo ""')).toEqual({ ok: true, tokens: [word('echo'), word('')] });
  });

  it('preserves runs of whitespace inside a quoted string', () => {
    expect(tokenize('echo "a   b"')).toEqual({
      ok: true,
      tokens: [word('echo'), word('a   b')],
    });
  });

  it('concatenates adjacent quoted and unquoted segments into one token', () => {
    // Real-bash behaviour — `"a"b"c"` is the single token `abc`. Falls out
    // of the state machine; locked here so a refactor can't lose it.
    expect(tokenize('"a"b"c"')).toEqual({ ok: true, tokens: [word('abc')] });
  });

  it('preserves the opposite quote character inside a quoted string', () => {
    expect(tokenize(`echo "it's"`)).toEqual({ ok: true, tokens: [word('echo'), word("it's")] });
    expect(tokenize(`echo '"foo"'`)).toEqual({
      ok: true,
      tokens: [word('echo'), word('"foo"')],
    });
  });

  it('strips quotes from a dash-prefixed quoted token (so the binder still sees the flag)', () => {
    // Real-bash semantics — quotes affect word-splitting, NOT flag-vs-positional
    // routing. The binder receives `-n` literally regardless of quoting.
    expect(tokenize('cat "-n" /etc/passwd')).toEqual({
      ok: true,
      tokens: [word('cat'), word('-n'), word('/etc/passwd')],
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

  // ---- Pipe operator ----

  it('emits a pipe token for `|` between two commands', () => {
    expect(tokenize('cat /etc/passwd | grep root')).toEqual({
      ok: true,
      tokens: [word('cat'), word('/etc/passwd'), pipe, word('grep'), word('root')],
    });
  });

  it('treats `|` as an operator even without surrounding whitespace', () => {
    // Real-bash splits `a|b` into word(a), pipe, word(b) — the operator
    // flushes the current word buffer regardless of adjacency.
    expect(tokenize('echo a|b')).toEqual({
      ok: true,
      tokens: [word('echo'), word('a'), pipe, word('b')],
    });
  });

  it('emits consecutive pipe tokens for `||` (parse-time rejects, tokenizer does not)', () => {
    expect(tokenize('cat || grep')).toEqual({
      ok: true,
      tokens: [word('cat'), pipe, pipe, word('grep')],
    });
  });

  it('emits a leading pipe token verbatim', () => {
    expect(tokenize('| cat')).toEqual({ ok: true, tokens: [pipe, word('cat')] });
  });

  it('emits a trailing pipe token verbatim', () => {
    expect(tokenize('cat |')).toEqual({ ok: true, tokens: [word('cat'), pipe] });
  });

  it('keeps `|` literal inside a double-quoted string', () => {
    expect(tokenize('echo "a|b"')).toEqual({ ok: true, tokens: [word('echo'), word('a|b')] });
  });

  it('keeps `|` literal inside a single-quoted string', () => {
    expect(tokenize("echo 'a|b'")).toEqual({ ok: true, tokens: [word('echo'), word('a|b')] });
  });

  it('emits a redirect token for `>` outside quotes', () => {
    expect(tokenize('echo hi > f')).toEqual({
      ok: true,
      tokens: [word('echo'), word('hi'), redirect, word('f')],
    });
  });

  it('flushes the word buffer when `>` is adjacent (no surrounding spaces)', () => {
    expect(tokenize('echo a>b')).toEqual({
      ok: true,
      tokens: [word('echo'), word('a'), redirect, word('b')],
    });
  });

  it('keeps `>` literal inside a double-quoted string', () => {
    expect(tokenize('echo "a>b"')).toEqual({ ok: true, tokens: [word('echo'), word('a>b')] });
  });

  it('keeps `>` literal inside a single-quoted string', () => {
    expect(tokenize("echo 'a>b'")).toEqual({ ok: true, tokens: [word('echo'), word('a>b')] });
  });

  it('emits a trailing redirect token verbatim (parse-time rejects, tokenizer does not)', () => {
    expect(tokenize('echo >')).toEqual({ ok: true, tokens: [word('echo'), redirect] });
  });
});
