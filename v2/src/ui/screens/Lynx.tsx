/**
 * Lynx — the full-screen text browser shown while a `lynx` overlay is open.
 *
 * A reader, not an editor: the page arrives already fetched (the command does that,
 * so a refused connection reads in the TERMINAL exactly as `curl`'s does, and the
 * browser only ever opens on a page that came back), and this screen turns it into
 * text and takes the keyboard.
 *
 * The content is rendered as text nodes, never as markup — a page is someone else's
 * writing, and the only thing this screen does with it is read it out loud.
 *
 * Nothing wraps here: the lines carry CSS that breaks them at the viewport, the same
 * class the terminal's own output uses, so a narrow window re-wraps a page without
 * re-rendering it.
 */

import { For, onMount } from 'solid-js';
import { renderPage } from '../renderPage';

export type LynxProps = {
  readonly url: string;
  readonly content: string;
  readonly onExit: () => void;
};

/** The keys that put the terminal back. Real lynx quits on either case, and a
 *  held shift should not strand a reader on a page. */
const quits = (event: KeyboardEvent): boolean =>
  event.key === 'q' || event.key === 'Q' || event.key === 'Escape';

export const Lynx = (props: LynxProps) => {
  let screen: HTMLElement | undefined;

  // The overlay fills the screen the moment it opens, so it takes the keyboard
  // straight away — a reader should be able to quit without clicking first.
  onMount(() => screen?.focus());

  const lines = () => renderPage(props.content);

  const onKeyDown = (event: KeyboardEvent) => {
    if (!quits(event)) return;
    event.preventDefault();
    props.onExit();
  };

  return (
    <main
      ref={screen}
      // Focusable so the page itself receives keys; not in the tab order, because
      // it is the only thing on screen while it is open.
      tabIndex={-1}
      class="flex h-full flex-col font-mono text-sm leading-relaxed outline-none"
      onKeyDown={onKeyDown}
    >
      <div class="bg-[var(--theme-text-bright)] px-2 py-1 text-center text-[var(--theme-bg)]">
        {props.url}
      </div>
      <div class="flex-1 overflow-y-auto p-2">
        <For each={lines()}>
          {/* `min-h-[1lh]` keeps the blank line between blocks: an empty div has no
              height of its own, and the spacing IS the rendering. */}
          {(line) => <div class="min-h-[1lh] whitespace-pre-wrap break-words">{line}</div>}
        </For>
      </div>
      <div class="px-2 py-1 text-[var(--theme-text-dim)]">q Quit</div>
    </main>
  );
};
