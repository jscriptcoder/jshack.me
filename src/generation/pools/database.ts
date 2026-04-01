import type { Prng } from '../prng';
import type { MysqlDatabase, MysqlTable, MysqlColumn, MysqlRow } from '../../commands/mysql/types';

type TableTemplate = {
  readonly name: string;
  readonly columns: readonly MysqlColumn[];
  readonly rowGenerator: (prng: Prng, users: readonly string[]) => readonly MysqlRow[];
};

const usersTable: TableTemplate = {
  name: 'users',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'username', type: 'VARCHAR', nullable: false, key: 'UNI' },
    { name: 'email', type: 'VARCHAR', nullable: false },
    { name: 'role', type: 'VARCHAR', nullable: true, defaultValue: 'user' },
    { name: 'created_at', type: 'DATETIME', nullable: true },
  ],
  rowGenerator: (prng, users) => {
    const domains = ['company.local', 'corp.internal', 'acme.local'];
    const domain = prng.pick(domains);
    return users.map((username, i) => ({
      id: i + 1,
      username,
      email: `${username}@${domain}`,
      role: i === 0 ? 'admin' : 'user',
      created_at: `2024-0${prng.nextInt(1, 9)}-${prng.nextInt(10, 28)} ${prng.nextInt(8, 18).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:00`,
    }));
  },
};

const sessionsTable: TableTemplate = {
  name: 'sessions',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'user_id', type: 'INT', nullable: false },
    { name: 'token', type: 'VARCHAR', nullable: false },
    { name: 'expires_at', type: 'DATETIME', nullable: true },
  ],
  rowGenerator: (prng, users) =>
    users.slice(0, prng.nextInt(1, users.length)).map((_, i) => ({
      id: i + 1,
      user_id: i + 1,
      token: Array.from({ length: 32 }, () => prng.pick('abcdef0123456789'.split(''))).join(''),
      expires_at: `2025-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng.nextInt(1, 28).toString().padStart(2, '0')} 23:59:59`,
    })),
};

const apiKeysTable: TableTemplate = {
  name: 'api_keys',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'user_id', type: 'INT', nullable: false },
    { name: 'key_value', type: 'VARCHAR', nullable: false },
    { name: 'active', type: 'BOOLEAN', nullable: false, defaultValue: '1' },
  ],
  rowGenerator: (prng, users) =>
    users.slice(0, prng.nextInt(1, users.length)).map((_, i) => ({
      id: i + 1,
      user_id: i + 1,
      key_value: `ak_${Array.from({ length: 24 }, () => prng.pick('abcdef0123456789'.split(''))).join('')}`,
      active: prng.next() > 0.3 ? 1 : 0,
    })),
};

const configTable: TableTemplate = {
  name: 'config',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'key', type: 'VARCHAR', nullable: false, key: 'UNI' },
    { name: 'value', type: 'TEXT', nullable: true },
  ],
  rowGenerator: (prng) => {
    const entries = [
      { key: 'site_name', value: prng.pick(['AcmeCorp', 'TechVault', 'DataHub', 'NetCore']) },
      { key: 'maintenance_mode', value: prng.pick(['false', 'true']) },
      { key: 'max_upload_mb', value: String(prng.pick([10, 50, 100, 256])) },
      { key: 'debug_mode', value: prng.pick(['false', 'true']) },
      { key: 'smtp_host', value: 'mail.internal' },
    ];
    return entries.map((e, i) => ({ id: i + 1, ...e }));
  },
};

const logsTable: TableTemplate = {
  name: 'audit_log',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'action', type: 'VARCHAR', nullable: false },
    { name: 'user_id', type: 'INT', nullable: true },
    { name: 'timestamp', type: 'DATETIME', nullable: false },
    { name: 'details', type: 'TEXT', nullable: true },
  ],
  rowGenerator: (prng, users) => {
    const actions = ['LOGIN', 'LOGOUT', 'UPDATE_PROFILE', 'CHANGE_PASSWORD', 'API_ACCESS'];
    const count = prng.nextInt(3, 8);
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      action: prng.pick(actions),
      user_id: prng.nextInt(1, users.length),
      timestamp: `2024-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng.nextInt(1, 28).toString().padStart(2, '0')} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}`,
      details: null,
    }));
  },
};

// All available table templates. Generator picks 2-4 of these per database.
const allTableTemplates: readonly TableTemplate[] = [
  usersTable,
  sessionsTable,
  apiKeysTable,
  configTable,
  logsTable,
];

const dbNamePrefixes = ['app', 'web', 'main', 'core', 'portal', 'system'];
const dbNameSuffixes = ['prod', 'db', 'data', 'store', 'live'];

// Generates a MysqlDatabase with deterministic content based on PRNG.
// Users array provides usernames for populating the users table.
export const generateDatabase = (prng: Prng, usernames: readonly string[]): MysqlDatabase => {
  const name = `${prng.pick(dbNamePrefixes)}_${prng.pick(dbNameSuffixes)}`;

  // Always include users table, then pick 1-3 additional tables
  const additionalTemplates = prng.pickN(
    allTableTemplates.filter((t) => t.name !== 'users'),
    prng.nextInt(1, 3),
  );
  const selectedTemplates = [usersTable, ...additionalTemplates];

  const tables: Record<string, MysqlTable> = {};
  for (const template of selectedTemplates) {
    const rows = template.rowGenerator(prng, usernames);
    tables[template.name] = { columns: [...template.columns], rows: [...rows] };
  }

  return { name, tables };
};
