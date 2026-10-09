/**
 * Intro screen — first-launch onboarding, replicating the legacy two-step flow:
 *
 *   1. MENU  — logo, tagline, briefing copy, and a NEW GAME action.
 *   2. FORM  — workstation / username / root password + confirm, then START.
 *
 * A dumb component: it captures + validates the fields and calls
 * `onSubmit(config)` only when the form is valid AND the passwords match. The
 * boot gate owns persistence + starting the game. Validation rules live in
 * `core/gameConfig` (shared, unit-tested).
 *
 * D2: minimal Solid — local `createSignal`s for the step, field values, and the
 * first error; no Context, no Router, no form library.
 */

import { createSignal, type JSX, Show } from 'solid-js';
import {
  type GameConfig,
  validateMachineName,
  validatePassword,
  validateUsername,
} from '../../core/gameConfig/gameConfig.js';

export type IntroProps = {
  readonly onSubmit: (config: GameConfig) => void;
};

type Step = 'menu' | 'form';

/** Bordered menu button with the legacy hover invert (fill on hover). `dim`
 *  renders the secondary (BACK) variant. */
const MenuButton = (props: {
  readonly onClick: () => void;
  readonly children: JSX.Element;
  readonly dim?: boolean;
}) => (
  <button
    type="button"
    onClick={() => props.onClick()}
    class="w-48 cursor-pointer border px-6 py-2 font-mono text-sm transition-colors"
    classList={{
      'border-[var(--theme-text-dim)] text-[var(--theme-text-dim)]': props.dim,
      'border-[var(--theme-text-dim)] text-[var(--theme-text)]': !props.dim,
      'hover:bg-[var(--theme-text-dim)] hover:text-[var(--theme-bg)]': true,
    }}
  >
    {props.children}
  </button>
);

const FIELD_CLASS =
  'w-48 border-b border-[var(--theme-text-dim)] bg-transparent px-1 py-0.5 font-mono text-sm ' +
  'text-[var(--theme-text-bright)] caret-[var(--theme-caret)] outline-none ' +
  'placeholder:text-[var(--theme-text-dim)] placeholder:opacity-50';

const LABEL_CLASS = 'text-right text-sm text-[var(--theme-text-dim)]';

export const Intro = (props: IntroProps) => {
  const [step, setStep] = createSignal<Step>('menu');
  const [machineName, setMachineName] = createSignal('');
  const [username, setUsername] = createSignal('');
  const [rootPassword, setRootPassword] = createSignal('');
  const [confirmPassword, setConfirmPassword] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);

  const clearError = () => setError(null);

  const goToForm = () => {
    setMachineName('');
    setUsername('');
    setRootPassword('');
    setConfirmPassword('');
    setError(null);
    setStep('form');
  };

  const handleSubmit = (event?: Event) => {
    event?.preventDefault();
    const fieldError =
      validateMachineName(machineName()) ??
      validateUsername(username()) ??
      validatePassword(rootPassword());
    if (fieldError !== null) {
      setError(fieldError);
      return;
    }
    if (rootPassword() !== confirmPassword()) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    props.onSubmit({
      machineName: machineName(),
      username: username(),
      rootPassword: rootPassword(),
    });
  };

  return (
    <div class="flex h-full flex-col items-center justify-center p-4 font-mono">
      <div class="mb-3 text-center">
        <h1 class="text-5xl font-bold tracking-widest text-[var(--theme-text-bright)] sm:text-6xl">
          JSHACK.ME
        </h1>
        <div class="mt-2 h-px w-full bg-[var(--theme-text-dim)]" />
      </div>

      <p class="mb-8 text-base tracking-wide text-[var(--theme-text-dim)]">
        <Show when={step() === 'menu'} fallback="Configure your workstation.">
          Crack the network. Explore the machines. Go deeper.
        </Show>
      </p>

      <Show
        when={step() === 'form'}
        fallback={
          <div class="flex max-w-lg flex-col items-center">
            <div class="mb-8 text-center text-base leading-relaxed text-[var(--theme-text-dim)]">
              <p class="mb-4">
                You start at a personal workstation whose WiFi card can reach several networks. Each
                one hides its own machines, and some hide more networks behind them. Crack in,
                explore, and see how deep you can go.
              </p>
              <p class="mb-4">
                There are no missions yet. The world is an open sandbox for putting hacking
                techniques into practice: scan, crack, exploit, escalate.
              </p>
              <p>
                You are not alone. Other players connect to the same networks, and whatever anyone
                changes stays changed for everyone.
              </p>
            </div>
            <MenuButton onClick={goToForm}>NEW GAME</MenuButton>
          </div>
        }
      >
        <form class="flex flex-col items-center gap-5" onSubmit={handleSubmit}>
          <div class="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
            <label class={LABEL_CLASS} for="intro-workstation">
              Workstation
            </label>
            <input
              id="intro-workstation"
              class={FIELD_CLASS}
              placeholder="my-machine"
              maxLength={24}
              autocomplete="off"
              spellcheck={false}
              value={machineName()}
              onInput={(event) => {
                setMachineName(event.currentTarget.value);
                clearError();
              }}
            />

            <label class={LABEL_CLASS} for="intro-username">
              Username
            </label>
            <input
              id="intro-username"
              class={FIELD_CLASS}
              placeholder="hacker"
              maxLength={24}
              autocomplete="off"
              spellcheck={false}
              value={username()}
              onInput={(event) => {
                setUsername(event.currentTarget.value);
                clearError();
              }}
            />

            <label class={LABEL_CLASS} for="intro-password">
              Root password
            </label>
            <input
              id="intro-password"
              type="password"
              class={FIELD_CLASS}
              placeholder="password"
              autocomplete="new-password"
              spellcheck={false}
              value={rootPassword()}
              onInput={(event) => {
                setRootPassword(event.currentTarget.value);
                clearError();
              }}
            />

            <label class={LABEL_CLASS} for="intro-confirm">
              Confirm password
            </label>
            <input
              id="intro-confirm"
              type="password"
              class={FIELD_CLASS}
              placeholder="confirm password"
              autocomplete="new-password"
              spellcheck={false}
              value={confirmPassword()}
              onInput={(event) => {
                setConfirmPassword(event.currentTarget.value);
                clearError();
              }}
            />
          </div>

          <Show when={error()}>
            <p class="text-xs text-[var(--theme-error)]" role="alert">
              {error()}
            </p>
          </Show>

          <div class="mt-1 flex gap-4">
            <MenuButton onClick={() => setStep('menu')} dim>
              BACK
            </MenuButton>
            <MenuButton onClick={handleSubmit}>START</MenuButton>
          </div>
        </form>
      </Show>
    </div>
  );
};
