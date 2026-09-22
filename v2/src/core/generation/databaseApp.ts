/**
 * The application a database holds: which one a box runs, and the rows in it.
 *
 * A network is one organisation, so the boxes on it run one application between them:
 * the one its kind of place runs, drawn once per network. Three kinds of box run their
 * own instead, because their names say what they are for: a `portal-` runs the
 * intranet's CMS, an `api-` runs an API platform, and a mail server keeps the mail
 * directory. A workstation keeps a developer's local copy of the network's application,
 * smaller and named for it.
 *
 * Every application keeps `users`, the table its people sign in through. Their
 * password hashes are bcrypt-shaped because that is what an application stores, and
 * because the only cracker in the world reverses md5: a hash lifted from this table
 * opens nothing, so reading it is recon rather than a free credential.
 *
 * Rows are TRUE to each other. Every reference names a row that exists, ids count up
 * in the order rows were made, and nothing is dated before the row it refers to or
 * after the world stopped.
 */

import { WORLD_EPOCH } from '../cve/worldClock';
import { createPrng, type Prng } from './prng';
import { networkPersona } from './persona';
import { roleOfHostname } from './pools/hostnames';
import { FIRST_NAMES_BY_INITIAL, SURNAMES } from './pools/people';
import {
  ARCHETYPE_DEFINITIONS,
  type ColumnSpec,
  type Draft,
  type DraftContext,
  type TableSpec,
} from './pools/databaseApps';
import { lanZoneName } from '../network/resolveName';
import type { LanHost } from './generateHomeLan';
import type { NetworkCategory } from './pools/essidCatalog';
import type { MysqlColumn, MysqlRow, MysqlTable } from '../mysql/types';

const DAY_MS = 86_400_000;

/** How long before the world stopped an application was installed: somewhere between
 *  about a year and about four. */
const INSTALLED_DAYS_AGO = { min: 400, max: 1500 } as const;

/** The application's login table, the same in every application. */
export const USERS_COLUMNS: readonly MysqlColumn[] = [
  { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
  { name: 'username', type: 'VARCHAR', nullable: false, key: 'UNI' },
  { name: 'email', type: 'VARCHAR', nullable: false },
  { name: 'password_hash', type: 'VARCHAR', nullable: false },
  { name: 'role', type: 'VARCHAR', nullable: false, defaultValue: 'user' },
  { name: 'created_at', type: 'DATETIME', nullable: false },
];

const BCRYPT_ALPHABET = './ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('');

/** A password hash as a PHP application stores one: cost 10, then salt and digest. */
export const bcryptHash = (prng: Prng): string =>
  `$2y$10$${Array.from({ length: 53 }, () => prng.pick(BCRYPT_ALPHABET)).join('')}`;

/**
 * The login rows for `people`, in the order they signed up.
 *
 * The first is whoever installed the application, and administers it; everyone else
 * joined afterwards, at moments drawn between the install and the last second before
 * the world stopped, so the table reads in the order its accounts were made.
 */
export const usersRows = ({
  prng,
  people,
  zone,
}: {
  readonly prng: Prng;
  readonly people: readonly string[];
  /** The network's own domain, which every login's mail is addressed to. */
  readonly zone: string;
}): readonly MysqlRow[] => {
  const installedAt =
    WORLD_EPOCH -
    prng.nextInt(INSTALLED_DAYS_AGO.min, INSTALLED_DAYS_AGO.max) * DAY_MS -
    prng.nextInt(0, DAY_MS / 1000 - 1) * 1000;
  const lastSecond = WORLD_EPOCH / 1000 - 1;
  const joined = people
    .slice(1)
    .map(() => prng.nextInt(installedAt / 1000 + 1, lastSecond) * 1000)
    .sort((earlier, later) => earlier - later);
  const createdAt = [installedAt, ...joined];
  return people.map((username, index) => ({
    id: index + 1,
    username,
    email: `${username}@${zone}`,
    password_hash: bcryptHash(prng),
    role: index === 0 ? 'admin' : 'user',
    created_at: datetimeAt(createdAt[index] ?? installedAt),
  }));
};

/** An instant as a DATETIME cell reads it: `YYYY-MM-DD HH:MM:SS`, in UTC. */
export const datetimeAt = (epochMs: number): string =>
  new Date(epochMs).toISOString().slice(0, 19).replace('T', ' ');

const instantOf = (datetime: string): number => Date.parse(`${datetime.replace(' ', 'T')}Z`);

export const ARCHETYPES = ARCHETYPE_DEFINITIONS;
export type ArchetypeKey = keyof typeof ARCHETYPES;

/** The applications each kind of place runs. */
export const ARCHETYPES_BY_CATEGORY: Readonly<Record<NetworkCategory, readonly ArchetypeKey[]>> = {
  corporate: ['helpdesk', 'crm', 'stock'],
  cafe: ['till'],
  residential: ['media', 'household'],
  university: ['enrolment', 'library'],
  public: ['library', 'bookings'],
  iot: ['telemetry'],
  hacker: ['scoreboard', 'wiki'],
};

/** The application a network's organisation runs. Its OWN stream, keyed by the network
 *  alone, so no box's stream gains a draw and every box on the network agrees. */
export const networkArchetype = (essid: string): ArchetypeKey =>
  createPrng(`db-app-network-${essid}`).pick(ARCHETYPES_BY_CATEGORY[networkPersona(essid).category]);

export const databaseArchetype = (essid: string, host: LanHost): ArchetypeKey => {
  if (host.hostname.startsWith('portal-')) return 'cms';
  if (host.hostname.startsWith('api-')) return 'api';
  if (roleOfHostname(host.hostname) === 'mailserver') return 'mail';
  return networkArchetype(essid);
};

/** The most tables an application holds, `users` included. */
const MAX_TABLES = 8;

/** Rows in a table beyond `users`: a live application's, and a developer's copy. */
const ROWS = { min: 6, max: 40 } as const;
const DEV_ROWS = { min: 5, max: 12 } as const;

const ALL_FIRST_NAMES: readonly string[] = Object.values(FIRST_NAMES_BY_INITIAL).flat();
const ALL_SURNAMES: readonly string[] = [...SURNAMES.values()];

/** A table as built so far: its rows, and the moment each was made (null when the
 *  table records none). */
type Built = { readonly rows: readonly MysqlRow[]; readonly madeAt: readonly (number | null)[] };

const columnOf = (spec: ColumnSpec): MysqlColumn => {
  const key =
    spec.fill.kind === 'serial'
      ? 'PRI'
      : spec.fill.kind === 'unique' || spec.fill.kind === 'code'
        ? 'UNI'
        : undefined;
  return {
    name: spec.name,
    type: spec.type,
    nullable: spec.nullable ?? false,
    ...(key === undefined ? {} : { key }),
  };
};

/** One row's cells before it is dated and numbered, drawn column by column. */
const draftRow = ({
  prng,
  spec,
  built,
  drawnUniques,
  index,
  install,
}: {
  readonly prng: Prng;
  readonly spec: TableSpec;
  readonly built: ReadonlyMap<string, Built>;
  readonly drawnUniques: ReadonlyMap<string, readonly string[]>;
  readonly index: number;
  readonly install: number;
}): Draft =>
  spec.columns.reduce<Draft>(
    (draft, column) => {
      const { fill } = column;
      const withCell = (value: string | number | null): Draft => ({
        ...draft,
        cells: { ...draft.cells, [column.name]: value },
      });
      switch (fill.kind) {
        case 'ref': {
          // A row is made no earlier than the row it refers to.
          const parent = built.get(fill.table);
          const at = prng.nextInt(0, (parent?.rows.length ?? 1) - 1);
          return {
            cells: { ...draft.cells, [column.name]: parent?.rows[at]?.['id'] ?? null },
            after: Math.max(draft.after, parent?.madeAt[at] ?? install),
          };
        }
        case 'pick':
          return withCell(prng.pick(fill.values));
        case 'unique':
          return withCell(drawnUniques.get(column.name)?.[index] ?? null);
        case 'int':
          return withCell(prng.nextInt(fill.min, fill.max));
        case 'flag':
          return withCell(prng.next() < fill.chance ? 1 : 0);
        case 'person':
          return withCell(`${prng.pick(ALL_FIRST_NAMES)} ${prng.pick(ALL_SURNAMES)}`);
        case 'serial':
        case 'stamp':
        case 'code':
          return draft;
      }
    },
    { cells: {}, after: install },
  );

const buildTable = ({
  prng,
  spec,
  built,
  context,
  rows,
}: {
  readonly prng: Prng;
  readonly spec: TableSpec;
  readonly built: ReadonlyMap<string, Built>;
  readonly context: DraftContext;
  readonly rows: { readonly min: number; readonly max: number };
}): { readonly table: MysqlTable; readonly built: Built } => {
  const install = context.users[0]?.madeAt ?? WORLD_EPOCH;
  const uniques = spec.columns.flatMap((column) =>
    column.fill.kind === 'unique' ? [{ name: column.name, values: column.fill.values }] : [],
  );
  const count = Math.min(
    prng.nextInt(rows.min, rows.max),
    ...uniques.map((column) => column.values.length),
  );
  const drawnUniques = new Map(
    uniques.map((column) => [column.name, prng.pickN(column.values, count)] as const),
  );
  const drafts =
    spec.draft?.(context) ??
    Array.from({ length: count }, (_, index) =>
      draftRow({ prng, spec, built, drawnUniques, index, install }),
    );

  const hasStamp = spec.columns.some((column) => column.fill.kind === 'stamp');
  const lastSecond = WORLD_EPOCH / 1000 - 1;
  const dated = drafts.map((draft) => ({
    draft,
    madeAt: hasStamp ? prng.nextInt(Math.ceil(draft.after / 1000), lastSecond) * 1000 : null,
  }));
  // Rows are numbered in the order they were made, so ids and dates ascend together.
  const ordered = hasStamp
    ? [...dated].sort((earlier, later) => (earlier.madeAt ?? 0) - (later.madeAt ?? 0))
    : dated;

  const tableRows = ordered.map(({ draft, madeAt }, index) =>
    Object.fromEntries(
      spec.columns.map((column) => {
        const { fill } = column;
        switch (fill.kind) {
          case 'serial':
            return [column.name, index + 1];
          case 'stamp':
            return [column.name, madeAt === null ? null : datetimeAt(madeAt)];
          case 'code':
            return [column.name, `${fill.prefix}${fill.start + index}`];
          default:
            return [column.name, draft.cells[column.name] ?? null];
        }
      }),
    ),
  );
  return {
    table: { columns: spec.columns.map(columnOf), rows: tableRows },
    built: { rows: tableRows, madeAt: ordered.map(({ madeAt }) => madeAt) },
  };
};

/**
 * The application `host` on `essid` runs, staffed by `people` (the box's own account
 * first). Draws on `prng`, the box's own application stream.
 */
export const buildApplication = ({
  prng,
  essid,
  host,
  people,
}: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly people: readonly string[];
}): { readonly name: string; readonly tables: Readonly<Record<string, MysqlTable>> } => {
  const archetype = ARCHETYPES[databaseArchetype(essid, host)];
  const isDevCopy = roleOfHostname(host.hostname) === 'workstation';
  const users = usersRows({ prng, people, zone: lanZoneName(essid) });

  const required = archetype.tables.filter((table) => table.required);
  const optional = archetype.tables.filter((table) => !table.required);
  const chosen = new Set(
    prng
      .pickN(optional, prng.nextInt(0, Math.min(optional.length, MAX_TABLES - 1 - required.length)))
      .map((table) => table.name),
  );
  const specs = archetype.tables.filter((table) => table.required || chosen.has(table.name));

  const context: DraftContext = {
    users: users.map((row) => ({
      id: Number(row['id']),
      username: String(row['username']),
      madeAt: instantOf(String(row['created_at'])),
    })),
    pick: prng.pick,
    nextInt: prng.nextInt,
  };
  const initial: {
    readonly built: ReadonlyMap<string, Built>;
    readonly tables: Readonly<Record<string, MysqlTable>>;
  } = {
    built: new Map([['users', { rows: users, madeAt: context.users.map((user) => user.madeAt) }]]),
    tables: { users: { columns: USERS_COLUMNS, rows: users } },
  };
  const { tables } = specs.reduce((progress, spec) => {
    const { table, built } = buildTable({
      prng,
      spec,
      built: progress.built,
      context,
      rows: isDevCopy ? DEV_ROWS : ROWS,
    });
    return {
      built: new Map([...progress.built, [spec.name, built]]),
      tables: { ...progress.tables, [spec.name]: table },
    };
  }, initial);

  const name = prng.pick(archetype.names);
  return { name: isDevCopy ? `${name}_dev` : name, tables };
};
