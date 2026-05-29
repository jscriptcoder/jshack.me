import { describe, expect, it, vi } from 'vitest';
import { runCommandLine } from './runLine';
import { cat } from '../commands/cat';
import { echo } from '../commands/echo';
import { grep } from '../commands/grep';
import type {
  Command,
  CommandEnv,
  CommandResult,
  PatchApi,
  PatchResult,
  TerminalLine,
} from '../commands/types';
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

  describe('output redirection (`>`)', () => {
    /** user-tier in /home/alice (alice-owned, writable); /etc is root-only
     *  write; /home/alice/docs is an existing directory. */
    const redirectEnv = (
      writeResult: PatchResult = { ok: true },
    ): { readonly env: CommandEnv; readonly write: ReturnType<typeof vi.fn> } => {
      const write = vi.fn<PatchApi['write']>(async () => writeResult);
      const patches: PatchApi = {
        write,
        remove: async () => ({ ok: true }),
        mkdir: async () => ({ ok: true }),
      };
      const env = mockCommandEnv({
        fs: mockFsViewFromTree(
          buildDirectory({
            home: buildDirectory({
              alice: buildDirectory(
                {
                  'notes.txt': buildFile('old content', { owner: 'alice' }),
                  'multi.txt': buildFile('line1\nline2', { owner: 'alice' }),
                  // owned by root, writable by root only — alice can't truncate it
                  'readonly.txt': buildFile('locked', {
                    owner: 'root',
                    perms: { write: ['root'] },
                  }),
                  docs: buildDirectory({}, { owner: 'alice' }),
                },
                { owner: 'alice' },
              ),
            }),
            etc: buildDirectory({}, { owner: 'root' }),
          }),
          { userType: 'user', cwd: asAbsPath('/home/alice') },
        ),
        patches,
      });
      return { env, write };
    };

    it('writes the final stdout to a new file and suppresses terminal output', async () => {
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > out.txt', pipeCommands));

      expect(write).toHaveBeenCalledWith(asAbsPath('/home/alice/out.txt'), 'hi');
      expect(result.exitCode).toBe(0);
      expect(result.lines).toEqual([]); // stdout went to the file, not the terminal
    });

    it('overwrites (truncates) an existing file via the same write path', async () => {
      const { env, write } = redirectEnv();

      await runCommandLine(env, 'echo replaced > notes.txt', pipeCommands);

      expect(write).toHaveBeenCalledWith(asAbsPath('/home/alice/notes.txt'), 'replaced');
    });

    it('redirects the LAST stage of a pipeline', async () => {
      const { env, write } = redirectEnv();

      await runCommandLine(env, 'echo hi | cat > piped.txt', pipeCommands);

      expect(write).toHaveBeenCalledWith(asAbsPath('/home/alice/piped.txt'), 'hi');
    });

    it('errors when the target is an existing directory and does not write', async () => {
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > docs', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: docs: Is a directory')]);
      expect(write).not.toHaveBeenCalled();
    });

    it('errors when the target parent directory does not exist', async () => {
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > nope/f', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: nope/f: No such file or directory')]);
      expect(write).not.toHaveBeenCalled();
    });

    it('errors when the tier cannot write the target location', async () => {
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > /etc/x', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: /etc/x: Permission denied')]);
      expect(write).not.toHaveBeenCalled();
    });

    it('does not run the command when the redirect target is invalid', async () => {
      const { env } = redirectEnv();
      // cat of a missing file would normally emit an error; redirect-to-dir
      // fails first, so cat must never run.
      const result = expectSync(await runCommandLine(env, 'cat notes.txt > docs', pipeCommands));

      expect(result.lines).toEqual([errorLine('bash: docs: Is a directory')]);
    });

    it('joins multi-line stdout with newlines before writing', async () => {
      const { env, write } = redirectEnv();

      await runCommandLine(env, 'cat multi.txt > out.txt', pipeCommands);

      expect(write).toHaveBeenCalledWith(asAbsPath('/home/alice/out.txt'), 'line1\nline2');
    });

    it('errors when a path segment in the target is a file, not a directory', async () => {
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > notes.txt/x', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: notes.txt/x: No such file or directory')]);
      expect(write).not.toHaveBeenCalled();
    });

    it('checks write permission on an EXISTING target file, not just its parent dir', async () => {
      // alice can write /home/alice (the parent) but NOT readonly.txt itself;
      // `>` truncates the file, so the file's own write perm is what matters.
      const { env, write } = redirectEnv();

      const result = expectSync(await runCommandLine(env, 'echo hi > readonly.txt', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: readonly.txt: Permission denied')]);
      expect(write).not.toHaveBeenCalled();
    });

    it('does not redirect a mode-change command (no write, mode passes through)', async () => {
      const { env, write } = redirectEnv();
      const withMode: ReadonlyMap<string, Command> = new Map([
        ['echo', echo],
        ['opener', modeChanger('opener')],
      ]);

      const result = await runCommandLine(env, 'opener > out.txt', withMode);

      expect(result.kind).toBe('mode_change');
      expect(write).not.toHaveBeenCalled();
    });

    it('surfaces a network write failure as an I/O error and exits non-zero', async () => {
      const { env } = redirectEnv({ ok: false, error: 'network_error' });

      const result = expectSync(await runCommandLine(env, 'echo hi > out.txt', pipeCommands));

      expect(result.exitCode).toBe(1);
      expect(result.lines).toEqual([errorLine('bash: out.txt: I/O error')]);
    });

    it('surfaces a server rejection (no_session / permission_denied) as "Permission denied"', async () => {
      const denied = expectSync(
        await runCommandLine(
          redirectEnv({ ok: false, error: 'no_session' }).env,
          'echo hi > out.txt',
          pipeCommands,
        ),
      );
      const forbidden = expectSync(
        await runCommandLine(
          redirectEnv({ ok: false, error: 'permission_denied' }).env,
          'echo hi > out.txt',
          pipeCommands,
        ),
      );

      expect(denied.lines).toEqual([errorLine('bash: out.txt: Permission denied')]);
      expect(forbidden.lines).toEqual([errorLine('bash: out.txt: Permission denied')]);
    });

    it("preserves the command's exit code and stderr while still writing", async () => {
      const { env, write } = redirectEnv();
      // `cat missing.txt` errors (exit 1) and produces no stdout; the empty
      // stdout is still written, the error still surfaces, exit stays 1.
      const result = expectSync(
        await runCommandLine(env, 'cat missing.txt > out.txt', pipeCommands),
      );

      expect(write).toHaveBeenCalledWith(asAbsPath('/home/alice/out.txt'), '');
      expect(result.exitCode).toBe(1);
      expect(contentOf(result.lines)).toContain('missing.txt');
    });
  });
});
