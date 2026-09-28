/**
 * The HUD — the cut-corner frame a neon theme draws around the terminal, with a
 * status bar above and below it. Everything the bars show is live game state:
 * whether the workstation has a link, the local time, who the player is and on
 * which machine, the wlan0 address and network, and the game's version. Nothing
 * on them is decoration pretending to mean something.
 *
 * It wraps the terminal AND its full-screen apps, so nano and lynx open inside
 * the frame rather than tearing it down. The wrapper is always rendered and only
 * its dressing comes and goes with the theme: rendering the terminal in one branch
 * with a frame and another without would remount it on every `theme` switch.
 */

import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { THEMES } from '../../core/theme/themes.js';
import {
  connectedWireless,
  currentTheme,
  linkOnline,
  promptHost,
  promptUsername,
} from '../state.js';

const CLOCK_TICK_MS = 1000;

/** Local wall time on a 24-hour clock, `HH:MM:SS`. The locale is named rather than
 *  left to the browser's, which in the US would say `9:05:58 AM`. The world clock
 *  the game's events run on is real time too, so local time agrees with it. */
const wallTime = (): string => new Date().toLocaleTimeString('en-GB');

const Clock = () => {
  const [time, setTime] = createSignal(wallTime());
  const timer = setInterval(() => setTime(wallTime()), CLOCK_TICK_MS);
  onCleanup(() => clearInterval(timer));
  return <b class="hud-value">{time()}</b>;
};

/** The values keep their own case inside the capitalised bars: an ESSID or a host
 *  name is something the player may type back, and `FERRO-CAFE` is not the network
 *  `nmcli` knows as `ferro-cafe`. */
const TopBar = () => (
  <header class="hud-top">
    <span class="hud-brand">
      JSHACK<i>.ME</i>
    </span>
    <span class="max-sm:hidden">NET TERMINAL</span>
    <span class="flex-1" />
    <span>
      LINK
      <span
        aria-hidden="true"
        class="hud-pip"
        classList={{
          'text-[var(--theme-frame-b)]': linkOnline(),
          'text-[var(--theme-error)]': !linkOnline(),
        }}
      />
      <b class="hud-value">{linkOnline() ? 'ONLINE' : 'OFFLINE'}</b>
    </span>
    <span>
      <Clock />
    </span>
  </header>
);

const BottomBar = () => (
  <footer class="hud-bottom">
    <span>
      <b class="hud-value normal-case">
        {promptUsername()}@{promptHost()}
      </b>
    </span>
    <span class="max-sm:hidden">
      WLAN0 <b class="hud-value">{connectedWireless()?.ipv4 ?? 'DOWN'}</b>
    </span>
    <span class="max-sm:hidden">
      ESSID <b class="hud-value normal-case">{connectedWireless()?.association.essid ?? '—'}</b>
    </span>
    <span class="flex-1" />
    <span aria-hidden="true" class="hud-barcode max-sm:hidden" />
    <span class="max-sm:hidden">
      v<b class="hud-value">{__APP_VERSION__}</b>
    </span>
  </footer>
);

type HudProps = {
  readonly children: JSX.Element;
};

export const Hud = (props: HudProps) => {
  // The theme's own neon colours are what switch the look on, so the frame asks
  // the same question `applyTheme` does rather than reading the mark it leaves on
  // the document.
  const framed = () => THEMES[currentTheme()].neonColors !== undefined;

  return (
    <div class="h-full" classList={{ 'p-2': framed() }}>
      <div class="h-full" classList={{ 'hud-frame': framed() }}>
        <div class="flex h-full flex-col" classList={{ 'hud-screen': framed() }}>
          <Show when={framed()}>
            <TopBar />
          </Show>
          <div class="min-h-0 flex-1">{props.children}</div>
          <Show when={framed()}>
            <BottomBar />
          </Show>
        </div>
      </div>
    </div>
  );
};
