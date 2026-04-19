import { describe, it, expect } from 'vitest';
import { classifyCursor, complete, type CompleteAdapter } from './complete';
import type { Command } from '../components/Terminal/types';

const makeCommand = (name: string, flagArgs: readonly string[] = []): Command => ({
  name,
  category: 'general',
  description: '',
  fn: () => '',
  manual: {
    synopsis: `${name}(...)`,
    description: '',
    arguments: flagArgs.map((flag) => ({ name: flag, description: '' })),
  },
});

const makeAdapter = (overrides: Partial<CompleteAdapter>): CompleteAdapter => ({
  commandNames: [],
  getCommand: () => undefined,
  listPath: () => null,
  isDirectory: () => false,
  resolvePath: (p) => p,
  ...overrides,
});

describe('classifyCursor', () => {
  describe('command position', () => {
    it('classifies an empty input as command position', () => {
      expect(classifyCursor('', 0)).toMatchObject({ kind: 'command', prefix: '' });
    });

    it('classifies the first word of a line as command', () => {
      expect(classifyCursor('ca', 2)).toMatchObject({ kind: 'command', prefix: 'ca' });
    });

    it('classifies the first word with leading whitespace', () => {
      expect(classifyCursor('   ls', 5)).toMatchObject({ kind: 'command', prefix: 'ls' });
    });

    it('classifies token right after a pipe as command position', () => {
      expect(classifyCursor('cat /x | gr', 11)).toMatchObject({ kind: 'command', prefix: 'gr' });
    });

    it('classifies token after pipe with whitespace as command position', () => {
      expect(classifyCursor('cat | ', 6)).toMatchObject({ kind: 'command', prefix: '' });
    });
  });

  describe('path position (arg)', () => {
    it('classifies an arg after a command as path', () => {
      expect(classifyCursor('cat /et', 7)).toMatchObject({ kind: 'path', prefix: '/et' });
    });

    it('classifies a bare relative path as path', () => {
      expect(classifyCursor('cat read', 8)).toMatchObject({ kind: 'path', prefix: 'read' });
    });

    it('classifies the second arg of a command as path', () => {
      expect(classifyCursor('grep pattern /etc/pa', 20)).toMatchObject({
        kind: 'path',
        prefix: '/etc/pa',
      });
    });
  });

  describe('path position (redirect target)', () => {
    it('classifies a token right after > as path', () => {
      expect(classifyCursor('cat /x > ou', 11)).toMatchObject({ kind: 'path', prefix: 'ou' });
    });

    it('classifies a token after >with no space as path', () => {
      expect(classifyCursor('cat /x >ou', 10)).toMatchObject({ kind: 'path', prefix: 'ou' });
    });
  });

  describe('flag position', () => {
    it('classifies an arg starting with - as flag', () => {
      expect(classifyCursor('nmap -sV', 8)).toMatchObject({ kind: 'flag', prefix: '-sV' });
    });

    it('classifies an arg starting with -- as flag', () => {
      expect(classifyCursor('nmap --tr', 9)).toMatchObject({ kind: 'flag', prefix: '--tr' });
    });

    it('classifies a dash alone (partial flag) as flag', () => {
      expect(classifyCursor('nmap -', 6)).toMatchObject({ kind: 'flag', prefix: '-' });
    });

    it('does not classify the command-position token as flag', () => {
      expect(classifyCursor('-sV', 3)).toMatchObject({ kind: 'command', prefix: '-sV' });
    });
  });

  describe('quoted tokens', () => {
    it('classifies inside a double-quoted arg as path and strips the quote', () => {
      expect(classifyCursor('cat "/et', 8)).toMatchObject({
        kind: 'path',
        prefix: '/et',
        quoteChar: '"',
      });
    });

    it('classifies inside a single-quoted arg as path', () => {
      expect(classifyCursor("cat '/home/u", 12)).toMatchObject({
        kind: 'path',
        prefix: '/home/u',
        quoteChar: "'",
      });
    });
  });

  describe('token boundaries', () => {
    it('reports tokenStart where the current token begins', () => {
      const result = classifyCursor('cat /etc/pa', 11);
      expect(result.tokenStart).toBe(4);
      expect(result.tokenEnd).toBe(11);
    });

    it('reports tokenStart at the opening quote for quoted tokens', () => {
      const result = classifyCursor('cat "/et', 8);
      expect(result.tokenStart).toBe(4);
      expect(result.tokenEnd).toBe(8);
    });
  });
});

describe('complete', () => {
  describe('command completion', () => {
    const adapter = makeAdapter({
      commandNames: ['cat', 'cd', 'clear', 'help', 'hello'],
    });

    it('returns all commands matching the prefix', () => {
      const result = complete('he', 2, adapter);

      expect(result.matches).toEqual(['hello', 'help']);
      expect(result.commonPrefix).toBe('hel');
    });

    it('signals trailing space for a single command match', () => {
      const result = complete('hel', 3, adapter);

      expect(result.matches).toEqual(['hello', 'help']);
      expect(result.addTrailingSpace).toBe(false);
    });

    it('advances to the single match and requests a trailing space', () => {
      const result = complete('cle', 3, adapter);

      expect(result.matches).toEqual(['clear']);
      expect(result.addTrailingSpace).toBe(true);
      expect(result.replacement).toBe('clear ');
      expect(result.newCursorPosition).toBe(6);
    });

    it('returns no matches when prefix does not match any command', () => {
      const result = complete('zzz', 3, adapter);

      expect(result.matches).toEqual([]);
    });

    it('completes the first token of a stage after a pipe', () => {
      const result = complete('cat /x | cl', 11, adapter);

      expect(result.matches).toEqual(['clear']);
      expect(result.replacement).toBe('cat /x | clear ');
    });
  });

  describe('path completion (unquoted)', () => {
    const adapter = makeAdapter({
      listPath: (abs) => {
        if (abs === '/etc') return ['passwd', 'hosts', 'shadow'];
        if (abs === '/etc/shadow') return null; // not a directory
        return null;
      },
      isDirectory: (abs) => abs === '/etc' || abs === '/etc/shadow',
      resolvePath: (p) => (p.startsWith('/') ? p : `/${p}`),
    });

    it('completes a bare path arg', () => {
      const result = complete('cat /etc/p', 10, adapter);

      expect(result.matches).toEqual(['passwd']);
      expect(result.replacement).toBe('cat /etc/passwd');
    });

    it('lists multiple path matches with common prefix', () => {
      const result = complete('cat /etc/', 9, adapter);

      expect(result.matches).toContain('hosts');
      expect(result.matches).toContain('passwd');
      expect(result.matches).toContain('shadow/');
    });

    it('decorates directory entries with a trailing slash', () => {
      const adapter2 = makeAdapter({
        listPath: (abs) => (abs === '/' ? ['etc', 'home'] : null),
        isDirectory: (abs) => abs === '/etc' || abs === '/home' || abs === '/',
        resolvePath: (p) => (p.startsWith('/') ? p : `/${p}`),
      });

      const result = complete('cat /h', 6, adapter2);

      expect(result.matches).toEqual(['home/']);
      expect(result.replacement).toBe('cat /home/');
      // Trailing slash — no extra space added, user can continue typing.
      expect(result.addTrailingSpace).toBe(false);
    });

    it('returns no matches for an unreadable directory', () => {
      const adapter2 = makeAdapter({ listPath: () => null });

      const result = complete('cat /locked/', 12, adapter2);

      expect(result.matches).toEqual([]);
    });
  });

  describe('path completion (quoted)', () => {
    const adapter = makeAdapter({
      listPath: (abs) => (abs === '/etc' ? ['passwd'] : null),
      isDirectory: (abs) => abs === '/etc',
      resolvePath: (p) => (p.startsWith('/') ? p : `/${p}`),
    });

    it('preserves the quote char in the replacement', () => {
      const result = complete('cat "/etc/p', 11, adapter);

      expect(result.matches).toEqual(['passwd']);
      expect(result.replacement).toBe('cat "/etc/passwd');
    });
  });

  describe('redirect target', () => {
    const adapter = makeAdapter({
      listPath: (abs) => (abs === '/tmp' ? ['out.txt'] : null),
      isDirectory: (abs) => abs === '/tmp',
      resolvePath: (p) => (p.startsWith('/') ? p : `/${p}`),
    });

    it('completes the path after > operator', () => {
      const result = complete('cat /x > /tmp/o', 15, adapter);

      expect(result.matches).toEqual(['out.txt']);
      expect(result.replacement).toBe('cat /x > /tmp/out.txt');
    });
  });

  describe('keyword completion at arg 0', () => {
    const aptCommand: Command = {
      name: 'apt',
      category: 'general',
      description: '',
      fn: () => '',
      manual: {
        synopsis: 'apt ...',
        description: '',
        arguments: [
          {
            name: 'subcommand',
            description: '',
            values: ['install', 'list', 'upgrade'],
          },
          { name: 'package', description: '' },
        ],
      },
    };
    const adapter = makeAdapter({
      commandNames: ['apt', 'cat'],
      getCommand: (name) => (name === 'apt' ? aptCommand : undefined),
    });

    it('offers subcommand keywords at arg 0 when prefix has no slash', () => {
      const result = complete('apt ', 4, adapter);

      expect(result.matches).toEqual(['install', 'list', 'upgrade']);
    });

    it('filters keyword matches by typed prefix', () => {
      const result = complete('apt i', 5, adapter);

      expect(result.matches).toEqual(['install']);
      expect(result.replacement).toBe('apt install ');
    });

    it('falls back to path completion when prefix contains a slash', () => {
      const adapter2 = makeAdapter({
        commandNames: ['apt'],
        getCommand: () => aptCommand,
        listPath: (abs) => (abs === '/tmp' ? ['foo.txt'] : null),
        isDirectory: (abs) => abs === '/tmp',
        resolvePath: (p) => (p.startsWith('/') ? p : `/${p}`),
      });

      const result = complete('apt /tmp/f', 10, adapter2);

      expect(result.matches).toEqual(['foo.txt']);
    });

    it('does not offer keywords at arg 1 (package position)', () => {
      const adapter2 = makeAdapter({
        commandNames: ['apt'],
        getCommand: () => aptCommand,
        listPath: () => null,
      });

      const result = complete('apt install i', 13, adapter2);

      // We're at arg 1 (the package position), which has no values defined.
      // Should NOT re-offer 'install' from arg 0's values.
      expect(result.matches).toEqual([]);
    });

    it('does not offer keywords when command has no values defined', () => {
      const adapter2 = makeAdapter({
        commandNames: ['cat'],
        getCommand: (name) =>
          name === 'cat'
            ? {
                name: 'cat',
                category: 'general',
                description: '',
                fn: () => '',
                manual: {
                  synopsis: 'cat',
                  description: '',
                  arguments: [{ name: 'path', description: '' }],
                },
              }
            : undefined,
        listPath: () => null,
      });

      const result = complete('cat r', 5, adapter2);

      expect(result.matches).toEqual([]);
    });
  });

  describe('flag completion', () => {
    const adapter = makeAdapter({
      commandNames: ['nmap'],
      getCommand: (name) =>
        name === 'nmap' ? makeCommand('nmap', ['-sV', '-sU', '--tree', 'target']) : undefined,
    });

    it('completes flags from the command manual', () => {
      const result = complete('nmap -s', 7, adapter);

      expect(result.matches).toEqual(['-sU', '-sV']);
    });

    it('filters out non-flag argument entries', () => {
      const result = complete('nmap -', 6, adapter);

      // Only entries starting with `-` — "target" is excluded
      expect(result.matches).toEqual(['--tree', '-sU', '-sV']);
    });

    it('returns no matches when command has no flag args', () => {
      const adapter2 = makeAdapter({
        commandNames: ['cat'],
        getCommand: () => makeCommand('cat', []),
      });

      const result = complete('cat -', 5, adapter2);

      expect(result.matches).toEqual([]);
    });

    it('returns no matches when command is unknown', () => {
      const result = complete('bogus -', 7, adapter);

      expect(result.matches).toEqual([]);
    });
  });
});
