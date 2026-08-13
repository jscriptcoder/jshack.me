/**
 * Nano — the full-screen file editor, shown while it is the open overlay.
 *
 * A deliberately thin wrapper over a native `<textarea>`: the browser gives us
 * cursor movement, multiline editing, and selection for free, so the only custom
 * behaviour is the two nano chords — **Ctrl-O** (write out) and **Ctrl-X** (exit).
 * The component owns a local buffer signal seeded from the opened file's content;
 * persistence + exit are injected as `onSave`/`onExit` props so the editor stays
 * unit-testable without the patch/server stack (the `Terminal` screen wires the
 * real `saveEditor`, and closes the overlay).
 */

import { createSignal, onMount, Show } from 'solid-js';
import type { AbsPath } from '../../core/types';
import type { PatchResult } from '../../core/commands/types';

export type NanoProps = {
  readonly path: AbsPath;
  readonly content: string;
  readonly onSave: (
    content: string,
    options?: { readonly overwriteUnseen?: boolean },
  ) => Promise<PatchResult>;
  readonly onExit: () => void;
};

/** Lines written, the way nano reports them: an empty buffer is 0 lines,
 *  otherwise the count of newline-separated segments. */
const lineCount = (content: string): number => (content === '' ? 0 : content.split('\n').length);

/** Map a failed save to nano's status-line reason, reusing the same wording as
 *  the `>` redirect write path (`runLine.ts`): an auth/permission rejection reads
 *  "Permission denied", a transport failure reads "I/O error".
 *
 *  `modified_since_open` never reaches here — it becomes a question rather than a
 *  report (see `OVERWRITE_CONFIRM`), and the forced retry carries no base so it
 *  cannot come back a second time. The entry exists because the map is total over
 *  the error union, which is what makes a newly added error a compile failure
 *  here instead of a blank status line in front of a player. */
const SAVE_ERROR_REASON: Record<Extract<PatchResult, { ok: false }>['error'], string> = {
  no_session: 'Permission denied',
  permission_denied: 'Permission denied',
  network_error: 'I/O error',
  modified_since_open: 'File was modified since you opened it',
};

/** Real GNU nano's own wording, and its own escape hatch: the player may still
 *  destroy an edit they were never shown, but only by saying so. The path is not
 *  named — the header bar carries it, and only one file is ever open. */
const OVERWRITE_CONFIRM = 'File was modified since you opened it, continue saving? (y/n)';

/** The answers GNU nano takes to a y/n prompt. Anything else is not an answer,
 *  and leaves the question standing. */
const confirms = (event: KeyboardEvent): boolean => event.key === 'y' || event.key === 'Y';
const declines = (event: KeyboardEvent): boolean =>
  event.key === 'n' ||
  event.key === 'N' ||
  event.key === 'Escape' ||
  (event.ctrlKey && event.key === 'c');

export const Nano = (props: NanoProps) => {
  // Seed the editable buffer from the opened file's content (read once at open).
  // eslint-disable-next-line solid/reactivity -- initial buffer value, not a tracked dependency
  const [buffer, setBuffer] = createSignal(props.content);
  const [status, setStatus] = createSignal('');
  const [confirmingOverwrite, setConfirmingOverwrite] = createSignal(false);
  let textarea: HTMLTextAreaElement | undefined;

  // The editor fills the screen the moment it opens, so put the cursor in the
  // buffer straight away — the player should be able to type without first
  // clicking the textarea.
  onMount(() => textarea?.focus());

  // A save the server refused because the file changed underneath is a question,
  // not a failure: hold the answer instead of reporting, and let the player
  // decide. Anything else lands on the status line as before.
  const reportSave = (result: PatchResult) => {
    if (!result.ok && result.error === 'modified_since_open') {
      setStatus('');
      setConfirmingOverwrite(true);
      return;
    }
    setStatus(
      result.ok
        ? `[ Wrote ${lineCount(buffer())} lines ]`
        : `[ Error writing ${props.path}: ${SAVE_ERROR_REASON[result.error]} ]`,
    );
  };

  const onKeyDown = async (event: KeyboardEvent) => {
    // While the question stands it owns the keyboard entirely — the chords are
    // out of reach, so ^X cannot discard a buffer the player still believes they
    // are being asked about, and an unrecognised key just leaves the question up.
    if (confirmingOverwrite()) {
      event.preventDefault();
      if (confirms(event)) {
        setConfirmingOverwrite(false);
        // Sent WITHOUT a base, which is the unconditional write the server
        // already accepts — the overwrite is deliberate now, so there is nothing
        // left to check it against.
        reportSave(await props.onSave(buffer(), { overwriteUnseen: true }));
        return;
      }
      if (declines(event)) setConfirmingOverwrite(false);
      return;
    }
    // Ctrl-O writes the buffer out and stays in the editor.
    if (event.ctrlKey && event.key === 'o') {
      event.preventDefault();
      reportSave(await props.onSave(buffer()));
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
        ref={textarea}
        aria-label="editor"
        class="flex-1 resize-none border-none bg-transparent p-2 text-inherit caret-[var(--theme-caret)] outline-none [font:inherit]"
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        // The question is about the buffer as it stands, so the buffer stops
        // moving until it is answered.
        readOnly={confirmingOverwrite()}
        value={buffer()}
        onInput={(event) => setBuffer(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <Show when={confirmingOverwrite()}>
        <div class="px-2 text-center text-[var(--theme-text-bright)]">{OVERWRITE_CONFIRM}</div>
      </Show>
      <Show when={status()}>
        <div role="status" class="px-2 text-center text-[var(--theme-text-dim)]">
          {status()}
        </div>
      </Show>
      <div class="px-2 py-1 text-[var(--theme-text-dim)]">
        ^O Write Out&nbsp;&nbsp;&nbsp;^X Exit
      </div>
    </main>
  );
};
