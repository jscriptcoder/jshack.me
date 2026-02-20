import { test } from '@playwright/test';
import {
  TYPE_DELAY,
  BANNER,
  RESULT,
  typeCommand,
  waitForReady,
  countThenWait,
  suTo,
  sshTo,
  runAndExpect,
  exitSession,
  completeWifiGate,
  acceptMission,
  expectMissionComplete,
} from './helpers';

// Increase timeout when typing character-by-character
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Mission 1 — Exploit entry variant (MEDTECH-4A7F-easy)
// ---------------------------------------------------------------------------
// Seed: MEDTECH-4A7F-easy (exploit entry, 2 machines, easy difficulty)
//
// Machines:
//   Entry: dev-box  (10.47.174.10) — workstation, port 3306/mysql vuln CVE-2012-2122
//   Target: files01 (10.47.174.11) — fileserver
//
// Credentials:
//   dev-box:  root/n3tw0rk, admin/s3cur3!, guest/password
//   files01:  root/tr4nsf3r, ftpuser/d4t4b4s3, backup/pr0duct1on
//
// Attack chain:
//   1. exploit(entry, 3306) → restricted shell as guest
//   2. cat /home/guest/.credentials → find admin/s3cur3! (SSH creds for entry)
//   3. SSH to entry as admin → cat /home/admin/notes.txt → find backup/pr0duct1on
//   4. SSH to target as backup → su root (tr4nsf3r) → cat /srv/records/patient_discharge_2024.csv
//
// Flag: FLAG{mission_14747}
// ---------------------------------------------------------------------------

test('Mission playthrough — exploit entry variant (MEDTECH-4A7F-easy)', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  // -----------------------------------------------------------------------
  // Step 1: Complete WiFi gate (prerequisite for network access)
  // -----------------------------------------------------------------------
  await test.step('Complete WiFi gate', async () => {
    await completeWifiGate(page);
  });

  // -----------------------------------------------------------------------
  // Step 2: Accept mission
  // -----------------------------------------------------------------------
  await test.step('Accept mission MEDTECH-4A7F-easy', async () => {
    await acceptMission(page, 'MEDTECH-4A7F-easy');
  });

  // -----------------------------------------------------------------------
  // Step 3: Scan entry machine for vulnerabilities
  // -----------------------------------------------------------------------
  await test.step('Scan entry machine with nmap -sV', async () => {
    const vulnLocator = page.locator(RESULT, { hasText: 'CVE-2012-2122' });
    await countThenWait(
      vulnLocator,
      () => typeCommand(page, 'nmap("-sV", "10.47.174.10")'),
      60_000,
    );
  });

  // -----------------------------------------------------------------------
  // Step 4: Exploit vulnerable MySQL port → restricted shell as guest
  // -----------------------------------------------------------------------
  await test.step('Exploit port 3306 on entry machine', async () => {
    // exploit() is async — wait for the "Exploit successful" message,
    // then the NC-like prompt becomes active
    const exploitDone = page.locator(RESULT, { hasText: 'Exploit successful' });
    await countThenWait(
      exploitDone,
      () => typeCommand(page, 'exploit("10.47.174.10", 3306)'),
      60_000,
    );
    await waitForReady(page);
  });

  // -----------------------------------------------------------------------
  // Step 5: In restricted shell, find SSH credentials for the entry machine
  // -----------------------------------------------------------------------
  await test.step('Find SSH credentials in restricted exploit shell', async () => {
    // /home/guest/.credentials contains: admin / s3cur3!
    await runAndExpect(page, 'cat("/home/guest/.credentials")', 's3cur3!');
    await exitSession(page);
  });

  // -----------------------------------------------------------------------
  // Step 6: SSH to entry machine as admin
  // -----------------------------------------------------------------------
  await test.step('SSH to entry machine as admin', async () => {
    await sshTo(page, 'admin', '10.47.174.10', 's3cur3!');
  });

  // -----------------------------------------------------------------------
  // Step 7: Find target credentials on entry machine
  // -----------------------------------------------------------------------
  await test.step('Find target credentials on entry machine', async () => {
    // /home/admin/notes.txt contains: backup / pr0duct1on for 10.47.174.11
    await runAndExpect(page, 'cat("/home/admin/notes.txt")', 'pr0duct1on');
  });

  // -----------------------------------------------------------------------
  // Step 8: SSH to target machine
  // -----------------------------------------------------------------------
  await test.step('SSH to target machine as backup', async () => {
    await sshTo(page, 'backup', '10.47.174.11', 'pr0duct1on');
  });

  // -----------------------------------------------------------------------
  // Step 9: Escalate to root and capture flag from thematic target path
  // -----------------------------------------------------------------------
  await test.step('Escalate to root and capture flag', async () => {
    await suTo(page, 'root', 'tr4nsf3r');
    await typeCommand(page, 'cat("/srv/records/patient_discharge_2024.csv")');
    await expectMissionComplete(page, 'FLAG{mission_14747}');
  });
});
