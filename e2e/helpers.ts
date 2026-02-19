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

  await countThenWait(pwLocator, () => typeCommand(page, `su("${user}")`));
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

  await countThenWait(pwLocator, () => typeCommand(page, `ssh("${user}", "${host}")`), 60_000);
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

  await countThenWait(nameLocator, () => typeCommand(page, `ftp("${host}")`), 60_000);
  await countThenWait(pw331Locator, () => enterInput(page, user));
  await countThenWait(successLocator, () => enterInput(page, password));
};

export const ncConnect = async (page: Page, host: string, port: number): Promise<void> => {
  await typeCommand(page, `nc("${host}", ${port})`);
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
  await runAndExpect(page, 'exit()', 'Connection closed.');
};

export const ftpQuit = async (page: Page): Promise<void> => {
  await runAndExpect(page, 'quit()', '221 Goodbye.');
};

export const writeInNano = async (page: Page, filePath: string, content: string): Promise<void> => {
  await typeCommand(page, `nano("${filePath}")`);
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

export const expectFlag = async (page: Page, flag: string): Promise<void> => {
  await page.locator(RESULT, { hasText: flag }).first().waitFor({ timeout: 30_000 });
};

// ---------------------------------------------------------------------------
// Mission-specific helpers
// ---------------------------------------------------------------------------

/** Complete the WiFi gate prerequisite (required before any network access). */
export const completeWifiGate = async (page: Page): Promise<void> => {
  await suTo(page, 'root', 'sup3rus3r');
  await runAndExpect(page, 'airmon("start", "wlan0")', 'monitor mode enabled', 30_000);
  const scanDone = page.locator(RESULT, { hasText: 'Scan complete' });
  await countThenWait(scanDone, () => typeCommand(page, 'airdump()'), 60_000);
  const keyFound = page.locator(RESULT, { hasText: 'KEY FOUND!' });
  await countThenWait(keyFound, () => typeCommand(page, 'aircrack("A4:CF:12:D3:8B:7A")'), 60_000);
  await runAndExpect(
    page,
    'nmcli("connect", "JSHACK-CORP", "cr4ck3d_w1f1")',
    'Connected to JSHACK-CORP',
    30_000,
  );
};

/** Accept a mission and wait for the briefing. */
export const acceptMission = async (page: Page, seed: string): Promise<void> => {
  const briefingLocator = page.locator(RESULT, { hasText: 'MISSION BRIEFING' });
  await countThenWait(briefingLocator, () => typeCommand(page, `accept("${seed}")`));
};

/** Wait for the MISSION COMPLETE banner to appear. */
export const expectMissionComplete = async (page: Page, flag: string): Promise<void> => {
  await page.locator(BANNER, { hasText: 'MISSION COMPLETE' }).first().waitFor({ timeout: 30_000 });
  await page.locator(BANNER, { hasText: flag }).first().waitFor({ timeout: 10_000 });
};
