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

// Tamper/fix scenario pools — each defines a table, column, and old→new value pair.
// For db_tamper: database starts with oldValue, player must change to newValue.
// For db_fix: database starts with oldValue (corrupted), player must restore to newValue.
type TamperScenario = {
  readonly table: string;
  readonly column: string;
  readonly rowFilter: { readonly column: string; readonly value: string };
  readonly oldValue: string;
  readonly newValue: string;
  readonly description: string;
};

const tamperScenarios: readonly TamperScenario[] = [
  {
    table: 'users',
    column: 'role',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: 'admin',
    newValue: 'user',
    description: 'admin role',
  },
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'maintenance_mode' },
    oldValue: 'false',
    newValue: 'true',
    description: 'maintenance mode',
  },
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'debug_mode' },
    oldValue: 'false',
    newValue: 'true',
    description: 'debug mode',
  },
];

// Fix scenarios — reversed direction from tamper. Database starts corrupted, player restores.
const fixScenarios: readonly TamperScenario[] = [
  {
    table: 'users',
    column: 'role',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: 'user',
    newValue: 'admin',
    description: 'admin role',
  },
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'maintenance_mode' },
    oldValue: 'true',
    newValue: 'false',
    description: 'maintenance mode',
  },
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'debug_mode' },
    oldValue: 'true',
    newValue: 'false',
    description: 'debug mode',
  },
];

// Tables eligible for sabotage (player must DROP or DELETE all rows)
const sabotageTargetTables = ['sessions', 'api_keys', 'audit_log'] as const;

export type DbEnrichment = {
  readonly database: MysqlDatabase;
  readonly targetTable: string;
  readonly expectedProof?: string;
  readonly tamperColumn?: string;
  readonly tamperOldValue?: string;
  readonly tamperNewValue?: string;
};

// Generates an ACCESS-KEY and injects it into the api_keys table.
// Ensures the api_keys table exists in the database.
export const enrichForDbExfiltrate = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const accessKey = `ACCESS-${prng.nextInt(1000, 9999)}-${prng.nextInt(1000, 9999)}-${prng.nextInt(1000, 9999)}`;

  const existingTable = db.tables['api_keys'];
  const table: MysqlTable = existingTable ?? {
    columns: apiKeysTable.columns,
    rows: [],
  };

  const nextId = table.rows.length + 1;
  const newRow: MysqlRow = {
    id: nextId,
    user_id: 1,
    key_value: accessKey,
    active: 1,
  };
  const updatedTable: MysqlTable = { ...table, rows: [...table.rows, newRow] };

  return {
    database: { ...db, tables: { ...db.tables, api_keys: updatedTable } },
    targetTable: 'api_keys',
    expectedProof: accessKey,
  };
};

// Picks a tamper scenario, ensures the target table exists, and sets the old value.
export const enrichForDbTamper = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const scenario = prng.pick(tamperScenarios);
  const enriched = applyTamperScenario(db, scenario);
  return {
    database: enriched,
    targetTable: scenario.table,
    tamperColumn: scenario.column,
    tamperOldValue: scenario.oldValue,
    tamperNewValue: scenario.newValue,
  };
};

// Picks a fix scenario (corrupted → correct), ensures the target table exists.
export const enrichForDbFix = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const scenario = prng.pick(fixScenarios);
  const enriched = applyTamperScenario(db, scenario);
  return {
    database: enriched,
    targetTable: scenario.table,
    tamperColumn: scenario.column,
    tamperOldValue: scenario.oldValue,
    tamperNewValue: scenario.newValue,
  };
};

// Ensures a sabotage target table exists in the database.
export const enrichForDbSabotage = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const targetName = prng.pick(sabotageTargetTables);

  // Ensure the target table exists
  if (!db.tables[targetName]) {
    const template = allTableTemplates.find((t) => t.name === targetName);
    if (template) {
      const rows = template.rowGenerator(prng, ['admin', 'user']);
      const enriched: MysqlDatabase = {
        ...db,
        tables: { ...db.tables, [targetName]: { columns: [...template.columns], rows: [...rows] } },
      };
      return { database: enriched, targetTable: targetName };
    }
  }

  return { database: db, targetTable: targetName };
};

// Applies a tamper/fix scenario to the database, ensuring the target table
// exists and the target row has the old value set.
const applyTamperScenario = (db: MysqlDatabase, scenario: TamperScenario): MysqlDatabase => {
  const table = db.tables[scenario.table];
  if (!table) return db;

  // Resolve __ADMIN__ placeholder to actual first admin username
  const filterValue =
    scenario.rowFilter.value === '__ADMIN__'
      ? ((table.rows.find((r) => r['role'] === 'admin')?.[scenario.rowFilter.column] as
          | string
          | undefined) ?? 'admin')
      : scenario.rowFilter.value;

  const updatedRows = table.rows.map((row) => {
    const key = Object.keys(row).find(
      (k) => k.toLowerCase() === scenario.rowFilter.column.toLowerCase(),
    );
    if (!key || String(row[key]) !== filterValue) return row;
    return { ...row, [scenario.column]: scenario.oldValue };
  });

  return {
    ...db,
    tables: { ...db.tables, [scenario.table]: { ...table, rows: updatedRows } },
  };
};

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
