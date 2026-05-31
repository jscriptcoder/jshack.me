import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { App } from './app';
import { GAMECONFIG_STORAGE_KEY, serializeGameConfig } from '../../core/gameConfig/gameConfig';

/**
 * The boot gate sequences three states: intro (no config) -> boot animation
 * (just-submitted, new player) -> terminal. A returning player (config already
 * stored) skips both intro and boot and lands on the terminal. Storage is
 * injected so each test drives a clean boot; fake timers drive the animation.
 */

const fakeStorage = (initial?: Record<string, string>): Storage => {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
};

const fillField = (name: RegExp, value: string) => {
  fireEvent.input(screen.getByLabelText(name), { target: { value } });
};

/** Walk through the menu + form to a valid submission. */
const completeIntro = (username = 'neo', machineName = 'skylab') => {
  fireEvent.click(screen.getByRole('button', { name: /new game/i }));
  fillField(/workstation/i, machineName);
  fillField(/username/i, username);
  fillField(/^root password/i, 'hunter2');
  fillField(/confirm password/i, 'hunter2');
  fireEvent.click(screen.getByRole('button', { name: /start/i }));
};

describe('App boot gate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the intro menu on first launch (no persisted config)', () => {
    render(() => <App storage={fakeStorage()} />);

    expect(screen.getByRole('button', { name: /new game/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();
  });

  it('plays the boot animation after the intro, before showing the terminal', () => {
    render(() => <App storage={fakeStorage()} />);

    completeIntro('neo', 'skylab');
    // Advance far enough for the login line to reveal, but short of the
    // post-sequence handoff — so the boot is still on screen, not the terminal.
    vi.advanceTimersByTime(3300);

    expect(screen.getByText(/skylab login: neo/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();
  });

  it('reaches the terminal with the typed prompt once the boot completes', () => {
    render(() => <App storage={fakeStorage()} />);

    completeIntro('neo', 'skylab');
    vi.advanceTimersByTime(10_000);

    expect(screen.getByRole('textbox', { name: /terminal input/i })).toBeInTheDocument();
    // The prompt reflects the typed config, not the old alice@workstation default.
    expect(screen.getByText('neo@skylab:/home/neo$')).toBeInTheDocument();
  });

  it('persists the submitted config so it survives into storage', () => {
    const storage = fakeStorage();
    render(() => <App storage={storage} />);

    completeIntro();

    expect(storage.getItem(GAMECONFIG_STORAGE_KEY)).not.toBeNull();
  });

  it('skips both intro and boot, landing on the terminal for a returning player', () => {
    const storage = fakeStorage({
      [GAMECONFIG_STORAGE_KEY]: serializeGameConfig({
        machineName: 'oldbox',
        username: 'trinity',
        rootPassword: 'hunter2',
      }),
    });
    render(() => <App storage={storage} />);

    expect(screen.queryByRole('button', { name: /new game/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/login:/)).not.toBeInTheDocument();
    expect(screen.getByText('trinity@oldbox:/home/trinity$')).toBeInTheDocument();
  });
});
