import { expect, test } from '@playwright/test';
import {
  TYPE_DELAY,
  loadSavedGame,
  ncConnect,
  readMachinePatch,
  runAndExpect,
  suTo,
} from './helpers';

// Bump per-test timeout when typing visibly.
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// syslog — nc connect
// ---------------------------------------------------------------------------
// Verifies that `nc <host> <port>` fires the createNcConnectHandler callback
// wired in useNetworkCommands, which writes an xinetd-style connection entry
// to the target's /var/log/syslog via appendToMachineLog.
//
// Pinning seed `abcd1234` gives a deterministic backdoor port: dev-box
// (172.25.96.12) exposes an `elite` service on port 5555 owned by root —
// reachable with raw nc and logged as `xinetd[pid]: START: connection from=…`.
// Assertion reads IDB directly; nc drops the player into a raw shell with no
// native `cat /var/log/syslog` path back to the syslog on the *same* machine.
// ---------------------------------------------------------------------------

test('nc connect writes a START entry to the target /var/log/syslog', async ({ page }) => {
  const SEED = 'abcd1234';
  const WIFI = { essid: 'TYRELL-CORP', bssid: '0A:3F:E0:EE:91:68' };
  const ROOT_PASSWORD = 'testpass';
  const TARGET_HOST = '172.25.96.12'; // dev-box
  const TARGET_PORT = 5555; // elite service, nc-reachable

  await loadSavedGame(page, {
    gameState: {
      seed: SEED,
      workstationName: 'test-ws',
      username: 'tester',
      rootPassword: ROOT_PASSWORD,
    },
    wifi: WIFI,
  });

  // nc ships in the `netcat` apt package — install as root.
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install netcat', 'Setting up netcat', 30_000);

  await ncConnect(page, TARGET_HOST, TARGET_PORT);

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/syslog');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('xinetd');
  expect(logContent).toContain(`START: connection from=`);
  expect(logContent).toContain(`to port=${TARGET_PORT}`);
});
