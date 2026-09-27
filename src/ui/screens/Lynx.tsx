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
 * Going back is a follow to an address the reader has already been to: it asks for
 * the page again rather than replaying a copy of it. That keeps one rule for the
 * target's log — a line per page viewed — instead of a second rule saying which
 * views do not count, and it means a page rewritten while the reader was away shows
 * them what it says now. Which is why the selection is restored through the same
 * clamp a keypress uses: the link they left by may no longer be there.
 *
 * Sending a form is a follow too. A GET form's answer is just the page at its action
 * with the fields in the query, so submitting builds that address and follows it —
 * the same fetch, the same log line, the same way back. What was typed lives here,
 * beside the selection, and is forgotten on arrival anywhere, exactly as the
 * selection is.
 *
 * The trail of visited pages lives here, beside the selection it restores, and it
 * starts empty every time the browser opens — a reader who quit and came back has
 * begun reading, not resumed it.
 *
 * The content is rendered as text nodes, never as markup — a page is someone else's
 * writing, and the only thing this screen does with it is read it out loud. What a
 * reader types into a field is rendered the same way.
 *
 * Nothing wraps here: the lines carry CSS that breaks them at the viewport, the same
 * class the terminal's own output uses, so a narrow window re-wraps a page without
 * re-rendering it.
 */

import { For, Show, createEffect, createMemo, createSignal, on, onMount } from 'solid-js';
import { fieldBox, renderPage, type FormTarget, type Segment } from '../renderPage';
import { formSubmissionUrl } from '../../core/network/http';

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

/** A key that types a character: one character long, with no modifier held. A key
 *  held with Ctrl, Cmd or Alt is a shortcut meant for something else. */
const typesCharacter = (event: KeyboardEvent): boolean =>
  event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

/** The first thing on a page a reader can select — where they start, so Enter always
 *  has a target without them having to aim first. */
const FIRST_SELECTABLE = 1;

/** A page the reader has left, and what they had selected when they left it. */
type Visited = { readonly url: string; readonly selected: number };

/** Something on a page a reader can select: a link, a field, or a form's button. */
type Selectable = Exclude<Segment, { readonly kind: 'text' }>;

type Field = Extract<Selectable, { readonly kind: 'field' }>;

/** The form pressing Enter on `selectable` sends, or null when it sends nothing. Only a
 *  GET form is ever sent, because only a GET form's answer is a page at an address. */
const sendingForm = (selectable: Selectable): FormTarget | null =>
  selectable.kind !== 'link' && selectable.form?.method === 'get' ? selectable.form : null;

export const Lynx = (props: LynxProps) => {
  let screen: HTMLElement | undefined;
  const [selected, setSelected] = createSignal(FIRST_SELECTABLE);
  const [alert, setAlert] = createSignal<string | null>(null);
  const [visited, setVisited] = createSignal<readonly Visited[]>([]);
  /** What the reader has typed, by the position of the field they typed it into. A
   *  field they never touched holds what the page filled it with. */
  const [typed, setTyped] = createSignal<Readonly<Record<number, string>>>({});
  /** Whether the reader has stepped out of the field they are on with Escape, so keys
   *  drive the browser again. Moving onto any field puts them back in. */
  const [steppedOut, setSteppedOut] = createSignal(false);

  // The overlay fills the screen the moment it opens, so it takes the keyboard
  // straight away — a reader should be able to quit without clicking first.
  onMount(() => screen?.focus());

  const lines = createMemo(() => renderPage({ html: props.content, url: props.url }));
  const selectables = createMemo(() =>
    lines().flatMap((line) =>
      line.filter((segment): segment is Selectable => segment.kind !== 'text'),
    ),
  );
  const current = () => selectables()[selected() - 1];
  /** The field the reader is typing into, or null while keys drive the browser. */
  const fieldBeingEdited = (): Field | null => {
    const selectable = current();
    return selectable?.kind === 'field' && !steppedOut() ? selectable : null;
  };

  /** What a field holds now: what was typed into it, or what the page filled in. */
  const valueOf = (field: Field): string =>
    typed()[selectables().indexOf(field) + 1] ?? field.value;

  // A page the reader has arrived at is read from its top, with nothing typed into
  // it: carrying the previous page's selection or words over would land them
  // somewhere they never chose.
  createEffect(
    on(
      [() => props.url, () => props.content],
      () => {
        setSelected(FIRST_SELECTABLE);
        setAlert(null);
        setTyped({});
        setSteppedOut(false);
      },
      { defer: true },
    ),
  );

  /** Come to rest on something selectable, at either end of the page rather than past
   *  it. Two callers, one question: a reader holding a key down should stop at the
   *  bottom instead of being thrown back to the top, and a selection restored onto a
   *  page that has changed since should land on something that is actually there. */
  const restOn = (wanted: number) => {
    const count = selectables().length;
    if (count === 0) return;
    setSelected(Math.min(count, Math.max(FIRST_SELECTABLE, wanted)));
    setSteppedOut(false);
  };

  const move = (step: number) => restOn(selected() + step);

  /** Ask the parent for `url`, and step there only if it answered. */
  const go = async (url: string) => {
    // Whatever the last attempt said is about this one now.
    setAlert(null);
    // Where the reader is standing, read BEFORE the fetch: by the time it answers,
    // the page under them is the new one and this is no longer recoverable.
    const leaving = { url: props.url, selected: selected() };
    const outcome = await props.onFollow(url);
    if (!outcome.ok) {
      setAlert(outcome.alert);
      return;
    }
    setVisited((trail) => [...trail, leaving]);
  };

  /** Send the form `control` belongs to: every field of that form, and no other's. A
   *  field with no name has nothing to be sent as, so a browser leaves it out. */
  const submit = async (control: Selectable) => {
    const form = sendingForm(control);
    if (form === null) return;
    const fields = selectables().flatMap((segment) =>
      segment.kind === 'field' && segment.form?.id === form.id && segment.name !== ''
        ? [{ name: segment.name, value: valueOf(segment) }]
        : [],
    );
    await go(formSubmissionUrl({ action: form.action, fields }));
  };

  const activate = async () => {
    const target = current();
    if (target === undefined) return;
    await (target.kind === 'link' ? go(target.url) : submit(target));
  };

  const back = async () => {
    const previous = visited().at(-1);
    if (previous === undefined) return;
    setAlert(null);
    const outcome = await props.onFollow(previous.url);
    // A reader who could not go back has not gone back, so the step stays ahead of
    // them — dropping it here would strand them one page further along than they are.
    if (!outcome.ok) {
      setAlert(outcome.alert);
      return;
    }
    setVisited((trail) => trail.slice(0, -1));
    // After the fetch, never before it: arriving anywhere sends the selection back to
    // the top, and that has already happened by the time this line runs.
    restOn(previous.selected);
  };

  /** Change what `field`, the one being edited, holds. */
  const edit = (field: Field, change: (value: string) => string) => {
    setTyped((all) => ({ ...all, [selected()]: change(valueOf(field)) }));
  };

  /**
   * A key as the field being edited takes it, or false when the field leaves it to the
   * browser. Only the arrows up and down and Enter pass through: a field has no cursor
   * to move, so left and right do nothing rather than going back, and Backspace deletes.
   */
  const editKey = (event: KeyboardEvent, field: Field): boolean => {
    if (event.key === 'Escape') {
      setSteppedOut(true);
      return true;
    }
    if (event.key === 'Backspace') {
      edit(field, (value) => value.slice(0, -1));
      return true;
    }
    if (typesCharacter(event)) {
      edit(field, (value) => `${value}${event.key}`);
      return true;
    }
    return event.key === 'ArrowLeft' || event.key === 'ArrowRight';
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const field = fieldBeingEdited();
    if (field !== null && editKey(event, field)) {
      event.preventDefault();
      return;
    }
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
      void activate();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
      event.preventDefault();
      void back();
    }
  };

  /** What Enter does on what is selected, when it does anything. */
  const enterDoes = (): readonly string[] => {
    const target = current();
    if (target === undefined) return [];
    if (target.kind === 'link') return ['⏎ Follow'];
    return sendingForm(target) === null ? [] : ['⏎ Submit'];
  };

  /** Only the keys that lead somewhere from here — a hint for a door that is not
   *  there teaches a reader the wrong thing about the one that is. Inside a field, the
   *  keys that would quit or go back are typing, so the hint does not offer them. */
  const hint = () =>
    (fieldBeingEdited() !== null
      ? ['↑↓ Select', ...enterDoes(), 'Esc Leave field']
      : [
          ...(selectables().length === 0 ? [] : ['↑↓ Select']),
          ...enterDoes(),
          ...(visited().length === 0 ? [] : ['← Back']),
          'q Quit',
        ]
    ).join('  ');

  /** How a field reads: with a cursor at the end while it is being typed into. */
  const fieldText = (field: Field): string =>
    field === fieldBeingEdited()
      ? `[${valueOf(field)}_]`
      : fieldBox({ value: valueOf(field), placeholder: field.placeholder });

  const selectedClass = 'bg-[var(--theme-text-bright)] text-[var(--theme-bg)]';

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
                  const isSelected = () => segment === current();
                  if (segment.kind === 'link') {
                    return (
                      <span
                        role="link"
                        aria-current={isSelected() ? 'true' : undefined}
                        class={
                          isSelected() ? selectedClass : 'text-[var(--theme-text-bright)] underline'
                        }
                      >
                        {segment.text}
                      </span>
                    );
                  }
                  return (
                    <span
                      role={segment.kind === 'field' ? 'textbox' : 'button'}
                      aria-current={isSelected() ? 'true' : undefined}
                      class={isSelected() ? selectedClass : 'text-[var(--theme-text-bright)]'}
                    >
                      {segment.kind === 'field' ? fieldText(segment) : segment.text}
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
          <div class="px-2 py-1 text-[var(--theme-text-dim)]">{hint()}</div>
        }
      >
        {(message) => <div class="px-2 py-1 text-[var(--theme-error)]">{message()}</div>}
      </Show>
    </main>
  );
};
