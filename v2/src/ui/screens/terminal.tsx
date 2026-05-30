import { createEffect, For } from 'solid-js';
import type { TerminalLine } from '../../core/commands/types';
import { formatPrompt } from '../../core/shell/prompt';
import { BANNER } from '../banner';
import { SEED_HOST, SEED_USERNAME } from '../seed';
import {
  cwd,
  historyDown,
  historyUp,
  input,
  runInput,
  scrollback,
  setInput,
  tabComplete,
} from '../state';

const LINE_BASE = 'whitespace-pre-wrap break-words';

/** Per-kind colour — normal text inherits the amber body colour. */
const LINE_COLOR: Record<TerminalLine['kind'], string> = {
  text: '',
  error: 'text-[var(--theme-error)]',
  dim: 'text-[var(--theme-text-dim)]',
  prompt: 'text-[var(--theme-text-bright)]',
};

/** Reactive prompt — re-evaluated by Solid each time `cwd()` changes. */
const livePrompt = () => formatPrompt({ username: SEED_USERNAME, host: SEED_HOST, cwd: cwd() });

export const Terminal = () => {
  let output: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  // Keep the newest output in view as the scrollback grows.
  createEffect(() => {
    scrollback();
    if (output) output.scrollTop = output.scrollHeight;
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runInput();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      historyUp();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      historyDown();
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const caret = tabComplete(inputEl?.selectionStart ?? input().length);
      // The replacement is applied to the `input` signal; Solid flushes the
      // controlled value at the end of this event, so reposition the caret in a
      // microtask — by then the DOM value reflects the completion.
      if (caret !== null) queueMicrotask(() => inputEl?.setSelectionRange(caret, caret));
    }
  };

  return (
    <main class="flex h-full flex-col p-4 font-mono text-sm leading-relaxed">
      <div ref={output} class="flex-1 overflow-y-auto">
        <pre
          data-testid="terminal-banner"
          class="whitespace-pre leading-none text-[var(--theme-text-bright)]"
        >
          {BANNER}
        </pre>
        <For each={scrollback()}>
          {(line) => <div class={`${LINE_BASE} ${LINE_COLOR[line.kind]}`}>{line.content}</div>}
        </For>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="whitespace-pre text-[var(--theme-text-bright)]">{livePrompt()}</span>
        <input
          ref={inputEl}
          aria-label="terminal input"
          class="flex-1 border-none bg-transparent p-0 text-inherit caret-[var(--theme-caret)] outline-none [font:inherit]"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          value={input()}
          onInput={(event) => setInput(event.currentTarget.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </main>
  );
};
