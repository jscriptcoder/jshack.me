/**
 * What is IN a generated database — the table shapes a box can hold and the rows that
 * fill them.
 *
 * Ported from legacy's pool, with its mission half left behind: legacy's tables existed
 * to carry objectives (an `ACCESS-` key to exfiltrate, a row to tamper with and a
 * scenario to put it back), and this world has no missions to carry. What is left is
 * the part that was always doing the other job — making a box that answers on 3306 read
 * like a box somebody actually runs.
 *
 * Every row here is INERT. No key opens anything, no token authenticates anything, and
 * no password in a table is a password anywhere in the world. A plaintext a player has
 * not earned through the wordlist is a progression the wordlist no longer gates, and
 * the effect that hands one over deliberately belongs to a later epic.
 *
 * Content may not claim what the game cannot honour: nothing here names a host that
 * resolves nowhere, a path no box serves, or a mechanic that does not exist. Legacy's
 * `smtp_host = mail.internal` row is dropped for exactly that reason — there is no
 * name resolution in this world yet for it to be true in.
 */

import type { Prng } from '../prng';
import type { MysqlColumn, MysqlRow } from '../../mysql/types';

/** One table a database can hold: its shape, and how its rows are filled for a
 *  particular box. `hostname` is the box the database belongs to, and `people` are the
 *  accounts it should look populated by — the box's own user among them, which is what
 *  makes this THIS box's database rather than a database. */
export type TableTemplate = {
  readonly name: string;
  readonly columns: readonly MysqlColumn[];
  readonly rowGenerator: (
    prng: Prng,
    people: readonly string[],
    hostname: string,
  ) => readonly MysqlRow[];
};

const HEX = 'abcdef0123456789'.split('');

const hex = (prng: Prng, length: number): string =>
  Array.from({ length }, () => prng.pick(HEX)).join('');

const timestamp = (prng: Prng, year: number, fromHour: number, toHour: number): string => {
  const month = prng.nextInt(1, 12).toString().padStart(2, '0');
  const day = prng.nextInt(1, 28).toString().padStart(2, '0');
  const hour = prng.nextInt(fromHour, toHour).toString().padStart(2, '0');
  const minute = prng.nextInt(0, 59).toString().padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:00`;
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
  rowGenerator: (prng, people) => {
    const domain = prng.pick(['company.local', 'corp.internal', 'acme.local']);
    return people.map((username, index) => ({
      id: index + 1,
      username,
      email: `${username}@${domain}`,
      role: index === 0 ? 'admin' : 'user',
      created_at: timestamp(prng, 2024, 8, 18),
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
  rowGenerator: (prng, people) =>
    people.slice(0, prng.nextInt(1, people.length)).map((_, index) => ({
      id: index + 1,
      user_id: index + 1,
      token: hex(prng, 32),
      expires_at: `2025-${prng.nextInt(1, 12).toString().padStart(2, '0')}-${prng
        .nextInt(1, 28)
        .toString()
        .padStart(2, '0')} 23:59:59`,
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
  rowGenerator: (prng, people) =>
    people.slice(0, prng.nextInt(1, people.length)).map((_, index) => ({
      id: index + 1,
      user_id: index + 1,
      key_value: `ak_${hex(prng, 24)}`,
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
  rowGenerator: (prng, _people, hostname) =>
    [
      // The box's own name, not a company's. Every page this world serves is titled
      // with the hostname of the box serving it, so a site name drawn from a pool of
      // invented companies would contradict the one other thing on the box that says
      // what it is — and a player who opens both doors is the player most likely to
      // read both.
      { key: 'site_name', value: hostname },
      { key: 'maintenance_mode', value: prng.pick(['false', 'true']) },
      { key: 'max_upload_mb', value: String(prng.pick([10, 50, 100, 256])) },
      { key: 'debug_mode', value: prng.pick(['false', 'true']) },
      { key: 'registration_open', value: prng.pick(['true', 'false']) },
    ].map((entry, index) => ({ id: index + 1, ...entry })),
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
  rowGenerator: (prng, people) => {
    const actions = ['LOGIN', 'LOGOUT', 'UPDATE_PROFILE', 'CHANGE_PASSWORD', 'API_ACCESS'];
    return Array.from({ length: prng.nextInt(3, 8) }, (_unused, index) => ({
      id: index + 1,
      action: prng.pick(actions),
      user_id: prng.nextInt(1, people.length),
      timestamp: timestamp(prng, 2024, 0, 23),
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
    return Array.from({ length: prng.nextInt(3, 7) }, (_unused, index) => ({
      id: 1000 + index,
      customer: prng.pick(customers),
      product: prng.pick(products),
      amount: prng.nextInt(50, 5000) + 0.99,
      status: prng.pick(statuses),
      created_at: timestamp(prng, 2024, 8, 18),
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
    const names = ['J. Mitchell', 'R. Vasquez', 'S. Okonkwo', 'L. Chen', 'M. Petrov', 'A. Johansson'];
    const departments = ['Engineering', 'Finance', 'HR', 'Operations', 'Security', 'Legal'];
    const clearances = ['standard', 'elevated', 'restricted', 'top-secret'];
    return Array.from({ length: prng.nextInt(3, 6) }, (_unused, index) => ({
      id: index + 1,
      name: prng.pick(names),
      department: prng.pick(departments),
      salary: prng.nextInt(45, 150) * 1000,
      clearance: index === 0 ? 'top-secret' : prng.pick(clearances),
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
    return prng.pickN(items, prng.nextInt(3, items.length)).map((item, index) => ({
      id: index + 1,
      sku: item.sku,
      name: item.name,
      quantity: prng.nextInt(0, 500),
      price: prng.nextInt(50, 8000) + 0.99,
      warehouse: prng.pick(warehouses),
    }));
  },
};

/** `users` is not here: every database has one, so it is never drawn. */
export const DRAWN_TABLE_TEMPLATES: readonly TableTemplate[] = [
  sessionsTable,
  apiKeysTable,
  configTable,
  auditLogTable,
  ordersTable,
  employeesTable,
  inventoryTable,
];

export const USERS_TABLE: TableTemplate = usersTable;

/** The account a database runs its application as — never a system account, which is
 *  the whole point of the door: `/etc/passwd` cannot answer who you are to a database. */
export const MYSQL_USERNAMES: readonly string[] = [
  'app_user',
  'webapp',
  'db_admin',
  'service',
  'api_svc',
  'backup_svc',
  'data_admin',
  'app_rw',
];

export const DB_NAME_PREFIXES: readonly string[] = [
  'app',
  'web',
  'main',
  'core',
  'portal',
  'system',
  'internal',
  'ops',
];

export const DB_NAME_SUFFIXES: readonly string[] = [
  'prod',
  'db',
  'data',
  'store',
  'live',
  'primary',
  'master',
];
