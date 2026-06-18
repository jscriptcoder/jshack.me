/**
 * reset — a GAME command (not a real Linux tool): wipe the player's game and
 * start fresh. It warns, then asks `confirm (y/N):` through `env.prompt` (the
 * same line-based seam `su` uses, but NOT masked). `y`/`yes` (case-insensitive,
 * trimmed) fires `env.resetGame()` — the UI seam that clears all client-persisted
 * state (regenerating the Ed25519 identity) and reloads to the intro screen.
 * Anything else cancels without touching the seam; the capital `N` in `(y/N)`
 * marks No as the default, so a bare Enter does not reset.
 *
 * `reset -y` / `reset --yes` skips the warning + prompt and resets immediately.
 *
 * The warning is emitted to scrollback via `env.output` (so it renders as its own
 * line ABOVE the single-line `confirm (y/N):` input label) — `reset` is the first
 * consumer of that sink. Ctrl-C at the prompt rejects (`env.prompt`), which aborts
 * with exit 130 and no reset, mirroring `su`.
 */

import type { Command, CommandResult, TerminalLine } from './types';

const WARNING = '⚠ This wipes ALL progress and starts a new game. This cannot be undone.';
const CONFIRM_MESSAGE = 'confirm (y/N): ';

const dim = (content: string): TerminalLine => ({ kind: 'dim', content });

const status = (content: string): CommandResult => ({
  kind: 'sync',
  lines: [dim(content)],
  exitCode: 0,
});

/** Real `su`/`apt`-style `[y/N]`: only `y` or `yes` (case-insensitive, trimmed)
 *  confirms. Empty (bare Enter), `n`, and everything else decline. */
const isYes = (answer: string): boolean => {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
};

const execute: Command['execute'] = async (env, _args, flags) => {
  const skipPrompt = flags.has('--yes') || flags.has('-y');

  if (!skipPrompt) {
    env.output.text(WARNING);
    let answer: string;
    try {
      answer = await env.prompt({ message: CONFIRM_MESSAGE, masked: false });
    } catch {
      // Ctrl-C — the prompt rejected; abort without resetting.
      return { kind: 'sync', lines: [], exitCode: 130 };
    }
    if (!isYes(answer)) return status('Reset cancelled.');
  }

  env.resetGame();
  return status('Resetting game...');
};

export const reset: Command = {
  name: 'reset',
  description: 'Wipe all progress and start a new game',
  category: 'general',
  tier: 'guest',
  availability: { kind: 'any-machine' },
  flags: { '--yes': 'boolean', '-y': 'boolean' },
  manual: {
    synopsis: 'reset [-y|--yes]',
    description:
      'Wipe ALL game progress — your identity, files, workstation, and WiFi — and ' +
      'start a new game from the intro screen. Prompts for confirmation unless ' +
      '-y/--yes is given. This cannot be undone.',
    arguments: [
      {
        name: '-y, --yes',
        description: 'Skip the confirmation prompt and reset immediately.',
      },
    ],
    examples: [
      { command: 'reset', description: 'Show the warning and confirm before resetting' },
      { command: 'reset -y', description: 'Reset immediately, without the confirmation prompt' },
    ],
  },
  execute,
};
