/**
 * runCommandLine — turn a raw input line into a command invocation, supporting
 * pipelines (`cmd1 | cmd2 | …`).
 *
 * Three-phase parse:
 *   1. tokenize() — typed token stream (`word` / `pipe`) with shell-style
 *      quoting. An unterminated quote → `bash: <error>` exit 2.
 *   2. parsePipeline() — split tokens into stages on pipe operators. An empty
 *      stage (`| a`, `a |`, `a || b`) → `bash: <error>` exit 2.
 *   3. per stage: bindFlags() classifies each remaining token as a flag or a
 *      positional and surfaces unknown-flag / missing-value errors as exit 2.
 *
 * Single-stage lines run exactly as before — the command's `CommandResult`
 * (sync, async, OR mode_change) is returned untouched, so nano/lynx/nc and
 * streaming commands are unaffected.
 *
 * Multi-stage lines thread each stage's stdout into the next stage's
 * `env.stdin` (an `AsyncIterable<string>`):
 *   - only `text` lines are stdout (piped). `error`/`dim`/`prompt` lines from
 *     an intermediate stage are NOT piped — they surface to the terminal,
 *     prepended to the final stage's output (real-bash: stderr isn't piped).
 *   - intermediate async stages are DRAINED fully before the next stage runs
 *     (v2-native; no legacy "must complete synchronously" restriction).
 *   - exit code is the LAST stage's (bash default; no pipefail).
 *   - all stages are validated (command-found + flags) BEFORE any executes, so
 *     a typo in a later stage can't leave an earlier stage's side effects half
 *     applied.
 *
 * Exit-code conventions:
 *   0   — empty input (no-op) or successful command
 *   2   — parse-time error (tokenizer, pipeline, OR a stage's binder)
 *   127 — unknown command name in any stage
 *   *   — anything else is the (last) command's own exit code
 */

import {
  PATCH_ERROR_REASON,
  type Command,
  type CommandEnv,
  type CommandResult,
  type FsView,
  type Session,
  type TerminalLine,
} from '../commands/types';
import { listenerOn } from '../services/pidfile';
import type { AbsPath } from '../types';
import { tokenize } from './tokenize';
import { parsePipeline, type Stage } from './pipeline';
import { bindFlags } from './bindFlags';
import { dirname, resolveAbsPath } from '../filesystem/path';

const syncError = (content: string, exitCode: number): CommandResult => ({
  kind: 'sync',
  lines: [{ kind: 'error', content }],
  exitCode,
});

type PreparedStage = {
  readonly command: Command;
  readonly positional: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
};

type PrepareResult =
  | { readonly ok: true; readonly prepared: PreparedStage }
  | { readonly ok: false; readonly error: CommandResult };

/** Whether the shell running this session has a terminal behind it. Everything
 *  reached by LOGGING IN does; a session reached through a planted listener
 *  does not, because netcat is a pipe and nobody allocated it a pty. It is the
 *  difference every writeup opens by fixing (`python3 -c 'import pty;…'`), and
 *  here it is what separates the three doors: ftp moves files, a backdoor lets
 *  you look and break, and only a real login can be pivoted onward from. */
const hasTty = (session: Session): boolean => session.kind !== 'nc';

/** What netcat prints when the far side is gone. */
const CONNECTION_CLOSED = 'nc: connection closed by foreign host';

/** Whether the listener that admitted this session is still in the box's
 *  `/var/run`. Asked through the same reader `nmap` and `ps` use, so the port a
 *  defender sees closed and the socket an intruder is sitting on cannot disagree.
 *
 *  Only a backdoor is asked: a login forks a child that outlives whatever started
 *  it, which is exactly why stopping sshd leaves its sessions up, while netcat is
 *  the ONE process that both listens and serves — kill it and the socket it was
 *  serving goes with it. A session that recorded no port names no door and is
 *  left alone. */
const socketAlive = (session: Session, fs: FsView): boolean =>
  session.kind !== 'nc' ||
  session.port === undefined ||
  listenerOn(fs.root(), session.port) !== null;

/** Resolve a stage to a runnable command + bound flags, or a shell error
 *  (command-not-found exit 127, a binder failure exit 2, or no terminal for a
 *  command that needs one, exit 1). Pure — no execution — so the dispatcher can
 *  validate every stage up front, which is also what stops `su | grep x` from
 *  smuggling a refused command past the gate inside a pipeline. */
const prepareStage = (
  stage: Stage,
  commands: ReadonlyMap<string, Command>,
  tty: boolean,
): PrepareResult => {
  const command = commands.get(stage.name);
  if (command === undefined) {
    return { ok: false, error: syncError(`bash: ${stage.name}: command not found`, 127) };
  }

  const bound = bindFlags(stage.args, command.flags ?? {}, { stacking: command.stacking ?? false });
  if (!bound.ok) {
    return { ok: false, error: syncError(`${command.name}: ${bound.error}`, 2) };
  }

  // Last of the three, mirroring the order the real thing fails in: the program
  // is found, parses its arguments, and only then reaches for a terminal that
  // is not there. The command speaks for itself — one voice per program, not a
  // shell-wide sentence about someone else's tool.
  if (!tty && command.withoutTty !== undefined) {
    return { ok: false, error: syncError(command.withoutTty, 1) };
  }

  return { ok: true, prepared: { command, positional: bound.positional, flags: bound.flags } };
};

const run = (env: CommandEnv, prepared: PreparedStage): Promise<CommandResult> =>
  prepared.command.execute(env, prepared.positional, prepared.flags);

const isStdout = (line: TerminalLine): boolean => line.kind === 'text';

type StageOutput = {
  readonly stdout: readonly string[];
  readonly passthrough: readonly TerminalLine[];
  readonly exitCode: number;
};

/** Split a stage's lines into piped stdout (text-line content) and the
 *  terminal-bound passthrough lines (everything else). */
const categorize = (lines: readonly TerminalLine[], exitCode: number): StageOutput => ({
  stdout: lines.filter(isStdout).map((line) => line.content),
  passthrough: lines.filter((line) => !isStdout(line)),
  exitCode,
});

/** Reduce a stage's result to its piped stdout + passthrough + exit code.
 *  Async results are drained to completion (the v2-native pipe-draining
 *  decision); a mode_change (nano/lynx/nc/…) can't feed a pipe, so it
 *  contributes nothing. */
const collectStageOutput = async (result: CommandResult): Promise<StageOutput> => {
  if (result.kind === 'sync') {
    return categorize(result.lines, result.exitCode);
  }
  if (result.kind === 'mode_change') {
    return categorize([], 0);
  }
  // async: stream into an array (the one unavoidable imperative step — an
  // AsyncIterable can't be array-method'd), then split it like the sync branch.
  const drained: TerminalLine[] = [];
  for await (const line of result.lines) {
    drained.push(line);
  }
  const exitCode = await result.exitCode();
  return categorize(drained, exitCode);
};

async function* iterate(lines: readonly string[]): AsyncIterable<string> {
  yield* lines;
}

type RedirectTarget =
  | { readonly ok: true; readonly target: AbsPath; readonly isNew: boolean }
  | { readonly ok: false; readonly message: string };

/** Resolve + validate a redirect target against the live FS view, BEFORE the
 *  command runs (bash opens redirects before exec). Rejects an existing
 *  directory, a missing parent directory, and a location the tier can't write.
 *  Reports `isNew` (the target doesn't exist yet) so the write stamps `is_new`
 *  for a freshly-created file but leaves an overwrite's stored flag intact. */
const validateRedirectTarget = (env: CommandEnv, rawTarget: string): RedirectTarget => {
  const target = resolveAbsPath(env.fs.cwd(), rawTarget);
  const node = env.fs.stat(target);
  if (node?.kind === 'directory') {
    return { ok: false, message: `bash: ${rawTarget}: Is a directory` };
  }
  const parent = dirname(target);
  const parentNode = env.fs.stat(parent);
  if (parentNode === null || parentNode.kind !== 'directory') {
    return { ok: false, message: `bash: ${rawTarget}: No such file or directory` };
  }
  // Overwrite checks the file itself; a new file checks the parent directory.
  const writable = node !== null ? env.fs.canWrite(target) : env.fs.canWrite(parent);
  if (!writable.allowed) {
    return { ok: false, message: `bash: ${rawTarget}: Permission denied` };
  }
  return { ok: true, target, isNew: node === null };
};

/** Write the final stage's stdout to the redirect target instead of the
 *  terminal. The command's stderr (passthrough) + intermediate carry still
 *  surface; the command's exit code is preserved unless the write itself
 *  fails. */
const applyRedirect = async (
  env: CommandEnv,
  rawTarget: string,
  target: AbsPath,
  isNew: boolean,
  carried: readonly TerminalLine[],
  finalResult: CommandResult,
): Promise<CommandResult> => {
  const { stdout, passthrough, exitCode } = await collectStageOutput(finalResult);
  const written = await env.patches.write(target, stdout.join('\n'), { isNew });
  const lines = [...carried, ...passthrough];
  if (!written.ok) {
    return {
      kind: 'sync',
      lines: [
        ...lines,
        { kind: 'error', content: `bash: ${rawTarget}: ${PATCH_ERROR_REASON[written.error]}` },
      ],
      exitCode: 1,
    };
  }
  return { kind: 'sync', lines, exitCode };
};

/** Prepend terminal-bound passthrough lines (intermediate stderr) to the final
 *  stage's result so they aren't swallowed. */
const withCarried = (carried: readonly TerminalLine[], result: CommandResult): CommandResult => {
  if (carried.length === 0) return result;
  if (result.kind === 'sync') {
    return { kind: 'sync', lines: [...carried, ...result.lines], exitCode: result.exitCode };
  }
  return result;
};

export const runCommandLine = async (
  env: CommandEnv,
  input: string,
  commands: ReadonlyMap<string, Command>,
): Promise<CommandResult> => {
  // Before the line is even parsed: a submitted line is a write to the socket, and
  // this is how a terminal learns the socket died — by writing to it. Nothing the
  // player typed reaches the box, so a typo answers `connection closed` rather than
  // `command not found`; the box is not there to have looked.
  if (!socketAlive(env.session, env.fs)) {
    env.popSession();
    return syncError(CONNECTION_CLOSED, 1);
  }

  const tokenized = tokenize(input);
  if (!tokenized.ok) {
    return syncError(`bash: ${tokenized.error}`, 2);
  }

  const parsed = parsePipeline(tokenized.tokens);
  if (!parsed.ok) {
    return syncError(`bash: ${parsed.error}`, 2);
  }

  // Validate every stage before running any (avoids partial side effects when
  // a later stage has a typo or bad flag). An imperative loop with an early
  // return is the right tool here: a functional map+filter would need a
  // provably-no-op `.filter(ok)` to re-narrow the results, which only adds an
  // unkillable equivalent mutant without improving clarity.
  const prepared: PreparedStage[] = [];
  const tty = hasTty(env.session);
  for (const stage of parsed.pipeline.stages) {
    const result = prepareStage(stage, commands, tty);
    if (!result.ok) return result.error;
    prepared.push(result.prepared);
  }

  // Empty pipeline (blank input line) — a no-op. Guards the loop below, which
  // assumes at least one stage and always returns on the last.
  if (prepared.length === 0) {
    return { kind: 'sync', lines: [], exitCode: 0 };
  }

  // Validate the redirect target BEFORE running anything (bash opens redirects
  // before exec) — an invalid target must not run a side-effecting command.
  const redirect = parsed.pipeline.redirect;
  let redirectTarget:
    | { readonly path: string; readonly resolved: AbsPath; readonly isNew: boolean }
    | undefined;
  if (redirect !== undefined) {
    const validated = validateRedirectTarget(env, redirect.path);
    if (!validated.ok) return syncError(validated.message, 1);
    redirectTarget = { path: redirect.path, resolved: validated.target, isNew: validated.isNew };
  }

  // The loop also handles the single-stage case (one iteration, empty carry),
  // so there is no special-case branch: a lone command's result passes through
  // untouched (sync / async / mode_change alike).
  let stdin = env.stdin;
  const carried: TerminalLine[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    // Omit `stdin` entirely when undefined — `exactOptionalPropertyTypes`
    // forbids assigning `undefined` to the optional `stdin` property.
    const stageEnv: CommandEnv = stdin === undefined ? env : { ...env, stdin };
    const result = await run(stageEnv, prepared[i]);
    if (i === prepared.length - 1) {
      // A mode_change (nano/lynx/…) produces no stdout to redirect — pass it
      // through untouched even if a redirect was parsed.
      if (redirectTarget !== undefined && result.kind !== 'mode_change') {
        return applyRedirect(
          env,
          redirectTarget.path,
          redirectTarget.resolved,
          redirectTarget.isNew,
          carried,
          result,
        );
      }
      return withCarried(carried, result);
    }
    const { stdout, passthrough } = await collectStageOutput(result);
    carried.push(...passthrough);
    stdin = iterate(stdout);
  }

  throw new Error('runCommandLine: pipeline loop did not return (unreachable)');
};
