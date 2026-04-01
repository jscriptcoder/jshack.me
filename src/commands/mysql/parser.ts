import type { ParsedSql, WhereClause, SetClause } from './types';

// SQL keywords that we recognize but don't fully support.
// If input starts with one of these but fails to parse, it's a syntax error (1064).
// If it starts with something else entirely, it's "unsupported syntax".
const KNOWN_SQL_KEYWORDS =
  /^(SELECT|UPDATE|DELETE|DROP|SHOW|DESCRIBE|DESC|INSERT|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|REPLACE|RENAME|USE|SET|BEGIN|COMMIT|ROLLBACK|EXPLAIN|LOCK|UNLOCK|CALL|LOAD|OPTIMIZE|REPAIR|CHECK|ANALYZE|FLUSH|RESET|PURGE|HANDLER|DO|PREPARE|EXECUTE|DEALLOCATE|START|SAVEPOINT|RELEASE|XA)\b/i;

// Normalize input: trim, strip trailing semicolons, collapse whitespace
const normalize = (sql: string): string =>
  sql.trim().replace(/;\s*$/, '').replace(/\s+/g, ' ').trim();

// Parse WHERE clause: col = 'val' [AND col = 'val']...
// Returns empty array if no WHERE clause. Returns null if WHERE is present but malformed.
const parseWhere = (whereStr: string | undefined): readonly WhereClause[] | null => {
  if (!whereStr) return [];
  const trimmed = whereStr.trim();
  if (!trimmed) return [];

  const conditions: WhereClause[] = [];
  // Split on AND (case-insensitive)
  const parts = trimmed.split(/\s+AND\s+/i);

  for (const part of parts) {
    const match = part.trim().match(/^(\w+)\s*=\s*'([^']*)'\s*$/);
    if (!match) return null;
    conditions.push({ column: match[1], value: match[2] });
  }

  return conditions;
};

const parseShowTables = (sql: string): ParsedSql | null => {
  if (/^SHOW\s+TABLES$/i.test(sql)) {
    return { type: 'show_tables' };
  }
  return null;
};

const parseDescribe = (sql: string): ParsedSql | null => {
  const match = sql.match(/^(?:DESCRIBE|DESC)\s+(\w+)$/i);
  if (!match) return null;
  return { type: 'describe', table: match[1] };
};

const parseSelect = (sql: string): ParsedSql | null => {
  const match = sql.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;

  const columnsStr = match[1].trim();
  const table = match[2];
  const whereStr = match[3];

  const where = parseWhere(whereStr);
  if (where === null) return null;

  const columns: readonly string[] | '*' =
    columnsStr === '*' ? '*' : columnsStr.split(/\s*,\s*/).map((c) => c.trim());

  return { type: 'select', table, columns, where };
};

const parseUpdate = (sql: string): ParsedSql | null => {
  const match = sql.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;

  const table = match[1];
  const setsStr = match[2];
  const whereStr = match[3];

  const where = parseWhere(whereStr);
  if (where === null) return null;

  // Parse SET clauses: col = 'val', col2 = 'val2'
  const setParts = setsStr.split(/\s*,\s*/);
  const sets: SetClause[] = [];
  for (const part of setParts) {
    const setMatch = part.trim().match(/^(\w+)\s*=\s*'([^']*)'\s*$/);
    if (!setMatch) return null;
    sets.push({ column: setMatch[1], value: setMatch[2] });
  }

  if (sets.length === 0) return null;

  return { type: 'update', table, sets, where };
};

const parseDelete = (sql: string): ParsedSql | null => {
  const match = sql.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) return null;

  const table = match[1];
  const whereStr = match[2];

  const where = parseWhere(whereStr);
  if (where === null) return null;

  return { type: 'delete', table, where };
};

const parseDropTable = (sql: string): ParsedSql | null => {
  const match = sql.match(/^DROP\s+TABLE\s+(\w+)$/i);
  if (!match) return null;
  return { type: 'drop_table', table: match[1] };
};

const parseExitQuit = (sql: string): ParsedSql | null => {
  if (/^(exit|quit)$/i.test(sql)) {
    return { type: 'exit' };
  }
  return null;
};

type ParseResult =
  | { readonly ok: true; readonly parsed: ParsedSql }
  | { readonly ok: false; readonly error: string };

// Top-level SQL parser. Tries each sub-parser in order.
// Returns a structured result with either the parsed command or an error message.
export const parseSql = (raw: string): ParseResult => {
  const sql = normalize(raw);

  if (!sql) {
    return { ok: false, error: 'ERROR 1064 (42000): You have an error in your SQL syntax' };
  }

  // Exit/quit first — these don't need semicolons or SQL syntax
  const exitResult = parseExitQuit(sql);
  if (exitResult) return { ok: true, parsed: exitResult };

  // Try each parser in order
  const parsers = [
    parseShowTables,
    parseDescribe,
    parseSelect,
    parseUpdate,
    parseDelete,
    parseDropTable,
  ];

  for (const parser of parsers) {
    const result = parser(sql);
    if (result) return { ok: true, parsed: result };
  }

  // No parser matched — determine error type
  if (KNOWN_SQL_KEYWORDS.test(sql)) {
    // Recognized keyword but malformed syntax
    return {
      ok: false,
      error: 'ERROR 1064 (42000): You have an error in your SQL syntax',
    };
  }

  // Completely unrecognized
  return {
    ok: false,
    error: 'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.',
  };
};
