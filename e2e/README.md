# E2E Tests

End-to-end tests using [Playwright](https://playwright.dev/) that verify the full JSHACK.ME experience in a real browser (Chromium).

## Files

| File                          | Description                                                         |
| ----------------------------- | ------------------------------------------------------------------- |
| `helpers.ts`                  | Shared constants, selectors, and helper functions used by all tests |
| `ctf-playthrough.spec.ts`     | Full 16-flag CTF playthrough (WiFi gate, SSH, FTP, NC, nano, node)  |
| `mission-playthrough.spec.ts` | Mission system tests (SSH/FTP/NC entry variants, abort/re-accept)   |

## Running

```bash
# Run all E2E tests (starts dev server automatically)
npm run test:e2e

# Run a specific test file
npx playwright test e2e/ctf-playthrough.spec.ts
npx playwright test e2e/mission-playthrough.spec.ts
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
- **Session** — `suTo`, `sshTo`, `ftpConnect`, `ncConnect`, `exitSession`, `ftpQuit`
- **Commands** — `runAndExpect`, `writeInNano`, `saveAndExitNano`, `expectFlag`
- **Mission** — `completeWifiGate`, `acceptMission`, `expectMissionComplete`

The `countThenWait` pattern is used throughout: count existing matches before an action, then wait for a new match to appear. This avoids matching stale output from earlier commands.
