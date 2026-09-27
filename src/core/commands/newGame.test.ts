import { describe, expect, it } from 'vitest';
import { mockCommandEnv } from '../../test/factories/commandEnv';
import { bindFlags } from '../shell/bindFlags';
import type { CommandResult, OutputSink } from './types';
import { newGame } from './newGame';

/**
 * `new-game` is a GAME command (not a real Linux tool): it wipes the player's game
 * and starts fresh. It warns, then asks `confirm (y/N):` through `env.prompt`
 * (line-based, NOT masked). `y`/`yes` (case-insensitive, trimmed) ⇒ it fires the
 * `env.resetGame()` seam (the UI clears storage + reloads); anything else ⇒ it
 * cancels without touching the seam. `new-game -y`/`--yes` skips the warning + prompt
 * and resets immediately. Ctrl-C at the prompt aborts (exit 130, no reset).
 *
 * The tests drive the answer through a mocked `env.prompt`, capture the warning
 * through a spy `env.output`, and count `env.resetGame()` calls.
 */

const NO_FLAGS = new Map<string, string | true>();

type PromptCall = { readonly message: string; readonly masked: boolean };

/** Build the flags map the dispatcher WOULD produce, by running the REAL parser
 *  over `newGame.flags`. Driving the parser (instead of hand-building the Map)
 *  proves the declared spec keys match what `execute` checks — a `-y`/`--yes`
 *  spec-key drift surfaces as an `unrecognized option` here, not a silent pass. */
const flagsFor = (tokens: readonly string[]): ReadonlyMap<string, string | true> => {
  const result = bindFlags(tokens, newGame.flags ?? {});
  if (!result.ok) throw new Error(result.error);
  return result.flags;
};

type ResetEnvOpts = {
  /** What the player types at the confirm prompt. */
  readonly typed?: string;
  /** When true, the prompt is cancelled (Ctrl-C) instead of answered. */
  readonly cancel?: boolean;
};

const resetEnv = (opts: ResetEnvOpts = {}) => {
  let resetGameCalls = 0;
  const outputs: string[] = [];
  const promptCalls: PromptCall[] = [];

  const output: OutputSink = {
    text: (content) => outputs.push(content),
    dim: () => undefined,
    error: () => undefined,
  };

  const env = mockCommandEnv({
    output,
    resetGame: () => {
      resetGameCalls += 1;
    },
    prompt: async (promptOpts) => {
      promptCalls.push(promptOpts);
      if (opts.cancel) throw new DOMException('aborted', 'AbortError');
      return opts.typed ?? '';
    },
  });

  return {
    env,
    promptCalls,
    outputs,
    resetGameCount: () => resetGameCalls,
  };
};

const sync = (result: CommandResult) => {
  if (result.kind !== 'sync') throw new Error('sync result expected');
  return {
    text: result.lines.map((line) => line.content).join('\n'),
    kinds: result.lines.map((line) => line.kind),
    exitCode: result.exitCode,
    lineCount: result.lines.length,
  };
};

describe('new-game', () => {
  describe('confirming (interactive)', () => {
    it('fires resetGame and reports "Resetting game..." when the player answers y', async () => {
      const { env, resetGameCount } = resetEnv({ typed: 'y' });

      const { text, exitCode, kinds } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(resetGameCount()).toBe(1);
      expect(text).toBe('Resetting game...');
      expect(kinds).toEqual(['dim']);
      expect(exitCode).toBe(0);
    });

    it('accepts "yes" as well as "y"', async () => {
      const { env, resetGameCount } = resetEnv({ typed: 'yes' });

      const { exitCode } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(resetGameCount()).toBe(1);
      expect(exitCode).toBe(0);
    });

    // Trimmed + lowercased before the y/yes compare: each of these must reset.
    it.each(['Y', 'YES', ' y ', 'Yes', '  yes'])(
      'treats %j as confirmation (case-insensitive, trimmed)',
      async (typed) => {
        const { env, resetGameCount } = resetEnv({ typed });

        await newGame.execute(env, [], NO_FLAGS);

        expect(resetGameCount()).toBe(1);
      },
    );

    it('asks through a NON-masked line prompt labelled "confirm (y/N):"', async () => {
      const { env, promptCalls } = resetEnv({ typed: 'y' });

      await newGame.execute(env, [], NO_FLAGS);

      expect(promptCalls).toHaveLength(1);
      expect(promptCalls[0].masked).toBe(false);
      expect(promptCalls[0].message.toLowerCase()).toContain('confirm');
      expect(promptCalls[0].message).toContain('y/N');
    });

    it('prints the danger warning to scrollback BEFORE prompting', async () => {
      const { env, outputs } = resetEnv({ typed: 'y' });

      await newGame.execute(env, [], NO_FLAGS);

      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toContain('progress');
      expect(outputs[0]).toContain('undone');
    });
  });

  describe('declining', () => {
    it('does NOT fire resetGame and reports "Reset cancelled." on "n"', async () => {
      const { env, resetGameCount } = resetEnv({ typed: 'n' });

      const { text, exitCode, kinds } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(resetGameCount()).toBe(0);
      expect(text).toBe('Reset cancelled.');
      expect(kinds).toEqual(['dim']);
      expect(exitCode).toBe(0);
    });

    it('treats a bare Enter (empty answer) as No — default is not to reset', async () => {
      const { env, resetGameCount } = resetEnv({ typed: '' });

      const { text, exitCode } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(resetGameCount()).toBe(0);
      expect(text).toBe('Reset cancelled.');
      expect(exitCode).toBe(0);
    });

    // Near-misses that must NOT count as yes (kills a `startsWith('y')`/substring
    // mutant: `ye`, `yep`, `yeah` all begin with `y` but are not `y`/`yes`).
    it.each(['no', 'ye', 'yep', 'yeah', 'nope', 'maybe'])('does not reset on %j', async (typed) => {
      const { env, resetGameCount } = resetEnv({ typed });

      const { text } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(resetGameCount()).toBe(0);
      expect(text).toBe('Reset cancelled.');
    });
  });

  describe('cancelling at the prompt (Ctrl-C)', () => {
    it('aborts with exit 130, no output line, and never resets', async () => {
      const { env, resetGameCount } = resetEnv({ cancel: true });

      const { exitCode, lineCount } = sync(await newGame.execute(env, [], NO_FLAGS));

      expect(exitCode).toBe(130);
      expect(lineCount).toBe(0);
      expect(resetGameCount()).toBe(0);
    });
  });

  describe('skipping the prompt with -y / --yes', () => {
    it.each([['-y'], ['--yes']])(
      'resets immediately with %s — no prompt, no warning',
      async (flag) => {
        const { env, promptCalls, outputs, resetGameCount } = resetEnv();

        const { text, exitCode } = sync(await newGame.execute(env, [], flagsFor([flag])));

        expect(promptCalls).toEqual([]);
        expect(outputs).toEqual([]);
        expect(resetGameCount()).toBe(1);
        expect(text).toBe('Resetting game...');
        expect(exitCode).toBe(0);
      },
    );
  });
});
