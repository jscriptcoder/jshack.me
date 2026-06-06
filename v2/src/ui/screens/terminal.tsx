import { createEffect, For } from 'solid-js';
import type { TerminalLine } from '../../core/commands/types';
import { formatPrompt } from '../../core/shell/prompt';
import { BANNER } from '../banner';
import {
  abortRunning,
  cancelPrompt,
  cwd,
  historyDown,
  historyUp,
  input,
  pendingPrompt,
  promptHost,
  promptTier,
  promptUsername,
  runInput,
  scrollback,
  setInput,
  submitPrompt,
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

/** Reactive prompt — re-evaluated by Solid on cwd / session changes. Shows the
 *  pending prompt's message (e.g. `Password:`) while one is active. */
const livePrompt = () =>
  pendingPrompt()?.message ??
  formatPrompt({
    username: promptUsername(),
    host: promptHost(),
    cwd: cwd(),
    userType: promptTier(),
  });

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
      // A pending prompt (su password, …) consumes the line instead of running it.
      if (pendingPrompt()) {
        submitPrompt();
        return;
      }
      void runInput();
      return;
    }
    // Ctrl-C cancels a pending prompt, else interrupts a running command. Only
    // swallow the keystroke when there was something to act on, so an idle
    // Ctrl-C still copies any selection.
    if (event.key === 'c' && event.ctrlKey) {
      if (pendingPrompt()) {
        cancelPrompt();
        event.preventDefault();
        return;
      }
      if (abortRunning()) event.preventDefault();
      return;
    }
    // While a prompt is pending, history recall and tab-complete are disabled.
    if (pendingPrompt()) {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Tab') {
        event.preventDefault();
      }
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
          type={pendingPrompt()?.masked ? 'password' : 'text'}
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
