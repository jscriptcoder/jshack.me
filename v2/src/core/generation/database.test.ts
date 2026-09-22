import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { generateHomeLan, isOnHomeLan } from './generateHomeLan';
import { lanZoneName } from '../network/resolveName';
import { buildDeepHostFs } from './deepHostFs';
import { drawDatabaseCredentials } from './generateDatabase';
import {
  ARCHETYPES,
  ARCHETYPES_BY_CATEGORY,
  buildApplication,
  databaseArchetype,
  networkArchetype,
  type ArchetypeKey,
} from './databaseApp';
import { createPrng } from './prng';
import { networkPersona } from './persona';
import { roleOfHostname } from './pools/hostnames';
import { crackableEssidPool } from './generateWifi';
import { CRACK_CHANCE, CRACKABLE_PASSWORDS } from './passwordPools';
import { MYSQL_USERNAMES } from './pools/database';
import { md5 } from './md5';
import { databaseIn } from '../mysql/datadir';
import { SERVICE_CATALOG } from '../services/serviceCatalog';
import {
  ALL_ESSIDS,
  deepBoxes,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';
import type { MysqlDatabase, MysqlRow, MysqlTable } from '../mysql/types';

type DatabaseBox = Box & { readonly database: MysqlDatabase };

/** Every database the world holds: each LAN box that runs mysqld, and each deep box
 *  that does. Built inside each test rather than cached, so a mutation run credits the
 *  test that actually reads the generator. */
const everyDatabase = (): readonly DatabaseBox[] => {
  const lan = lanBoxes(ALL_ESSIDS)
    .filter(({ essid, host }) =>
      hostServices(essid, host).some(({ spec }) => spec === SERVICE_CATALOG.mysql),
    )
    .map(({ essid, host }) => ({ essid, host, fs: buildRemoteHostFs(essid, host) }));
  const deep = deepBoxes(ALL_ESSIDS).map(({ essid, host }) => ({
    essid,
    host,
    fs: buildDeepHostFs(essid, host),
  }));
  return [...lan, ...deep].flatMap(({ essid, host, fs }) => {
    const database = databaseIn(fs);
    return database === null ? [] : [{ essid, host, database }];
  });
};

const CRACKABLE_HASHES = new Set(CRACKABLE_PASSWORDS.map((password) => md5(password)));

/** A sweep's verdict kept small however wrong the world turns out to be: a count and
 *  three examples fail as loudly as a full list, and in constant time. */
const noneOf = (offenders: readonly string[]) => ({
  count: offenders.length,
  sample: offenders.slice(0, 3),
});
const NONE = { count: 0, sample: [] };

const where = ({ essid, host }: Box): string => `${essid} ${host.hostname}`;

const usersOf = (database: MysqlDatabase) => database.tables['users']?.rows ?? [];

/** The last second before the world stopped. */
const LAST_MOMENT = '2026-07-11 23:59:59';

describe('the accounts a database answers to', () => {
  it('are drawn from the box’s own database seed and from nothing else', () => {
    // The application a database holds is drawn separately, so reshaping what is IN a
    // database never moves the passwords that guard it.
    const databases = everyDatabase();
    const drifted = databases
      .filter(
        ({ essid, host, database }) =>
          JSON.stringify(database.credentials) !==
          JSON.stringify(drawDatabaseCredentials(`mysql-db-${essid}-${host.ip}`)),
      )
      .map(({ essid, host }) => `${essid} ${host.hostname}`);

    expect(databases.length).toBeGreaterThan(30);
    expect({ count: drifted.length, sample: drifted.slice(0, 3) }).toEqual({ count: 0, sample: [] });
  });

  it('are root, one application account and sometimes a read-only one, on the world’s crack ladder', () => {
    const draws = Array.from({ length: 4000 }, (_, index) =>
      drawDatabaseCredentials(`ladder-${index}`),
    );
    const byTier = (tier: 'root' | 'user' | 'guest') =>
      draws.flatMap((credentials) =>
        credentials.filter((credential) => credential.userType === tier),
      );
    const crackableShare = (tier: 'root' | 'user' | 'guest') =>
      byTier(tier).filter((credential) => CRACKABLE_HASHES.has(credential.passwordHash)).length /
      byTier(tier).length;

    expect(draws.every((credentials) => credentials[0]?.username === 'root')).toBe(true);
    expect(draws.every((credentials) => credentials[0]?.userType === 'root')).toBe(true);
    expect(draws.every((credentials) => credentials[1]?.userType === 'user')).toBe(true);
    expect(
      draws.every((credentials) => MYSQL_USERNAMES.includes(credentials[1]?.username ?? '')),
    ).toBe(true);
    expect(byTier('guest').every((credential) => credential.username === 'readonly')).toBe(true);
    expect(draws.every((credentials) => credentials.length <= 3)).toBe(true);
    expect(byTier('guest').length / draws.length).toBeCloseTo(0.5, 1);
    expect(crackableShare('root')).toBeCloseTo(CRACK_CHANCE.npcRoot, 1);
    expect(crackableShare('user')).toBeCloseTo(CRACK_CHANCE.npcUser, 1);
    expect(crackableShare('guest')).toBe(CRACK_CHANCE.guest);
  });
});

describe('the users table every application signs its people in through', () => {
  it('has the columns an application’s login table has', () => {
    const misshapen = everyDatabase()
      .filter(
        ({ database }) =>
          JSON.stringify(database.tables['users']?.columns.map((column) => column.name)) !==
          JSON.stringify(['id', 'username', 'email', 'password_hash', 'role', 'created_at']),
      )
      .map(where);

    expect(noneOf(misshapen)).toEqual(NONE);
  });

  it('is led by the box’s own account, as the application’s admin', () => {
    const databases = everyDatabase();
    const unled = databases
      .filter(({ essid, host, database }) => {
        const [first] = usersOf(database);
        return first?.['username'] !== npcUsername(essid, host) || first['role'] !== 'admin';
      })
      .map(where);

    expect(noneOf(unled)).toEqual(NONE);
  });

  it('holds everyone on the LAN, and nobody the LAN does not hold', () => {
    // The people who sign in to a network's application are the people whose machines
    // are on it: every one a player can find with a scan, and no one they cannot.
    const lan = everyDatabase().filter(({ essid, host }) => isOnHomeLan(essid, host));
    const wrong = lan.flatMap(({ essid, host, database }) => {
      const own = npcUsername(essid, host);
      const neighbours = new Set(
        generateHomeLan(essid)
          .hosts.filter((candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip)
          .map((neighbour) => npcUsername(essid, neighbour))
          .filter((username) => username !== own),
      );
      const others = usersOf(database)
        .slice(1)
        .map((row) => String(row['username']));
      return JSON.stringify([...others].sort()) === JSON.stringify([...neighbours].sort())
        ? []
        : [`${where({ essid, host })}: ${others.join(',')} vs ${[...neighbours].join(',')}`];
    });

    expect(lan.length).toBeGreaterThan(30);
    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('gives a deep box, which has no neighbours, the application’s own logins beside its account', () => {
    const deep = everyDatabase().filter(({ essid, host }) => !isOnHomeLan(essid, host));
    const thin = deep
      .filter(({ database }) => usersOf(database).length < 5)
      .map(({ essid, host, database }) => `${where({ essid, host })}: ${usersOf(database).length}`);

    expect(deep.length).toBeGreaterThan(0);
    expect(noneOf(thin)).toEqual(NONE);
  });

  it('names each login once, numbered from one', () => {
    const wrong = everyDatabase()
      .filter(({ database }) => {
        const rows = usersOf(database);
        const usernames = rows.map((row) => row['username']);
        return (
          new Set(usernames).size !== usernames.length ||
          rows.some((row, index) => row['id'] !== index + 1)
        );
      })
      .map(where);

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('addresses every login’s mail to the network’s own zone', () => {
    const wrong = everyDatabase().flatMap(({ essid, host, database }) =>
      usersOf(database)
        .filter((row) => row['email'] !== `${String(row['username'])}@${lanZoneName(essid)}`)
        .map((row) => `${where({ essid, host })}: ${String(row['email'])}`),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('stores bcrypt hashes, which no tool in the world reverses', () => {
    const wrong = everyDatabase().flatMap(({ essid, host, database }) =>
      usersOf(database)
        .map((row) => String(row['password_hash']))
        .filter((hash) => !/^\$2y\$10\$[./A-Za-z0-9]{53}$/.test(hash) || CRACKABLE_HASHES.has(hash))
        .map((hash) => `${where({ essid, host })}: ${hash}`),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('dates every login before the world stopped, in the order the logins were made', () => {
    const wrong = everyDatabase().flatMap(({ essid, host, database }) => {
      const dates = usersOf(database).map((row) => String(row['created_at']));
      const valid = dates.every(
        (date, index) =>
          /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) &&
          date <= LAST_MOMENT &&
          (index === 0 || (dates[index - 1] ?? '') <= date),
      );
      return valid ? [] : [`${where({ essid, host })}: ${dates.join(', ')}`];
    });

    expect(noneOf(wrong)).toEqual(NONE);
  });
});

const tablesBeyondUsers = (database: MysqlDatabase) =>
  Object.entries(database.tables).filter(([name]) => name !== 'users');

describe('the application a database holds', () => {
  it('is four to eight tables including users, each beyond users holding five to forty rows', () => {
    const wrong = everyDatabase().flatMap((box) => {
      const tables = Object.keys(box.database.tables);
      const shapeless =
        tables.length < 4 || tables.length > 8 || !tables.includes('users')
          ? [`${where(box)}: ${tables.join(',')}`]
          : [];
      const sized = tablesBeyondUsers(box.database)
        .filter(([, table]) => table.rows.length < 5 || table.rows.length > 40)
        .map(([name, table]) => `${where(box)} ${name}: ${table.rows.length} rows`);
      return [...shapeless, ...sized];
    });

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('is the application its archetype describes: its tables, and a name the archetype uses', () => {
    const wrong = everyDatabase().flatMap((box) => {
      const archetype = ARCHETYPES[databaseArchetype(box.essid, box.host)];
      const known = new Set(archetype.tables.map((table) => table.name));
      const required = archetype.tables.filter((table) => table.required).map((table) => table.name);
      const tables = Object.keys(box.database.tables);
      const name = box.database.name.replace(/_dev$/, '');
      return tables.every((table) => table === 'users' || known.has(table)) &&
        required.every((table) => tables.includes(table)) &&
        archetype.names.includes(name)
        ? []
        : [`${where(box)}: ${box.database.name} ${tables.join(',')}`];
    });

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('runs a CMS behind a portal, an API platform behind an api box, and a mail directory on a mail server', () => {
    const boxes = everyDatabase();
    const expected = (box: Box): string | null =>
      box.host.hostname.startsWith('portal-')
        ? 'cms'
        : box.host.hostname.startsWith('api-')
          ? 'api'
          : roleOfHostname(box.host.hostname) === 'mailserver'
            ? 'mail'
            : null;
    const wrong = boxes
      .filter((box) => expected(box) !== null)
      .filter((box) => databaseArchetype(box.essid, box.host) !== expected(box))
      .map(where);

    expect(boxes.some((box) => expected(box) === 'cms')).toBe(true);
    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('runs the network’s own application on every other box, one per network, of the kind its place runs', () => {
    // One organisation runs one application: its database box and its web box's
    // database are two copies of the same thing, never a helpdesk beside a till.
    const special = (box: Box) =>
      box.host.hostname.startsWith('portal-') ||
      box.host.hostname.startsWith('api-') ||
      roleOfHostname(box.host.hostname) === 'mailserver';
    const wrong = everyDatabase()
      .filter((box) => !special(box))
      .filter((box) => {
        const archetype = databaseArchetype(box.essid, box.host);
        return (
          archetype !== networkArchetype(box.essid) ||
          !ARCHETYPES_BY_CATEGORY[networkPersona(box.essid).category].includes(archetype)
        );
      })
      .map(where);

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('draws every archetype a kind of place can run on some network', () => {
    const drawn = new Set(crackableEssidPool.map((essid) => networkArchetype(essid)));
    const undrawn = Object.values(ARCHETYPES_BY_CATEGORY)
      .flat()
      .filter((archetype) => !drawn.has(archetype));

    expect(undrawn).toEqual([]);
  });

  it('keeps a developer’s local copy on a workstation: named _dev, and smaller', () => {
    const boxes = everyDatabase();
    const workstation = (box: Box) => roleOfHostname(box.host.hostname) === 'workstation';
    const wrong = boxes.flatMap((box) => {
      const isDev = box.database.name.endsWith('_dev');
      const largest = Math.max(...tablesBeyondUsers(box.database).map(([, table]) => table.rows.length));
      return isDev === workstation(box) && (!isDev || largest <= 12)
        ? []
        : [`${where(box)}: ${box.database.name}, largest ${largest}`];
    });

    expect(boxes.some(workstation)).toBe(true);
    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('keeps a till on a café’s network: its menu, orders, order lines and shifts', () => {
    const cafes = everyDatabase().filter(
      (box) =>
        networkPersona(box.essid).category === 'cafe' &&
        databaseArchetype(box.essid, box.host) === networkArchetype(box.essid),
    );
    const wrong = cafes
      .filter(
        (box) =>
          !['menu_items', 'orders', 'order_lines', 'shifts', 'users'].every(
            (table) => table in box.database.tables,
          ),
      )
      .map(where);

    expect(cafes.length).toBeGreaterThan(0);
    expect(noneOf(wrong)).toEqual(NONE);
  });
});

/** One database of every application, on a real network whose people staff it. The
 *  world holds some applications rarely (a mail server seldom runs mysql), and a rule
 *  proven only over the world would never read their rows. */
const oneOfEach = (): readonly (Box & { readonly archetype: ArchetypeKey; readonly database: MysqlDatabase })[] =>
  (Object.keys(ARCHETYPES) as ArchetypeKey[]).map((archetype) => {
    const prefix = archetype === 'cms' ? 'portal' : archetype === 'api' ? 'api' : archetype === 'mail' ? 'mail' : 'db';
    const essid =
      crackableEssidPool.find((candidate) => networkArchetype(candidate) === archetype) ?? 'BEAN-THERE-WIFI';
    const host = { ip: '10.40.0.9', hostname: `${prefix}-9`, kind: 'machine' as const };
    const people = ['mrodriguez', 'jchen', 'agarcia', 'hkim'];
    const { name, tables } = buildApplication({ prng: createPrng(`sample-${archetype}`), essid, host, people });
    return { essid, host, archetype, database: { name, tables, credentials: [] } };
  });

describe('a mail directory', () => {
  it('keeps a mailbox for every login and the shared ones an organisation keeps, with no address in any cell', () => {
    const sample = oneOfEach().find((box) => box.archetype === 'mail');
    const users = usersOf(sample?.database ?? { name: '', tables: {}, credentials: [] });
    const mailboxes = sample?.database.tables['mailboxes']?.rows ?? [];
    const personal = mailboxes.filter((row) => row['user_id'] !== null);
    const shared = mailboxes.filter((row) => row['user_id'] === null);
    const addresses = Object.entries(sample?.database.tables ?? {})
      .filter(([name]) => name !== 'users')
      .flatMap(([, table]) => table.rows.flatMap((row) => Object.values(row)))
      .filter((cell) => String(cell).includes('@'));

    expect(personal.map((row) => [row['user_id'], row['local_part']])).toEqual(
      expect.arrayContaining(users.map((row) => [row['id'], row['username']])),
    );
    expect(personal).toHaveLength(users.length);
    expect(shared.length).toBeGreaterThanOrEqual(2);
    expect(mailboxes.length).toBeGreaterThanOrEqual(5);
    expect(addresses).toEqual([]);
  });
});

describe('every application, sampled once', () => {
  it('is built as its archetype describes, four to eight tables of five to forty rows', () => {
    const wrong = oneOfEach().flatMap((box) => {
      const archetype = ARCHETYPES[box.archetype];
      const tables = Object.keys(box.database.tables);
      const required = archetype.tables.filter((table) => table.required).map((table) => table.name);
      const sized = tablesBeyondUsers(box.database).every(
        ([, table]) => table.rows.length >= 5 && table.rows.length <= 40,
      );
      return databaseArchetype(box.essid, box.host) === box.archetype &&
        tables.length >= 4 &&
        tables.length <= 8 &&
        required.every((table) => tables.includes(table)) &&
        sized
        ? []
        : [`${box.archetype}: ${tables.join(',')}`];
    });

    expect(noneOf(wrong)).toEqual(NONE);
  });
});

/** Every database a rule is proven over: the whole world's, and one of each
 *  application so the rarely drawn ones are read too. */
const everyApplication = (): readonly (Box & { readonly database: MysqlDatabase })[] => [
  ...everyDatabase(),
  ...oneOfEach(),
];

/** The columns of one table that refer to another, as the box's application declares
 *  them. Two applications can each hold a table of one name (`comments`), so the lookup
 *  is always through the application the box runs. */
const referencesIn = (
  box: Box,
  tableName: string,
): readonly { readonly column: string; readonly table: string }[] =>
  ARCHETYPES[databaseArchetype(box.essid, box.host)].tables
    .filter((table) => table.name === tableName)
    .flatMap((table) =>
      table.columns.flatMap((column) =>
        column.fill.kind === 'ref' ? [{ column: column.name, table: column.fill.table }] : [],
      ),
    );

/** The one DATETIME a row carries, if its table records one. */
const madeAt = (table: MysqlTable, row: MysqlRow): string | null => {
  const column = table.columns.find((candidate) => candidate.type === 'DATETIME');
  return column === undefined ? null : String(row[column.name]);
};

describe('what is true of every row', () => {
  it('refers only to rows that exist', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        referencesIn(box, name).flatMap(({ column, table: target }) => {
          const ids = new Set((box.database.tables[target]?.rows ?? []).map((row) => row['id']));
          const nullable = table.columns.find((candidate) => candidate.name === column)?.nullable ?? false;
          return table.rows
            .filter((row) => !(nullable && row[column] === null) && !ids.has(row[column]))
            .map((row) => `${where(box)} ${name}.${column}=${String(row[column])} -> ${target}`);
        }),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('numbers its rows one, two, three, and never repeats a unique value', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) => {
        const misnumbered = table.rows.some((row, index) => row['id'] !== index + 1)
          ? [`${where(box)} ${name}: ids out of order`]
          : [];
        const repeated = table.columns
          .filter((column) => column.key === 'UNI')
          .filter((column) => new Set(table.rows.map((row) => row[column.name])).size !== table.rows.length)
          .map((column) => `${where(box)} ${name}.${column.name} repeats`);
        return [...misnumbered, ...repeated];
      }),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('holds in every cell what its column’s type promises, and NULL only where a column allows it', () => {
    const fits = (type: string, cell: string | number | null): boolean => {
      switch (type) {
        case 'INT':
          return Number.isInteger(cell);
        case 'BOOLEAN':
          return cell === 0 || cell === 1;
        case 'DATETIME':
          return (
            typeof cell === 'string' &&
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(cell) &&
            !Number.isNaN(Date.parse(`${cell.replace(' ', 'T')}Z`))
          );
        default:
          return typeof cell === 'string' && cell.length > 0;
      }
    };
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        table.rows.flatMap((row) =>
          table.columns
            .filter((column) =>
              row[column.name] === null || row[column.name] === undefined
                ? !column.nullable
                : !fits(column.type, row[column.name] ?? null),
            )
            .map((column) => `${where(box)} ${name}.${column.name}=${String(row[column.name])}`),
        ),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('keeps money in whole euros', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        table.columns
          .filter((column) => column.name.endsWith('_eur') && column.type !== 'INT')
          .map((column) => `${where(box)} ${name}.${column.name}: ${column.type}`),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('dates every row before the world stopped, in id order, and never before a row it refers to', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        table.rows.flatMap((row, index) => {
          const date = madeAt(table, row);
          if (date === null) return [];
          const previous = index === 0 ? null : madeAt(table, table.rows[index - 1] ?? row);
          const parents = referencesIn(box, name).flatMap(({ column, table: target }) => {
            const parentTable = box.database.tables[target];
            const parent = parentTable?.rows.find((candidate) => candidate['id'] === row[column]);
            const parentDate = parentTable === undefined || parent === undefined ? null : madeAt(parentTable, parent);
            return parentDate === null ? [] : [parentDate];
          });
          const late = date > LAST_MOMENT;
          const outOfOrder = previous !== null && previous > date;
          const beforeParent = parents.some((parentDate) => parentDate > date);
          return late || outOfOrder || beforeParent ? [`${where(box)} ${name} row ${index + 1}: ${date}`] : [];
        }),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('states no version, leaves no slot unfilled, and names no mail address outside users', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        table.rows.flatMap((row) =>
          Object.entries(row)
            .filter(([column, cell]) => {
              const text = String(cell);
              return (
                softwareVersionsIn(text).length > 0 ||
                /[{}]|undefined|NaN/.test(text) ||
                (text.includes('@') && !(name === 'users' && column === 'email'))
              );
            })
            .map(([column, cell]) => `${where(box)} ${name}.${column}=${String(cell)}`),
        ),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });

  it('keeps every TEXT cell to one short line, so SELECT * still fits a terminal', () => {
    const wrong = everyApplication().flatMap((box) =>
      Object.entries(box.database.tables).flatMap(([name, table]) =>
        table.columns
          .filter((column) => column.type === 'TEXT')
          .flatMap((column) =>
            table.rows
              .map((row) => String(row[column.name]))
              .filter((text) => text.length > 60 || text.includes('\n'))
              .map((text) => `${where(box)} ${name}.${column.name}: ${text}`),
          ),
      ),
    );

    expect(noneOf(wrong)).toEqual(NONE);
  });
});

/** A table's rows with what is drawn fresh for every row regardless of content (a hash,
 *  a date) left out, so two tables differ only if what they SAY differs. */
const contentOf = (table: MysqlTable | undefined): string =>
  JSON.stringify(
    (table?.rows ?? []).map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(
          ([column]) =>
            column !== 'password_hash' &&
            table?.columns.find((candidate) => candidate.name === column)?.type !== 'DATETIME',
        ),
      ),
    ),
  );

const distinctShare = (values: readonly string[]): number => new Set(values).size / values.length;

describe('how databases differ', () => {
  it('never repeats a table between two databases on one network', () => {
    const databases = everyDatabase();
    const repeated = databases.flatMap((first, index) =>
      databases
        .slice(index + 1)
        .filter((second) => second.essid === first.essid)
        .flatMap((second) =>
          Object.keys(first.database.tables)
            .filter(
              (name) =>
                JSON.stringify(first.database.tables[name]?.rows) ===
                JSON.stringify(second.database.tables[name]?.rows),
            )
            .map((name) => `${where(first)} and ${second.host.hostname}: ${name}`),
        ),
    );

    expect(noneOf(repeated)).toEqual(NONE);
  });

  it('staffs nearly every database with a different set of people', () => {
    const databases = everyDatabase();

    expect(
      distinctShare(databases.map(({ database }) => contentOf(database.tables['users']))),
    ).toBeGreaterThanOrEqual(0.9);
  });

  it('fills nearly every application’s first table differently', () => {
    const databases = everyDatabase();
    const mainTables = databases.map((box) => {
      const [first] = ARCHETYPES[databaseArchetype(box.essid, box.host)].tables;
      return contentOf(box.database.tables[first?.name ?? '']);
    });

    expect(distinctShare(mainTables)).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps nothing of the generic pool the applications replaced', () => {
    const leftovers = everyApplication().flatMap((box) =>
      Object.values(box.database.tables)
        .flatMap((table) => table.rows.flatMap((row) => Object.values(row)))
        .filter((cell) => /company\.local|corp\.internal|acme\.local/.test(String(cell)))
        .map((cell) => `${where(box)}: ${String(cell)}`),
    );

    expect(noneOf(leftovers)).toEqual(NONE);
  });
});
