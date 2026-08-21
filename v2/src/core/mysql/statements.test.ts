import { describe, expect, it } from 'vitest';
import { mysqlDatabaseSchema } from './types';
import { runStatement } from './statements';
import type { MysqlDatabase } from './types';

/**
 * What a database says back to a statement typed at `mysql>`.
 *
 * The rendering is legacy's, character for character — column widths, the right
 * alignment numbers get and strings do not, `NULL` for an absent value, the singular
 * `1 row in set`. These blocks were captured by running the legacy formatter over
 * this same fixture rather than typed out by hand, so a difference here is a real
 * divergence and not a disagreement about arithmetic.
 *
 * Claims are whole-value: a dropped line or an added field fails. That is what makes
 * this the layer where "the response carries the rendered output and nothing else"
 * can actually be held to, rather than a promise made further up.
 */

const database = (overrides: Partial<MysqlDatabase> = {}): MysqlDatabase =>
  mysqlDatabaseSchema.parse({
    name: 'app_prod',
    tables: {
      orders: {
        columns: [
          { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
          { name: 'sku', type: 'VARCHAR', nullable: false, key: 'UNI' },
          { name: 'notes', type: 'TEXT', nullable: true },
          { name: 'amount', type: 'FLOAT', nullable: false },
        ],
        rows: [
          { id: 1, sku: 'SRV-001', notes: null, amount: 99.99 },
          { id: 2, sku: 'SRV-002', notes: 'rush', amount: 5 },
        ],
      },
      users: {
        columns: [
          { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
          { name: 'email', type: 'VARCHAR', nullable: false },
        ],
        rows: [{ id: 1, email: 'ada@example.com' }],
      },
    },
    credentials: [
      { username: 'root', passwordHash: 'd41d8cd98f00b204e9800998ecf8427e', userType: 'root' },
    ],
    ...overrides,
  });

/**
 * A second shape, drawn to make the rendering rules visible where the first cannot.
 *
 * In `orders` every numeric header is exactly as wide as its widest value and every
 * column default is absent, so a formatter that right-aligned its headers, ignored
 * defaults, or treated text as numeric would render `orders` identically either way.
 * These columns differ in width and carry a default, which is what turns those three
 * rules from claims into something a test can watch fail.
 */
const PARTS: MysqlDatabase['tables'] = {
  parts: {
    columns: [
      { name: 'sku', type: 'VARCHAR', nullable: false, key: 'PRI' },
      { name: 'qty', type: 'INT', nullable: false, defaultValue: '0' },
      { name: 'label', type: 'VARCHAR', nullable: true },
    ],
    rows: [
      { sku: 'A', qty: 1000000, label: 'x' },
      { sku: 'LONG-SKU-9', qty: 7, label: null },
    ],
  },
};

const run = (line: string, overrides: Partial<MysqlDatabase> = {}) =>
  runStatement({
    database: database(overrides),
    line,
    username: 'readonly',
    sourceIp: '192.168.1.42',
  });

const runAs = (identity: { readonly username: string; readonly sourceIp: string }, line: string) =>
  runStatement({ database: database(), line, ...identity });

describe('reading a database at the prompt', () => {
  it('lists the tables under the database own name', () => {
    expect(run('SHOW TABLES')).toEqual({
      failed: false,
      output: [
        '+--------------------+',
        '| Tables_in_app_prod |',
        '+--------------------+',
        '| orders             |',
        '| users              |',
        '+--------------------+',
        '2 rows in set (0.00 sec)',
      ],
    });
  });

  it('describes a table down to the column metadata the generator drew', () => {
    // Every cell traces to something: `int` and `varchar(255)` are the type map,
    // `NO`/`YES` the nullable flag, `PRI`/`UNI` the key, `NULL` an absent default,
    // and the empty Extra column exists because real MySQL prints one.
    expect(run('DESCRIBE orders').output).toEqual([
      '+--------+--------------+------+-----+---------+-------+',
      '| Field  | Type         | Null | Key | Default | Extra |',
      '+--------+--------------+------+-----+---------+-------+',
      '| id     | int          | NO   | PRI | NULL    |       |',
      '| sku    | varchar(255) | NO   | UNI | NULL    |       |',
      '| notes  | text         | YES  |     | NULL    |       |',
      '| amount | float        | NO   |     | NULL    |       |',
      '+--------+--------------+------+-----+---------+-------+',
      '4 rows in set (0.00 sec)',
    ]);
  });

  it('right-aligns numbers, left-aligns text, and prints NULL for an absent value', () => {
    // Alignment is not decoration: it is how a column of amounts reads as a column
    // of amounts. A formatter that padded every cell the same way would still pass
    // a test that only counted rows.
    expect(run('SELECT * FROM orders').output).toEqual([
      '+----+---------+-------+--------+',
      '| id | sku     | notes | amount |',
      '+----+---------+-------+--------+',
      '|  1 | SRV-001 | NULL  |  99.99 |',
      '|  2 | SRV-002 | rush  |      5 |',
      '+----+---------+-------+--------+',
      '2 rows in set (0.00 sec)',
    ]);
  });

  it('narrows to the named columns and says row, not rows, for one of them', () => {
    expect(run("SELECT sku FROM orders WHERE notes = 'rush'").output).toEqual([
      '+---------+',
      '| sku     |',
      '+---------+',
      '| SRV-002 |',
      '+---------+',
      '1 row in set (0.00 sec)',
    ]);
  });

  it('requires every condition of an AND to hold', () => {
    expect(run("SELECT sku FROM orders WHERE notes = 'rush' AND sku = 'SRV-002'").output).toContain(
      '| SRV-002 |',
    );
    // Or AND is an OR wearing its name, and a player filtering a table gets rows
    // they did not ask for while believing they narrowed it.
    expect(run("SELECT sku FROM orders WHERE notes = 'rush' AND sku = 'SRV-001'").output).toEqual([
      'Empty set (0.00 sec)',
    ]);
  });

  it('answers a SELECT that matches nothing with an empty set, not an empty table', () => {
    // A different formatter path, and the one the old acceptance criterion hid: a
    // headers-only table reading `0 rows in set` would satisfy "renders a table and
    // a count" while looking nothing like what MySQL prints.
    expect(run("SELECT * FROM orders WHERE sku = 'NOPE'")).toEqual({
      failed: false,
      output: ['Empty set (0.00 sec)'],
    });
  });

  it('reads verbs and table names in any case', () => {
    expect(run('describe USERS').output).toEqual([
      '+-------+--------------+------+-----+---------+-------+',
      '| Field | Type         | Null | Key | Default | Extra |',
      '+-------+--------------+------+-----+---------+-------+',
      '| id    | int          | NO   | PRI | NULL    |       |',
      '| email | varchar(255) | NO   |     | NULL    |       |',
      '+-------+--------------+------+-----+---------+-------+',
      '2 rows in set (0.00 sec)',
    ]);
    expect(run('select * from Orders').output).toContain('|  1 | SRV-001 | NULL  |  99.99 |');
  });

  it('shows a column default where the generator drew one', () => {
    // The `Default` column is the half of the metadata `orders` cannot exercise,
    // and the pool draws defaults on real tables — a DESCRIBE that printed NULL
    // over all of them would look right on most boxes and be wrong on those.
    expect(run('DESCRIBE parts', { tables: PARTS }).output).toEqual([
      '+-------+--------------+------+-----+---------+-------+',
      '| Field | Type         | Null | Key | Default | Extra |',
      '+-------+--------------+------+-----+---------+-------+',
      '| sku   | varchar(255) | NO   | PRI | NULL    |       |',
      '| qty   | int          | NO   |     | 0       |       |',
      '| label | varchar(255) | YES  |     | NULL    |       |',
      '+-------+--------------+------+-----+---------+-------+',
      '3 rows in set (0.00 sec)',
    ]);
  });

  it('aligns a wide numeric column right and leaves its header and text left', () => {
    // Three rules at once, each invisible in a table whose cells happen to be the
    // width of their headers: `qty` right-aligns under a LEFT-aligned `qty` header,
    // and `sku` stays left even though its cells vary in width.
    expect(run('SELECT * FROM parts', { tables: PARTS }).output).toEqual([
      '+------------+---------+-------+',
      '| sku        | qty     | label |',
      '+------------+---------+-------+',
      '| A          | 1000000 | x     |',
      '| LONG-SKU-9 |       7 | NULL  |',
      '+------------+---------+-------+',
      '2 rows in set (0.00 sec)',
    ]);
  });

  it('matches a column name in any case, in the field list and in the WHERE alike', () => {
    // Two separate lookups — one over the column definitions, one over each row's
    // own keys — and a player who types a column in the wrong case must not be told
    // it does not exist by either of them.
    expect(run("SELECT sku FROM parts WHERE QTY = '7'", { tables: PARTS }).output).toEqual([
      '+------------+',
      '| sku        |',
      '+------------+',
      '| LONG-SKU-9 |',
      '+------------+',
      '1 row in set (0.00 sec)',
    ]);
    // And the header comes back spelled the way the table spells it, not the way it
    // was typed.
    expect(run('SELECT SKU FROM parts', { tables: PARTS }).output).toEqual([
      '+------------+',
      '| sku        |',
      '+------------+',
      '| A          |',
      '| LONG-SKU-9 |',
      '+------------+',
      '2 rows in set (0.00 sec)',
    ]);
  });

  it('needs no semicolon, and is unbothered by one', () => {
    // The same rule the way out already follows, now across the verb table: one
    // statement per line, so a terminating `;` carries no information either way.
    expect(run('SHOW TABLES;')).toEqual(run('SHOW TABLES'));
    expect(run('  SELECT * FROM   orders  ;  ')).toEqual(run('SELECT * FROM orders'));
  });
});

describe('what a database refuses to read', () => {
  it('names the database and the table when the table is not there', () => {
    expect(run('SELECT * FROM nope')).toEqual({
      failed: true,
      output: ["ERROR 1146 (42S02): Table 'app_prod.nope' doesn't exist"],
    });
  });

  it('tells a WHERE column apart from a selected one', () => {
    // Two different 1054s, and the clause name is the whole of the difference — it
    // is what sends the player to the right half of their own statement.
    expect(run("SELECT * FROM orders WHERE nope = 'x'").output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'where clause'",
    ]);
    expect(run('SELECT nope FROM orders').output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'field list'",
    ]);
  });

  it('calls a mangled known verb a syntax error', () => {
    expect(run('SELECT FROM')).toEqual({
      failed: true,
      output: ['ERROR 1064 (42000): You have an error in your SQL syntax'],
    });
  });

  it('calls a line that is not SQL at all unsupported, not malformed', () => {
    // The distinction legacy draws and this port keeps: telling a player their line
    // is malformed when the truth is that this instance does not implement it sends
    // them to fix spelling that was never wrong.
    expect(run('hello there')).toEqual({
      failed: true,
      output: ['ERROR: Unsupported SQL syntax. This MySQL instance supports basic queries only.'],
    });
  });

  it('prints a cell a tampered datadir left out as NULL, never as undefined', () => {
    // A deliberate departure from legacy, which rendered the JavaScript word
    // `undefined` into the table. The datadir is root-owned on a box a player can
    // reach as root, so a row missing a column is a thing a player can arrange —
    // and an absent cell is exactly what SQL calls NULL.
    const tampered = run('SELECT * FROM orders', {
      tables: {
        orders: {
          columns: [
            { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
            { name: 'sku', type: 'VARCHAR', nullable: false },
            { name: 'amount', type: 'FLOAT', nullable: false },
          ],
          rows: [{ id: 3, sku: 'SRV-003' }],
        },
      },
    });

    expect(tampered.output).toContain('|  3 | SRV-003 |   NULL |');
    expect(tampered.output.join(' ')).not.toContain('undefined');
  });

  it('reports a database with no tables as having none rather than failing', () => {
    expect(run('SHOW TABLES', { tables: {} }).output).toEqual([
      '+--------------------+',
      '| Tables_in_app_prod |',
      '+--------------------+',
      '+--------------------+',
      '0 rows in set (0.00 sec)',
    ]);
  });
});

describe('what a database refuses to write', () => {
  it('understands each write verb and denies it by name', () => {
    // The point of parsing a statement this door will not run: a well-formed UPDATE
    // told it has a syntax error sends the player to rewrite a statement that was
    // already correct. A permission denial tells them the truth — they need a better
    // account — which is the whole ladder this game is about.
    for (const [line, verb] of [
      ["UPDATE orders SET sku = 'X' WHERE id = '1'", 'UPDATE'],
      ["DELETE FROM orders WHERE id = '1'", 'DELETE'],
      ['DROP TABLE orders', 'DROP'],
    ]) {
      expect(run(line), line).toEqual({
        failed: true,
        output: [
          `ERROR 1142 (42000): ${verb} command denied to user 'readonly'@'192.168.1.42' for table 'orders'`,
        ],
      });
    }
  });

  it('names the account and the address the connection came from', () => {
    // Both are re-sent with every statement because there is no session row holding
    // them, so a denial that named the wrong one would mean the credential the
    // prompt is holding is not the credential being checked.
    expect(
      runAs({ username: 'app_rw', sourceIp: '10.0.0.7' }, 'DROP TABLE users').output,
    ).toEqual([
      "ERROR 1142 (42000): DROP command denied to user 'app_rw'@'10.0.0.7' for table 'users'",
    ]);
  });

  it('denies a write against a table that is not there without saying so', () => {
    // Deliberately NOT 1146. A denial that fired only for real tables would answer
    // "does this table exist?" for an account with no right to ask.
    expect(run('DELETE FROM ghosts').output).toEqual([
      "ERROR 1142 (42000): DELETE command denied to user 'readonly'@'192.168.1.42' for table 'ghosts'",
    ]);
  });

  it('spells the verb in upper case however the player typed it', () => {
    expect(run("update orders set sku = 'X'").output).toEqual([
      "ERROR 1142 (42000): UPDATE command denied to user 'readonly'@'192.168.1.42' for table 'orders'",
    ]);
  });

  it('still calls a malformed write a syntax error rather than a denial', () => {
    // The refusal is earned by parsing. A write that does not parse never reaches
    // the permission check, or `UPDATE` would become a way to have any garbage
    // answered politely.
    for (const line of [
      'UPDATE orders SET',
      'UPDATE orders SET sku',
      "UPDATE orders SET sku = 'X' WHERE id",
      'DELETE orders',
      "DELETE FROM orders WHERE id",
      'DROP orders',
    ]) {
      expect(run(line), line).toEqual({
        failed: true,
        output: ['ERROR 1064 (42000): You have an error in your SQL syntax'],
      });
    }
  });
});
