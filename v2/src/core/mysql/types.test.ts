import { describe, expect, it } from 'vitest';
import { parseMysqlDatabase } from './types';

/**
 * Reading a datadir back is a TRUST BOUNDARY, not an internal hand-off. The file
 * lives at `/var/lib/mysql/data.json` on a box a player can stand on as root, and
 * anything a player can reach they can `nano`. So the claims here are the ones the
 * rest of the game relies on: what comes back is either a database whose shape is
 * guaranteed, or nothing — and "nothing" is the same answer for every way the file
 * can be wrong, because from the daemon's side they are one condition.
 */

/** A datadir as the generator writes one, with every column type a template can emit
 *  present — a type the schema stops accepting is a table no box could serve. */
const wellFormedDatadir = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    name: 'app_prod',
    tables: {
      orders: {
        columns: [
          { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
          { name: 'sku', type: 'VARCHAR', nullable: false, key: 'UNI' },
          { name: 'notes', type: 'TEXT', nullable: true },
          { name: 'created_at', type: 'DATETIME', nullable: true },
          { name: 'shipped', type: 'BOOLEAN', nullable: false, defaultValue: '1' },
          { name: 'amount', type: 'FLOAT', nullable: false },
        ],
        rows: [
          { id: 1, sku: 'SRV-001', notes: null, created_at: '2024-03-04 09:12:00', shipped: 1, amount: 99.99 },
        ],
      },
    },
    credentials: [
      { username: 'root', passwordHash: 'd41d8cd98f00b204e9800998ecf8427e', userType: 'root' },
      { username: 'app_rw', passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99', userType: 'user' },
    ],
    ...overrides,
  });

describe('reading a datadir back', () => {
  it('returns the database a well-formed datadir describes, cell for cell', () => {
    const parsed = parseMysqlDatabase(wellFormedDatadir());

    expect(parsed?.name).toBe('app_prod');
    expect(parsed?.tables['orders']?.columns.map((column) => column.type)).toEqual([
      'INT',
      'VARCHAR',
      'TEXT',
      'DATETIME',
      'BOOLEAN',
      'FLOAT',
    ]);
    expect(parsed?.credentials.map((credential) => credential.userType)).toEqual(['root', 'user']);
  });

  it('keeps a null cell, which is what an empty nullable column really reads back as', () => {
    // `null` is a VALUE here, not a missing field: the formatter prints NULL for it,
    // and a schema that dropped it would turn an empty cell into a missing column.
    const parsed = parseMysqlDatabase(wellFormedDatadir());

    expect(parsed?.tables['orders']?.rows[0]?.['notes']).toBeNull();
  });

  it('refuses a column that does not say what it is', () => {
    // The hole this closes. Legacy cast the file with `as MysqlDatabase`, so a
    // hand-edited column would have reached the formatter as a well-typed lie.
    const parsed = parseMysqlDatabase(
      wellFormedDatadir({ tables: { orders: { columns: [{}], rows: [] } } }),
    );

    expect(parsed).toBeNull();
  });

  it('refuses a column typed as something no table in this world can hold', () => {
    const parsed = parseMysqlDatabase(
      wellFormedDatadir({
        tables: { orders: { columns: [{ name: 'blob', type: 'BLOB', nullable: true }], rows: [] } },
      }),
    );

    expect(parsed).toBeNull();
  });

  it('refuses a credential claiming a tier the database does not grant', () => {
    // The tier decides which statements the account may run, so an invented one is
    // the edit with the most to gain from being believed.
    const parsed = parseMysqlDatabase(
      wellFormedDatadir({
        credentials: [{ username: 'root', passwordHash: 'x', userType: 'superuser' }],
      }),
    );

    expect(parsed).toBeNull();
  });

  it('refuses a row cell holding something no column type can print', () => {
    const parsed = parseMysqlDatabase(
      wellFormedDatadir({
        tables: { orders: { columns: [], rows: [{ id: { nested: true } }] } },
      }),
    );

    expect(parsed).toBeNull();
  });

  it('answers the same nothing for a file that is not JSON at all', () => {
    // Truncation, a half-written file and deliberate garbage are one condition:
    // there is no database here. Telling them apart would only tell a player how
    // their tampering failed.
    expect(parseMysqlDatabase('{ "name": "app_prod"')).toBeNull();
    expect(parseMysqlDatabase('')).toBeNull();
    expect(parseMysqlDatabase('not json at all')).toBeNull();
  });

  it('answers the same nothing for JSON that describes something else', () => {
    expect(parseMysqlDatabase('42')).toBeNull();
    expect(parseMysqlDatabase('null')).toBeNull();
    expect(parseMysqlDatabase('[]')).toBeNull();
    expect(parseMysqlDatabase(JSON.stringify({ name: 'app_prod' }))).toBeNull();
  });
});
