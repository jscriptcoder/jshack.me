import { describe, expect, it } from 'vitest';
import { runCommandLine } from './runLine';
import { cat } from '../commands/cat';
import { echo } from '../commands/echo';
import { grep } from '../commands/grep';
import type { Command, CommandResult, TerminalLine } from '../commands/types';
import { mockCommandEnv, mockFsViewFromTree } from '../../test/factories/commandEnv';
import { buildDirectory, buildFile } from '../../test/factories/filesystem';
import { asAbsPath } from '../types';

/** A `user`-tier session in /home/alice with two files she owns (and can read). */
const aliceEnv = () =>
  mockCommandEnv({
    fs: mockFsViewFromTree(
      buildDirectory({
        home: buildDirectory({
          alice: buildDirectory(
            {
              'notes.txt': buildFile('hello world\nfrom alice\n', { owner: 'alice' }),
              'todo.txt': buildFile('buy milk\n', { owner: 'alice' }),
            },
            { owner: 'alice' },
          ),
        }),
      }),
      { userType: 'user', cwd: asAbsPath('/home/alice') },
    ),
  });

const commands: ReadonlyMap<string, Command> = new Map([['cat', cat]]);

/** cat + echo + grep — the set exercised by the pipeline tests. */
const pipeCommands: ReadonlyMap<string, Command> = new Map([
  ['cat', cat],
  ['echo', echo],
  ['grep', grep],
]);

const baseFixture = (
  name: string,
): Pick<Command, 'name' | 'description' | 'tier' | 'availability'> => ({
  name,
  description: `fixture: ${name}`,
  tier: 'guest',
  availability: { kind: 'any-machine' },
});

/** A fixture that emits a fixed set of lines as a SYNC result — used to prove
 *  only `text` lines are piped (stderr stays out of the pipe). */
const syncEmitter = (name: string, lines: readonly TerminalLine[]): Command => ({
  ...baseFixture(name),
  execute: async () => ({ kind: 'sync', lines, exitCode: 0 }),
});

/** Same, but as an `async` result — proves intermediate async stages are
 *  drained fully (in order) and that non-text lines stay out of the pipe. */
const asyncEmitter = (name: string, lines: readonly TerminalLine[]): Command => ({
  ...baseFixture(name),
  execute: async () => ({
    kind: 'async',
    lines: (async function* () {
      for (const line of lines) yield line;
    })(),
    exitCode: async () => 0,
  }),
});

/** A fixture that returns a `mode_change` — proves a mode-change stage can't
 *  feed a pipe (downstream sees empty stdin) and doesn't crash. */
const modeChanger = (name: string): Command => ({
  ...baseFixture(name),
  execute: async () => ({ kind: 'mode_change', mode: { kind: 'lynx', url: 'http://x' } }),
});

const text = (content: string): TerminalLine => ({ kind: 'text', content });
const errorLine = (content: string): TerminalLine => ({ kind: 'error', content });

const expectSync = (result: CommandResult): Extract<CommandResult, { kind: 'sync' }> => {
  expect(result.kind).toBe('sync');
  if (result.kind !== 'sync') throw new Error('expected a sync result');
  return result;
};

const contentOf = (lines: readonly TerminalLine[]): string =>
  lines.map((line) => line.content).join('\n');

describe('runCommandLine', () => {
  it('dispatches a known command and returns its output', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat notes.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
    expect(contentOf(result.lines)).toContain('from alice');
  });

  it('parses multiple arguments and passes them through to the command', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat notes.txt todo.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
    expect(contentOf(result.lines)).toContain('buy milk');
  });

  it('trims surrounding whitespace before dispatching', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), '   cat notes.txt   ', commands));

    expect(result.exitCode).toBe(0);
    expect(contentOf(result.lines)).toContain('hello world');
  });

  it('reports "command not found" for an unknown command', async () => {
    const result = await runCommandLine(aliceEnv(), 'frobnicate --hard now', commands);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'bash: frobnicate: command not found' }],
      exitCode: 127,
    });
  });

  it('runs nothing for empty input', async () => {
    const result = await runCommandLine(aliceEnv(), '', commands);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
  });

  it('runs nothing for whitespace-only input', async () => {
    const result = await runCommandLine(aliceEnv(), '   \t  ', commands);

    expect(result).toEqual({ kind: 'sync', lines: [], exitCode: 0 });
  });

  it("returns the command's own failing result unchanged", async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat /nope', commands));

    expect(result.exitCode).toBe(1);
    expect(result.lines).toContainEqual({
      kind: 'error',
      content: 'cat: /nope: No such file or directory',
    });
  });

  it('rejects an unknown flag with exit code 2 and reports the offending option', async () => {
    // The error must come from the parser (exit 2) BEFORE cat is invoked —
    // otherwise cat would treat `-xyz` as a missing file and emit its own
    // exit-1 "No such file or directory" instead.
    const result = await runCommandLine(aliceEnv(), 'cat -xyz notes.txt', commands);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'cat: unrecognized option: -xyz' }],
      exitCode: 2,
    });
  });

  it('passes recognised boolean flags through to the command', async () => {
    const result = expectSync(await runCommandLine(aliceEnv(), 'cat -n notes.txt', commands));

    expect(result.exitCode).toBe(0);
    expect(result.lines).toContainEqual({
      kind: 'text',
      content: '     1\thello world',
    });
    expect(result.lines).toContainEqual({
      kind: 'text',
      content: '     2\tfrom alice',
    });
  });

  it('reports a syntax error and exits 2 when the tokenizer fails on an unterminated quote', async () => {
    // The result must be the parse-error line ONLY — no command output
    // and no command's-own-error lines. If the command ran in spite of
    // the parser failure, more lines would appear here.
    const result = await runCommandLine(aliceEnv(), 'cat "unterminated', commands);

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'bash: syntax error: unexpected end of file' }],
      exitCode: 2,
    });
  });

  it('defaults `Command.stacking` to false — multi-char stacks fail for commands that do not opt in', async () => {
    // Test command with two boolean flags but no `stacking: true`. With
    // the default-off rule, `-ab` is an unknown flag, NOT an expansion.
    // Kills the `command.stacking ?? false` default-value mutant in
    // runCommandLine — the alternative default of `true` would let `-ab`
    // expand and call execute, producing the placeholder output.
    const stackless: Command = {
      name: 'stackless',
      description: 'fixture: no stacking opt-in',
      tier: 'guest',
      availability: { kind: 'any-machine' },
      flags: { '-a': 'boolean', '-b': 'boolean' },
      execute: async () => ({
        kind: 'sync',
        lines: [{ kind: 'text', content: 'should-not-run' }],
        exitCode: 0,
      }),
    };
    const result = await runCommandLine(
      aliceEnv(),
      'stackless -ab',
      new Map([['stackless', stackless]]),
    );

    expect(result).toEqual({
      kind: 'sync',
      lines: [{ kind: 'error', content: 'stackless: unrecognized option: -ab' }],
      exitCode: 2,
    });
  });

  describe('pipelines', () => {
    it('threads stdout of the first stage into stdin of the second', async () => {
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'echo hello | grep hello', pipeCommands),
      );

      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([{ kind: 'text', content: 'hello' }]);
    });

    it('filters a file through grep via a pipe', async () => {
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'cat notes.txt | grep alice', pipeCommands),
      );

      expect(result.exitCode).toBe(0);
      expect(contentOf(result.lines)).toContain('from alice');
      expect(contentOf(result.lines)).not.toContain('hello world');
    });

    it('exits 1 when the final stage matches nothing', async () => {
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'echo hello | grep zzz', pipeCommands),
      );

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([]);
    });

    it('chains three or more stages, threading left to right', async () => {
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'cat notes.txt | grep o | grep from', pipeCommands),
      );

      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([{ kind: 'text', content: 'from alice' }]);
    });

    it('takes the exit code from the LAST stage, not earlier ones', async () => {
      // `grep zzz` exits 1, but the final `echo` exits 0 — the pipeline's
      // exit code is the last stage's. (echo ignores its stdin.)
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'grep zzz notes.txt | echo done', pipeCommands),
      );

      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([{ kind: 'text', content: 'done' }]);
    });

    it('surfaces an intermediate stage error to the terminal (stderr is not piped)', async () => {
      // cat fails (error line, exit 1, empty stdout); grep sees empty stdin
      // and matches nothing (exit 1). The cat error must still appear.
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'cat /nope | grep root', pipeCommands),
      );

      expect(result.exitCode).toBe(1);
      expect(result.lines).toContainEqual({
        kind: 'error',
        content: 'cat: /nope: No such file or directory',
      });
    });

    it('drains an async intermediate stage fully, in order, before the next stage runs', async () => {
      const commandsWithAsync: ReadonlyMap<string, Command> = new Map([
        ['asyncgen', asyncEmitter('asyncgen', [text('alpha'), text('beta'), text('gamma')])],
        ['grep', grep],
      ]);

      // `grep .` matches every non-empty line — so the assertion locks the
      // exact set AND order of lines the async stage produced (a spurious
      // injected line, or reordering, would fail).
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'asyncgen | grep .', commandsWithAsync),
      );

      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([text('alpha'), text('beta'), text('gamma')]);
    });

    it('does not pipe a SYNC intermediate stage’s non-text lines (stderr stays out of the pipe)', async () => {
      // The fixture emits one text line ("keep") and one error line carrying
      // the downstream pattern. If the error line were piped, grep would match
      // it; correct behaviour leaves it out, so grep matches nothing (exit 1),
      // while the error line still surfaces to the terminal.
      const commandsWithMixed: ReadonlyMap<string, Command> = new Map([
        ['mixed', syncEmitter('mixed', [text('keep'), errorLine('leak secret token')])],
        ['grep', grep],
      ]);

      const result = expectSync(
        await runCommandLine(aliceEnv(), 'mixed | grep secret', commandsWithMixed),
      );

      expect(result.exitCode).toBe(1);
      expect(result.lines).not.toContainEqual(text('leak secret token'));
      expect(result.lines).toContainEqual(errorLine('leak secret token'));
    });

    it('does not pipe an ASYNC intermediate stage’s non-text lines either', async () => {
      const commandsWithMixed: ReadonlyMap<string, Command> = new Map([
        ['mixed', asyncEmitter('mixed', [text('keep'), errorLine('leak secret token')])],
        ['grep', grep],
      ]);

      const result = expectSync(
        await runCommandLine(aliceEnv(), 'mixed | grep secret', commandsWithMixed),
      );

      expect(result.exitCode).toBe(1);
      expect(result.lines).not.toContainEqual(text('leak secret token'));
      expect(result.lines).toContainEqual(errorLine('leak secret token'));
    });

    it('treats a mode-change intermediate stage as empty stdin (no output, no crash)', async () => {
      const commandsWithMode: ReadonlyMap<string, Command> = new Map([
        ['lynxish', modeChanger('lynxish')],
        ['grep', grep],
      ]);

      // grep over empty stdin matches nothing; the mode-change contributes no
      // stdout and no terminal lines.
      const result = expectSync(
        await runCommandLine(aliceEnv(), 'lynxish | grep was', commandsWithMode),
      );

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([]);
    });

    it('reports command-not-found (127) for an unknown command mid-pipe', async () => {
      const result = await runCommandLine(aliceEnv(), 'echo hi | frobnicate', pipeCommands);

      expect(result).toEqual({
        kind: 'sync',
        lines: [{ kind: 'error', content: 'bash: frobnicate: command not found' }],
        exitCode: 127,
      });
    });

    it('rejects an empty stage from a leading pipe with a syntax error (exit 2)', async () => {
      const result = await runCommandLine(aliceEnv(), '| grep root', pipeCommands);

      expect(result).toEqual({
        kind: 'sync',
        lines: [{ kind: 'error', content: "bash: syntax error near unexpected token `|'" }],
        exitCode: 2,
      });
    });

    it('rejects an empty stage from a trailing pipe with a syntax error (exit 2)', async () => {
      const result = await runCommandLine(aliceEnv(), 'cat notes.txt |', pipeCommands);

      expect(result).toEqual({
        kind: 'sync',
        lines: [{ kind: 'error', content: "bash: syntax error near unexpected token `|'" }],
        exitCode: 2,
      });
    });

    it('rejects a stage flag error before any stage executes (exit 2)', async () => {
      // `grep` rejects `-z`; the binder error must win over execution, and no
      // partial output from the first stage should leak through.
      const result = await runCommandLine(aliceEnv(), 'cat notes.txt | grep -z root', pipeCommands);

      expect(result).toEqual({
        kind: 'sync',
        lines: [{ kind: 'error', content: 'grep: unrecognized option: -z' }],
        exitCode: 2,
      });
    });

    it('keeps a quoted pipe literal (no split)', async () => {
      // `echo "a|b"` is a single argument — the `|` is literal, not an operator.
      const result = expectSync(await runCommandLine(aliceEnv(), 'echo "a|b"', pipeCommands));

      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([{ kind: 'text', content: 'a|b' }]);
    });
  });
});
