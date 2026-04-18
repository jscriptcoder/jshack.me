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

  describe('Phase A rejections', () => {
    it('throws bash-style error on pipe token', () => {
      expect(() => parse([word('ls'), pipe, word('cat')])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });

    it('throws bash-style error on redirect token', () => {
      expect(() => parse([word('ls'), redirect, word('out.txt')])).toThrow(
        "bash: syntax error near unexpected token `>'",
      );
    });

    it('throws when input starts with a pipe', () => {
      expect(() => parse([pipe, word('cat')])).toThrow(
        "bash: syntax error near unexpected token `|'",
      );
    });

    it('throws when input starts with a redirect', () => {
      expect(() => parse([redirect, word('out.txt')])).toThrow(
        "bash: syntax error near unexpected token `>'",
      );
    });
  });
});
