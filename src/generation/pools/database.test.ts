import { describe, it, expect } from 'vitest';
import { createPrng } from '../prng';
import {
  generateDatabase,
  enrichForDbExfiltrate,
  enrichForDbTamper,
  enrichForDbFix,
  enrichForDbSabotage,
} from './database';

const makeDb = (seed = 'test-db') => {
  const prng = createPrng(seed);
  return generateDatabase(prng, ['admin', 'jsmith', 'guest']);
};

describe('enrichForDbExfiltrate', () => {
  it('injects an ACCESS-KEY into api_keys table', () => {
    const db = makeDb();
    const prng = createPrng('exfil-seed');
    const result = enrichForDbExfiltrate(prng, db);

    expect(result.targetTable).toBe('api_keys');
    expect(result.expectedProof).toMatch(/^ACCESS-\d{4}-\d{4}-\d{4}$/);

    const table = result.database.tables['api_keys'];
    expect(table).toBeDefined();
    const keyRow = table.rows.find((r) => r.key_value === result.expectedProof);
    expect(keyRow).toBeDefined();
  });

  it('creates api_keys table if it does not exist', () => {
    const db = makeDb();
    const stripped = { ...db, tables: { users: db.tables['users'] } };
    const prng = createPrng('exfil-no-table');
    const result = enrichForDbExfiltrate(prng, stripped);

    expect(result.database.tables['api_keys']).toBeDefined();
    expect(result.database.tables['api_keys'].rows.length).toBeGreaterThan(0);
  });
});

describe('enrichForDbTamper', () => {
  it('returns tamper details with old and new values', () => {
    const db = makeDb('tamper-db');
    const prng = createPrng('tamper-seed');
    const result = enrichForDbTamper(prng, db);

    expect(result.targetTable).toBeDefined();
    expect(result.tamperColumn).toBeDefined();
    expect(result.tamperOldValue).toBeDefined();
    expect(result.tamperNewValue).toBeDefined();
    expect(result.tamperOldValue).not.toBe(result.tamperNewValue);
  });

  it('sets the old value in the database', () => {
    const db = makeDb('tamper-db-2');
    const prng = createPrng('tamper-seed-2');
    const result = enrichForDbTamper(prng, db);

    const table = result.database.tables[result.targetTable];
    expect(table).toBeDefined();
    const hasOldValue = table.rows.some(
      (r) => String(r[result.tamperColumn!]) === result.tamperOldValue,
    );
    expect(hasOldValue).toBe(true);
  });
});

describe('enrichForDbFix', () => {
  it('returns fix details with corrupted and correct values', () => {
    const db = makeDb('fix-db');
    const prng = createPrng('fix-seed');
    const result = enrichForDbFix(prng, db);

    expect(result.targetTable).toBeDefined();
    expect(result.tamperColumn).toBeDefined();
    expect(result.tamperOldValue).toBeDefined();
    expect(result.tamperNewValue).toBeDefined();
    // For db_fix, old = corrupted, new = correct
    expect(result.tamperOldValue).not.toBe(result.tamperNewValue);
  });

  it('database starts with the corrupted value', () => {
    const db = makeDb('fix-db-2');
    const prng = createPrng('fix-seed-2');
    const result = enrichForDbFix(prng, db);

    const table = result.database.tables[result.targetTable];
    expect(table).toBeDefined();
    const hasCorruptedValue = table.rows.some(
      (r) => String(r[result.tamperColumn!]) === result.tamperOldValue,
    );
    expect(hasCorruptedValue).toBe(true);
  });
});

describe('enrichForDbSabotage', () => {
  it('returns a target table name', () => {
    const db = makeDb('sab-db');
    const prng = createPrng('sab-seed');
    const result = enrichForDbSabotage(prng, db);

    expect(result.targetTable).toBeDefined();
    expect(['sessions', 'api_keys', 'audit_log']).toContain(result.targetTable);
  });

  it('ensures the target table exists in the database', () => {
    const db = makeDb('sab-db-2');
    const prng = createPrng('sab-seed-2');
    const result = enrichForDbSabotage(prng, db);

    expect(result.database.tables[result.targetTable]).toBeDefined();
    expect(result.database.tables[result.targetTable].rows.length).toBeGreaterThan(0);
  });
});
