/**
 * What a database answers to one statement.
 *
 * This is the whole statement path behind `mysql>`, and it is deliberately one
 * module: parsing, executing and rendering are three views of a single question —
 * what does the player see when they type this line — and splitting them into three
 * public contracts would invite callers to hold a parsed statement or a raw result
 * set, which are precisely the two things nothing outside here may hold.
 *
 * That is not tidiness. A response carrying rows rather than rendered text hands the
 * client every row the account was not allowed to select, in a field the terminal
 * never draws and anyone watching the wire can read. So the only thing that leaves
 * here is what a terminal would print, and the only thing that comes in is the
 * database plus the line as the player typed it.
 *
 * The rendering is legacy's, character for character — widths from the widest cell,
 * numbers right-aligned and text left, `NULL` for an absent value, `Empty set` on its
 * own path rather than a headerless table. A player who learned to read these tables
 * in the old client reads the same tables here.
 *
 * A statement that CHANGES the database hands back a new one beside its output; it
 * never edits the one it was given. Nothing here reaches a disk — what a caller does
 * with that database is the caller's, and the fact that only a write produces one is
 * what lets a caller persist without deciding anything about verbs for itself.
 */

import type { MysqlColumn, MysqlColumnType, MysqlDatabase, MysqlRow, MysqlTable } from './types';
import type { UserType } from '../types';

export type StatementRequest = {
  readonly database: MysqlDatabase;
  /** The line exactly as the player typed it, semicolon, spacing and all. */
  readonly line: string;
  /** The account the connection was opened with. Re-sent with every statement
   *  because there is no session row holding it, and named back in a denial. */
  readonly username: string;
  /** The tier that account carries in the datadir. Derived server-side from the
   *  credential the statement just validated against, never sent by the client — a
   *  client that named its own tier would be naming its own permissions. */
  readonly userType: UserType;
  /** The address the connection came from, as the denial spells it. */
  readonly sourceIp: string;
};

export type StatementResult = {
  /** Rendered lines, ready to print. Never rows, never a parsed statement. */
  readonly output: readonly string[];
  /** Whether the terminal should draw this in the error colour and exit non-zero. */
  readonly failed: boolean;
  /**
   * The database as this statement left it, present ONLY when the statement changed
   * it — absent for every read, every syntax error and every refusal.
   *
   * Its presence is what a caller keys the datadir write on, rather than the verb: a
   * refused DROP is a write verb that produced nothing, and a caller deciding from the
   * verb would persist an unchanged database and record a mutation that never happened.
   */
  readonly database?: MysqlDatabase;
};

/**
 * Trim, drop the trailing semicolon, collapse the whitespace.
 *
 * One statement per line, so a terminating `;` carries no information — and the
 * alternative is the real client's `->` continuation, which this door declined to
 * pay for. Shared with the sub-shell so the way out and the verb table cannot drift
 * into disagreeing about what a semicolon means.
 */
export const normalizeStatement = (line: string): string =>
  line
    .trim()
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

type WhereCondition = {
  readonly column: string;
  readonly value: string;
};

/** The write verbs this door parses. It parses them precisely so it can refuse them
 *  as a PERMISSION problem: a well-formed `UPDATE` told it has a syntax error sends
 *  the player to rewrite a statement that was already correct, when what they
 *  actually need is a better account. */
type WriteVerb = 'UPDATE' | 'DELETE' | 'DROP';

type Statement =
  | { readonly kind: 'showTables' }
  | { readonly kind: 'describe'; readonly table: string }
  | {
      readonly kind: 'select';
      readonly table: string;
      readonly columns: readonly string[] | '*';
      readonly where: readonly WhereCondition[];
    }
  | {
      readonly kind: 'write';
      readonly verb: 'UPDATE';
      readonly table: string;
      readonly sets: readonly WhereCondition[];
      readonly where: readonly WhereCondition[];
    }
  | {
      readonly kind: 'write';
      readonly verb: 'DELETE';
      readonly table: string;
      readonly where: readonly WhereCondition[];
    }
  | { readonly kind: 'write'; readonly verb: 'DROP'; readonly table: string };

type Write = Extract<Statement, { readonly kind: 'write' }>;

type ParseOutcome =
  | { readonly ok: true; readonly statement: Statement }
  | { readonly ok: false; readonly message: string };

/** Verbs this instance recognises as SQL even when it cannot run them. A line that
 *  starts with one and fails to parse is malformed; a line that starts with anything
 *  else was never SQL, and the two deserve different answers. */
const KNOWN_SQL_KEYWORDS =
  /^(SELECT|UPDATE|DELETE|DROP|SHOW|DESCRIBE|DESC|INSERT|CREATE|ALTER|GRANT|REVOKE|TRUNCATE|REPLACE|RENAME|USE|SET|BEGIN|COMMIT|ROLLBACK|EXPLAIN|LOCK|UNLOCK|CALL|LOAD|OPTIMIZE|REPAIR|CHECK|ANALYZE|FLUSH|RESET|PURGE|HANDLER|DO|PREPARE|EXECUTE|DEALLOCATE|START|SAVEPOINT|RELEASE|XA)\b/i;

const SYNTAX_ERROR = 'ERROR 1064 (42000): You have an error in your SQL syntax';

const UNSUPPORTED =
  'ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.';

const CONDITION = /^(\w+)\s*=\s*'([^']*)'\s*$/;

/** `[]` for no WHERE at all, `null` for one that is present and malformed — the
 *  caller has to tell those apart, since the second is a syntax error and the first
 *  is every row. */
const parseWhere = (clause: string | undefined): readonly WhereCondition[] | null => {
  const trimmed = clause?.trim() ?? '';
  if (trimmed === '') return [];

  const matches = trimmed.split(/\s+AND\s+/i).map((part) => part.trim().match(CONDITION));
  const matched = matches.filter((match) => match !== null);
  if (matched.length !== matches.length) return null;

  return matched.map((match) => ({ column: match[1], value: match[2] }));
};

const parseShowTables = (statement: string): Statement | null =>
  /^SHOW\s+TABLES$/i.test(statement) ? { kind: 'showTables' } : null;

const parseDescribe = (statement: string): Statement | null => {
  const match = statement.match(/^(?:DESCRIBE|DESC)\s+(\w+)$/i);
  return match === null ? null : { kind: 'describe', table: match[1] };
};

const parseSelect = (statement: string): Statement | null => {
  const match = statement.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (match === null) return null;

  const where = parseWhere(match[3]);
  if (where === null) return null;

  const requested = match[1].trim();
  const columns = requested === '*' ? '*' : requested.split(/\s*,\s*/).map((name) => name.trim());

  return { kind: 'select', table: match[2], columns, where };
};

/** A SET assignment and a WHERE condition are the same production, `col = 'value'`,
 *  so one parser reads both — which is also why one type describes both. */
const parseUpdate = (statement: string): Statement | null => {
  const match = statement.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
  if (match === null) return null;

  const where = parseWhere(match[3]);
  if (where === null) return null;

  const assignments = match[2].split(/\s*,\s*/).map((part) => part.trim().match(CONDITION));
  const matched = assignments.filter((assignment) => assignment !== null);
  if (matched.length !== assignments.length) return null;

  const sets = matched.map((assignment) => ({ column: assignment[1], value: assignment[2] }));
  return { kind: 'write', verb: 'UPDATE', table: match[1], sets, where };
};

const parseDelete = (statement: string): Statement | null => {
  const match = statement.match(/^DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (match === null) return null;

  const where = parseWhere(match[2]);
  if (where === null) return null;

  return { kind: 'write', verb: 'DELETE', table: match[1], where };
};

const parseDropTable = (statement: string): Statement | null => {
  const match = statement.match(/^DROP\s+TABLE\s+(\w+)$/i);
  return match === null ? null : { kind: 'write', verb: 'DROP', table: match[1] };
};

const parseStatement = (statement: string): ParseOutcome => {
  const parsers = [
    parseShowTables,
    parseDescribe,
    parseSelect,
    parseUpdate,
    parseDelete,
    parseDropTable,
  ];
  const parsed = parsers.reduce<Statement | null>(
    (found, parser) => found ?? parser(statement),
    null,
  );
  if (parsed !== null) return { ok: true, statement: parsed };

  return { ok: false, message: KNOWN_SQL_KEYWORDS.test(statement) ? SYNTAX_ERROR : UNSUPPORTED };
};

/** How each generated column type is spelled in a `DESCRIBE`. Exhaustive over the
 *  schema's closed set, so a new column type is a compile error here rather than a
 *  cell that silently prints its own enum name at the player. */
const TYPE_NAMES: Readonly<Record<MysqlColumnType, string>> = {
  INT: 'int',
  VARCHAR: 'varchar(255)',
  TEXT: 'text',
  DATETIME: 'datetime',
  BOOLEAN: 'tinyint(1)',
  FLOAT: 'float',
};

const NUMERIC_TYPES: readonly MysqlColumnType[] = ['INT', 'FLOAT', 'BOOLEAN'];

const padCell = (value: string, width: number, numeric: boolean): string =>
  numeric ? value.padStart(width) : value.padEnd(width);

const separatorRow = (widths: readonly number[]): string =>
  `+${widths.map((width) => '-'.repeat(width + 2)).join('+')}+`;

const dataRow = (
  values: readonly string[],
  widths: readonly number[],
  numericFlags: readonly boolean[],
): string =>
  `| ${values.map((value, index) => padCell(value, widths[index], numericFlags[index])).join(' | ')} |`;

/** The classic ASCII grid: every column as wide as its widest cell, header included. */
const asciiTable = (
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  numericFlags: readonly boolean[],
): readonly string[] => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const separator = separatorRow(widths);
  // Headers are never right-aligned, even above a column of numbers, because that is
  // what the real client does.
  const headerRow = dataRow(
    headers,
    widths,
    headers.map(() => false),
  );

  return [
    separator,
    headerRow,
    separator,
    ...rows.map((row) => dataRow(row, widths, numericFlags)),
    separator,
  ];
};

const countLine = (count: number): string =>
  `${count} ${count === 1 ? 'row' : 'rows'} in set (0.00 sec)`;

const cellValue = (value: string | number | null): string => (value === null ? 'NULL' : `${value}`);

const succeeded = (output: readonly string[]): StatementResult => ({ output, failed: false });

/** A success that also hands back what the caller should persist. Separate from
 *  `succeeded` so that a read cannot acquire a database by editing one line. */
const wrote = (output: readonly string[], database: MysqlDatabase): StatementResult => ({
  output,
  failed: false,
  database,
});

const refused = (message: string): StatementResult => ({ output: [message], failed: true });

/** Tables and columns are matched without regard to case, the way MySQL matches them
 *  on the platforms this game imitates. */
const findByName = <Named extends { readonly name: string }>(
  candidates: readonly Named[],
  name: string,
): Named | undefined =>
  candidates.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());

const resolveTableName = (database: MysqlDatabase, requested: string): string | undefined =>
  Object.keys(database.tables).find((name) => name.toLowerCase() === requested.toLowerCase());

const unknownTable = (database: MysqlDatabase, requested: string): StatementResult =>
  refused(`ERROR 1146 (42S02): Table '${database.name}.${requested}' doesn't exist`);

/** The first column not on the table, or undefined when all of them are. The clause
 *  name travels with it: `where clause` and `field list` are the same error code and
 *  the only thing that points the player at the right half of their statement. */
const firstUnknownColumn = (
  names: readonly string[],
  columns: readonly MysqlColumn[],
): string | undefined => names.find((name) => findByName(columns, name) === undefined);

const unknownColumn = (name: string, clause: string): StatementResult =>
  refused(`ERROR 1054 (42S22): Unknown column '${name}' in '${clause}'`);

const showTables = (database: MysqlDatabase): StatementResult => {
  // Appended rather than sorted in: the listing is the datadir's own key order, and
  // re-sorting to make room for this one would reorder every other box's tables. A
  // stored table of the same name is dropped, or the listing would name it twice.
  const names = [
    ...Object.keys(database.tables).filter((name) => !isCredentialsTable(name)),
    CREDENTIALS_TABLE,
  ];
  return succeeded([
    ...asciiTable([`Tables_in_${database.name}`], names.map((name) => [name]), [false]),
    countLine(names.length),
  ]);
};

const describe = (table: MysqlTable): StatementResult =>
  succeeded([
    ...asciiTable(
      ['Field', 'Type', 'Null', 'Key', 'Default', 'Extra'],
      table.columns.map((column) => [
        column.name,
        TYPE_NAMES[column.type],
        column.nullable ? 'YES' : 'NO',
        column.key ?? '',
        column.defaultValue ?? 'NULL',
        '',
      ]),
      [false, false, false, false, false, false],
    ),
    countLine(table.columns.length),
  ]);

const matchesWhere = (row: MysqlRow, where: readonly WhereCondition[]): boolean =>
  where.every((condition) => {
    const key = Object.keys(row).find(
      (name) => name.toLowerCase() === condition.column.toLowerCase(),
    );
    return key !== undefined && `${row[key]}` === condition.value;
  });

const select = (table: MysqlTable, statement: Statement & { kind: 'select' }): StatementResult => {
  const unknownInWhere = firstUnknownColumn(
    statement.where.map((condition) => condition.column),
    table.columns,
  );
  if (unknownInWhere !== undefined) return unknownColumn(unknownInWhere, 'where clause');

  // Resolving and validating the field list are one step, not two: a name that
  // resolves to nothing IS the unknown column, and splitting them leaves a branch
  // for the already-refused case that no statement can reach.
  const requested =
    statement.columns === '*' ? table.columns.map((column) => column.name) : statement.columns;
  const resolved = requested.map((name) => findByName(table.columns, name));
  const missing = resolved.findIndex((column) => column === undefined);
  if (missing !== -1) return unknownColumn(requested[missing], 'field list');

  // Selected names are re-spelled as the table spells them, so the header reads the
  // way `DESCRIBE` does no matter how the player cased their statement.
  const selected = resolved.filter((column) => column !== undefined);

  const rows = table.rows.filter((row) => matchesWhere(row, statement.where));
  // Not a table with a zero count: the real client prints this instead, and a player
  // who sees headers with nothing under them reads it as a broken query.
  if (rows.length === 0) return succeeded(['Empty set (0.00 sec)']);

  return succeeded([
    ...asciiTable(
      selected.map((column) => column.name),
      rows.map((row) => selected.map((column) => cellValue(row[column.name] ?? null))),
      selected.map((column) => NUMERIC_TYPES.includes(column.type)),
    ),
    countLine(rows.length),
  ]);
};

/**
 * How this door spells a permission refusal, whatever earned it.
 *
 * Both callers refuse BEFORE resolving anything, and that is the point: a denial that
 * fired only for tables that exist would answer "does this table exist?" for an
 * account with no right to ask. For the same reason the table is echoed back as the
 * player SPELLED it rather than as the database holds it — confirming a table's exact
 * casing is one more thing this answer should not say.
 */
const deny = (request: StatementRequest, verb: string, table: string): StatementResult =>
  refused(
    `ERROR 1142 (42000): ${verb} command denied to user '${request.username}'@'${request.sourceIp}' for table '${table}'`,
  );

/**
 * The account list, readable as a table — the database's own `/etc/passwd`.
 *
 * A VIEW over the datadir's accounts rather than an entry in its tables, and it wins
 * over a stored table of the same name. What a player reads here has to be the list
 * that actually decides logins: the datadir is root-owned on a box a player can reach
 * AS root, so a planted `credentials` table is something a player can arrange, and a
 * decoy that shadowed this would hide the real accounts from the next player through
 * the door. Nothing generated ever collides with the name — the pool draws `api_keys`,
 * `audit_log`, `config`, `employees`, `inventory`, `orders`, `sessions` and `users`.
 */
const CREDENTIALS_TABLE = 'credentials';

const CREDENTIALS_COLUMNS: readonly MysqlColumn[] = [
  { name: 'username', type: 'VARCHAR', nullable: false, key: 'PRI' },
  { name: 'password_hash', type: 'VARCHAR', nullable: false },
  { name: 'user_type', type: 'VARCHAR', nullable: false },
];

/**
 * Which tiers may read it: the same two `PASSWD_FILE.read` names, because it guards the
 * same kind of secret one door in. Held here rather than imported from the filesystem's
 * permissions — those are two rules that agree, not one rule in two places, and the day
 * this door's ladder moves it must not drag `/etc/passwd` along with it.
 *
 * Listing and `DESCRIBE` are deliberately NOT gated. `/etc` is traversable at every
 * tier, so a guest sees `passwd` in `ls` and learns there is something there worth
 * earning; this table has the same shape, because a ladder nobody can see the top of is
 * not a ladder.
 */
const CREDENTIALS_READERS: readonly UserType[] = ['root', 'user'];

const isCredentialsTable = (name: string): boolean => name.toLowerCase() === CREDENTIALS_TABLE;

const credentialsTable = (database: MysqlDatabase): MysqlTable => ({
  columns: CREDENTIALS_COLUMNS,
  rows: database.credentials.map((credential) => ({
    username: credential.username,
    password_hash: credential.passwordHash,
    user_type: credential.userType,
  })),
});

const readCredentials = (
  request: StatementRequest,
  statement: Extract<Statement, { readonly kind: 'describe' | 'select' }>,
): StatementResult => {
  const table = credentialsTable(request.database);
  if (statement.kind === 'describe') return describe(table);
  // Ahead of the field list, so a refusal cannot double as a column oracle for the one
  // tier that must not have one.
  if (!CREDENTIALS_READERS.includes(request.userType)) {
    return deny(request, 'SELECT', statement.table);
  }
  return select(table, statement);
};

/**
 * Which tiers may run which verb — the ladder, as data.
 *
 * `DROP` sits a rung above the other two because editing rows and removing the thing
 * rows live in are different powers: the application account is the commonest one a
 * sweep returns, and it can rewrite a table's contents all day without being able to
 * take the table away. Database root turns up on about one database box in eight,
 * which is what makes the top rung worth the climb.
 *
 * A tier absent from a verb's list is refused it. Nothing lists `guest`, so the rung a
 * sweep lands on half the time reads and nothing more.
 */
const WRITERS: Readonly<Record<WriteVerb, readonly UserType[]>> = {
  UPDATE: ['root', 'user'],
  DELETE: ['root', 'user'],
  DROP: ['root'],
};

/** Legacy's two lines for a row verb, and its own separate constant for the drop —
 *  0.01 where everything else says 0.00. Legacy keeps them in two functions for
 *  exactly that reason, and one shared formatter would normalise the difference away. */
const mutationLines = (changed: number, matched: number): readonly string[] => [
  `Query OK, ${changed} ${changed === 1 ? 'row' : 'rows'} affected (0.00 sec)`,
  `Rows matched: ${matched}  Changed: ${changed}  Warnings: 0`,
];

const DROP_LINE = 'Query OK, 0 rows affected (0.01 sec)';

const unknownDropTarget = (database: MysqlDatabase, requested: string): StatementResult =>
  refused(`ERROR 1051 (42S02): Unknown table '${database.name}.${requested}'`);

const withTable = (
  database: MysqlDatabase,
  name: string,
  table: MysqlTable,
): MysqlDatabase => ({ ...database, tables: { ...database.tables, [name]: table } });

const withoutTable = (database: MysqlDatabase, name: string): MysqlDatabase => ({
  ...database,
  tables: Object.fromEntries(Object.entries(database.tables).filter(([key]) => key !== name)),
});

/**
 * One row with its assignments applied, or THE SAME ROW when none of them moved it.
 *
 * The identity is load-bearing: it is how the caller counts changed rows apart from
 * matched ones. Values are compared as the strings they were typed as, which is what
 * makes `SET amount = '5'` against a numeric 5 a match that changed nothing — and why
 * a column is left holding its own type rather than being rewritten with an equal
 * string.
 */
const withAssignments = (row: MysqlRow, sets: readonly WhereCondition[]): MysqlRow =>
  sets.reduce<MysqlRow>((current, set) => {
    const key = Object.keys(current).find(
      (name) => name.toLowerCase() === set.column.toLowerCase(),
    );
    if (key === undefined || `${current[key]}` === set.value) return current;
    return { ...current, [key]: set.value };
  }, row);

const update = (
  request: StatementRequest,
  statement: Extract<Write, { readonly verb: 'UPDATE' }>,
  name: string,
  table: MysqlTable,
): StatementResult => {
  // Assignments before the condition, which is the order legacy checks them — and the
  // only thing a statement naming an absent column in both halves can tell apart.
  const unknownInSets = firstUnknownColumn(
    statement.sets.map((set) => set.column),
    table.columns,
  );
  if (unknownInSets !== undefined) return unknownColumn(unknownInSets, 'field list');

  const unknownInWhere = firstUnknownColumn(
    statement.where.map((condition) => condition.column),
    table.columns,
  );
  if (unknownInWhere !== undefined) return unknownColumn(unknownInWhere, 'where clause');

  const applied = table.rows.map((row) =>
    matchesWhere(row, statement.where) ? withAssignments(row, statement.sets) : row,
  );
  const matched = table.rows.filter((row) => matchesWhere(row, statement.where)).length;
  const changed = applied.filter((row, index) => row !== table.rows[index]).length;

  return wrote(
    mutationLines(changed, matched),
    withTable(request.database, name, { ...table, rows: applied }),
  );
};

const remove = (
  request: StatementRequest,
  statement: Extract<Write, { readonly verb: 'DELETE' }>,
  name: string,
  table: MysqlTable,
): StatementResult => {
  const unknownInWhere = firstUnknownColumn(
    statement.where.map((condition) => condition.column),
    table.columns,
  );
  if (unknownInWhere !== undefined) return unknownColumn(unknownInWhere, 'where clause');

  const rows = table.rows.filter((row) => !matchesWhere(row, statement.where));
  const deleted = table.rows.length - rows.length;

  return wrote(
    mutationLines(deleted, deleted),
    withTable(request.database, name, { ...table, rows }),
  );
};

const write = (request: StatementRequest, statement: Write): StatementResult => {
  // Both refusals fire before the table is resolved, and both spell the same 1142: a
  // verb an account may not run must not double as a way to ask what exists. The
  // account list is unwritable at EVERY tier, root included — it is a view over the
  // list that decides who may log in, so writing it reaches back into the login door.
  if (
    !WRITERS[statement.verb].includes(request.userType) ||
    isCredentialsTable(statement.table)
  ) {
    return deny(request, statement.verb, statement.table);
  }

  const name = resolveTableName(request.database, statement.table);
  const table = name === undefined ? undefined : request.database.tables[name];
  if (name === undefined || table === undefined) {
    // Legacy gives the drop its own code here, 1051 where the row verbs say 1146.
    return statement.verb === 'DROP'
      ? unknownDropTarget(request.database, statement.table)
      : unknownTable(request.database, statement.table);
  }

  if (statement.verb === 'DROP') {
    return wrote([DROP_LINE], withoutTable(request.database, name));
  }

  return statement.verb === 'UPDATE'
    ? update(request, statement, name, table)
    : remove(request, statement, name, table);
};

const execute = (request: StatementRequest, statement: Statement): StatementResult => {
  if (statement.kind === 'showTables') return showTables(request.database);
  if (statement.kind === 'write') return write(request, statement);

  if (isCredentialsTable(statement.table)) return readCredentials(request, statement);

  const resolved = resolveTableName(request.database, statement.table);
  const table = resolved === undefined ? undefined : request.database.tables[resolved];
  if (table === undefined) return unknownTable(request.database, statement.table);

  return statement.kind === 'describe' ? describe(table) : select(table, statement);
};

export const runStatement = (request: StatementRequest): StatementResult => {
  const parsed = parseStatement(normalizeStatement(request.line));
  return parsed.ok ? execute(request, parsed.statement) : refused(parsed.message);
};
