import { describe, it, expect } from 'vitest';
import { tokenize } from './tokenize';

const word = (value: string) => ({ kind: 'word' as const, value });
const pipe = { kind: 'pipe' as const };
const redirect = { kind: 'redirect' as const };

describe('tokenize', () => {
  describe('empty and whitespace', () => {
    it('returns empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });

    it('returns empty array for whitespace only', () => {
      expect(tokenize('   \t  ')).toEqual([]);
    });
  });

  describe('plain words', () => {
    it('tokenizes a single word', () => {
      expect(tokenize('ls')).toEqual([word('ls')]);
    });

    it('tokenizes multiple words separated by spaces', () => {
      expect(tokenize('ls -la /etc')).toEqual([word('ls'), word('-la'), word('/etc')]);
    });

    it('collapses runs of whitespace between words', () => {
      expect(tokenize('ls    -la  \t  /etc')).toEqual([word('ls'), word('-la'), word('/etc')]);
    });

    it('ignores leading and trailing whitespace', () => {
      expect(tokenize('  ls -la  ')).toEqual([word('ls'), word('-la')]);
    });
  });

  describe('single quotes', () => {
    it('groups spaces inside single quotes into one token', () => {
      expect(tokenize("echo 'hello world'")).toEqual([word('echo'), word('hello world')]);
    });

    it('treats backslashes literally inside single quotes', () => {
      expect(tokenize("echo 'foo\\bar'")).toEqual([word('echo'), word('foo\\bar')]);
    });

    it('allows double quotes inside single quotes', () => {
      expect(tokenize('echo \'she said "hi"\'')).toEqual([word('echo'), word('she said "hi"')]);
    });

    it('preserves empty single-quoted token', () => {
      expect(tokenize("echo ''")).toEqual([word('echo'), word('')]);
    });

    it('concatenates adjacent quoted and unquoted segments', () => {
      expect(tokenize("foo'bar baz'")).toEqual([word('foobar baz')]);
    });

    it('throws on unterminated single quote', () => {
      expect(() => tokenize("echo 'hello")).toThrow();
    });
  });

  describe('double quotes', () => {
    it('groups spaces inside double quotes into one token', () => {
      expect(tokenize('echo "hello world"')).toEqual([word('echo'), word('hello world')]);
    });

    it('allows single quotes inside double quotes', () => {
      expect(tokenize('echo "it\'s fine"')).toEqual([word('echo'), word("it's fine")]);
    });

    it('supports escaped double quote inside double quotes', () => {
      expect(tokenize('echo "she said \\"hi\\""')).toEqual([word('echo'), word('she said "hi"')]);
    });

    it('supports escaped backslash inside double quotes', () => {
      expect(tokenize('echo "a\\\\b"')).toEqual([word('echo'), word('a\\b')]);
    });

    it('preserves empty double-quoted token', () => {
      expect(tokenize('echo ""')).toEqual([word('echo'), word('')]);
    });

    it('throws on unterminated double quote', () => {
      expect(() => tokenize('echo "hello')).toThrow();
    });
  });

  describe('backslash escapes (unquoted)', () => {
    it('escapes a space to keep it in the same word', () => {
      expect(tokenize('foo\\ bar')).toEqual([word('foo bar')]);
    });

    it('escapes a pipe character to treat it as literal', () => {
      expect(tokenize('foo\\|bar')).toEqual([word('foo|bar')]);
    });

    it('escapes a greater-than to treat it as literal', () => {
      expect(tokenize('foo\\>bar')).toEqual([word('foo>bar')]);
    });

    it('throws on trailing backslash with nothing to escape', () => {
      expect(() => tokenize('foo\\')).toThrow();
    });
  });

  describe('operators', () => {
    it('recognizes pipe between commands', () => {
      expect(tokenize('ls | cat')).toEqual([word('ls'), pipe, word('cat')]);
    });

    it('recognizes pipe with no surrounding whitespace', () => {
      expect(tokenize('ls|cat')).toEqual([word('ls'), pipe, word('cat')]);
    });

    it('recognizes redirect with target', () => {
      expect(tokenize('ls > out.txt')).toEqual([word('ls'), redirect, word('out.txt')]);
    });

    it('recognizes redirect with no surrounding whitespace', () => {
      expect(tokenize('ls>out.txt')).toEqual([word('ls'), redirect, word('out.txt')]);
    });

    it('does not split pipe inside quotes', () => {
      expect(tokenize("echo 'a|b'")).toEqual([word('echo'), word('a|b')]);
    });

    it('does not split redirect inside quotes', () => {
      expect(tokenize('echo "a>b"')).toEqual([word('echo'), word('a>b')]);
    });
  });

  describe('realistic combinations', () => {
    it('handles pipe with flags and path target', () => {
      expect(tokenize('cat /etc/passwd | grep root > out.txt')).toEqual([
        word('cat'),
        word('/etc/passwd'),
        pipe,
        word('grep'),
        word('root'),
        redirect,
        word('out.txt'),
      ]);
    });

    it('handles nmap with flags', () => {
      expect(tokenize('nmap 10.10.10.10 -sV --tree')).toEqual([
        word('nmap'),
        word('10.10.10.10'),
        word('-sV'),
        word('--tree'),
      ]);
    });

    it('handles a quoted path with spaces', () => {
      expect(tokenize('cat "/home/My Docs/file.txt"')).toEqual([
        word('cat'),
        word('/home/My Docs/file.txt'),
      ]);
    });
  });
});
