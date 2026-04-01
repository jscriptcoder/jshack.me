import type { MysqlColumn, MysqlRow } from './types';

// Pads a string to a given width, right-aligning numbers
const padCell = (value: string, width: number, isNumeric: boolean): string =>
  isNumeric ? value.padStart(width) : value.padEnd(width);

// Formats a value for display in a MySQL table cell
const formatValue = (value: string | number | null): string =>
  value === null ? 'NULL' : String(value);

// Builds a separator row: +------+------+
const buildSeparator = (widths: readonly number[]): string =>
  `+${widths.map((w) => '-'.repeat(w + 2)).join('+')}+`;

// Builds a data row: | val  | val  |
const buildRow = (
  values: readonly string[],
  widths: readonly number[],
  numericFlags: readonly boolean[],
): string => `| ${values.map((v, i) => padCell(v, widths[i], numericFlags[i])).join(' | ')} |`;

// Renders the classic MySQL ASCII table format
export const formatMysqlTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  numericFlags: readonly boolean[],
): string => {
  // Calculate column widths from headers and data
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );

  const separator = buildSeparator(widths);
  const headerRow = buildRow(
    headers,
    widths,
    numericFlags.map(() => false),
  );
  const dataRows = rows.map((row) => buildRow(row, widths, numericFlags));

  return [separator, headerRow, separator, ...dataRows, separator].join('\n');
};

// Formats SHOW TABLES output
export const formatShowTables = (tableNames: readonly string[], dbName: string): string => {
  const header = `Tables_in_${dbName}`;
  const rows = tableNames.map((name) => [name]);
  const result = formatMysqlTable([header], rows, [false]);
  const count = tableNames.length;
  return `${result}\n${count} ${count === 1 ? 'row' : 'rows'} in set (0.00 sec)`;
};

// Formats DESCRIBE output
export const formatDescribeTable = (columns: readonly MysqlColumn[]): string => {
  const headers = ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'];
  const rows = columns.map((col) => [
    col.name,
    formatColumnType(col.type),
    col.nullable ? 'YES' : 'NO',
    col.key ?? '',
    col.defaultValue ?? 'NULL',
    '',
  ]);
  const result = formatMysqlTable(headers, rows, [false, false, false, false, false, false]);
  const count = columns.length;
  return `${result}\n${count} ${count === 1 ? 'row' : 'rows'} in set (0.00 sec)`;
};

// Formats a column type for DESCRIBE output
const formatColumnType = (type: string): string => {
  const typeMap: Readonly<Record<string, string>> = {
    INT: 'int',
    VARCHAR: 'varchar(255)',
    TEXT: 'text',
    DATE: 'date',
    DATETIME: 'datetime',
    BOOLEAN: 'tinyint(1)',
    FLOAT: 'float',
  };
  return typeMap[type] ?? type.toLowerCase();
};

// Formats SELECT result with row count
export const formatSelectResult = (
  columns: readonly MysqlColumn[],
  selectedColumns: readonly string[],
  rows: readonly MysqlRow[],
): string => {
  if (rows.length === 0) {
    return 'Empty set (0.00 sec)';
  }

  const headers = selectedColumns;
  const numericFlags = selectedColumns.map((name) => {
    const col = columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return col?.type === 'INT' || col?.type === 'FLOAT' || col?.type === 'BOOLEAN';
  });

  const dataRows = rows.map((row) => selectedColumns.map((col) => formatValue(row[col])));
  const result = formatMysqlTable(headers, dataRows, numericFlags);
  const count = rows.length;
  return `${result}\n${count} ${count === 1 ? 'row' : 'rows'} in set (0.00 sec)`;
};

// Formats mutation result (UPDATE/DELETE)
export const formatMutationResult = (rowsAffected: number, rowsMatched?: number): string => {
  const matched = rowsMatched ?? rowsAffected;
  return (
    `Query OK, ${rowsAffected} ${rowsAffected === 1 ? 'row' : 'rows'} affected (0.00 sec)\n` +
    `Rows matched: ${matched}  Changed: ${rowsAffected}  Warnings: 0`
  );
};

// Formats DROP TABLE result
export const formatDropResult = (): string => 'Query OK, 0 rows affected (0.01 sec)';
