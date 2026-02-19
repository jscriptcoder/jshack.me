import { test, expect } from '@playwright/test';
import {
  TYPE_DELAY,
  BANNER,
  RESULT,
  typeCommand,
  waitForReady,
  countThenWait,
  suTo,
  sshTo,
  ftpConnect,
  ncConnect,
  runAndExpect,
  exitSession,
  ftpQuit,
  completeWifiGate,
  acceptMission,
  expectMissionComplete,
} from './helpers';

// Increase timeout when typing character-by-character
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Mission Playthrough — SSH entry variant
// ---------------------------------------------------------------------------
// Seed: TEST-1-easy (SSH entry, 2 machines)
// Entry: frontend (10.100.103.10) — guest/guest
// Target: ftp-main (10.100.103.11) — fileadm/r00tpass, root/adm1n123
// Flag: FLAG{mission_79284} at /root/flag.txt on target
// ---------------------------------------------------------------------------

test('Mission playthrough — SSH entry variant (TEST-1-easy)', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  await test.step('Complete WiFi gate', async () => {
    await completeWifiGate(page);
  });

  await test.step('Accept mission', async () => {
    await acceptMission(page, 'TEST-1-easy');
  });

  await test.step('Scan the mission network', async () => {
    const scanDone = page.locator(RESULT, { hasText: 'frontend' });
    await countThenWait(scanDone, () => typeCommand(page, 'nmap("10.100.103.10")'), 60_000);
  });

  await test.step('SSH to target machine', async () => {
    await sshTo(page, 'fileadm', '10.100.103.11', 'r00tpass');
  });

  await test.step('Escalate to root and capture flag', async () => {
    await suTo(page, 'root', 'adm1n123');
    await typeCommand(page, 'cat("/root/flag.txt")');
    await expectMissionComplete(page, 'FLAG{mission_79284}');
  });
});

// ---------------------------------------------------------------------------
// Mission Playthrough — NC entry variant
// ---------------------------------------------------------------------------
// Seed: MEDTECH-4A7F-easy (NC entry, 2 machines)
// Entry: dev-box (10.47.174.10) — NC port 4444 as guest
// Target: files01 (10.47.174.11) — sysadmin/p4ssw0rd, root/l3tm3in
// Flag: FLAG{mission_91702} at /root/flag.txt on target
//
// Tests NC backdoor connection to a mission machine, then completes via SSH.
// ---------------------------------------------------------------------------

test('Mission playthrough — NC entry variant (MEDTECH-4A7F-easy)', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  await test.step('Complete WiFi gate', async () => {
    await completeWifiGate(page);
  });

  await test.step('Accept mission', async () => {
    await acceptMission(page, 'MEDTECH-4A7F-easy');
  });

  await test.step('NC to entry machine and explore via backdoor', async () => {
    await ncConnect(page, '10.47.174.10', 4444);
    await runAndExpect(page, 'cat("/home/guest/.credentials")', 'ssh_pass=s3cur3!');
    await exitSession(page);
  });

  await test.step('SSH to target machine', async () => {
    await sshTo(page, 'sysadmin', '10.47.174.11', 'p4ssw0rd');
  });

  await test.step('Escalate to root and capture flag', async () => {
    await suTo(page, 'root', 'l3tm3in');
    await typeCommand(page, 'cat("/root/flag.txt")');
    await expectMissionComplete(page, 'FLAG{mission_91702}');
  });
});

// ---------------------------------------------------------------------------
// Mission Playthrough — FTP entry variant
// ---------------------------------------------------------------------------
// Seed: NOVA-7E2A-easy (FTP entry, 2 machines)
// Entry: dev-box (10.87.27.10) — FTP as analyst/tr4nsf3r
// Target: postgres01 (10.87.27.11) — dbadmin/syst3m!, root/p4ssw0rd
// Flag: FLAG{mission_12942} at /root/flag.txt on target
//
// Tests FTP connection + file download from a mission machine,
// then completes via SSH.
// ---------------------------------------------------------------------------

test('Mission playthrough — FTP entry variant (NOVA-7E2A-easy)', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  await test.step('Complete WiFi gate', async () => {
    await completeWifiGate(page);
  });

  await test.step('Accept mission', async () => {
    await acceptMission(page, 'NOVA-7E2A-easy');
  });

  await test.step('FTP to entry machine and download file', async () => {
    await ftpConnect(page, '10.87.27.10', 'analyst', 'tr4nsf3r');
    await runAndExpect(page, 'cd("/home/analyst")', 'Remote directory changed');
    await runAndExpect(page, 'get("credentials.bak")', 'Downloaded');
    await ftpQuit(page);
    await runAndExpect(page, 'cat("credentials.bak")', 'ssh_pass=tr4nsf3r');
  });

  await test.step('SSH to target machine', async () => {
    await sshTo(page, 'dbadmin', '10.87.27.11', 'syst3m!');
  });

  await test.step('Escalate to root and capture flag', async () => {
    await suTo(page, 'root', 'p4ssw0rd');
    await typeCommand(page, 'cat("/root/flag.txt")');
    await expectMissionComplete(page, 'FLAG{mission_12942}');
  });
});

// ---------------------------------------------------------------------------
// Mission lifecycle — abort and re-accept
// ---------------------------------------------------------------------------

test('Mission lifecycle — abort returns to localhost', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  await test.step('Complete WiFi gate', async () => {
    await completeWifiGate(page);
  });

  await test.step('Accept and enter mission', async () => {
    await acceptMission(page, 'TEST-1-easy');
    await sshTo(page, 'fileadm', '10.100.103.11', 'r00tpass');
  });

  await test.step('Abort mission — returns to localhost', async () => {
    await runAndExpect(page, 'abort()', 'Mission aborted');
  });

  await test.step('Verify back on localhost', async () => {
    await runAndExpect(page, 'whoami()', 'root');
  });

  await test.step('Can accept a new mission after abort', async () => {
    await acceptMission(page, 'MEDTECH-4A7F-easy');
    const briefing = page.locator(RESULT, { hasText: 'dev-box' });
    await expect(briefing.first()).toBeVisible();
  });
});
