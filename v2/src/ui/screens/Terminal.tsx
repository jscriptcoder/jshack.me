import { createEffect, For, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { ModeChange, TerminalLine } from '../../core/commands/types';
import { formatPrompt } from '../../core/shell/prompt';
import { BANNER } from '../banner';
import {
  abortRunning,
  cancelPrompt,
  cwd,
  historyDown,
  followLink,
  historyUp,
  input,
  pendingPrompt,
  FTP_PROMPT,
  inFtpSession,
  inMysqlSession,
  MYSQL_PROMPT,
  promptHost,
  promptTier,
  promptUsername,
  runInput,
  overlayMode,
  runningCommand,
  saveEditor,
  scrollback,
  setInput,
  setOverlayMode,
  submitPrompt,
  tabComplete,
} from '../state';
import { Lynx } from './Lynx';
import { Nano } from './Nano';
import { TerminalLoading } from './TerminalLoading';

const LINE_BASE = 'whitespace-pre-wrap break-words';

/** Narrow the open overlay to one app, or null when a different one holds the
 *  screen. Written as functions rather than inline comparisons because it is the
 *  RETURN type that carries the narrowing into each screen's props. */
const asNano = (mode: ModeChange) => (mode.kind === 'nano' ? mode : null);
const asLynx = (mode: ModeChange) => (mode.kind === 'lynx' ? mode : null);

/** Every full-screen app leaves the same way: hand the screen back. */
const closeOverlay = () => setOverlayMode(null);

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
  // At `ftp>` or `mysql>` the shell's user@host:cwd would name a machine the player
  // is no longer typing at, so the sub-shell's prompt replaces it rather than
  // decorating it.
  (inMysqlSession() ? MYSQL_PROMPT : undefined) ??
  (inFtpSession() ? FTP_PROMPT : undefined) ??
  formatPrompt({
    username: promptUsername(),
    host: promptHost(),
    cwd: cwd(),
    userType: promptTier(),
  });

export const Terminal = () => {
  let output: HTMLDivElement | undefined;
  let inputEl: HTMLInputElement | undefined;

  // The label for the busy bar, or null when the prompt should be live. A
  // command blocked on an interactive prompt (su's password) is still running,
  // but it is waiting on the PLAYER — so the prompt wins and stays typeable.
  const busyLabel = (): string | null => (pendingPrompt() ? null : runningCommand());

  // Keep the newest output in view as the scrollback grows.
  createEffect(() => {
    scrollback();
    if (output) output.scrollTop = output.scrollHeight;
  });

  // Keep the prompt focused. Runs on first mount, and again whenever the input
  // comes back after being swapped out — for a full-screen overlay (nano, future
  // apps) or for the busy bar — so the player never has to click to resume
  // typing after an editor or a long-running command.
  createEffect(() => {
    if (overlayMode() === null && busyLabel() === null) inputEl?.focus();
  });

  // While the busy bar stands in for the prompt there is no focused input to
  // carry a keystroke, so the interrupt is caught at the window instead. Guarded
  // on the same derivation that swaps the bar in, so exactly one of the two
  // handlers is ever live and Ctrl-C can't both cancel a prompt and abort a run.
  onMount(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (busyLabel() === null) return;
      if (event.key === 'c' && event.ctrlKey && abortRunning()) event.preventDefault();
    };
    window.addEventListener('keydown', onWindowKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onWindowKeyDown));
  });

  // Click-to-refocus: a plain click anywhere in the terminal returns focus to
  // the prompt, so the shell always feels live. Skipped while text is selected,
  // so the player can still highlight output and copy it — focusing the input
  // would collapse the selection and make Ctrl-C copy the empty prompt instead.
  const refocusPrompt = () => {
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    inputEl?.focus();
  };

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
    <Show
      when={overlayMode()}
      fallback={
        <main
          class="flex h-full flex-col p-4 font-mono text-sm leading-relaxed"
          onClick={refocusPrompt}
        >
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
          <Show
            when={busyLabel()}
            fallback={
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
            }
          >
            {(label) => <TerminalLoading commandName={label()} />}
          </Show>
        </main>
      }
    >
      {(mode) => (
        <Switch>
          <Match when={asNano(mode())}>
            {(nano) => (
              <Nano
                path={nano().path}
                content={nano().content}
                onSave={saveEditor}
                onExit={closeOverlay}
              />
            )}
          </Match>
          <Match when={asLynx(mode())}>
            {(browser) => (
              <Lynx
                url={browser().url}
                content={browser().content}
                onExit={closeOverlay}
                onFollow={followLink}
              />
            )}
          </Match>
        </Switch>
      )}
    </Show>
  );
};
