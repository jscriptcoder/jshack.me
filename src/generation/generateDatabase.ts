import type { Prng } from './prng';
import type { MysqlDatabase, MysqlTable, MysqlRow } from '../commands/mysql/types';
import {
  usersTable,
  apiKeysTable,
  allTableTemplates,
  dbNamePrefixes,
  dbNameSuffixes,
  tamperScenarios,
  fixScenarios,
  sabotageTargetTables,
  type TamperScenario,
} from './pools/database';

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

// --- Database Enrichment for Mission Objectives ---

export type DbEnrichment = {
  readonly database: MysqlDatabase;
  readonly targetTable: string;
  readonly expectedProof?: string;
  readonly tamperColumn?: string;
  readonly tamperOldValue?: string;
  readonly tamperNewValue?: string;
  readonly tamperRowHint?: string;
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
    tamperRowHint: enriched.rowHint,
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
    tamperRowHint: enriched.rowHint,
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
  readonly rowHint: string;
} => {
  const table = db.tables[scenario.table];
  if (!table)
    return {
      db,
      resolvedOldValue: scenario.oldValue,
      resolvedNewValue: scenario.newValue,
      rowHint: scenario.rowFilter.value,
    };

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
    rowHint: filterValue,
  };
};
