/**
 * Boot gate — sequences the three first-class screens and wires the new-game
 * flow: intro → boot animation → terminal. A returning player (config already
 * persisted) skips both intro and boot and lands straight on the terminal,
 * matching legacy (the boot animation plays only for a fresh start).
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
import { startGame } from '../state';
import { Intro } from './intro';
import { BootScreen } from './boot';
import { Terminal } from './terminal';

export type AppProps = {
  readonly storage: GameConfigStorage;
};

type Phase = 'intro' | 'booting' | 'terminal';

export const App = (props: AppProps) => {
  // `storage` is genuinely static for the app's lifetime — injected once at
  // mount, never reassigned. The boot read is intentionally one-time, so the
  // solid/reactivity warning (which assumes props change) is a false positive.
  // eslint-disable-next-line solid/reactivity -- static injected dependency, read once at boot
  const storage = props.storage;
  const existing = getStoredGameConfig(storage);
  // A returning player skips intro + boot; only a fresh start plays the boot.
  if (existing !== null) startGame(existing);
  const [phase, setPhase] = createSignal<Phase>(existing !== null ? 'terminal' : 'intro');
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
