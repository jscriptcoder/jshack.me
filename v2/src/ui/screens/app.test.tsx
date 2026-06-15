import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { App } from './app';
import { GAMECONFIG_STORAGE_KEY, serializeGameConfig } from '../../core/gameConfig/gameConfig';

/**
 * The boot gate sequences three states: intro (no config) -> boot animation ->
 * terminal. A returning player (config already stored) skips the intro but STILL
 * runs the boot screen — it is the brick detector now. Storage is injected so
 * each test drives a clean boot; fake timers drive the (async) animation, so the
 * clock is advanced with the async variant.
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

  it('plays the boot animation after the intro, before showing the terminal', async () => {
    render(() => <App storage={fakeStorage()} />);

    completeIntro('neo', 'skylab');
    // Advance far enough for the login line to reveal, but short of the
    // post-sequence handoff — so the boot is still on screen, not the terminal.
    await vi.advanceTimersByTimeAsync(3300);

    expect(screen.getByText(/skylab login: neo/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();
  });

  it('reaches the terminal with the typed prompt once the boot completes', async () => {
    render(() => <App storage={fakeStorage()} />);

    completeIntro('neo', 'skylab');
    await vi.advanceTimersByTimeAsync(10_000);

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

  it('skips the intro but still boots, reaching the terminal for a returning player', async () => {
    const storage = fakeStorage({
      [GAMECONFIG_STORAGE_KEY]: serializeGameConfig({
        machineName: 'oldbox',
        username: 'trinity',
        rootPassword: 'hunter2',
      }),
    });
    render(() => <App storage={storage} />);

    // The intro is skipped (no menu), but the boot screen runs first — it is the
    // brick check now, so a returning player can't bypass it.
    expect(screen.queryByRole('button', { name: /new game/i })).not.toBeInTheDocument();

    // Part-way through, the boot is on screen (its login line), not the terminal.
    await vi.advanceTimersByTimeAsync(3300);
    expect(screen.getByText(/oldbox login: trinity/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /terminal input/i })).not.toBeInTheDocument();

    // A healthy box (no boot-file tombstone) boots through to the terminal.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getByText('trinity@oldbox:/home/trinity$')).toBeInTheDocument();
  });
});
