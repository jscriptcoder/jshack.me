# E2E Tests

End-to-end tests using [Playwright](https://playwright.dev/) that verify the full JSHACK.ME experience in a real browser (Chromium).

## Files

| File                   | Description                                                                    |
| ---------------------- | ------------------------------------------------------------------------------ |
| `helpers.ts`           | Shared constants, selectors, and helper functions used by all tests            |
| `auth-logging.spec.ts` | Verifies UI → session → auth-log wiring (e.g. `su root` → `/var/log/auth.log`) |
| `ftp-logging.spec.ts`  | Verifies FTP connect + login wiring (`ftp <host>` → target's `vsftpd.log`)     |
| `nc-logging.spec.ts`   | Verifies nc connect wiring (`nc <host> <port>` → target's `syslog`)            |
| `scan-logging.spec.ts` | Verifies scan-aggregate log wiring (e.g. `nmap <ip>` → target's `kern.log`)    |

E2E coverage is reserved for behavior Vitest can't reach — full UI-through-session-through-filesystem flows, real keyboard handling, the nano editor textarea, and mission playthroughs (added as missions are built out).

## Running

```bash
# Run all E2E tests (starts dev server automatically)
npm run test:e2e

# Run a specific test file
npx playwright test e2e/<spec-file>.spec.ts
```

## Environment Variables

| Variable       | Default | Description                                                                                                                       |
| -------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `TYPE_DELAY`   | `0`     | Per-character typing delay in ms. `0` = instant fill, `50` = visible typing. Non-zero values increase test timeout to 15 minutes. |
| `SLOW_MO`      | `0`     | Playwright `slowMo` option — adds delay between browser actions                                                                   |
| `RECORD_VIDEO` | (unset) | Set to any value to record video of test runs                                                                                     |

## Configuration

Playwright config lives at `playwright.config.ts` in the project root:

- **Browser**: Chromium only
- **Base URL**: `http://localhost:5173` (Vite dev server, started automatically)
- **Timeout**: 5 minutes per test
- **Workers**: 1 (sequential — tests depend on clean app state)
- **Retries**: 0

## Helpers

`helpers.ts` exports all shared test utilities:

- **Selectors** — `INPUT`, `BANNER`, `RESULT`, `NANO_TEXTAREA`
- **Core** — `fillOrType`, `countThenWait`, `typeCommand`, `enterInput`, `waitForReady`
- **Intro/boot** — `setupNewGame`, `loadSavedGame` (pre-seed IDB to skip intro and pin a seed)
- **Session** — `suTo`, `sshTo`, `ftpConnect`, `ncConnect`, `exitSession`, `ftpQuit`
- **Commands** — `runAndExpect`, `writeInNano`, `saveAndExitNano`
- **State** — `readMachinePatch` (read a machine's filesystem patch directly from IDB)
- **Mission** — `completeWifiGate`, `acceptMission`, `expectMissionComplete`

`loadSavedGame` writes a `GameState` (and optional WiFi connection) directly to IndexedDB, then reloads. The app starts in the game with a known seed — letting tests assert against procedurally-generated machine IPs that would otherwise vary run-to-run. `readMachinePatch` reads filesystem patches back from IDB, useful when a test needs to verify a log write on a machine whose credentials are procedurally generated and therefore not reachable through SSH.

The `countThenWait` pattern is used throughout: count existing matches before an action, then wait for a new match to appear. This avoids matching stale output from earlier commands.
