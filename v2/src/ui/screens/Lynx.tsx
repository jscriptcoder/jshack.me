/**
 * Lynx — the full-screen text browser shown while a `lynx` overlay is open.
 *
 * A reader, not an editor: the first page arrives already fetched (the command does
 * that, so a refused connection reads in the TERMINAL exactly as `curl`'s does, and
 * the browser only ever opens on a page that came back), and this screen turns it
 * into text and takes the keyboard.
 *
 * Following a link is the other way round. By then the browser is already open, so
 * it asks its parent to fetch (`onFollow`) and the parent hands back the next page
 * as new props — which is why the page shown is the parent's state and not this
 * screen's. A follow that never reached the host does NOT move the reader: the page
 * stays, and the footer says why, matching what the target's log will show. Nothing
 * answered, so nothing was logged and nowhere was visited.
 *
 * The content is rendered as text nodes, never as markup — a page is someone else's
 * writing, and the only thing this screen does with it is read it out loud.
 *
 * Nothing wraps here: the lines carry CSS that breaks them at the viewport, the same
 * class the terminal's own output uses, so a narrow window re-wraps a page without
 * re-rendering it.
 */

import { For, Show, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import { renderPage } from '../renderPage';

/** What became of a follow: the reader moved (and new props are on their way), or
 *  they did not, and this is what to tell them. */
export type FollowOutcome = { readonly ok: true } | { readonly ok: false; readonly alert: string };

export type LynxProps = {
  readonly url: string;
  readonly content: string;
  readonly onExit: () => void;
  readonly onFollow: (url: string) => Promise<FollowOutcome>;
};

/** The keys that put the terminal back. Real lynx quits on either case, and a
 *  held shift should not strand a reader on a page. */
const quits = (event: KeyboardEvent): boolean =>
  event.key === 'q' || event.key === 'Q' || event.key === 'Escape';

/** The first link on a page — where a reader starts, so Enter always has a target
 *  without them having to aim first. */
const FIRST_LINK = 1;

export const Lynx = (props: LynxProps) => {
  let screen: HTMLElement | undefined;
  const [selected, setSelected] = createSignal(FIRST_LINK);
  const [alert, setAlert] = createSignal<string | null>(null);

  // The overlay fills the screen the moment it opens, so it takes the keyboard
  // straight away — a reader should be able to quit without clicking first.
  onMount(() => screen?.focus());

  const lines = createMemo(() => renderPage({ html: props.content, url: props.url }));
  const links = createMemo(() =>
    lines().flatMap((line) => line.filter((segment) => segment.kind === 'link')),
  );

  // A page the reader has arrived at is read from its top: carrying the previous
  // page's selection over would land them somewhere they never chose.
  createEffect(
    on(
      [() => props.url, () => props.content],
      () => {
        setSelected(FIRST_LINK);
        setAlert(null);
      },
      { defer: true },
    ),
  );

  /** Move the selection, coming to rest at either end rather than wrapping around
   *  — a reader holding a key down should stop at the bottom of the page, not be
   *  thrown back to the top of it. */
  const move = (step: number) => {
    const count = links().length;
    if (count === 0) return;
    setSelected((current) => Math.min(count, Math.max(FIRST_LINK, current + step)));
  };

  const follow = async () => {
    const target = links().find((link) => link.index === selected());
    if (target === undefined) return;
    // Whatever the last attempt said is about this one now.
    setAlert(null);
    const outcome = await props.onFollow(target.url);
    if (!outcome.ok) setAlert(outcome.alert);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (quits(event)) {
      event.preventDefault();
      props.onExit();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === 'ArrowRight') {
      event.preventDefault();
      void follow();
    }
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
          {(line) => (
            <div class="min-h-[1lh] whitespace-pre-wrap break-words">
              <For each={line}>
                {(segment) => {
                  if (segment.kind === 'text') return segment.text;
                  // Asked ONCE and spent twice: what a reader sees highlighted and
                  // what the page reports as current cannot end up disagreeing.
                  const isSelected = () => segment.index === selected();
                  return (
                    <span
                      role="link"
                      aria-current={isSelected() ? 'true' : undefined}
                      class={
                        isSelected()
                          ? 'bg-[var(--theme-text-bright)] text-[var(--theme-bg)]'
                          : 'text-[var(--theme-text-bright)] underline'
                      }
                    >
                      {segment.text}
                    </span>
                  );
                }}
              </For>
            </div>
          )}
        </For>
      </div>
      <Show
        when={alert()}
        fallback={
          <div class="px-2 py-1 text-[var(--theme-text-dim)]">
            {links().length === 0 ? 'q Quit' : '↑↓ Select  ⏎ Follow  q Quit'}
          </div>
        }
      >
        {(message) => <div class="px-2 py-1 text-[var(--theme-error)]">{message()}</div>}
      </Show>
    </main>
  );
};
