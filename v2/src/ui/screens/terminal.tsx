import { For } from 'solid-js';
import type { TerminalLine } from '../../core/commands/types';
import { SEED_HOST, seedSession } from '../seed';
import { input, runInput, scrollback, setInput } from '../state';

const LINE_BASE = 'whitespace-pre-wrap break-words';

/** Per-kind colour — normal text inherits the amber body colour. */
const LINE_COLOR: Record<TerminalLine['kind'], string> = {
  text: '',
  error: 'text-[var(--theme-error)]',
  dim: 'text-[var(--theme-text-dim)]',
  prompt: 'text-[var(--theme-text-bright)]',
};

const PROMPT = `${seedSession().username}@${SEED_HOST}>`;

export const Terminal = () => {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void runInput();
    }
  };

  return (
    <main class="flex h-full flex-col p-4 text-sm leading-relaxed">
      <div class="flex-1 overflow-y-auto">
        <For each={scrollback()}>
          {(line) => <div class={`${LINE_BASE} ${LINE_COLOR[line.kind]}`}>{line.content}</div>}
        </For>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="whitespace-pre text-[var(--theme-text-bright)]">{PROMPT}</span>
        <input
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
