/**
 * Author — the card behind the `author` command.
 *
 * The one screen in the game with no simulation behind it: a real person, their
 * real avatar and two links that genuinely leave the page. Everything else the
 * terminal shows is generated; this is not.
 *
 * The copy lives here rather than in `core/`, because nothing outside this file
 * reads it. `core/theme/themes.ts` is the tempting parallel and a misleading one
 * — the `theme` command LISTS its palettes, so those values have a reader on the
 * framework-agnostic side. This has none.
 */

import { For, onMount } from 'solid-js';

export type AuthorProps = {
  readonly onExit: () => void;
};

type ProfileLink = { readonly label: string; readonly url: string };

const NAME = 'Francisco Ramos (jscriptcoder)';

const AVATAR_URL = 'https://avatars.githubusercontent.com/u/613724';

const BIO: readonly string[] = [
  'Hey there! 👋',
  "I'm Francisco Ramos, a fullstack engineer with 20+ years in the game. " +
    "Started out building websites back in the early 2000s and never really stopped. I've worked across the entire stack, " +
    'from frontend and backend to DevOps, picking up whatever tools got the job done.',
  'Along the way I got really into Machine Learning and Deep Reinforcement Learning, ' +
    'teaching machines to teach themselves, basically. Built some fun stuff there, from AI training environments to ' +
    'neural network experiments. My Github is full of ML projects if you want to check them out.',
  'Then I went down the Web3 rabbit hole, building DEX aggregators, smart contract tools, ' +
    'and dApps with Solidity. Blockchain was a wild ride.',
  'These days my biggest passion is cybersecurity, especially web security. At my current job I helped uncover ' +
    'several security vulnerabilities, which really got me hooked. I earned a Nanodegree as Security Engineer from Udacity, ' +
    "I'm grinding through TryHackMe rooms and Portswigger labs whenever I get the chance, and currently working towards my Burp Suite certification.",
  'This little hacking terminal is where all those worlds collide, code, hacking, and the love of breaking things, ' +
    'responsibly of course. Hack away! 😉',
];

const LINKS: readonly ProfileLink[] = [
  { label: 'LinkedIn', url: 'https://www.linkedin.com/in/jscriptcoder' },
  { label: 'GitHub', url: 'https://github.com/jscriptcoder' },
];

/** The keys that put the terminal back — the same pair the browser answers to,
 *  including the shifted `Q`, because a held shift should not strand anybody on a
 *  screen whose only job is to be read and left. */
const quits = (event: KeyboardEvent): boolean =>
  event.key === 'q' || event.key === 'Q' || event.key === 'Escape';

export const Author = (props: AuthorProps) => {
  let card: HTMLElement | undefined;

  // The card fills the screen the moment it opens, so it takes the keyboard
  // straight away — a keystroke goes where the focus is, and a player should be
  // able to leave without aiming at the card first.
  onMount(() => card?.focus());

  const onKeyDown = (event: KeyboardEvent) => {
    if (!quits(event)) return;
    event.preventDefault();
    props.onExit();
  };

  return (
    <main
      ref={card}
      // Focusable so the card itself receives keys; not in the tab order, because
      // it is the only thing on screen while it is open.
      tabIndex={-1}
      class="flex h-full flex-col overflow-y-auto font-mono text-sm leading-relaxed outline-none"
      onKeyDown={onKeyDown}
    >
      <div class="flex max-w-3xl items-start gap-6 p-4">
        {/* Sized in CSS rather than left to the image: it is the only remote asset
            the game loads, and a slow or failed fetch must not reflow the text
            beside it. A broken image is allowed to be a broken image — there is no
            fallback machinery for a picture. */}
        <img
          src={AVATAR_URL}
          alt={NAME}
          class="h-[152px] w-[152px] shrink-0 rounded-full border-2 border-solid border-[var(--theme-avatar-border)]"
        />
        <div class="flex flex-col gap-2">
          <h2 class="text-xl font-bold text-[var(--theme-text-bright)]">{NAME}</h2>
          <div class="flex flex-col gap-3">
            <For each={BIO}>{(paragraph) => <p>{paragraph}</p>}</For>
          </div>
          <div class="mt-2 flex gap-4">
            <For each={LINKS}>
              {(link) => (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  // Hover borrows `text-bright` rather than carrying a token of
                  // its own: legacy had a `linkHover` shade, and a ninth value
                  // whose only job is to be slightly lighter than the eighth is
                  // four more numbers to keep right for no visible gain.
                  class="text-[var(--theme-link)] underline hover:text-[var(--theme-text-bright)]"
                >
                  {link.label}
                </a>
              )}
            </For>
          </div>
        </div>
      </div>
    </main>
  );
};
