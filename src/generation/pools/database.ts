import type { Prng } from '../prng';
import type { MysqlDatabase, MysqlTable, MysqlColumn, MysqlRow } from '../../commands/mysql/types';

type TableTemplate = {
  readonly name: string;
  readonly columns: readonly MysqlColumn[];
  readonly rowGenerator: (prng: Prng, users: readonly string[]) => readonly MysqlRow[];
};

// --- Table Templates ---

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
      { key: 'registration_open', value: prng.pick(['true', 'false']) },
    ];
    return entries.map((e, i) => ({ id: i + 1, ...e }));
  },
};

const auditLogTable: TableTemplate = {
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

const ordersTable: TableTemplate = {
  name: 'orders',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'customer', type: 'VARCHAR', nullable: false },
    { name: 'product', type: 'VARCHAR', nullable: false },
    { name: 'amount', type: 'FLOAT', nullable: false },
    { name: 'status', type: 'VARCHAR', nullable: false, defaultValue: 'pending' },
    { name: 'created_at', type: 'DATETIME', nullable: true },
  ],
  rowGenerator: (prng) => {
    const customers = ['Acme Ltd', 'TechStart Inc', 'Global Freight', 'HealthFirst', 'EduCore'];
    const products = ['Server License', 'Cloud Plan', 'Support Tier', 'API Access', 'Data Package'];
    const statuses = ['pending', 'shipped', 'delivered', 'cancelled'];
    const count = prng.nextInt(3, 7);
    return Array.from({ length: count }, (_, i) => ({
      id: 1000 + i,
      customer: prng.pick(customers),
      product: prng.pick(products),
      amount: prng.nextInt(50, 5000) + 0.99,
      status: prng.pick(statuses),
      created_at: `2024-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng.nextInt(1, 28).toString().padStart(2, '0')} ${prng.nextInt(8, 18).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:00`,
    }));
  },
};

const employeesTable: TableTemplate = {
  name: 'employees',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'name', type: 'VARCHAR', nullable: false },
    { name: 'department', type: 'VARCHAR', nullable: false },
    { name: 'salary', type: 'FLOAT', nullable: false },
    { name: 'clearance', type: 'VARCHAR', nullable: false, defaultValue: 'standard' },
    { name: 'active', type: 'BOOLEAN', nullable: false, defaultValue: '1' },
  ],
  rowGenerator: (prng) => {
    const names = [
      'J. Mitchell',
      'R. Vasquez',
      'S. Okonkwo',
      'L. Chen',
      'M. Petrov',
      'A. Johansson',
    ];
    const departments = ['Engineering', 'Finance', 'HR', 'Operations', 'Security', 'Legal'];
    const clearances = ['standard', 'elevated', 'restricted', 'top-secret'];
    const count = prng.nextInt(3, 6);
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      name: prng.pick(names),
      department: prng.pick(departments),
      salary: prng.nextInt(45, 150) * 1000,
      clearance: i === 0 ? 'top-secret' : prng.pick(clearances),
      active: prng.next() > 0.1 ? 1 : 0,
    }));
  },
};

const inventoryTable: TableTemplate = {
  name: 'inventory',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'sku', type: 'VARCHAR', nullable: false, key: 'UNI' },
    { name: 'name', type: 'VARCHAR', nullable: false },
    { name: 'quantity', type: 'INT', nullable: false },
    { name: 'price', type: 'FLOAT', nullable: false },
    { name: 'warehouse', type: 'VARCHAR', nullable: true },
  ],
  rowGenerator: (prng) => {
    const items = [
      { sku: 'SRV-001', name: 'Rack Server 2U' },
      { sku: 'SWT-042', name: 'Managed Switch 48p' },
      { sku: 'FW-100', name: 'Enterprise Firewall' },
      { sku: 'UPS-220', name: 'UPS Battery Backup' },
      { sku: 'CAB-500', name: 'Cat6 Cable Box 1000ft' },
      { sku: 'SSD-2TB', name: 'NVMe SSD 2TB' },
    ];
    const warehouses = ['WH-East', 'WH-West', 'WH-Central'];
    const selected = prng.pickN(items, prng.nextInt(3, items.length));
    return selected.map((item, i) => ({
      id: i + 1,
      sku: item.sku,
      name: item.name,
      quantity: prng.nextInt(0, 500),
      price: prng.nextInt(50, 8000) + 0.99,
      warehouse: prng.pick(warehouses),
    }));
  },
};

const paymentsTable: TableTemplate = {
  name: 'payments',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'order_id', type: 'INT', nullable: false },
    { name: 'method', type: 'VARCHAR', nullable: false },
    { name: 'amount', type: 'FLOAT', nullable: false },
    { name: 'status', type: 'VARCHAR', nullable: false, defaultValue: 'pending' },
    { name: 'processed_at', type: 'DATETIME', nullable: true },
  ],
  rowGenerator: (prng) => {
    const methods = ['credit_card', 'wire_transfer', 'crypto', 'invoice'];
    const statuses = ['pending', 'completed', 'failed', 'refunded'];
    const count = prng.nextInt(3, 6);
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      order_id: 1000 + prng.nextInt(0, 10),
      method: prng.pick(methods),
      amount: prng.nextInt(100, 10000) + 0.99,
      status: prng.pick(statuses),
      processed_at: `2024-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng.nextInt(1, 28).toString().padStart(2, '0')} ${prng.nextInt(0, 23).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:00`,
    }));
  },
};

const ticketsTable: TableTemplate = {
  name: 'tickets',
  columns: [
    { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
    { name: 'subject', type: 'VARCHAR', nullable: false },
    { name: 'priority', type: 'VARCHAR', nullable: false, defaultValue: 'normal' },
    { name: 'status', type: 'VARCHAR', nullable: false, defaultValue: 'open' },
    { name: 'assigned_to', type: 'VARCHAR', nullable: true },
    { name: 'created_at', type: 'DATETIME', nullable: true },
  ],
  rowGenerator: (prng, users) => {
    const subjects = [
      'Login not working',
      'SSL certificate expired',
      'Database backup failed',
      'Disk space critical',
      'API rate limit exceeded',
      'Permission denied on /srv',
      'Cron job not running',
    ];
    const priorities = ['low', 'normal', 'high', 'critical'];
    const statuses = ['open', 'in_progress', 'resolved', 'closed'];
    const count = prng.nextInt(3, 6);
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      subject: prng.pick(subjects),
      priority: prng.pick(priorities),
      status: prng.pick(statuses),
      assigned_to: prng.next() > 0.3 ? prng.pick(users) : null,
      created_at: `2024-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng.nextInt(1, 28).toString().padStart(2, '0')} ${prng.nextInt(8, 18).toString().padStart(2, '0')}:${prng.nextInt(0, 59).toString().padStart(2, '0')}:00`,
    }));
  },
};

// All available table templates. Generator picks 2-4 of these per database.
// users is always included; the rest are randomly selected.
const allTableTemplates: readonly TableTemplate[] = [
  usersTable,
  sessionsTable,
  apiKeysTable,
  configTable,
  auditLogTable,
  ordersTable,
  employeesTable,
  inventoryTable,
  paymentsTable,
  ticketsTable,
];

const dbNamePrefixes = [
  'app',
  'web',
  'main',
  'core',
  'portal',
  'system',
  'internal',
  'ops',
  'hub',
  'platform',
];
const dbNameSuffixes = ['prod', 'db', 'data', 'store', 'live', 'primary', 'master'];

// --- Tamper / Fix Scenario Pools ---

// Each defines a table, column, and old→new value pair.
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
  // users table
  {
    table: 'users',
    column: 'role',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: 'admin',
    newValue: 'user',
    description: 'admin role',
  },
  {
    table: 'users',
    column: 'email',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: '__ADMIN_EMAIL__',
    newValue: 'redirected@external.com',
    description: 'admin email',
  },
  // config table
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
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'registration_open' },
    oldValue: 'false',
    newValue: 'true',
    description: 'registration setting',
  },
  // orders table
  {
    table: 'orders',
    column: 'status',
    rowFilter: { column: 'id', value: '1000' },
    oldValue: 'pending',
    newValue: 'delivered',
    description: 'order status',
  },
  {
    table: 'orders',
    column: 'amount',
    rowFilter: { column: 'id', value: '1000' },
    oldValue: '__ORIGINAL_AMOUNT__',
    newValue: '0.01',
    description: 'order amount',
  },
  // employees table
  {
    table: 'employees',
    column: 'salary',
    rowFilter: { column: 'id', value: '1' },
    oldValue: '__ORIGINAL_SALARY__',
    newValue: '999999',
    description: 'employee salary',
  },
  {
    table: 'employees',
    column: 'clearance',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'top-secret',
    newValue: 'standard',
    description: 'security clearance',
  },
  // payments table
  {
    table: 'payments',
    column: 'status',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'completed',
    newValue: 'refunded',
    description: 'payment status',
  },
  // tickets table
  {
    table: 'tickets',
    column: 'priority',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'critical',
    newValue: 'low',
    description: 'ticket priority',
  },
];

// Fix scenarios — reversed direction from tamper. Database starts corrupted, player restores.
const fixScenarios: readonly TamperScenario[] = [
  // users table
  {
    table: 'users',
    column: 'role',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: 'user',
    newValue: 'admin',
    description: 'admin role',
  },
  {
    table: 'users',
    column: 'email',
    rowFilter: { column: 'username', value: '__ADMIN__' },
    oldValue: 'corrupted@invalid',
    newValue: '__ADMIN_EMAIL__',
    description: 'admin email',
  },
  // config table
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
  {
    table: 'config',
    column: 'value',
    rowFilter: { column: 'key', value: 'registration_open' },
    oldValue: 'true',
    newValue: 'false',
    description: 'registration setting',
  },
  // orders table
  {
    table: 'orders',
    column: 'status',
    rowFilter: { column: 'id', value: '1000' },
    oldValue: 'cancelled',
    newValue: 'pending',
    description: 'order status',
  },
  // employees table
  {
    table: 'employees',
    column: 'clearance',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'standard',
    newValue: 'top-secret',
    description: 'security clearance',
  },
  {
    table: 'employees',
    column: 'active',
    rowFilter: { column: 'id', value: '1' },
    oldValue: '0',
    newValue: '1',
    description: 'employee active status',
  },
  // payments table
  {
    table: 'payments',
    column: 'status',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'failed',
    newValue: 'completed',
    description: 'payment status',
  },
  // tickets table
  {
    table: 'tickets',
    column: 'priority',
    rowFilter: { column: 'id', value: '1' },
    oldValue: 'low',
    newValue: 'critical',
    description: 'ticket priority',
  },
];

// Tables eligible for sabotage (player must DROP or DELETE all rows)
const sabotageTargetTables = [
  'sessions',
  'api_keys',
  'audit_log',
  'orders',
  'employees',
  'inventory',
  'payments',
  'tickets',
] as const;

// --- Enrichment Functions ---

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
// Filters to scenarios whose table exists in the database for relevance.
export const enrichForDbTamper = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const applicable = tamperScenarios.filter((s) => db.tables[s.table]);
  const scenario = applicable.length > 0 ? prng.pick(applicable) : prng.pick(tamperScenarios);
  const enriched = applyTamperScenario(db, scenario);
  return {
    database: enriched.db,
    targetTable: scenario.table,
    tamperColumn: scenario.column,
    tamperOldValue: enriched.resolvedOldValue,
    tamperNewValue: enriched.resolvedNewValue,
  };
};

// Picks a fix scenario (corrupted → correct), ensures the target table exists.
// Filters to scenarios whose table exists in the database for relevance.
export const enrichForDbFix = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const applicable = fixScenarios.filter((s) => db.tables[s.table]);
  const scenario = applicable.length > 0 ? prng.pick(applicable) : prng.pick(fixScenarios);
  const enriched = applyTamperScenario(db, scenario);
  return {
    database: enriched.db,
    targetTable: scenario.table,
    tamperColumn: scenario.column,
    tamperOldValue: enriched.resolvedOldValue,
    tamperNewValue: enriched.resolvedNewValue,
  };
};

// Ensures a sabotage target table exists in the database.
// Prefers tables that already exist for relevance.
export const enrichForDbSabotage = (prng: Prng, db: MysqlDatabase): DbEnrichment => {
  const existing = sabotageTargetTables.filter((t) => db.tables[t]);
  const targetName =
    existing.length > 0
      ? prng.pick(existing)
      : prng.pick(sabotageTargetTables as unknown as readonly string[]);

  // Ensure the target table exists
  if (!db.tables[targetName]) {
    const template = allTableTemplates.find((t) => t.name === targetName);
    if (template) {
      const rows = template.rowGenerator(prng, ['admin', 'user']);
      const enriched: MysqlDatabase = {
        ...db,
        tables: {
          ...db.tables,
          [targetName]: { columns: [...template.columns], rows: [...rows] },
        },
      };
      return { database: enriched, targetTable: targetName };
    }
  }

  return { database: db, targetTable: targetName };
};

// Applies a tamper/fix scenario to the database, ensuring the target table
// exists and the target row has the old value set. Resolves dynamic placeholders
// like __ADMIN__ (first admin username), __ADMIN_EMAIL__ (admin's email),
// __ORIGINAL_SALARY__ (current salary), __ORIGINAL_AMOUNT__ (current amount).
const applyTamperScenario = (
  db: MysqlDatabase,
  scenario: TamperScenario,
): {
  readonly db: MysqlDatabase;
  readonly resolvedOldValue: string;
  readonly resolvedNewValue: string;
} => {
  const table = db.tables[scenario.table];
  if (!table)
    return { db, resolvedOldValue: scenario.oldValue, resolvedNewValue: scenario.newValue };

  // Resolve __ADMIN__ placeholder to actual first admin username
  const filterValue =
    scenario.rowFilter.value === '__ADMIN__'
      ? ((table.rows.find((r) => r['role'] === 'admin')?.[scenario.rowFilter.column] as
          | string
          | undefined) ?? 'admin')
      : scenario.rowFilter.value;

  // Resolve dynamic value placeholders from existing data
  const targetRow = table.rows.find((row) => {
    const key = Object.keys(row).find(
      (k) => k.toLowerCase() === scenario.rowFilter.column.toLowerCase(),
    );
    return key && String(row[key]) === filterValue;
  });

  const resolveValue = (value: string): string => {
    if (value === '__ADMIN_EMAIL__' && targetRow) return String(targetRow['email'] ?? value);
    if (value === '__ORIGINAL_SALARY__' && targetRow) return String(targetRow['salary'] ?? value);
    if (value === '__ORIGINAL_AMOUNT__' && targetRow) return String(targetRow['amount'] ?? value);
    return value;
  };

  const resolvedOldValue = resolveValue(scenario.oldValue);
  const resolvedNewValue = resolveValue(scenario.newValue);

  const updatedRows = table.rows.map((row) => {
    const key = Object.keys(row).find(
      (k) => k.toLowerCase() === scenario.rowFilter.column.toLowerCase(),
    );
    if (!key || String(row[key]) !== filterValue) return row;
    return { ...row, [scenario.column]: resolvedOldValue };
  });

  return {
    db: {
      ...db,
      tables: { ...db.tables, [scenario.table]: { ...table, rows: updatedRows } },
    },
    resolvedOldValue,
    resolvedNewValue,
  };
};

// --- Database Generator ---

// Generates a MysqlDatabase with deterministic content based on PRNG.
// Users array provides usernames for populating the users table.
export const generateDatabase = (prng: Prng, usernames: readonly string[]): MysqlDatabase => {
  const name = `${prng.pick(dbNamePrefixes)}_${prng.pick(dbNameSuffixes)}`;

  // Always include users table, then pick 2-4 additional tables
  const additionalTemplates = prng.pickN(
    allTableTemplates.filter((t) => t.name !== 'users'),
    prng.nextInt(2, 4),
  );
  const selectedTemplates = [usersTable, ...additionalTemplates];

  const tables: Record<string, MysqlTable> = {};
  for (const template of selectedTemplates) {
    const rows = template.rowGenerator(prng, usernames);
    tables[template.name] = { columns: [...template.columns], rows: [...rows] };
  }

  return { name, tables };
};
