import { test } from '@playwright/test';
import { TYPE_DELAY, loadSavedGame, runAndExpect, setupNewGame, sshTo, suTo } from './helpers';

// Bump per-test timeout when typing visibly.
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// auth.log — su success
// ---------------------------------------------------------------------------
// Verifies the full UI wiring behind `su`: interactive password prompt →
// session switch → auth log write → world-readable log file on localhost.
// None of this is reachable via Vitest alone — the seam we care about is the
// Terminal → session → onAuthResult → appendToMachineLog chain.
// ---------------------------------------------------------------------------

test('su root writes a success entry to /var/log/auth.log', async ({ page }) => {
  const workstation = 'test-ws';
  const username = 'tester';
  const password = 'testpass';

  await page.goto('/');
  await setupNewGame(page, { workstation, username, password });

  await suTo(page, 'root', password);

  await runAndExpect(page, 'cat /var/log/auth.log', `Successful su for root by ${username}`);
});

// ---------------------------------------------------------------------------
// auth.log — ssh success
// ---------------------------------------------------------------------------
// Verifies that a successful SSH login writes an `Accepted password for` line
// to the target's /var/log/auth.log via the createSshAuthHandler factory wired
// in useNetworkCommands. Unlike the nmap scan-logging test, the target log is
// world-readable and the session is now inside the target machine, so we read
// it via `cat` — no IDB inspection needed.
//
// Pinning seed `abcd1234` gives a deterministic guest account: staging-ws
// (172.25.96.96) has SSH open on port 22 and guest/public credentials.
// ---------------------------------------------------------------------------

test('ssh login writes an Accepted entry to the target /var/log/auth.log', async ({ page }) => {
  const SEED = 'abcd1234';
  const WIFI = { essid: 'TYRELL-CORP', bssid: '0A:3F:E0:EE:91:68' };
  const TARGET_HOST = '172.25.96.96'; // staging-ws, SSH open
  const SSH_USER = 'guest';
  const SSH_PASSWORD = 'public';

  await loadSavedGame(page, {
    gameState: {
      seed: SEED,
      workstationName: 'test-ws',
      username: 'tester',
      rootPassword: 'testpass',
    },
    wifi: WIFI,
  });

  await sshTo(page, SSH_USER, TARGET_HOST, SSH_PASSWORD);

  await runAndExpect(page, 'cat /var/log/auth.log', `Accepted password for ${SSH_USER}`);
});
