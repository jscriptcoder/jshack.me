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

import type { Command, CommandEnv, CommandResult, TerminalLine } from '../commands/types';
import { tokenize } from './tokenize';
import { parsePipeline, type Stage } from './pipeline';
import { bindFlags } from './bindFlags';

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

/** Resolve a stage to a runnable command + bound flags, or a shell error
 *  (command-not-found exit 127, or a binder failure exit 2). Pure — no
 *  execution — so the dispatcher can validate every stage up front. */
const prepareStage = (stage: Stage, commands: ReadonlyMap<string, Command>): PrepareResult => {
  const command = commands.get(stage.name);
  if (command === undefined) {
    return { ok: false, error: syncError(`bash: ${stage.name}: command not found`, 127) };
  }

  const bound = bindFlags(stage.args, command.flags ?? {}, { stacking: command.stacking ?? false });
  if (!bound.ok) {
    return { ok: false, error: syncError(`${command.name}: ${bound.error}`, 2) };
  }

  return { ok: true, prepared: { command, positional: bound.positional, flags: bound.flags } };
};

const run = (env: CommandEnv, prepared: PreparedStage): Promise<CommandResult> =>
  prepared.command.execute(env, prepared.positional, prepared.flags);

const isStdout = (line: TerminalLine): boolean => line.kind === 'text';

type StageOutput = {
  readonly stdout: readonly string[];
  readonly passthrough: readonly TerminalLine[];
};

/** Split a stage's lines into piped stdout (text-line content) and the
 *  terminal-bound passthrough lines (everything else). */
const categorize = (lines: readonly TerminalLine[]): StageOutput => ({
  stdout: lines.filter(isStdout).map((line) => line.content),
  passthrough: lines.filter((line) => !isStdout(line)),
});

/** Reduce a stage's result to its piped stdout + passthrough. Async results
 *  are drained to completion (the v2-native pipe-draining decision); a
 *  mode_change (nano/lynx/nc/…) can't feed a pipe, so it contributes nothing. */
const collectStageOutput = async (result: CommandResult): Promise<StageOutput> => {
  if (result.kind === 'sync') {
    return categorize(result.lines);
  }
  if (result.kind === 'mode_change') {
    return categorize([]);
  }
  // async: stream into an array (the one unavoidable imperative step — an
  // AsyncIterable can't be array-method'd), then split it like the sync branch.
  const drained: TerminalLine[] = [];
  for await (const line of result.lines) {
    drained.push(line);
  }
  await result.exitCode();
  return categorize(drained);
};

async function* iterate(lines: readonly string[]): AsyncIterable<string> {
  yield* lines;
}

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
  for (const stage of parsed.pipeline.stages) {
    const result = prepareStage(stage, commands);
    if (!result.ok) return result.error;
    prepared.push(result.prepared);
  }

  // Empty pipeline (blank input line) — a no-op. Guards the loop below, which
  // assumes at least one stage and always returns on the last.
  if (prepared.length === 0) {
    return { kind: 'sync', lines: [], exitCode: 0 };
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
      return withCarried(carried, result);
    }
    const { stdout, passthrough } = await collectStageOutput(result);
    carried.push(...passthrough);
    stdin = iterate(stdout);
  }

  throw new Error('runCommandLine: pipeline loop did not return (unreachable)');
};
