import { describe, it, expect } from 'vitest';
import { parse } from './parse';
import type { Token } from './types';

const word = (value: string): Token => ({ kind: 'word', value });
const pipe: Token = { kind: 'pipe' };
const redirect: Token = { kind: 'redirect' };

describe('parse', () => {
  describe('empty and basic', () => {
    it('returns empty pipeline for empty tokens', () => {
      expect(parse([])).toEqual({ stages: [] });
    });

    it('parses a single word as a command with no args', () => {
      expect(parse([word('ls')])).toEqual({
        stages: [{ command: 'ls', args: [] }],
      });
    });

    it('parses a command with one arg', () => {
      expect(parse([word('cat'), word('/etc/passwd')])).toEqual({
        stages: [{ command: 'cat', args: ['/etc/passwd'] }],
      });
    });

    it('parses a command with multiple args including flags', () => {
      expect(parse([word('nmap'), word('10.10.10.10'), word('-sV'), word('--tree')])).toEqual({
        stages: [{ command: 'nmap', args: ['10.10.10.10', '-sV', '--tree'] }],
      });
    });
  });

  describe('pipes', () => {
    it('parses a two-stage pipeline', () => {
      expect(parse([word('ls'), pipe, word('cat')])).toEqual({
        stages: [
          { command: 'ls', args: [] },
          { command: 'cat', args: [] },
        ],
      });
    });

    it('parses a three-stage pipeline', () => {
      expect(parse([word('a'), pipe, word('b'), pipe, word('c')])).toEqual({
        stages: [
          { command: 'a', args: [] },
          { command: 'b', args: [] },
          { command: 'c', args: [] },
        ],
      });
    });

    it('preserves args per stage', () => {
      expect(parse([word('cat'), word('/etc/passwd'), pipe, word('grep'), word('root')])).toEqual({
        stages: [
          { command: 'cat', args: ['/etc/passwd'] },
          { command: 'grep', args: ['root'] },
        ],
      });
    });

    it('throws when input starts with a pipe', () => {
      expect(() => parse([pipe, word('cat')])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });

    it('throws when a stage between pipes is empty', () => {
      expect(() => parse([word('ls'), pipe, pipe, word('cat')])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });

    it('throws on a trailing pipe (missing command after)', () => {
      expect(() => parse([word('ls'), pipe])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });
  });

  describe('redirect', () => {
    it('parses a redirect on a single command', () => {
      expect(parse([word('ls'), redirect, word('out.txt')])).toEqual({
        stages: [{ command: 'ls', args: [] }],
        redirect: { path: 'out.txt' },
      });
    });

    it('parses a redirect on the last stage of a pipeline', () => {
      expect(
        parse([word('cat'), word('/log'), pipe, word('grep'), word('x'), redirect, word('out')]),
      ).toEqual({
        stages: [
          { command: 'cat', args: ['/log'] },
          { command: 'grep', args: ['x'] },
        ],
        redirect: { path: 'out' },
      });
    });

    it('throws when input starts with a redirect', () => {
      expect(() => parse([redirect, word('out.txt')])).toThrow(
        "bash: syntax error near unexpected token `>'",
      );
    });

    it('throws when redirect has no target', () => {
      expect(() => parse([word('ls'), redirect])).toThrow(
        "bash: syntax error near unexpected token `newline'",
      );
    });

    it('throws when redirect target is another operator', () => {
      expect(() => parse([word('ls'), redirect, pipe, word('cat')])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });

    it('throws when redirect appears before the last stage', () => {
      expect(() =>
        parse([word('cat'), redirect, word('mid.txt'), pipe, word('grep'), word('x')]),
      ).toThrow("bash: syntax error near unexpected token `|'");
    });

    it('throws when multiple redirects appear', () => {
      expect(() => parse([word('ls'), redirect, word('a.txt'), redirect, word('b.txt')])).toThrow(
        "bash: syntax error near unexpected token `>'",
      );
    });
  });
});
