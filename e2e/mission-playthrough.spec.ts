import { test, expect, type Page, type Locator } from '@playwright/test';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Per-character typing delay in ms. 0 = instant fill (CI), e.g. 50 = visible typing. */
const TYPE_DELAY = parseInt(process.env.TYPE_DELAY || '0', 10);

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const INPUT = 'input[data-testid="terminal-input"]';
const BANNER = 'div[data-testid="terminal-banner"]';
const RESULT = 'div[data-testid="terminal-result"]';

// ---------------------------------------------------------------------------
// Core helpers (shared with ctf-playthrough.spec.ts)
// ---------------------------------------------------------------------------

const fillOrType = async (locator: Locator, text: string): Promise<void> => {
  if (TYPE_DELAY > 0) {
    await locator.pressSequentially(text, { delay: TYPE_DELAY });
  } else {
    await locator.fill(text);
  }
};

const countThenWait = async (
  locator: Locator,
  action: () => Promise<void>,
  timeout = 30_000,
): Promise<void> => {
  const before = await locator.count();
  await action();
  await locator.nth(before).waitFor({ timeout });
};

const typeCommand = async (page: Page, cmd: string): Promise<void> => {
  const input = page.locator(INPUT);
  await fillOrType(input, cmd);
  await input.press('Enter');
};

const enterInput = async (page: Page, value: string): Promise<void> => {
  const input = page.locator(INPUT);
  await fillOrType(input, value);
  await input.press('Enter');
};

const waitForReady = async (page: Page, timeout = 30_000): Promise<void> => {
  await page.locator(`${INPUT}:not([disabled])`).waitFor({ timeout });
};

// ---------------------------------------------------------------------------
// Composite helpers
// ---------------------------------------------------------------------------

const suTo = async (page: Page, user: string, password: string): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: /^Password:$/ });
  const successLocator = page.locator(RESULT, { hasText: `Switched to user: ${user}` });

  await countThenWait(pwLocator, () => typeCommand(page, `su("${user}")`));
  await countThenWait(successLocator, () => enterInput(page, password));
};

const sshTo = async (page: Page, user: string, host: string, password: string): Promise<void> => {
  const pwLocator = page.locator(RESULT, { hasText: `${user}@${host}'s password:` });
  const connLocator = page.locator(RESULT, { hasText: `Connected to ${host}` });

  await countThenWait(pwLocator, () => typeCommand(page, `ssh("${user}", "${host}")`), 60_000);
  await countThenWait(connLocator, () => enterInput(page, password));
};

const ftpConnect = async (
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

const ncConnect = async (page: Page, host: string, port: number): Promise<void> => {
  await typeCommand(page, `nc("${host}", ${port})`);
  await waitForReady(page, 60_000);
};

const runAndExpect = async (
  page: Page,
  cmd: string,
  expectedText: string,
  timeout = 30_000,
): Promise<void> => {
  const locator = page.locator(RESULT, { hasText: expectedText });
  await countThenWait(locator, () => typeCommand(page, cmd), timeout);
};

const exitSession = async (page: Page): Promise<void> => {
  await runAndExpect(page, 'exit()', 'Connection closed.');
};

const ftpQuit = async (page: Page): Promise<void> => {
  await runAndExpect(page, 'quit()', '221 Goodbye.');
};

// ---------------------------------------------------------------------------
// Mission-specific helpers
// ---------------------------------------------------------------------------

/** Complete the WiFi gate prerequisite (required before any network access). */
const completeWifiGate = async (page: Page): Promise<void> => {
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
const acceptMission = async (page: Page, seed: string): Promise<void> => {
  const briefingLocator = page.locator(RESULT, { hasText: 'MISSION BRIEFING' });
  await countThenWait(briefingLocator, () => typeCommand(page, `accept("${seed}")`));
};

/** Wait for the MISSION COMPLETE banner to appear. */
const expectMissionComplete = async (page: Page, flag: string): Promise<void> => {
  await page.locator(BANNER, { hasText: 'MISSION COMPLETE' }).first().waitFor({ timeout: 30_000 });
  await page.locator(BANNER, { hasText: flag }).first().waitFor({ timeout: 10_000 });
};

// ---------------------------------------------------------------------------
// Increase timeout when typing character-by-character
// ---------------------------------------------------------------------------
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
