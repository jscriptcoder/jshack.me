import type { MysqlDatabase, MysqlRow, ParsedSql, SqlResult, WhereClause } from './types';
import {
  formatShowTables,
  formatDescribeTable,
  formatSelectResult,
  formatMutationResult,
  formatDropResult,
} from './formatter';

// Checks if a row matches all WHERE conditions (case-insensitive column matching)
const matchesWhere = (row: MysqlRow, where: readonly WhereClause[]): boolean =>
  where.every((clause) => {
    const key = Object.keys(row).find((k) => k.toLowerCase() === clause.column.toLowerCase());
    if (!key) return false;
    return String(row[key]) === clause.value;
  });

// Resolves a table name case-insensitively, returns the actual table name or null
const resolveTable = (
  db: MysqlDatabase,
  tableName: string,
): { readonly name: string; readonly found: boolean } => {
  const actual = Object.keys(db.tables).find((t) => t.toLowerCase() === tableName.toLowerCase());
  return actual ? { name: actual, found: true } : { name: tableName, found: false };
};

// Validates that all column names in WHERE/SET clauses exist in the table
const validateColumns = (
  columnNames: readonly string[],
  tableColumns: readonly { readonly name: string }[],
  context: string,
): string | null => {
  for (const col of columnNames) {
    const exists = tableColumns.some((c) => c.name.toLowerCase() === col.toLowerCase());
    if (!exists) {
      return `ERROR 1054 (42S22): Unknown column '${col}' in '${context}'`;
    }
  }
  return null;
};

export const executeSql = (db: MysqlDatabase, parsed: ParsedSql): SqlResult => {
  switch (parsed.type) {
    case 'show_tables': {
      const tableNames = Object.keys(db.tables);
      return { kind: 'read', output: formatShowTables(tableNames, db.name) };
    }

    case 'describe': {
      const resolved = resolveTable(db, parsed.table);
      if (!resolved.found) {
        return {
          kind: 'read',
          output: `ERROR 1146 (42S02): Table '${db.name}.${parsed.table}' doesn't exist`,
        };
      }
      const table = db.tables[resolved.name];
      return { kind: 'read', output: formatDescribeTable(table.columns) };
    }

    case 'select': {
      const resolved = resolveTable(db, parsed.table);
      if (!resolved.found) {
        return {
          kind: 'read',
          output: `ERROR 1146 (42S02): Table '${db.name}.${parsed.table}' doesn't exist`,
        };
      }
      const table = db.tables[resolved.name];

      // Validate WHERE columns
      const whereColNames = parsed.where.map((w) => w.column);
      const whereError = validateColumns(whereColNames, table.columns, 'where clause');
      if (whereError) return { kind: 'read', output: whereError };

      // Resolve selected columns
      const selectedColumns =
        parsed.columns === '*'
          ? table.columns.map((c) => c.name)
          : parsed.columns.map((col) => {
              const actual = table.columns.find((c) => c.name.toLowerCase() === col.toLowerCase());
              return actual?.name ?? col;
            });

      // Validate selected columns (when not *)
      if (parsed.columns !== '*') {
        const selectError = validateColumns(parsed.columns, table.columns, 'field list');
        if (selectError) return { kind: 'read', output: selectError };
      }

      const filteredRows = table.rows.filter((row) => matchesWhere(row, parsed.where));
      return {
        kind: 'read',
        output: formatSelectResult(table.columns, selectedColumns, filteredRows),
      };
    }

    case 'update': {
      const resolved = resolveTable(db, parsed.table);
      if (!resolved.found) {
        return {
          kind: 'read',
          output: `ERROR 1146 (42S02): Table '${db.name}.${parsed.table}' doesn't exist`,
        };
      }
      const table = db.tables[resolved.name];

      // Validate SET and WHERE columns
      const setColNames = parsed.sets.map((s) => s.column);
      const setError = validateColumns(setColNames, table.columns, 'field list');
      if (setError) return { kind: 'read', output: setError };

      const whereColNames = parsed.where.map((w) => w.column);
      const whereError = validateColumns(whereColNames, table.columns, 'where clause');
      if (whereError) return { kind: 'read', output: whereError };

      let changed = 0;
      let matched = 0;
      const updatedRows = table.rows.map((row) => {
        if (!matchesWhere(row, parsed.where)) return row;
        matched++;
        const updatedRow = { ...row };
        let rowChanged = false;
        for (const set of parsed.sets) {
          const key = Object.keys(row).find((k) => k.toLowerCase() === set.column.toLowerCase());
          if (key && String(row[key]) !== set.value) {
            (updatedRow as Record<string, string | number | null>)[key] = set.value;
            rowChanged = true;
          }
        }
        if (rowChanged) changed++;
        return updatedRow as MysqlRow;
      });

      const mutatedDb: MysqlDatabase = {
        ...db,
        tables: {
          ...db.tables,
          [resolved.name]: { ...table, rows: updatedRows },
        },
      };

      return {
        kind: 'mutation',
        output: formatMutationResult(changed, matched),
        mutatedDb,
      };
    }

    case 'delete': {
      const resolved = resolveTable(db, parsed.table);
      if (!resolved.found) {
        return {
          kind: 'read',
          output: `ERROR 1146 (42S02): Table '${db.name}.${parsed.table}' doesn't exist`,
        };
      }
      const table = db.tables[resolved.name];

      // Validate WHERE columns
      const whereColNames = parsed.where.map((w) => w.column);
      const whereError = validateColumns(whereColNames, table.columns, 'where clause');
      if (whereError) return { kind: 'read', output: whereError };

      const remainingRows = table.rows.filter((row) => !matchesWhere(row, parsed.where));
      const deleted = table.rows.length - remainingRows.length;

      const mutatedDb: MysqlDatabase = {
        ...db,
        tables: {
          ...db.tables,
          [resolved.name]: { ...table, rows: remainingRows },
        },
      };

      return {
        kind: 'mutation',
        output: formatMutationResult(deleted),
        mutatedDb,
      };
    }

    case 'drop_table': {
      const resolved = resolveTable(db, parsed.table);
      if (!resolved.found) {
        return {
          kind: 'read',
          output: `ERROR 1051 (42S02): Unknown table '${db.name}.${parsed.table}'`,
        };
      }

      const { [resolved.name]: _dropped, ...remainingTables } = db.tables;
      const mutatedDb: MysqlDatabase = {
        ...db,
        tables: remainingTables,
      };

      return { kind: 'mutation', output: formatDropResult(), mutatedDb };
    }

    case 'exit':
    case 'help':
      // Should not reach executor — handled by the caller
      return { kind: 'read', output: 'Bye' };
  }
};
