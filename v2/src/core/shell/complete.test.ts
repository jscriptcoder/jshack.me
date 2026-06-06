import { describe, expect, it } from 'vitest';
import { classifyCursor, complete, type CompleteAdapter } from './complete';
import type { Command } from '../commands/types';
import type { FlagSpec } from './bindFlags';

/** Minimal v2 Command fixture. The completer reads `command.flags` and, for
 *  keyword completion, `command.manual.arguments[0].values` (via the adapter's
 *  getCommand). `firstArgValues`, when given, declares the first positional's
 *  fixed value set. */
const makeCommand = (
  name: string,
  flags: FlagSpec = {},
  firstArgValues?: readonly string[],
): Command => ({
  name,
  description: '',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags,
  ...(firstArgValues === undefined
    ? {}
    : {
        manual: {
          synopsis: '',
          description: '',
          arguments: [
            { name: 'operation', description: '', values: firstArgValues },
            { name: 'package', description: '' },
          ],
        },
      }),
  execute: async () => ({ kind: 'sync', lines: [], exitCode: 0 }),
});

const makeAdapter = (overrides: Partial<CompleteAdapter>): CompleteAdapter => ({
  commandNames: [],
  getCommand: () => undefined,
  listPath: () => null,
  isDirectory: () => false,
  resolvePath: (path) => path,
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

    it('classifies a dash-prefixed redirect target as a path, not a flag', () => {
      // After `>` the token is a filename even when it looks like a flag — the
      // redirect context wins over the leading-dash heuristic.
      expect(classifyCursor('cat /x > -o', 11)).toMatchObject({ kind: 'path', prefix: '-o' });
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

  describe('quote state transitions', () => {
    it('treats a token after a CLOSED double-quoted arg as unquoted', () => {
      // The `"a"` opens then closes; the cursor sits in the next bare token.
      expect(classifyCursor('echo "a" /et', 12)).toMatchObject({
        kind: 'path',
        prefix: '/et',
        quoteChar: '',
        tokenStart: 9,
      });
    });

    it('treats a token after a CLOSED single-quoted arg as unquoted', () => {
      expect(classifyCursor("echo 'a' b", 10)).toMatchObject({
        kind: 'path',
        prefix: 'b',
        quoteChar: '',
        tokenStart: 9,
      });
    });

    it('keeps an escaped quote (\\") inside a double-quoted token, not closing it', () => {
      // cat "a\"b — the \" is a literal quote; we are still inside the double
      // quote opened at index 4, so the prefix includes the escape sequence.
      expect(classifyCursor('cat "a\\"b', 9)).toMatchObject({
        kind: 'path',
        prefix: 'a\\"b',
        quoteChar: '"',
        tokenStart: 4,
      });
    });

    it('treats an escaped quote (\\") OUTSIDE quotes as a literal, not an opener', () => {
      // cat \"x — the backslash escapes the quote, so no quoted context opens;
      // the whole `\"x` is one unquoted token.
      expect(classifyCursor('cat \\"x', 7)).toMatchObject({
        kind: 'path',
        prefix: '\\"x',
        quoteChar: '',
        tokenStart: 4,
      });
    });

    it('treats a tab as a token boundary', () => {
      // ls<TAB>cd — without tab being a boundary the token would start at 0
      // and classify as a command; with it, `cd` is a path argument.
      expect(classifyCursor('ls\tcd', 5)).toMatchObject({
        kind: 'path',
        prefix: 'cd',
        tokenStart: 3,
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

      expect(result.kind).toBe('command');
      expect(result.matches).toEqual(['hello', 'help']);
      expect(result.commonPrefix).toBe('hel');
      expect(result.displayText).toBe('hello, help');
    });

    it('does not add a trailing space when several commands match', () => {
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

    it('advances to the common prefix across several varying-length matches', () => {
      const adapter2 = makeAdapter({ commandNames: ['stash', 'start', 'stat', 'echo'] });

      const result = complete('st', 2, adapter2);

      expect(result.matches).toEqual(['start', 'stash', 'stat']);
      expect(result.commonPrefix).toBe('sta');
      expect(result.replacement).toBe('sta');
    });
  });

  describe('path completion (unquoted)', () => {
    const adapter = makeAdapter({
      listPath: (abs) => {
        if (abs === '/etc') return ['passwd', 'hosts', 'shadow'];
        return null;
      },
      isDirectory: (abs) => abs === '/etc' || abs === '/etc/shadow',
      resolvePath: (path) => (path.startsWith('/') ? path : `/${path}`),
    });

    it('completes a bare path arg', () => {
      const result = complete('cat /etc/p', 10, adapter);

      expect(result.matches).toEqual(['passwd']);
      expect(result.replacement).toBe('cat /etc/passwd');
    });

    it('lists multiple path matches with common prefix', () => {
      const result = complete('cat /etc/', 9, adapter);

      expect(result.kind).toBe('path');
      expect(result.matches).toContain('hosts');
      expect(result.matches).toContain('passwd');
      expect(result.matches).toContain('shadow/');
      // Path candidates are displayed two-spaces-separated, sorted, with the
      // directory entry decorated.
      expect(result.displayText).toBe('hosts  passwd  shadow/');
      // With several matches and no shared name prefix, the line is left as-is
      // (the directory prefix preserved) — it must NOT auto-pick the first entry.
      expect(result.replacement).toBe('cat /etc/');
    });

    it('resolves a single-segment absolute path against root', () => {
      // `/et` has directory `/` (empty-slice falls back to root). The adapter
      // distinguishes resolvePath('/') from resolvePath(''), so a regression
      // that drops the `|| '/'` fallback would list nothing.
      const adapter2 = makeAdapter({
        listPath: (abs) => (abs === '/' ? ['etc', 'home'] : null),
        isDirectory: (abs) => abs === '/etc',
        resolvePath: (path) => (path === '' ? '/SENTINEL' : path),
      });

      const result = complete('cat /et', 7, adapter2);

      expect(result.matches).toEqual(['etc/']);
      expect(result.replacement).toBe('cat /etc/');
    });

    it('decorates directory entries with a trailing slash', () => {
      const adapter2 = makeAdapter({
        listPath: (abs) => (abs === '/' ? ['etc', 'home'] : null),
        isDirectory: (abs) => abs === '/etc' || abs === '/home' || abs === '/',
        resolvePath: (path) => (path.startsWith('/') ? path : `/${path}`),
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

    it('completes a bare filename against the resolved cwd', () => {
      // No slash in the prefix → directory is the cwd ('.'), resolved by the
      // adapter. `no` uniquely matches notes.txt.
      const adapter2 = makeAdapter({
        listPath: (abs) => (abs === '/home/alice' ? ['notes.txt', 'nums.csv'] : null),
        resolvePath: (path) => (path === '.' ? '/home/alice' : path),
      });

      const result = complete('cat no', 6, adapter2);

      expect(result.matches).toEqual(['notes.txt']);
      expect(result.replacement).toBe('cat notes.txt');
    });

    it('lists multiple bare-filename matches against the cwd', () => {
      const adapter2 = makeAdapter({
        listPath: (abs) => (abs === '/home/alice' ? ['notes.txt', 'nums.csv'] : null),
        resolvePath: (path) => (path === '.' ? '/home/alice' : path),
      });

      const result = complete('cat n', 5, adapter2);

      expect(result.matches).toEqual(['notes.txt', 'nums.csv']);
      expect(result.displayText).toBe('notes.txt  nums.csv');
    });
  });

  describe('path completion (quoted)', () => {
    const adapter = makeAdapter({
      listPath: (abs) => (abs === '/etc' ? ['passwd'] : null),
      isDirectory: (abs) => abs === '/etc',
      resolvePath: (path) => (path.startsWith('/') ? path : `/${path}`),
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
      resolvePath: (path) => (path.startsWith('/') ? path : `/${path}`),
    });

    it('completes the path after > operator', () => {
      const result = complete('cat /x > /tmp/o', 15, adapter);

      expect(result.matches).toEqual(['out.txt']);
      expect(result.replacement).toBe('cat /x > /tmp/out.txt');
    });
  });

  describe('keyword completion (fixed-value first positional)', () => {
    // `apt` declares its first positional's values as install/list; the path
    // adapter bits let the "second positional still path-completes" test work.
    const adapter = makeAdapter({
      commandNames: ['apt'],
      getCommand: (name) =>
        name === 'apt'
          ? makeCommand('apt', { '--installed': 'boolean', '-i': 'boolean' }, ['install', 'list'])
          : undefined,
      listPath: (abs) => (abs === '/home/alice' ? ['report.txt'] : null),
      resolvePath: (path) => (path === '.' ? '/home/alice' : path),
    });

    it('lists the operation keywords for a bare first positional', () => {
      const result = complete('apt ', 4, adapter);

      expect(result.kind).toBe('keyword');
      expect(result.matches).toEqual(['install', 'list']);
      expect(result.displayText).toBe('install, list');
    });

    it('completes a unique keyword and adds a trailing space (not a path lookup)', () => {
      const result = complete('apt in', 6, adapter);

      expect(result.kind).toBe('keyword');
      expect(result.matches).toEqual(['install']);
      expect(result.replacement).toBe('apt install ');
      expect(result.newCursorPosition).toBe(12);
      expect(result.addTrailingSpace).toBe(true);
    });

    it('completes the other keyword too', () => {
      const result = complete('apt l', 5, adapter);

      expect(result.matches).toEqual(['list']);
      expect(result.replacement).toBe('apt list ');
    });

    it('returns no matches (keyword, not path) when no keyword matches the prefix', () => {
      const result = complete('apt zzz', 7, adapter);

      expect(result.kind).toBe('keyword');
      expect(result.matches).toEqual([]);
    });

    it('leaves the SECOND positional to path completion (arg1 unaffected)', () => {
      const result = complete('apt install re', 14, adapter);

      expect(result.kind).toBe('path');
      expect(result.matches).toEqual(['report.txt']);
      expect(result.replacement).toBe('apt install report.txt');
    });

    it('a command without declared values still path-completes its first arg', () => {
      const adapter2 = makeAdapter({
        commandNames: ['cat'],
        getCommand: () => makeCommand('cat'), // no firstArgValues → no keyword set
        listPath: (abs) => (abs === '/home/alice' ? ['notes.txt'] : null),
        resolvePath: (path) => (path === '.' ? '/home/alice' : path),
      });

      const result = complete('cat no', 6, adapter2);

      expect(result.kind).toBe('path');
      expect(result.matches).toEqual(['notes.txt']);
    });
  });

  describe('flag completion', () => {
    const adapter = makeAdapter({
      commandNames: ['nmap'],
      getCommand: (name) =>
        name === 'nmap'
          ? makeCommand('nmap', { '-sV': 'boolean', '-sU': 'boolean', '--tree': 'boolean' })
          : undefined,
    });

    it('completes flags from the command flag spec', () => {
      const result = complete('nmap -s', 7, adapter);

      expect(result.kind).toBe('flag');
      expect(result.matches).toEqual(['-sU', '-sV']);
      expect(result.displayText).toBe('-sU, -sV');
    });

    it('lists every flag in the spec for a bare dash', () => {
      const result = complete('nmap -', 6, adapter);

      expect(result.matches).toEqual(['--tree', '-sU', '-sV']);
    });

    it('returns no matches when the command declares no flags', () => {
      const adapter2 = makeAdapter({
        commandNames: ['cat'],
        getCommand: () => makeCommand('cat'),
      });

      const result = complete('cat -', 5, adapter2);

      expect(result.matches).toEqual([]);
    });

    it('returns no matches when the command is unknown', () => {
      const result = complete('bogus -', 7, adapter);

      expect(result.matches).toEqual([]);
    });

    it('completes a flag for the command in a piped stage', () => {
      // The cursor's stage is `grep -`, after the pipe — flags must come from
      // grep, not the first stage's `cat`.
      const adapter2 = makeAdapter({
        commandNames: ['cat', 'grep'],
        getCommand: (name) =>
          name === 'grep'
            ? makeCommand('grep', { '-l': 'boolean' })
            : name === 'cat'
              ? makeCommand('cat', { '-n': 'boolean' })
              : undefined,
      });

      const result = complete('cat x | grep -', 14, adapter2);

      expect(result.matches).toEqual(['-l']);
      expect(result.replacement).toBe('cat x | grep -l ');
    });
  });
});
