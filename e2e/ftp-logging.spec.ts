import { expect, test } from '@playwright/test';
import {
  TYPE_DELAY,
  ftpConnect,
  loadSavedGame,
  readMachinePatch,
  runAndExpect,
  suTo,
} from './helpers';

// Bump per-test timeout when typing visibly.
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// vsftpd.log — ftp connect + login success
// ---------------------------------------------------------------------------
// Verifies that an FTP session writes both a CONNECT line (fired when the
// socket opens) and an OK LOGIN line (fired when the user authenticates) to
// the target's /var/log/vsftpd.log. Exercises the full chain: terminal input →
// ftp command → createFtpAuthHandler → appendToMachineLog → IDB write.
//
// Pinning seed `abcd1234` gives a deterministic target: dev-box (172.25.96.12)
// exposes FTP on port 21. FTP auth uses the machine's virtual users file
// (/etc/vsftpd/virtual_users.conf) — passwords are drawn from the WORDLIST
// pool, not the system GUEST_PASSWORDS list, so the credentials here differ
// from what the host would accept over SSH. Assertion reads IDB directly:
// FTP's command set has no remote `cat`, and fetching the log via `get` would
// just round-trip the same IDB content.
// ---------------------------------------------------------------------------

test('ftp login writes CONNECT + OK LOGIN entries to the target /var/log/vsftpd.log', async ({
  page,
}) => {
  const SEED = 'abcd1234';
  const WIFI = { essid: 'TYRELL-CORP', bssid: '0A:3F:E0:EE:91:68' };
  const ROOT_PASSWORD = 'testpass';
  const TARGET_HOST = '172.25.96.12'; // dev-box, FTP open on port 21
  const FTP_USER = 'guest';
  const FTP_PASSWORD = 'staging1'; // virtual FTP password from the WORDLIST pool

  await loadSavedGame(page, {
    gameState: {
      seed: SEED,
      workstationName: 'test-ws',
      username: 'tester',
      rootPassword: ROOT_PASSWORD,
    },
    wifi: WIFI,
  });

  // ftp is not pre-installed — apt install requires root.
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install ftp', 'Setting up ftp', 30_000);

  await ftpConnect(page, TARGET_HOST, FTP_USER, FTP_PASSWORD);

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/vsftpd.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('CONNECT: Client');
  expect(logContent).toContain(`OK LOGIN: Client`);
  expect(logContent).toContain(`user "${FTP_USER}"`);
});
