/**
 * Nano — the full-screen file editor shown while `editorMode()` is set.
 *
 * A deliberately thin wrapper over a native `<textarea>`: the browser gives us
 * cursor movement, multiline editing, and selection for free, so the only custom
 * behaviour is the two nano chords — **Ctrl-O** (write out) and **Ctrl-X** (exit).
 * The component owns a local buffer signal seeded from the opened file's content;
 * persistence + exit are injected as `onSave`/`onExit` props so the editor stays
 * unit-testable without the patch/server stack (the `Terminal` screen wires the
 * real `saveEditor` / `setEditorMode(null)`).
 */

import { createSignal, Show } from 'solid-js';
import type { AbsPath } from '../../core/types';
import type { PatchResult } from '../../core/commands/types';

export type NanoProps = {
  readonly path: AbsPath;
  readonly content: string;
  readonly onSave: (content: string) => Promise<PatchResult>;
  readonly onExit: () => void;
};

/** Lines written, the way nano reports them: an empty buffer is 0 lines,
 *  otherwise the count of newline-separated segments. */
const lineCount = (content: string): number => (content === '' ? 0 : content.split('\n').length);

export const Nano = (props: NanoProps) => {
  // Seed the editable buffer from the opened file's content (read once at open).
  // eslint-disable-next-line solid/reactivity -- initial buffer value, not a tracked dependency
  const [buffer, setBuffer] = createSignal(props.content);
  const [status, setStatus] = createSignal('');

  const onKeyDown = async (event: KeyboardEvent) => {
    // Ctrl-O writes the buffer out and stays in the editor.
    if (event.ctrlKey && event.key === 'o') {
      event.preventDefault();
      const result = await props.onSave(buffer());
      setStatus(result.ok ? `[ Wrote ${lineCount(buffer())} lines ]` : '');
      return;
    }
    // Ctrl-X leaves the editor (back to the terminal).
    if (event.ctrlKey && event.key === 'x') {
      event.preventDefault();
      props.onExit();
    }
  };

  return (
    <main class="flex h-full flex-col font-mono text-sm leading-relaxed">
      <div class="bg-[var(--theme-text-bright)] px-2 py-1 text-center text-[var(--theme-bg)]">
        GNU nano · {props.path}
      </div>
      <textarea
        aria-label="editor"
        class="flex-1 resize-none border-none bg-transparent p-2 text-inherit caret-[var(--theme-caret)] outline-none [font:inherit]"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        value={buffer()}
        onInput={(event) => setBuffer(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <Show when={status()}>
        <div class="px-2 text-center text-[var(--theme-text-dim)]">{status()}</div>
      </Show>
      <div class="px-2 py-1 text-[var(--theme-text-dim)]">^O Write Out&nbsp;&nbsp;&nbsp;^X Exit</div>
    </main>
  );
};
