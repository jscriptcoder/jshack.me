/**
 * Boot gate — sequences the three first-class screens and wires the new-game
 * flow: intro → boot animation → terminal. A returning player (config already
 * persisted) skips the intro but STILL runs the boot screen on every entry —
 * the boot is now the brick detector (it checks the own-box FS via `canBoot`),
 * so a box whose `/boot` was deleted halts at a kernel panic instead of reaching
 * the terminal. A fresh start runs the same boot against a pristine (bootable)
 * seed FS.
 *
 * D2: plain `<Show>`s (no Router). `storage` is injected so the flow is testable
 * without touching the real `localStorage`; production passes the global in
 * `main.tsx`. The config-derived terminal state is initialised via `startGame`
 * BEFORE `<Terminal>` mounts — never as an import side effect (see the
 * import-safety guard in state.test.ts).
 */

import { createSignal, Match, Switch } from 'solid-js';
import {
  type GameConfig,
  type GameConfigStorage,
  getStoredGameConfig,
  storeGameConfig,
} from '../../core/gameConfig/gameConfig';
import { resolveBootCheck, startGame } from '../state';
import { Intro } from './Intro';
import { BootScreen } from './BootScreen';
import { Terminal } from './Terminal';

export type AppProps = {
  readonly storage: GameConfigStorage;
  /** True when `xterm` opened this terminal: it comes up on the player's own box
   *  rather than rebuilding the hop chain the other tab is holding. Absent on an
   *  ordinary boot, which is a reload and is meant to put them back where they
   *  were. */
  readonly fresh?: boolean;
};

type Phase = 'intro' | 'booting' | 'terminal';

export const App = (props: AppProps) => {
  // `storage` and `fresh` are genuinely static for the app's lifetime — injected
  // once at mount, never reassigned. Both boot reads are intentionally one-time,
  // so the solid/reactivity warning (which assumes props change) is a false
  // positive. `fresh` is settled before this component exists: `main.tsx` reads
  // it off the URL and spends it there.
  // eslint-disable-next-line solid/reactivity -- static injected dependency, read once at boot
  const storage = props.storage;
  // eslint-disable-next-line solid/reactivity -- static injected dependency, read once at boot
  const fresh = props.fresh === true;
  const existing = getStoredGameConfig(storage);
  // A returning player skips the intro but STILL boots — the boot screen checks
  // whether the box can come up (brick detection), so it can't be skipped.
  if (existing !== null) startGame(existing, { fresh });
  const [phase, setPhase] = createSignal<Phase>(existing !== null ? 'booting' : 'intro');
  const [config, setConfig] = createSignal<GameConfig | null>(existing);

  const handleSubmit = (submitted: GameConfig) => {
    storeGameConfig(storage, submitted);
    startGame(submitted);
    setConfig(submitted);
    setPhase('booting');
  };

  return (
    <Switch>
      <Match when={phase() === 'intro'}>
        <Intro onSubmit={handleSubmit} />
      </Match>
      <Match when={phase() === 'booting' && config()}>
        {(active) => (
          <BootScreen
            machineName={active().machineName}
            username={active().username}
            resolveBoot={resolveBootCheck}
            onComplete={() => setPhase('terminal')}
          />
        )}
      </Match>
      <Match when={phase() === 'terminal'}>
        <Terminal />
      </Match>
    </Switch>
  );
};
