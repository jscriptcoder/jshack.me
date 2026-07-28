/**
 * The streamed-progress convention for commands that do slow work.
 *
 * A command whose work takes real time (a server round-trip) — or whose
 * real-world counterpart takes time — announces each step BEFORE doing it, so
 * the announcement paints while the work is pending instead of narrating it
 * afterwards. The shape of an announcement:
 *
 *   - a line ending in `...` means "this is happening NOW";
 *   - the arrival of the NEXT line is what reports it finished;
 *   - the last step is reported by the prompt coming back.
 *
 * There is deliberately no `Done` marker. Real `apt` can print one because it
 * rewrites the line it already printed; a terminal that only appends can't, and
 * `Reading package lists... Done` arriving in one piece says the opposite of
 * what it means. Pace the steps with `env.sleep` (abort-aware, so Ctrl-C
 * unwinds mid-sequence) rather than letting them all land in one frame.
 *
 * `streamedResult` exists for the exit code. `CommandResult`'s async arm types
 * it as `() => Promise<number>`, which a bare async generator can't satisfy: a
 * `for await` throws the generator's RETURN value away. Forwarding through
 * `yield*` keeps it, so a streamed command ends each path with its exit code
 * and the shell sees the one that actually happened.
 *
 * Note a streamed command is LAZY — nothing runs until its lines are consumed.
 * Every consumer drains (the terminal renders each line as it arrives; a pipe
 * or redirect collects them first), so this is invisible in the game, but a
 * test that asserts on a command's side effects has to drain it too.
 */

import type { CommandResult, TerminalLine } from './types';

export const text = (content: string): TerminalLine => ({ kind: 'text', content });

export const errorLine = (content: string): TerminalLine => ({ kind: 'error', content });

export const streamedResult = (steps: AsyncGenerator<TerminalLine, number>): CommandResult => {
  let exitCode = 0;
  async function* forward(): AsyncIterable<TerminalLine> {
    exitCode = yield* steps;
  }
  return { kind: 'async', lines: forward(), exitCode: async () => exitCode };
};
