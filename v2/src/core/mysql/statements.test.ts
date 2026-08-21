import { describe, expect, it } from 'vitest';
import { mysqlDatabaseSchema } from './types';
import { runStatement, type StatementResult } from './statements';
import type { MysqlDatabase } from './types';
import type { UserType } from '../types';

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
      { username: 'app_rw', passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99', userType: 'user' },
      { username: 'readonly', passwordHash: '098f6bcd4621d373cade4e832627b4f6', userType: 'guest' },
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
    userType: 'guest',
    sourceIp: '192.168.1.42',
  });

type Identity = {
  readonly username: string;
  readonly userType: UserType;
  readonly sourceIp: string;
};

const runAs = (identity: Identity, line: string, from: MysqlDatabase = database()) =>
  runStatement({ database: from, line, ...identity });

/** What the player sees, apart from what the door would write back. Lets a claim about
 *  the answer stay whole-value while the new database is asserted by READING it, which
 *  is how the next statement would meet it. */
const said = ({ output, failed }: StatementResult) => ({ output, failed });

/** The two rungs above the one `run` uses, named once so a test reads as the account
 *  it is about rather than as three fields that happen to differ. */
const APP: Identity = { username: 'app_rw', userType: 'user', sourceIp: '10.0.0.7' };
const ROOT: Identity = { username: 'root', userType: 'root', sourceIp: '10.0.0.7' };

describe('reading a database at the prompt', () => {
  it('lists the tables under the database own name, account list included', () => {
    // `credentials` is listed at EVERY tier, this caller being the bottom one. Same
    // shape as `/etc`, which is traversable to a guest who cannot open `passwd`: you
    // are told the thing is there, and told separately that you may not read it.
    expect(run('SHOW TABLES')).toEqual({
      failed: false,
      output: [
        '+--------------------+',
        '| Tables_in_app_prod |',
        '+--------------------+',
        '| orders             |',
        '| users              |',
        '| credentials        |',
        '+--------------------+',
        '3 rows in set (0.00 sec)',
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

  it('lists the account list even when the datadir holds no tables of its own', () => {
    // The account list is not one table among the drawn ones — it is always there. So
    // this door can never answer a player with an empty grid, whatever a tamperer with
    // root on the box deletes from the datadir.
    expect(run('SHOW TABLES', { tables: {} }).output).toEqual([
      '+--------------------+',
      '| Tables_in_app_prod |',
      '+--------------------+',
      '| credentials        |',
      '+--------------------+',
      '1 row in set (0.00 sec)',
    ]);
  });

  it('describes a table stripped of its columns as having none rather than failing', () => {
    // A datadir a player can reach as root is a datadir a player can hollow out. An
    // empty grid is the honest answer to a table with nothing in it; a crash would
    // tell the tamperer their edit landed.
    expect(run('DESCRIBE hollow', { tables: { hollow: { columns: [], rows: [] } } }).output).toEqual(
      [
        '+-------+------+------+-----+---------+-------+',
        '| Field | Type | Null | Key | Default | Extra |',
        '+-------+------+------+-----+---------+-------+',
        '+-------+------+------+-----+---------+-------+',
        '0 rows in set (0.00 sec)',
      ],
    );
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
      expect(said(run(line)), line).toEqual({
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
      runAs({ username: 'app_rw', userType: 'user', sourceIp: '10.0.0.7' }, 'DROP TABLE users')
        .output,
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

/**
 * The account list, readable as a table — the database's own `/etc/passwd`.
 *
 * The mirror is exact rather than an analogy. `/etc` is a traversable directory, so a
 * guest who runs `ls` sees `passwd` sitting in it; `PASSWD_FILE` is
 * `read: ['root', 'user']`, so that same guest cannot open it. This table has the same
 * shape one door in — listed and describable at every tier, readable only above guest —
 * so the bottom rung can see exactly what the next credential buys. A ladder nobody can
 * see the top of is not a ladder.
 *
 * It is a VIEW over the datadir's account list rather than an entry in its tables, and
 * the tier it is checked against comes from the account the connection validated as.
 */
describe('the credentials table', () => {
  const CREDENTIALS_SHAPE = [
    '+---------------+--------------+------+-----+---------+-------+',
    '| Field         | Type         | Null | Key | Default | Extra |',
    '+---------------+--------------+------+-----+---------+-------+',
    '| username      | varchar(255) | NO   | PRI | NULL    |       |',
    '| password_hash | varchar(255) | NO   |     | NULL    |       |',
    '| user_type     | varchar(255) | NO   |     | NULL    |       |',
    '+---------------+--------------+------+-----+---------+-------+',
    '3 rows in set (0.00 sec)',
  ];

  const DENIED_TO_READONLY =
    "ERROR 1142 (42000): SELECT command denied to user 'readonly'@'192.168.1.42' for table 'credentials'";

  const asUser = (line: string) =>
    runAs({ username: 'app_rw', userType: 'user', sourceIp: '10.0.0.7' }, line);

  const asRoot = (line: string) =>
    runAs({ username: 'root', userType: 'root', sourceIp: '10.0.0.7' }, line);

  it('describes at the bottom tier, so a guest reads the shape of what it cannot read', () => {
    // Seeing that a `password_hash` column is sitting there is the whole point: it is
    // what tells the bottom rung this door has something behind it worth a better
    // credential, without handing over a single hash.
    expect(run('DESCRIBE credentials')).toEqual({ failed: false, output: CREDENTIALS_SHAPE });
  });

  it('renders the account list with the hashes inline once the tier is high enough', () => {
    // Inline, the way passwd's own rows carry theirs. This transfers no capability
    // hydra does not already transfer — `john` runs the same wordlist through the same
    // md5 — so what the middle tier actually buys is SILENCE. A sweep leaves a wall of
    // denials in the target's own `mysql.log`; an offline crack writes nothing anywhere.
    expect(asUser('SELECT * FROM credentials')).toEqual({
      failed: false,
      output: [
        '+----------+----------------------------------+-----------+',
        '| username | password_hash                    | user_type |',
        '+----------+----------------------------------+-----------+',
        '| root     | d41d8cd98f00b204e9800998ecf8427e | root      |',
        '| app_rw   | 5f4dcc3b5aa765d61d8327deb882cf99 | user      |',
        '| readonly | 098f6bcd4621d373cade4e832627b4f6 | guest     |',
        '+----------+----------------------------------+-----------+',
        '3 rows in set (0.00 sec)',
      ],
    });
  });

  it('answers database root exactly as it answers the application account', () => {
    // Above the line is above the line. Root's reward is the write set it will earn,
    // not a different view of this table — and a WHERE works here like anywhere.
    expect(asRoot("SELECT username FROM credentials WHERE user_type = 'root'")).toEqual({
      failed: false,
      output: [
        '+----------+',
        '| username |',
        '+----------+',
        '| root     |',
        '+----------+',
        '1 row in set (0.00 sec)',
      ],
    });
  });

  it('refuses the bottom tier a SELECT, naming the connection that asked', () => {
    expect(run('SELECT * FROM credentials')).toEqual({
      failed: true,
      output: [DENIED_TO_READONLY],
    });
  });

  it('refuses before the field list, so the denial cannot answer which columns exist', () => {
    // The same rule that puts a write denial ahead of table resolution. An account with
    // no right to read this table has no right to be told what is in it — a refusal
    // that said `Unknown column` instead would be a working column oracle for exactly
    // the tier that must not have one.
    expect(run('SELECT nosuchcolumn FROM credentials').output).toEqual([DENIED_TO_READONLY]);
  });

  it('still lets the bottom tier read the ordinary tables', () => {
    // The refusal belongs to this table, not to the tier. A guest who lost every SELECT
    // would have nothing to do at the prompt at all, and cracking one would stop being
    // worth the wall of denials it costs.
    expect(run('SELECT email FROM users')).toEqual({
      failed: false,
      output: [
        '+-----------------+',
        '| email           |',
        '+-----------------+',
        '| ada@example.com |',
        '+-----------------+',
        '1 row in set (0.00 sec)',
      ],
    });
  });

  it('is not shadowed by a table of the same name planted in the datadir', () => {
    // The datadir is root-owned on a box a player can reach AS root, so a decoy is
    // something a player can arrange. The account list a reader gets has to be the one
    // that actually decides logins: otherwise planting an empty `credentials` table
    // would hide the real accounts from the next player through this door, and the
    // listing would name the same table twice.
    const planted: Partial<MysqlDatabase> = {
      tables: {
        credentials: {
          columns: [{ name: 'nothing', type: 'VARCHAR', nullable: true }],
          rows: [{ nothing: 'decoy' }],
        },
      },
    };

    expect(run('SHOW TABLES', planted).output).toEqual([
      '+--------------------+',
      '| Tables_in_app_prod |',
      '+--------------------+',
      '| credentials        |',
      '+--------------------+',
      '1 row in set (0.00 sec)',
    ]);
    expect(run('DESCRIBE credentials', planted).output).toEqual(CREDENTIALS_SHAPE);
  });

  it('matches the name in any case, and echoes back the spelling the player used', () => {
    // Case-insensitive like every other table name here. The denial echoes the typed
    // spelling rather than the canonical one for the same reason it fires before
    // resolution: confirming a table's exact casing is one more thing a refusal to an
    // account with no right to ask should not say.
    expect(run('DESCRIBE CREDENTIALS').output).toEqual(CREDENTIALS_SHAPE);
    expect(run('SELECT * FROM Credentials').output).toEqual([
      "ERROR 1142 (42000): SELECT command denied to user 'readonly'@'192.168.1.42' for table 'Credentials'",
    ]);
  });

  it('refuses a write on it as a write, not as a table nobody may touch', () => {
    // The bottom rung is refused this by the ladder alone. What keeps the table
    // unwritable further up is a rule of its own, held one describe down.
    expect(run('DROP TABLE credentials').output).toEqual([
      "ERROR 1142 (42000): DROP command denied to user 'readonly'@'192.168.1.42' for table 'credentials'",
    ]);
  });
});

/**
 * The ladder for writes.
 *
 * Every write was refused from every account until now, because the ladder did not
 * exist yet. The tier decides it: a guest is refused all three verbs, the application
 * account edits rows but may not remove the thing rows live in, and database root may
 * do all three. Editing rows and dropping the table are different powers, and the
 * middle rung is where that difference becomes something a player can feel.
 *
 * What an allowed write says back is legacy's, captured from `formatMutationResult`
 * and `formatDropResult` rather than typed out — including the two constants that
 * differ between them, which one shared formatter would have quietly normalised away.
 */

describe('the tier a write runs at', () => {
  it('lets the application account edit rows, counting what it moved apart from what it matched', () => {
    // `notes` already holds `rush` on the second row, so this matches two rows and
    // moves one. Without a row already carrying the value the two counters would be
    // the same number and neither could be caught being the other.
    expect(said(runAs(APP, "UPDATE orders SET notes = 'rush'"))).toEqual({
      failed: false,
      output: ['Query OK, 1 row affected (0.00 sec)', 'Rows matched: 2  Changed: 1  Warnings: 0'],
    });
  });

  it('hands back a database in which the edit is what the next statement reads', () => {
    const written = runAs(APP, "UPDATE orders SET notes = 'seen' WHERE id = '1'").database;
    expect(written).toBeDefined();
    if (written === undefined) return;

    expect(runAs(APP, 'SELECT id, notes FROM orders', written).output).toEqual([
      '+----+-------+',
      '| id | notes |',
      '+----+-------+',
      '|  1 | seen  |',
      '|  2 | rush  |',
      '+----+-------+',
      '2 rows in set (0.00 sec)',
    ]);
  });

  it('leaves the database it was handed exactly as it found it', () => {
    // The new database is a new value, not the old one edited in place. A door that
    // mutated its argument would have changed the caller's copy before the caller had
    // decided whether the write was allowed to reach the disk.
    const before = database();
    runAs(ROOT, "UPDATE orders SET notes = 'seen'", before);
    runAs(ROOT, 'DELETE FROM orders', before);
    runAs(ROOT, 'DROP TABLE orders', before);

    expect(before.tables.orders.rows).toEqual([
      { id: 1, sku: 'SRV-001', notes: null, amount: 99.99 },
      { id: 2, sku: 'SRV-002', notes: 'rush', amount: 5 },
    ]);
  });

  it('reports an edit that matched nothing as a success that moved nothing', () => {
    // Not an error: the statement was well formed, the account could run it, and the
    // answer is that no row met the condition. Zero takes the plural.
    expect(said(runAs(APP, "UPDATE orders SET notes = 'x' WHERE id = '99'"))).toEqual({
      failed: false,
      output: ['Query OK, 0 rows affected (0.00 sec)', 'Rows matched: 0  Changed: 0  Warnings: 0'],
    });
  });

  it('lets the application account delete rows, and the row is gone from what it hands back', () => {
    const result = runAs(APP, "DELETE FROM orders WHERE id = '1'");
    expect(said(result)).toEqual({
      failed: false,
      output: ['Query OK, 1 row affected (0.00 sec)', 'Rows matched: 1  Changed: 1  Warnings: 0'],
    });

    const written = result.database;
    expect(written).toBeDefined();
    if (written === undefined) return;

    expect(runAs(APP, 'SELECT id FROM orders', written).output).toEqual([
      '+----+',
      '| id |',
      '+----+',
      '|  2 |',
      '+----+',
      '1 row in set (0.00 sec)',
    ]);
  });

  it('takes the plural when a delete with no condition empties the table', () => {
    expect(said(runAs(APP, 'DELETE FROM orders'))).toEqual({
      failed: false,
      output: ['Query OK, 2 rows affected (0.00 sec)', 'Rows matched: 2  Changed: 2  Warnings: 0'],
    });
  });

  it('refuses the application account the table itself', () => {
    // The middle rung's whole shape: rows yes, the thing rows live in no.
    expect(said(runAs(APP, 'DROP TABLE orders'))).toEqual({
      failed: true,
      output: [
        "ERROR 1142 (42000): DROP command denied to user 'app_rw'@'10.0.0.7' for table 'orders'",
      ],
    });
  });

  it('lets database root drop a table, in legacy own wording and legacy own clock', () => {
    // 0.01, not 0.00. Legacy gives the drop its own formatter for exactly this, and a
    // formatter shared with the row verbs would have normalised the difference away.
    const result = runAs(ROOT, 'DROP TABLE orders');
    expect(said(result)).toEqual({
      failed: false,
      output: ['Query OK, 0 rows affected (0.01 sec)'],
    });

    const written = result.database;
    expect(written).toBeDefined();
    if (written === undefined) return;

    expect(runAs(ROOT, 'SHOW TABLES', written).output).toEqual([
      '+--------------------+',
      '| Tables_in_app_prod |',
      '+--------------------+',
      '| users              |',
      '| credentials        |',
      '+--------------------+',
      '2 rows in set (0.00 sec)',
    ]);
  });

  it('lets database root edit and delete as well, so the top rung is not drop-only', () => {
    expect(runAs(ROOT, "UPDATE users SET email = 'ada@lovelace.org'").failed).toBe(false);
    expect(runAs(ROOT, 'DELETE FROM users').failed).toBe(false);
  });

  it('drops a table named in any case', () => {
    expect(said(runAs(ROOT, 'drop table ORDERS'))).toEqual({
      failed: false,
      output: ['Query OK, 0 rows affected (0.01 sec)'],
    });
  });

  it('still refuses the bottom rung all three verbs', () => {
    // The rung a sweep returns about half the time, and the reason the ladder is worth
    // climbing at all.
    for (const [line, verb] of [
      ["UPDATE orders SET notes = 'x'", 'UPDATE'],
      ['DELETE FROM orders', 'DELETE'],
      ['DROP TABLE orders', 'DROP'],
    ]) {
      expect(said(run(line)), line).toEqual({
        failed: true,
        output: [
          `ERROR 1142 (42000): ${verb} command denied to user 'readonly'@'192.168.1.42' for table 'orders'`,
        ],
      });
    }
  });
});

describe('what a refused write is not allowed to reveal', () => {
  it('denies a verb the account may not run before asking whether the table is there', () => {
    // The refusal fires ahead of resolution whatever earned it, now that what earns
    // it is the tier rather than the verb alone: an account that may not drop cannot
    // use DROP to find out what exists.
    expect(runAs(APP, 'DROP TABLE ghosts').output).toEqual([
      "ERROR 1142 (42000): DROP command denied to user 'app_rw'@'10.0.0.7' for table 'ghosts'",
    ]);
  });

  it('tells an account that MAY run the verb that the table is not there', () => {
    // Legacy gives the drop its own code here — 1051, not the 1146 the row verbs use.
    expect(runAs(ROOT, 'DROP TABLE ghosts').output).toEqual([
      "ERROR 1051 (42S02): Unknown table 'app_prod.ghosts'",
    ]);
    expect(runAs(ROOT, "UPDATE ghosts SET sku = 'X'").output).toEqual([
      "ERROR 1146 (42S02): Table 'app_prod.ghosts' doesn't exist",
    ]);
    expect(runAs(ROOT, 'DELETE FROM ghosts').output).toEqual([
      "ERROR 1146 (42S02): Table 'app_prod.ghosts' doesn't exist",
    ]);
  });

  it('names an unknown column in the half of the statement it was typed in', () => {
    expect(runAs(APP, "UPDATE orders SET nope = 'X'").output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'field list'",
    ]);
    expect(runAs(APP, "UPDATE orders SET sku = 'X' WHERE nope = '1'").output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'where clause'",
    ]);
    expect(runAs(APP, "DELETE FROM orders WHERE nope = '1'").output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'where clause'",
    ]);
  });

  it('reads the assignments before the condition when both name something absent', () => {
    // Legacy's order, and the only statement that can tell the two checks apart.
    expect(runAs(APP, "UPDATE orders SET nope = 'X' WHERE alsonope = '1'").output).toEqual([
      "ERROR 1054 (42S22): Unknown column 'nope' in 'field list'",
    ]);
  });

  it('keeps the denial ahead of the column check for an account that may not write', () => {
    // Otherwise a refused verb becomes a column oracle for the one tier that must not
    // have one — the same reason the account list refuses before its field list.
    expect(run("UPDATE orders SET nope = 'X'").output).toEqual([
      "ERROR 1142 (42000): UPDATE command denied to user 'readonly'@'192.168.1.42' for table 'orders'",
    ]);
  });
});

describe('what the door hands back to be written', () => {
  it('hands back nothing at all for a read', () => {
    // The structural guarantee this slice spends: until now the door could not write,
    // so "a session of reads changes nothing" was true by construction. It is a rule
    // now, and this is the test that holds it.
    for (const line of ['SHOW TABLES', 'DESCRIBE orders', 'SELECT * FROM orders']) {
      expect(runAs(ROOT, line).database, line).toBeUndefined();
    }
  });

  it('hands back nothing for a write it refused', () => {
    for (const line of ['DROP TABLE orders', 'DROP TABLE credentials']) {
      expect(runAs(APP, line).database, line).toBeUndefined();
    }
    expect(run("UPDATE orders SET notes = 'x'").database).toBeUndefined();
  });

  it('hands back nothing for a statement it could not parse', () => {
    expect(runAs(ROOT, 'UPDATE orders SET').database).toBeUndefined();
  });
});

describe('the account list under a write', () => {
  it('refuses every write on it at every tier, database root included', () => {
    // It is a view over the account list, not rows in a table: writing it means writing
    // the thing that decides who may log in, which reaches back into the login door.
    // Root being refused is the point — no tier on this ladder reaches it.
    for (const identity of [ROOT, APP]) {
      for (const [line, verb] of [
        ["UPDATE credentials SET password_hash = 'x'", 'UPDATE'],
        ['DELETE FROM credentials', 'DELETE'],
        ['DROP TABLE credentials', 'DROP'],
      ]) {
        expect(said(runAs(identity, line)), `${identity.username}: ${line}`).toEqual({
          failed: true,
          output: [
            `ERROR 1142 (42000): ${verb} command denied to user '${identity.username}'@'10.0.0.7' for table 'credentials'`,
          ],
        });
      }
    }
  });

  it('is not made writable by a planted table wearing its name', () => {
    // The decoy loses the read, and it has to lose the write too, or a player could
    // plant `credentials` and then edit the planted one into existence.
    const planted = database({
      tables: { credentials: { columns: [{ name: 'x', type: 'INT', nullable: false }], rows: [] } },
    });
    expect(runAs(ROOT, "UPDATE credentials SET x = '1'", planted).output).toEqual([
      "ERROR 1142 (42000): UPDATE command denied to user 'root'@'10.0.0.7' for table 'credentials'",
    ]);
  });
});

/**
 * What a statement leaves in the daemon's own record.
 *
 * `/var/log/mysql.log` already holds every connection this box accepted and every one
 * it turned away. What it gains here is the two things a defender reading it actually
 * needs: what CHANGED, and who was told they could not change it. Reads are absent on
 * purpose — a file that logged every SELECT would bury the two lines worth finding
 * under a session's worth of noise, and a player who could see what everyone read
 * would learn more from the log than from the database.
 *
 * The engine names the tag and the text; it never stamps a time or picks a file. It is
 * the only thing here that knows what a statement DID, which is what decides whether
 * there is a line at all.
 */
describe('what a statement leaves in the record', () => {
  it('records a change as the statement that made it, verbatim under Query', () => {
    // What real MySQL's general log does. The objection to holding player text in a
    // file others read mostly dissolves one line down: it is normalized first.
    expect(runAs(APP, "UPDATE orders SET notes = 'rush'").logged).toEqual({
      tag: 'Query',
      detail: "UPDATE orders SET notes = 'rush'",
    });
    expect(runAs(APP, "DELETE FROM orders WHERE id = '1'").logged).toEqual({
      tag: 'Query',
      detail: "DELETE FROM orders WHERE id = '1'",
    });
    expect(runAs(ROOT, 'DROP TABLE orders').logged).toEqual({
      tag: 'Query',
      detail: 'DROP TABLE orders',
    });
  });

  it('records the statement as the engine read it, not as the player spaced it', () => {
    // The whole answer to "arbitrary player text in a file others cat". Every tab and
    // newline is gone before the engine sees the line, so a player can neither forge a
    // second entry nor fake the tab-delimited columns this file is read by. The
    // trailing semicolon goes the same way, because it never carried anything.
    const logged = runAs(APP, "UPDATE\torders\nSET notes = 'x\ty';  ").logged;

    expect(logged).toEqual({ tag: 'Query', detail: "UPDATE orders SET notes = 'x y'" });
  });

  it('records a refused write as the denial, without the code the player was shown', () => {
    // Mirrors the `Access denied` line this file already carries: the log says what
    // happened, the client is told which error it was.
    expect(runAs(APP, 'DROP TABLE orders').logged).toEqual({
      tag: 'Denied',
      detail: "DROP command denied to user 'app_rw'@'10.0.0.7' for table 'orders'",
    });
    expect(run("UPDATE orders SET notes = 'x'").logged).toEqual({
      tag: 'Denied',
      detail: "UPDATE command denied to user 'readonly'@'192.168.1.42' for table 'orders'",
    });
  });

  it('records an attempt on the account list, which is the one most worth reading', () => {
    expect(runAs(ROOT, "UPDATE credentials SET password_hash = 'x'").logged).toEqual({
      tag: 'Denied',
      detail: "UPDATE command denied to user 'root'@'10.0.0.7' for table 'credentials'",
    });
  });

  it('records nothing for any read, refused or not', () => {
    // Including the refused one. A `SELECT` turned away is still a SELECT, and this
    // file is about attempts to CHANGE things.
    for (const line of ['SHOW TABLES', 'DESCRIBE orders', 'SELECT * FROM orders']) {
      expect(runAs(ROOT, line).logged, line).toBeUndefined();
    }
    expect(run('SELECT * FROM credentials').logged).toBeUndefined();
  });

  it('records nothing for a write that never became one', () => {
    // A statement that could not parse, named a table that is not there, or named a
    // column that is not there changed nothing and violated nothing. Recording it
    // would fill the file with a player's typing.
    for (const line of [
      'UPDATE orders SET',
      "UPDATE ghosts SET sku = 'X'",
      "UPDATE orders SET nope = 'X'",
      "DELETE FROM orders WHERE nope = '1'",
      'DROP TABLE ghosts',
    ]) {
      expect(runAs(ROOT, line).logged, line).toBeUndefined();
    }
  });

  it('records exactly when it hands back a database, never one without the other', () => {
    // One rule with two consequences, rather than two rules that have to agree: a
    // change that persisted and a change that was recorded cannot drift apart.
    for (const line of [
      "UPDATE orders SET notes = 'rush'",
      'DELETE FROM orders',
      'DROP TABLE orders',
      'SELECT * FROM orders',
      'UPDATE orders SET',
    ]) {
      const result = runAs(ROOT, line);
      expect((result.database !== undefined) === (result.logged?.tag === 'Query'), line).toBe(true);
    }
  });
});
