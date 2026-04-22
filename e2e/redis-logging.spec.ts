import { expect, test } from '@playwright/test';
import {
  RESULT,
  TYPE_DELAY,
  countThenWait,
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
// Shared setup
// ---------------------------------------------------------------------------
// Pinning seed `mysql1` + WiFi index 2 (GLOBEX-NET) gives a deterministic
// database target: data-node at 10.43.17.7 with port 6379 open. Redis on
// this seed has no `requirepass` in /etc/redis/redis.conf, so connect works
// without auth and AUTH is only exercised in the misconfigured branch.
// Unlike the MySQL spec, the target log file is /var/log/redis.log — written
// by the createRedisConnectHandler + createRedisAuthHandler factories added
// alongside these tests.
// ---------------------------------------------------------------------------

const SEED = 'mysql1';
const WIFI = { essid: 'GLOBEX-NET', bssid: '8E:2F:0F:0E:B5:63' };
const ROOT_PASSWORD = 'testpass';
const TARGET_HOST = '10.43.17.7';

const loadGame = (): Parameters<typeof loadSavedGame>[1] => ({
  gameState: {
    seed: SEED,
    workstationName: 'test-ws',
    username: 'tester',
    rootPassword: ROOT_PASSWORD,
  },
  wifi: WIFI,
});

const installRedisClient = async (page: Parameters<typeof suTo>[0]): Promise<void> => {
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install redis-tools', 'Setting up redis-tools', 30_000);
};

// ---------------------------------------------------------------------------
// redis.log — connect
// ---------------------------------------------------------------------------
// Opening a Redis session writes a single `Client connected from …` line to
// /var/log/redis.log on the target, regardless of whether AUTH is required.
// This test exercises the no-requirepass path: data-node's redis.conf has no
// `requirepass`, so the session enters without prompting.
// ---------------------------------------------------------------------------

test('redis connect writes a Client connected entry to the target /var/log/redis.log', async ({
  page,
}) => {
  await loadSavedGame(page, loadGame());
  await installRedisClient(page);

  // Enter redis mode — with no requirepass the prompt just changes; no banner.
  await typeCommand(page, `rediscli ${TARGET_HOST}`);
  // Sanity: issue a trivial command so we know we're inside the redis session.
  // DBSIZE returns a numeric key count — a zero-config command to prove we're
  // inside the redis session.
  await runAndExpect(page, 'DBSIZE', '(integer)');

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/redis.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('Client connected from');
});

// ---------------------------------------------------------------------------
// redis.log — AUTH failure
// ---------------------------------------------------------------------------
// Issuing `AUTH <wrong>` at the redis prompt must write an
// `authentication failed` line even when the server has no `requirepass` set
// (real Redis rejects AUTH in that state with ERR). Confirms the AUTH-command
// branch in Terminal.tsx fires onRedisAuthHandler(false, …) via the extended
// RedisExecuteResult.
// ---------------------------------------------------------------------------

test('AUTH with a wrong password writes an authentication-failed entry to the target /var/log/redis.log', async ({
  page,
}) => {
  await loadSavedGame(page, loadGame());
  await installRedisClient(page);

  await typeCommand(page, `rediscli ${TARGET_HOST}`);
  // DBSIZE returns a numeric key count — a zero-config command to prove we're
  // inside the redis session.
  await runAndExpect(page, 'DBSIZE', '(integer)');

  // With no requirepass set, any AUTH is rejected — we just need the
  // client-side AUTH result to fire the failure branch.
  const authErr = page.locator(RESULT, { hasText: 'ERR' });
  await countThenWait(authErr, () => typeCommand(page, 'AUTH not-the-password'), 10_000);

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/redis.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('authentication failed');
});
