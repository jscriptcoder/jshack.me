import { test, type Page, type Locator } from '@playwright/test';

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
const NANO_TEXTAREA = 'textarea[data-testid="nano-editor-textarea"]';

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** Fill instantly or type character-by-character depending on TYPE_DELAY. */
const fillOrType = async (locator: Locator, text: string): Promise<void> => {
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
// Composite helpers — each uses countThenWait for robustness
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

const writeInNano = async (page: Page, filePath: string, content: string): Promise<void> => {
  await typeCommand(page, `nano("${filePath}")`);
  const textarea = page.locator(NANO_TEXTAREA);
  await textarea.waitFor();
  await fillOrType(textarea, content);
};

const saveAndExitNano = async (page: Page): Promise<void> => {
  const textarea = page.locator(NANO_TEXTAREA);
  await textarea.press('Control+s');
  await page.locator('span[data-testid="nano-status"]', { hasText: /Wrote/ }).waitFor();
  await textarea.press('Escape');
  await textarea.waitFor({ state: 'hidden' });
};

const expectFlag = async (page: Page, flag: string): Promise<void> => {
  await page.locator(RESULT, { hasText: flag }).first().waitFor({ timeout: 30_000 });
};

// ---------------------------------------------------------------------------
// Full CTF Playthrough
// ---------------------------------------------------------------------------

// Increase timeout when typing character-by-character
if (TYPE_DELAY > 0) {
  test.setTimeout(15 * 60 * 1000);
}

test('Full CTF playthrough — all 16 flags', async ({ page }) => {
  await page.goto('/');
  await page.locator(BANNER, { hasText: 'Type help()' }).waitFor();
  await waitForReady(page);

  // -----------------------------------------------------------------------
  // Flag 1: FLAG{welcome_hacker} — localhost README
  // -----------------------------------------------------------------------
  await test.step('Flag 1 — welcome_hacker', async () => {
    await typeCommand(page, 'cat("README.txt")');
    await expectFlag(page, 'FLAG{welcome_hacker}');
  });

  // -----------------------------------------------------------------------
  // Flag 2: FLAG{hidden_in_plain_sight} — hidden file
  // -----------------------------------------------------------------------
  await test.step('Flag 2 — hidden_in_plain_sight', async () => {
    await typeCommand(page, 'ls(".", "-a")');
    await typeCommand(page, 'cat(".mission")');
    await expectFlag(page, 'FLAG{hidden_in_plain_sight}');
  });

  // -----------------------------------------------------------------------
  // Flag 3: FLAG{root_access_granted} — root escalation
  // -----------------------------------------------------------------------
  await test.step('Flag 3 — root_access_granted', async () => {
    await suTo(page, 'root', 'sup3rus3r');
    await typeCommand(page, 'cat("flag.txt")');
    await expectFlag(page, 'FLAG{root_access_granted}');
  });

  // -----------------------------------------------------------------------
  // WiFi Gate — crack WiFi to enable network access
  // -----------------------------------------------------------------------
  await test.step('WiFi Gate — crack WiFi', async () => {
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
  });

  // -----------------------------------------------------------------------
  // Flag 4: FLAG{network_explorer} — curl gateway
  // -----------------------------------------------------------------------
  await test.step('Flag 4 — network_explorer', async () => {
    await typeCommand(page, 'curl("192.168.1.1")');
    await expectFlag(page, 'FLAG{network_explorer}');
  });

  // -----------------------------------------------------------------------
  // Flag 5: FLAG{gateway_breach} — SSH to gateway, escalate to admin
  // -----------------------------------------------------------------------
  await test.step('Flag 5 — gateway_breach', async () => {
    await sshTo(page, 'guest', '192.168.1.1', 'guest2024');
    await suTo(page, 'admin', 'n3tgu4rd!');
    await typeCommand(page, 'cat("/root/flag.txt")');
    await expectFlag(page, 'FLAG{gateway_breach}');
  });

  // -----------------------------------------------------------------------
  // Flag 6: FLAG{admin_panel_exposed} — gateway admin page
  // -----------------------------------------------------------------------
  await test.step('Flag 6 — admin_panel_exposed', async () => {
    await typeCommand(page, 'cat("/var/www/html/admin.html")');
    await expectFlag(page, 'FLAG{admin_panel_exposed}');
    await exitSession(page);
  });

  // -----------------------------------------------------------------------
  // Flag 7: FLAG{file_transfer_pro} — FTP to fileserver
  // -----------------------------------------------------------------------
  await test.step('Flag 7 — file_transfer_pro', async () => {
    await ftpConnect(page, '192.168.1.50', 'ftpuser', 'tr4nsf3r');
    await typeCommand(page, 'cd("/srv/ftp/uploads")');
    await typeCommand(page, 'ls("-a")');
    await runAndExpect(page, 'get(".backup_notes.txt")', 'Downloaded');
    await ftpQuit(page);
    await typeCommand(page, 'cat(".backup_notes.txt")');
    await expectFlag(page, 'FLAG{file_transfer_pro}');
  });

  // -----------------------------------------------------------------------
  // Flag 8: FLAG{binary_secrets_revealed} — webserver strings
  // -----------------------------------------------------------------------
  await test.step('Flag 8 — binary_secrets_revealed', async () => {
    await sshTo(page, 'guest', '192.168.1.75', 'w3lcome');
    await suTo(page, 'www-data', 'd3v0ps2024');
    await typeCommand(page, 'strings("/opt/tools/scanner")');
    await expectFlag(page, 'FLAG{binary_secrets_revealed}');
  });

  // -----------------------------------------------------------------------
  // Flag 9: FLAG{decrypted_intel} — webserver decrypt
  // -----------------------------------------------------------------------
  await test.step('Flag 9 — decrypted_intel', async () => {
    await suTo(page, 'root', 'r00tW3b!');
    await typeCommand(
      page,
      'decrypt("/var/www/backups/encrypted_intel.enc", "76e2e21dacea215ff2293e4eafc5985cea2d996cb180258ec89c0000b42db460")',
    );
    await expectFlag(page, 'FLAG{decrypted_intel}');
  });

  // -----------------------------------------------------------------------
  // Flag 10: FLAG{backdoor_found} — webserver nc backdoor
  // -----------------------------------------------------------------------
  await test.step('Flag 10 — backdoor_found', async () => {
    await exitSession(page);
    await ncConnect(page, '192.168.1.75', 4444);
    await typeCommand(page, 'ls("/opt/tools", "-a")');
    await typeCommand(page, 'cat("/opt/tools/.backdoor_log")');
    await expectFlag(page, 'FLAG{backdoor_found}');
    await exitSession(page);
  });

  // -----------------------------------------------------------------------
  // Flag 11: FLAG{darknet_discovered} — darknet curl
  // -----------------------------------------------------------------------
  await test.step('Flag 11 — darknet_discovered', async () => {
    await typeCommand(page, 'curl("http://203.0.113.42:8080")');
    await expectFlag(page, 'FLAG{darknet_discovered}');
  });

  // -----------------------------------------------------------------------
  // Flag 12: FLAG{master_of_the_darknet} — darknet decrypt
  // -----------------------------------------------------------------------
  await test.step('Flag 12 — master_of_the_darknet', async () => {
    await sshTo(page, 'guest', '203.0.113.42', 'sh4d0w');
    await suTo(page, 'ghost', 'sp3ctr3');
    await suTo(page, 'root', 'd4rkn3tR00t');
    await typeCommand(
      page,
      'decrypt("/home/ghost/.encrypted_flag.enc", "82eab922d375a8022d7659b58559e59026dbff2768110073a6c3699a15699eda")',
    );
    await expectFlag(page, 'FLAG{master_of_the_darknet}');
  });

  // -----------------------------------------------------------------------
  // Flag 13: FLAG{code_the_decoder} — ROT13 with nano + node
  // -----------------------------------------------------------------------
  await test.step('Flag 13 — code_the_decoder', async () => {
    await typeCommand(page, 'cd("/home/ghost/projects")');

    const rot13Script = [
      'const encoded = cat("encoded_message.txt")',
      'const decoded = encoded.split("").map(c => {',
      '  const code = c.charCodeAt(0)',
      '  if (code >= 65 && code <= 90) return String.fromCharCode(((code - 65 + 13) % 26) + 65)',
      '  if (code >= 97 && code <= 122) return String.fromCharCode(((code - 97 + 13) % 26) + 97)',
      '  return c',
      '}).join("")',
      'echo(decoded)',
    ].join('\n');

    await writeInNano(page, 'decoder.js', rot13Script);
    await saveAndExitNano(page);
    await typeCommand(page, 'node("decoder.js")');
    await expectFlag(page, 'FLAG{code_the_decoder}');
  });

  // -----------------------------------------------------------------------
  // Flag 14: FLAG{shadow_debugger} — FTP recon + debug script
  // -----------------------------------------------------------------------
  await test.step('Flag 14 — shadow_debugger', async () => {
    await typeCommand(page, 'cd("/root")');

    // FTP recon on shadow
    await ftpConnect(page, '10.66.66.1', 'guest', 'demo');
    await typeCommand(page, 'cd("/srv/ftp/exports")');
    await runAndExpect(page, 'get("system_report.txt")', 'Downloaded');
    await ftpQuit(page);

    // SSH to shadow as operator
    await sshTo(page, 'operator', '10.66.66.1', 'c0ntr0l_pl4n3');

    const flag14Script = [
      'const content = cat("diagnostics/access.log")',
      'const lines = content.split("\\n").filter(l => l.trim())',
      'const tags = lines.map(l => l.split("|")[3] ? l.split("|")[3].trim() : "")',
      'echo(tags.join(""))',
    ].join('\n');

    await writeInNano(page, 'diagnostics/solve_flag14.js', flag14Script);
    await saveAndExitNano(page);
    await typeCommand(page, 'node("diagnostics/solve_flag14.js")');
    await expectFlag(page, 'FLAG{shadow_debugger}');

    await exitSession(page);
  });

  // -----------------------------------------------------------------------
  // Flag 15: FLAG{void_data_miner} — CSV data extraction
  // -----------------------------------------------------------------------
  await test.step('Flag 15 — void_data_miner', async () => {
    await sshTo(page, 'guest', '10.66.66.2', 'demo');
    await suTo(page, 'dbadmin', 'dr0p_t4bl3s');

    const flag15Script = [
      'const tables = ["table_01.csv","table_02.csv","table_03.csv","table_04.csv","table_05.csv"]',
      'const parts = tables.map(t => {',
      '  const rows = cat("recovery/" + t).split("\\n")',
      '  return rows[13] ? rows[13].split("|")[3].trim() : ""',
      '})',
      'echo(parts.join(""))',
    ].join('\n');

    await writeInNano(page, 'solve_flag15.js', flag15Script);
    await saveAndExitNano(page);
    await typeCommand(page, 'node("solve_flag15.js")');
    await expectFlag(page, 'FLAG{void_data_miner}');

    await exitSession(page);
  });

  // -----------------------------------------------------------------------
  // Flag 16: FLAG{abyss_decryptor} — XOR cipher
  // -----------------------------------------------------------------------
  await test.step('Flag 16 — abyss_decryptor', async () => {
    await sshTo(page, 'guest', '10.66.66.3', 'demo');
    await suTo(page, 'phantom', 'sp3ctr4l');

    const flag16Script = [
      'const payload = cat("vault/encoded_payload.txt")',
      'const key = cat("vault/key.txt").trim()',
      'const bytes = payload.trim().split(" ").map(h => parseInt(h, 16))',
      'const decoded = bytes.map((b, i) => String.fromCharCode(b ^ key.charCodeAt(i % key.length)))',
      'echo(decoded.join(""))',
    ].join('\n');

    await writeInNano(page, 'solve_flag16.js', flag16Script);
    await saveAndExitNano(page);
    await typeCommand(page, 'node("solve_flag16.js")');
    await expectFlag(page, 'FLAG{abyss_decryptor}');
  });
});
