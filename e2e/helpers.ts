import type { Page, Locator } from '@playwright/test';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Per-character typing delay in ms. 0 = instant fill (CI), e.g. 50 = visible typing. */
export const TYPE_DELAY = parseInt(process.env.TYPE_DELAY || '0', 10);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export const INPUT = 'input[data-testid="terminal-input"]';
export const BANNER = 'div[data-testid="terminal-banner"]';
export const RESULT = 'div[data-testid="terminal-result"]';
export const ERROR = 'div[data-testid="terminal-error"]';
export const NANO_TEXTAREA = 'textarea[data-testid="nano-editor-textarea"]';

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Fill instantly or type character-by-character depending on TYPE_DELAY. */
export const fillOrType = async (locator: Locator, text: string): Promise<void> => {
  if (TYPE_DELAY > 0) {
    await locator.pressSequentially(text, { delay: TYPE_DELAY });
  } else {
    await locator.fill(text);
  }
};

/**
 * Count matching result elements, perform an action, then wait for a NEW match.
 * This avoids matching stale output from earlier commands.
 */
export const countThenWait = async (
  locator: Locator,
  action: () => Promise<void>,
  timeout = 30_000,
): Promise<void> => {
  const before = await locator.count();
  await action();
  await locator.nth(before).waitFor({ timeout });
};

export const typeCommand = async (page: Page, cmd: string): Promise<void> => {
  const input = page.locator(INPUT);
  await fillOrType(input, cmd);
  await input.press('Enter');
};

export const enterInput = async (page: Page, value: string): Promise<void> => {
  const input = page.locator(INPUT);
  await fillOrType(input, value);
  await input.press('Enter');
};

export const waitForReady = async (page: Page, timeout = 30_000): Promise<void> => {
  await page.locator(`${INPUT}:not([disabled])`).waitFor({ timeout });
};

// ---------------------------------------------------------------------------
// Composite helpers — each uses countThenWait for robustness
// ---------------------------------------------------------------------------

export const suTo = async (page: Page, user: string, password: string): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: /^Password:$/ });
  const successLocator = page.locator(RESULT, { hasText: `Switched to user: ${user}` });

  await countThenWait(pwLocator, () => typeCommand(page, `su ${user}`));
  await countThenWait(successLocator, () => enterInput(page, password));
};

export const sshTo = async (
  page: Page,
  user: string,
  host: string,
  password: string,
): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: `${user}@${host}'s password:` });
  const connLocator = page.locator(RESULT, { hasText: `Connected to ${host}` });

  await countThenWait(pwLocator, () => typeCommand(page, `ssh ${user}@${host}`), 60_000);
  await countThenWait(connLocator, () => enterInput(page, password));
};

export const ftpConnect = async (
  page: Page,
  host: string,
  user: string,
  password: string,
): Promise<void> => {
  const nameLocator = page.locator(RESULT, { hasText: `Name (${host}:anonymous):` });
  const pw331Locator = page.locator(RESULT, { hasText: '331 Please specify the password.' });
  const successLocator = page.locator(RESULT, { hasText: '230 Login successful.' });

  await countThenWait(nameLocator, () => typeCommand(page, `ftp ${host}`), 60_000);
  await countThenWait(pw331Locator, () => enterInput(page, user));
  await countThenWait(successLocator, () => enterInput(page, password));
};

// ---------------------------------------------------------------------------
// Failure flows — exercise the rejected-auth paths for each service so the
// failure-branch log line fires.
// ---------------------------------------------------------------------------

export const suFail = async (page: Page, user: string, wrongPassword: string): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: /^Password:$/ });
  const failLocator = page.locator(ERROR, { hasText: 'su: Authentication failure' });

  await countThenWait(pwLocator, () => typeCommand(page, `su ${user}`));
  await countThenWait(failLocator, () => enterInput(page, wrongPassword));
};

export const sshFail = async (
  page: Page,
  user: string,
  host: string,
  wrongPassword: string,
): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: `${user}@${host}'s password:` });
  const failLocator = page.locator(ERROR, { hasText: 'Permission denied, please try again.' });

  await countThenWait(pwLocator, () => typeCommand(page, `ssh ${user}@${host}`), 60_000);
  await countThenWait(failLocator, () => enterInput(page, wrongPassword));
};

export const ftpFail = async (
  page: Page,
  host: string,
  user: string,
  wrongPassword: string,
): Promise<void> => {
  const nameLocator = page.locator(RESULT, { hasText: `Name (${host}:anonymous):` });
  const pw331Locator = page.locator(RESULT, { hasText: '331 Please specify the password.' });
  const failLocator = page.locator(ERROR, { hasText: '530 Login incorrect.' });

  await countThenWait(nameLocator, () => typeCommand(page, `ftp ${host}`), 60_000);
  await countThenWait(pw331Locator, () => enterInput(page, user));
  await countThenWait(failLocator, () => enterInput(page, wrongPassword));
};

export const ncConnect = async (page: Page, host: string, port: number): Promise<void> => {
  await typeCommand(page, `nc ${host} ${port}`);
  await waitForReady(page, 60_000);
};

export const runAndExpect = async (
  page: Page,
  cmd: string,
  expectedText: string,
  timeout = 30_000,
): Promise<void> => {
  const locator = page.locator(RESULT, { hasText: expectedText });
  await countThenWait(locator, () => typeCommand(page, cmd), timeout);
};

export const exitSession = async (page: Page): Promise<void> => {
  await runAndExpect(page, 'exit', 'Connection closed.');
};

export const ftpQuit = async (page: Page): Promise<void> => {
  await runAndExpect(page, 'quit', '221 Goodbye.');
};

export const writeInNano = async (page: Page, filePath: string, content: string): Promise<void> => {
  await typeCommand(page, `nano ${filePath}`);
  const textarea = page.locator(NANO_TEXTAREA);
  await textarea.waitFor();
  await fillOrType(textarea, content);
};

export const saveAndExitNano = async (page: Page): Promise<void> => {
  const textarea = page.locator(NANO_TEXTAREA);
  await textarea.press('Control+s');
  await page.locator('span[data-testid="nano-status"]', { hasText: /Wrote/ }).waitFor();
  await textarea.press('Escape');
  await textarea.waitFor({ state: 'hidden' });
};

// ---------------------------------------------------------------------------
// Intro / boot
// ---------------------------------------------------------------------------

export type NewGameOptions = {
  readonly workstation: string;
  readonly username: string;
  readonly password: string;
};

/**
 * Walk through the intro screen (NEW GAME → form → START) and the boot sequence,
 * returning once the terminal input is ready for commands.
 */
export const setupNewGame = async (page: Page, opts: NewGameOptions): Promise<void> => {
  await page.getByRole('button', { name: 'NEW GAME' }).click();
  await page.getByPlaceholder('my-machine').fill(opts.workstation);
  await page.getByPlaceholder('hacker').fill(opts.username);
  await page.getByPlaceholder('password', { exact: true }).fill(opts.password);
  await page.getByPlaceholder('confirm password').fill(opts.password);
  await page.getByRole('button', { name: 'START' }).click();

  // Boot sequence runs ~4-5s, then the terminal mounts — give it room.
  await page.locator(BANNER, { hasText: 'Type help' }).waitFor({ timeout: 30_000 });
  await waitForReady(page);
};

export type SavedGameState = {
  readonly seed: string;
  readonly workstationName: string;
  readonly username: string;
  readonly rootPassword: string;
};

export type SavedWifi = {
  readonly essid: string;
  readonly bssid: string;
};

export type LoadSavedGameOptions = {
  readonly gameState: SavedGameState;
  readonly wifi?: SavedWifi;
};

// Narrow shape of `window.__jshackTest`, mirrored from src/testApi.ts. When
// the storage layer migrates (e.g. Supabase for multiplayer), the src-side
// implementation changes but this surface stays stable — so nothing in e2e
// needs to know how state is persisted.
type TestApiSurface = {
  readonly setGameState: (state: SavedGameState) => Promise<void>;
  readonly setWifiConnected: (wifi: SavedWifi | null) => Promise<void>;
  readonly readFilesystemPatch: (machineId: string, path: string) => Promise<string | null>;
};

declare global {
  interface Window {
    __jshackTest?: TestApiSurface;
  }
}

const MISSING_TEST_API =
  'test API not installed on window — is Vite dev mode active? (import.meta.env.DEV)';

/**
 * Pre-populate the storage layer with a GameState (and optional WiFi
 * connection) so the app renders straight into the game, skipping the intro +
 * boot + WiFi gate. Lets tests pin a known seed — critical for scenarios that
 * need deterministic procedurally-generated machine IPs and credentials.
 */
export const loadSavedGame = async (page: Page, opts: LoadSavedGameOptions): Promise<void> => {
  await page.goto('/');

  // main.tsx's bootstrap is async and installs the test API only after
  // initializeStorage resolves, which can land after the page `load` event.
  await page.waitForFunction(() => Boolean(window.__jshackTest), null, { timeout: 10_000 });

  await page.evaluate(
    async ({ gameState, wifi, missingMessage }) => {
      if (!window.__jshackTest) throw new Error(missingMessage);
      await window.__jshackTest.setGameState(gameState);
      if (wifi) await window.__jshackTest.setWifiConnected(wifi);
    },
    { gameState: opts.gameState, wifi: opts.wifi, missingMessage: MISSING_TEST_API },
  );

  await page.reload();
  await page.locator(BANNER, { hasText: 'Type help' }).waitFor({ timeout: 30_000 });
  await waitForReady(page);
};

/**
 * Read a file's content from a machine's filesystem. Necessary for asserting
 * on log writes to machines whose credentials are procedurally generated and
 * not otherwise reachable from the player's UI.
 */
export const readMachinePatch = async (
  page: Page,
  machineId: string,
  path: string,
): Promise<string | null> =>
  page.evaluate(
    async ({ machineId: id, path: p, missingMessage }) => {
      if (!window.__jshackTest) throw new Error(missingMessage);
      return window.__jshackTest.readFilesystemPatch(id, p);
    },
    { machineId, path, missingMessage: MISSING_TEST_API },
  );

// ---------------------------------------------------------------------------
// Mission-specific helpers
// ---------------------------------------------------------------------------

/** Complete the WiFi gate prerequisite (required before any network access). */
export const completeWifiGate = async (page: Page, rootPassword: string): Promise<void> => {
  await suTo(page, 'root', rootPassword);
  await runAndExpect(page, 'airmon start wlan0', 'monitor mode enabled', 30_000);
  const scanDone = page.locator(RESULT, { hasText: 'Scan complete' });
  await countThenWait(scanDone, () => typeCommand(page, 'airdump'), 60_000);
  const keyFound = page.locator(RESULT, { hasText: 'KEY FOUND!' });
  await countThenWait(keyFound, () => typeCommand(page, 'aircrack A4:CF:12:D3:8B:7A'), 60_000);
  await runAndExpect(
    page,
    'nmcli connect JSHACK-CORP cr4ck3d_w1f1',
    'Connected to JSHACK-CORP',
    30_000,
  );
};

/** Accept a mission and wait for the briefing. */
export const acceptMission = async (page: Page, seed: string): Promise<void> => {
  const briefingLocator = page.locator(RESULT, { hasText: 'MISSION BRIEFING' });
  await countThenWait(briefingLocator, () => typeCommand(page, `accept ${seed}`));
};

/** Wait for the MISSION COMPLETE banner to appear. */
export const expectMissionComplete = async (page: Page, flag: string): Promise<void> => {
  await page.locator(BANNER, { hasText: 'MISSION COMPLETE' }).first().waitFor({ timeout: 30_000 });
  await page.locator(BANNER, { hasText: flag }).first().waitFor({ timeout: 10_000 });
};
