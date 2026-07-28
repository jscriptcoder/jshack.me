/**
 * The busy bar — what stands where the prompt normally is while the shell is
 * working. A command that talks to the server (an `ssh` auth round-trip, a
 * cross-player `nmap`, a patch write) or streams its output over time would
 * otherwise leave an idle-looking prompt on screen, so the player can't tell a
 * slow command from a finished one.
 */

import { createSignal, onCleanup } from 'solid-js';

export const BRAILLE_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

export const FRAME_INTERVAL_MS = 80;

type TerminalLoadingProps = {
  readonly commandName: string;
};

export const TerminalLoading = (props: TerminalLoadingProps) => {
  const [frameIndex, setFrameIndex] = createSignal(0);

  const timer = setInterval(() => {
    setFrameIndex((index) => (index + 1) % BRAILLE_FRAMES.length);
  }, FRAME_INTERVAL_MS);
  onCleanup(() => clearInterval(timer));

  return (
    <div class="flex items-baseline gap-2" data-testid="terminal-loading" role="status">
      <span class="whitespace-pre text-[var(--theme-text-dim)]">
        {/* The glyph churns ~12x/s — hidden from assistive tech so only the
            command name (which never changes) is announced. */}
        <span aria-hidden="true">{BRAILLE_FRAMES[frameIndex()]}</span>
        {props.commandName === '' ? '' : ` ${props.commandName}...`}
      </span>
    </div>
  );
};
