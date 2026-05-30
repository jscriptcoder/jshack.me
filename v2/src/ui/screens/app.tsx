/**
 * Boot gate — picks the intro screen vs the terminal based on whether a game
 * config has been persisted, and wires submit → persist → startGame → terminal.
 *
 * D2: a plain `<Show>` (no Router). `storage` is injected so the boot flow is
 * testable without touching the real `localStorage`; production passes the
 * global in `main.tsx`. The config-derived terminal state is initialised via
 * `startGame` BEFORE `<Terminal>` mounts — never as an import side effect (see
 * the import-safety guard in state.test.ts).
 */

import { createSignal, Show } from 'solid-js';
import {
  type GameConfig,
  type GameConfigStorage,
  getStoredGameConfig,
  storeGameConfig,
} from '../../core/gameConfig/gameConfig';
import { startGame } from '../state';
import { Intro } from './intro';
import { Terminal } from './terminal';

export type AppProps = {
  readonly storage: GameConfigStorage;
};

export const App = (props: AppProps) => {
  // `storage` is genuinely static for the app's lifetime — injected once at
  // mount, never reassigned. The boot read is intentionally one-time, so the
  // solid/reactivity warning (which assumes props change) is a false positive.
  // eslint-disable-next-line solid/reactivity -- static injected dependency, read once at boot
  const storage = props.storage;
  const existing = getStoredGameConfig(storage);
  if (existing !== null) startGame(existing);
  const [started, setStarted] = createSignal(existing !== null);

  const handleSubmit = (config: GameConfig) => {
    storeGameConfig(storage, config);
    startGame(config);
    setStarted(true);
  };

  return (
    <Show when={started()} fallback={<Intro onSubmit={handleSubmit} />}>
      <Terminal />
    </Show>
  );
};
