import { expect, test } from '@playwright/test';
import {
  RESULT,
  TYPE_DELAY,
  loadSavedGame,
  readMachinePatch,
  runAndExpect,
  suTo,
  typeCommand,
} from './helpers';

// Bump per-test timeout when typing visibly.
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------
// Pinning seed `abcd1234` + WiFi index 1 (CYBERDYNE-5G) gives a deterministic
// HTTP target: switch-core (router) at 10.220.230.1 with port 80 natively open
// (no NAT). Both curl and gobuster logs land on the router's own access.log,
// so the two tests cover complementary sides of the same log file.
// ---------------------------------------------------------------------------

const SEED = 'abcd1234';
const WIFI = { essid: 'CYBERDYNE-5G', bssid: 'F1:9D:F8:0C:11:99' };
const ROOT_PASSWORD = 'testpass';
const TARGET_HOST = '10.220.230.1'; // switch-core router on the CYBERDYNE-5G subnet
const TARGET_URL = `http://${TARGET_HOST}/`;

const loadGame = (): Parameters<typeof loadSavedGame>[1] => ({
  gameState: {
    seed: SEED,
    workstationName: 'test-ws',
    username: 'tester',
    rootPassword: ROOT_PASSWORD,
  },
  wifi: WIFI,
});

// ---------------------------------------------------------------------------
// access.log — curl HTTP request
// ---------------------------------------------------------------------------
// Verifies that `curl <url>` fires the createHttpRequestHandler callback in
// useNetworkCommands, writing an Apache-combined line to the target's
// /var/log/access.log via appendToMachineLog. curl is pre-installed, so no
// apt install needed.
// ---------------------------------------------------------------------------

test('curl writes an access-log entry to the target /var/log/access.log', async ({ page }) => {
  await loadSavedGame(page, loadGame());

  await runAndExpect(page, `curl ${TARGET_URL}`, '<html>', 30_000);

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/access.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('"GET / HTTP/1.1"');
  expect(logContent).toContain(' 200 ');
});

// ---------------------------------------------------------------------------
// access.log — gobuster directory-enumeration aggregate
// ---------------------------------------------------------------------------
// Verifies that a gobuster run — regardless of how many paths it probes —
// writes a single mod_security-style aggregate line to the target's
// access.log, via the inline onGobusterScanAggregate handler wired in
// useNetworkCommands (mirroring how real defensive tooling records bursts
// rather than one entry per probe).
// ---------------------------------------------------------------------------

test('gobuster writes an aggregate mod_security entry to the target /var/log/access.log', async ({
  page,
}) => {
  await loadSavedGame(page, loadGame());

  // gobuster ships in its own apt package — install as root.
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install gobuster', 'Setting up gobuster', 30_000);

  await typeCommand(page, `gobuster dir ${TARGET_URL}`);
  await page.locator(RESULT, { hasText: 'Scan complete' }).first().waitFor({ timeout: 120_000 });

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/access.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('[mod_security]');
  expect(logContent).toContain('Directory enumeration detected');
  expect(logContent).toContain('(gobuster)');
});
