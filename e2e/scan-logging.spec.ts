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
// kern.log — nmap scan aggregate
// ---------------------------------------------------------------------------
// Verifies that typing `nmap <ip>` in the terminal fires the onScanAggregate
// callback wired by useNetworkCommands, which writes a one-line iptables-style
// entry to the target machine's /var/log/kern.log via appendToMachineLog.
//
// Setup pins a known game seed (`abcd1234`) so the home network's subnet and
// machine IPs are deterministic. Assertion reads IDB directly — the target
// machine's credentials are procedurally generated, so SSHing in to `cat` the
// log would require cracking wordlist passwords that vary by seed.
// ---------------------------------------------------------------------------

test('nmap writes an aggregate scan entry to the target /var/log/kern.log', async ({ page }) => {
  const SEED = 'abcd1234';
  const WIFI = { essid: 'TYRELL-CORP', bssid: '0A:3F:E0:EE:91:68' };
  const ROOT_PASSWORD = 'testpass';
  const TARGET_IP = '172.25.96.12'; // dev-box on TYRELL-CORP subnet (seed abcd1234)

  await loadSavedGame(page, {
    gameState: {
      seed: SEED,
      workstationName: 'test-ws',
      username: 'tester',
      rootPassword: ROOT_PASSWORD,
    },
    wifi: WIFI,
  });

  // nmap is not pre-installed — apt install requires root.
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install nmap', 'Setting up nmap', 30_000);

  await typeCommand(page, `nmap ${TARGET_IP}`);
  await page.locator(RESULT, { hasText: 'Host is up.' }).first().waitFor({ timeout: 60_000 });

  const logContent = await readMachinePatch(page, TARGET_IP, '/var/log/kern.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('[iptables] Port scan from');
  expect(logContent).toContain('probed ports');
});
