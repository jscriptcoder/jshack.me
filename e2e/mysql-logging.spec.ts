import { expect, test } from '@playwright/test';
import {
  ERROR,
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
// database target: data-node at 10.43.17.7 with port 3306 open. MySQL
// credentials live in /var/lib/mysql/data.json on the target, separate from
// /etc/passwd; we cracked `root` → `j0urn4l!` from the MISSION_PASSWORDS pool
// for this seed.
// ---------------------------------------------------------------------------

const SEED = 'mysql1';
const WIFI = { essid: 'GLOBEX-NET', bssid: '8E:2F:0F:0E:B5:63' };
const ROOT_PASSWORD = 'testpass';
const TARGET_HOST = '10.43.17.7'; // data-node (database role)
const MYSQL_USER = 'root';
const MYSQL_PASSWORD = 'j0urn4l!';

const loadGame = (): Parameters<typeof loadSavedGame>[1] => ({
  gameState: {
    seed: SEED,
    workstationName: 'test-ws',
    username: 'tester',
    rootPassword: ROOT_PASSWORD,
  },
  wifi: WIFI,
});

const installMysqlClient = async (page: Parameters<typeof suTo>[0]): Promise<void> => {
  await suTo(page, 'root', ROOT_PASSWORD);
  await runAndExpect(page, 'apt install mysql', 'Setting up mysql', 30_000);
};

// ---------------------------------------------------------------------------
// mysql.log — connect success
// ---------------------------------------------------------------------------
// Verifies that `mysql <host> <user> <password>` fires the createMysqlAuthHandler
// callback with success=true, producing a `Connect user@sourceIp on db` line
// in /var/log/mysql.log on the target.
// ---------------------------------------------------------------------------

test('mysql login writes a Connect entry to the target /var/log/mysql.log', async ({ page }) => {
  await loadSavedGame(page, loadGame());
  await installMysqlClient(page);

  await runAndExpect(
    page,
    `mysql ${TARGET_HOST} ${MYSQL_USER} ${MYSQL_PASSWORD}`,
    'Welcome to the MySQL monitor',
    30_000,
  );

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/mysql.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain('Connect');
  expect(logContent).toContain(`${MYSQL_USER}@`);
});

// ---------------------------------------------------------------------------
// mysql.log — auth failure
// ---------------------------------------------------------------------------
// Rejected MySQL auth still hits the handler with success=false, producing an
// `Access denied for user` line in mysql.log.
// ---------------------------------------------------------------------------

test('mysql with a wrong password writes an Access denied entry to the target /var/log/mysql.log', async ({
  page,
}) => {
  await loadSavedGame(page, loadGame());
  await installMysqlClient(page);

  const denied = page.locator(ERROR, { hasText: 'ERROR 1045' });
  await countThenWait(
    denied,
    () => typeCommand(page, `mysql ${TARGET_HOST} ${MYSQL_USER} not-the-password`),
    30_000,
  );

  const logContent = await readMachinePatch(page, TARGET_HOST, '/var/log/mysql.log');
  expect(logContent).not.toBeNull();
  expect(logContent).toContain(`Access denied for user '${MYSQL_USER}'`);
});
