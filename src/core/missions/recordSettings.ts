/**
 * What each tamper setting keeps: the one table a job is about, how its rows are drawn, which
 * value a change moves, and the two tables kept beside it that no job is about.
 *
 * Every value here is typed back by a player, into a quoted SQL condition or one comma-separated
 * line of a file, so none holds a quote, a comma or the word "and" on its own. People's names come
 * from one pool, drawn without replacement within a table, so a name never names two rows of it.
 */

import type { Prng } from '../generation/prng.js';
import type { MysqlRow, MysqlTable } from '../mysql/types.js';

export const RECORD_SETTINGS = [
  'school',
  'police',
  'payroll',
  'dmv',
  'tournament',
  'admissions',
  'club',
  'registry',
] as const;
export type RecordSetting = (typeof RECORD_SETTINGS)[number];

export type RecordAction = 'change' | 'erase';

const FIRST_NAMES: readonly string[] = [
  'Aiden',
  'Amara',
  'Ben',
  'Chloe',
  'Daniel',
  'Elena',
  'Ethan',
  'Fatima',
  'Finn',
  'Grace',
  'Hannah',
  'Isaac',
  'Jade',
  'Jonah',
  'Kara',
  'Leo',
  'Lily',
  'Marcus',
  'Maya',
  'Nadia',
  'Noah',
  'Olivia',
  'Omar',
  'Priya',
  'Quinn',
  'Rosa',
  'Ryan',
  'Sofia',
  'Tobias',
  'Una',
  'Victor',
  'Willa',
  'Yusuf',
  'Zoe',
];

const LAST_NAMES: readonly string[] = [
  'Marsh',
  'Okafor',
  'Holloway',
  'Varga',
  'Reyes',
  'Petrov',
  'Cole',
  'Haddad',
  'Gallagher',
  'Lindqvist',
  'Brooks',
  'Mendel',
  'Nakamura',
  'Price',
  'Whitlock',
  'Albescu',
  'Santos',
  'Bell',
  'Kowalski',
  'Rahman',
  'Fairburn',
  'Dunn',
  'Siddiqui',
  'Raman',
  'Harlow',
  'Delgado',
  'Thorne',
  'Ricci',
  'Engel',
  'Kerrigan',
  'Osei',
  'Grant',
  'Demir',
  'Lambert',
];

/** Every person any setting's records can name: each first name with each last name. */
export const PEOPLE: readonly string[] = FIRST_NAMES.flatMap((first) =>
  LAST_NAMES.map((last) => `${first} ${last}`),
);

type ColumnSpec = readonly [string, 'INT' | 'VARCHAR'];

/** A table's columns: the first is its key, and every column is required. */
const columnsOf = (columns: readonly ColumnSpec[]): MysqlTable['columns'] =>
  columns.map(([name, type], index) => ({
    name,
    type,
    nullable: false,
    ...(index === 0 ? { key: 'PRI' as const } : {}),
  }));

const twoDigits = (value: number): string => `${value}`.padStart(2, '0');

/** A date as the records print one, in the years given: `1987-04-12`. Days stop at 28, so every
 *  month has them. */
const dateIn = (prng: Prng, firstYear: number, lastYear: number): string =>
  `${prng.nextInt(firstYear, lastYear)}-${twoDigits(prng.nextInt(1, 12))}-${twoDigits(prng.nextInt(1, 28))}`;

/** The letters a plate or a licence uses: none read as a digit. */
const LETTERS: readonly string[] = [...'ABCDEFGHJKLMNPRSTUVWXYZ'];

const lettersOf = (prng: Prng, count: number): string =>
  Array.from({ length: count }, () => prng.pick(LETTERS)).join('');

/** A number plate: two letters, two digits, a space and three letters, `KX21 LMR`. */
const plateOf = (prng: Prng): string =>
  `${lettersOf(prng, 2)}${prng.nextInt(10, 99)} ${lettersOf(prng, 3)}`;

/** `count` plates, none twice. */
const platesOf = (prng: Prng, count: number): readonly string[] => {
  const plates = new Set<string>();
  while (plates.size < count) plates.add(plateOf(prng));
  return [...plates];
};

/** A driving licence number: a letter and seven digits, `D4821937`. */
const licenceOf = (prng: Prng): string =>
  `${lettersOf(prng, 1)}${prng.nextInt(1_000_000, 9_999_999)}`;

/** The rows a job's table is drawn as, the row the job is about, and the value a change asks
 *  for in place of the one it holds. */
export type DrawnTable = {
  readonly rows: readonly MysqlRow[];
  readonly targetIndex: number;
  /** What a change asks the target to hold; an erase never reads it. */
  readonly to: string;
};

/** A table beside the target: its name, its columns, and its rows drawn `count` at a time with
 *  no id, `person` drawing one of the people the target never names. Its id comes first and is
 *  its row number. */
export type Neighbour = {
  readonly name: string;
  readonly columns: MysqlTable['columns'];
  readonly rows: (prng: Prng, count: number, person: () => string) => readonly MysqlRow[];
};

export type SettingRecords = {
  readonly table: string;
  readonly columns: MysqlTable['columns'];
  /** The columns the briefing names the target row by, which no two rows share. */
  readonly identity: readonly string[];
  /** The column a change moves. */
  readonly changes: string;
  /** Whether a job may ask the target row gone. */
  readonly erases: boolean;
  readonly draw: (prng: Prng, action: RecordAction) => DrawnTable;
  readonly neighbours: readonly [Neighbour, Neighbour];
};

/** Twenty to forty rows for a table of people. */
const MIN_ROWS = 20;
const MAX_ROWS = 40;

/** A table of one row per person, numbered from 1, `row` filling the rest of each, with the
 *  target drawn anywhere in it and reshaped by `asTarget`. */
const peopleTable = (
  prng: Prng,
  row: (person: string) => MysqlRow,
  asTarget: (row: MysqlRow) => MysqlRow,
): { readonly rows: readonly MysqlRow[]; readonly targetIndex: number } => {
  const people = prng.pickN(PEOPLE, prng.nextInt(MIN_ROWS, MAX_ROWS));
  const drawn = people.map((person, index) => ({ id: index + 1, ...row(person) }));
  const targetIndex = prng.nextInt(0, drawn.length - 1);
  return {
    rows: drawn.map((each, index) => (index === targetIndex ? asTarget(each) : each)),
    targetIndex,
  };
};

const neighbour = (
  name: string,
  columns: readonly ColumnSpec[],
  rows: Neighbour['rows'],
): Neighbour => ({ name, columns: columnsOf([['id', 'INT'], ...columns]), rows });

/** Rows drawn one at a time, each on its own. */
const eachRow =
  (row: (prng: Prng, person: () => string) => MysqlRow): Neighbour['rows'] =>
  (prng, count, person) =>
    Array.from({ length: count }, () => row(prng, person));

/** Rows each naming one of `names`, none twice, `row` filling the rest. */
const oneEach =
  (
    names: readonly string[],
    row: (name: string, prng: Prng, person: () => string) => MysqlRow,
  ): Neighbour['rows'] =>
  (prng, count, person) =>
    prng.pickN(names, count).map((name) => row(name, prng, person));

const STATIONS: readonly string[] = ['North', 'East', 'West', 'Harbour', 'Central'];

const inspections = neighbour(
  'inspections',
  [
    ['plate', 'VARCHAR'],
    ['station', 'VARCHAR'],
    ['result', 'VARCHAR'],
  ],
  eachRow((prng) => ({
    plate: plateOf(prng),
    station: prng.pick(STATIONS),
    result: prng.pick(['pass', 'fail', 'advisory']),
  })),
);

/** A staff list whose people each hold one of `roles`, in a column named `roleColumn`. */
const staffWith = (roleColumn: string, roles: readonly string[]): Neighbour =>
  neighbour(
    'staff',
    [
      ['name', 'VARCHAR'],
      [roleColumn, 'VARCHAR'],
    ],
    eachRow((prng, person) => ({ name: person(), [roleColumn]: prng.pick(roles) })),
  );

const SUBJECTS: readonly string[] = [
  'Mathematics',
  'English',
  'Biology',
  'Chemistry',
  'Physics',
  'History',
  'Geography',
  'French',
  'Art',
  'Music',
];

const LETTER_GRADES: readonly string[] = ['A', 'B', 'C', 'D', 'F'];

/** A grade worth paying to be rid of, and one worth paying for. */
const GRADES_TO_RAISE: readonly string[] = ['C', 'D', 'F'];
const GRADES_ASKED_FOR: readonly string[] = ['A', 'B'];

/** The grade an erase job's row holds, so the briefing can call it failing. */
const FAILING_GRADE = 'F';

/** Five to eight students and four or five subjects: twenty to forty rows. */
const MIN_STUDENTS = 5;
const MAX_STUDENTS = 8;
const MIN_SUBJECTS = 4;
const MAX_SUBJECTS = 5;

/** A school's grades: each student holds one grade in each subject, so a student and a subject
 *  together name a row. A change raises a failing or middling grade; an erase takes a failing
 *  one. */
const school: SettingRecords = {
  table: 'grades',
  columns: columnsOf([
    ['id', 'INT'],
    ['student', 'VARCHAR'],
    ['subject', 'VARCHAR'],
    ['grade', 'VARCHAR'],
  ]),
  identity: ['student', 'subject'],
  changes: 'grade',
  erases: true,
  draw: (prng, action) => {
    const students = prng.pickN(PEOPLE, prng.nextInt(MIN_STUDENTS, MAX_STUDENTS));
    const subjects = prng.pickN(SUBJECTS, prng.nextInt(MIN_SUBJECTS, MAX_SUBJECTS));
    const graded = students.flatMap((student) =>
      subjects.map((subject) => ({ student, subject, grade: prng.pick(LETTER_GRADES) })),
    );
    const targetIndex = prng.nextInt(0, graded.length - 1);
    const from = prng.pick(GRADES_TO_RAISE);
    const to = prng.pick(GRADES_ASKED_FOR);
    const targetGrade = action === 'erase' ? FAILING_GRADE : from;
    return {
      rows: graded.map((row, index) => ({
        id: index + 1,
        ...row,
        grade: index === targetIndex ? targetGrade : row.grade,
      })),
      targetIndex,
      to,
    };
  },
  neighbours: [
    neighbour(
      'attendance',
      [
        ['student', 'VARCHAR'],
        ['term', 'VARCHAR'],
        ['absences', 'INT'],
      ],
      eachRow((prng, person) => ({
        student: person(),
        term: prng.pick(['Autumn', 'Spring', 'Summer']),
        absences: prng.nextInt(0, 20),
      })),
    ),
    staffWith('role', ['Teacher', 'Head of Year', 'Librarian', 'Counsellor', 'Caretaker']),
  ],
};

const CRIMES: readonly string[] = [
  'burglary',
  'fraud',
  'assault',
  'theft',
  'vandalism',
  'trespass',
  'unpaid fines',
  'forgery',
];

/** A police department's warrants. The job is about an active one: cleared, or gone. */
const police: SettingRecords = {
  table: 'warrants',
  columns: columnsOf([
    ['id', 'INT'],
    ['name', 'VARCHAR'],
    ['dob', 'VARCHAR'],
    ['offence', 'VARCHAR'],
    ['status', 'VARCHAR'],
  ]),
  identity: ['name'],
  changes: 'status',
  erases: true,
  draw: (prng) => ({
    ...peopleTable(
      prng,
      (name) => ({
        name,
        dob: dateIn(prng, 1960, 2004),
        offence: prng.pick(CRIMES),
        status: prng.pick(['active', 'cleared', 'served']),
      }),
      (row) => ({ ...row, status: 'active' }),
    ),
    to: 'cleared',
  }),
  neighbours: [
    neighbour(
      'incidents',
      [
        ['reported', 'VARCHAR'],
        ['location', 'VARCHAR'],
        ['type', 'VARCHAR'],
      ],
      eachRow((prng) => ({
        reported: dateIn(prng, 2025, 2026),
        location: prng.pick(['Mill Lane', 'Station Road', 'High Street', 'Quay Side', 'Park Row']),
        type: prng.pick(['burglary', 'collision', 'noise complaint', 'disturbance', 'theft']),
      })),
    ),
    neighbour(
      'officers',
      [
        ['name', 'VARCHAR'],
        ['badge', 'INT'],
        ['rank', 'VARCHAR'],
      ],
      eachRow((prng, person) => ({
        name: person(),
        badge: prng.nextInt(1000, 9999),
        rank: prng.pick(['Constable', 'Sergeant', 'Inspector']),
      })),
    ),
  ],
};

const DEPARTMENTS: readonly string[] = [
  'Finance',
  'Sales',
  'Operations',
  'Legal',
  'IT',
  'Marketing',
  'HR',
  'Procurement',
  'Logistics',
  'Research',
  'Support',
  'Facilities',
  'Compliance',
  'Security',
  'Design',
];

/** A raise worth paying for, in thousands. */
const MIN_RAISE_THOUSANDS = 10;
const MAX_RAISE_THOUSANDS = 30;

/** A company's payroll. The job raises one salary; nobody pays to have a salary erased. */
const payroll: SettingRecords = {
  table: 'payroll',
  columns: columnsOf([
    ['id', 'INT'],
    ['name', 'VARCHAR'],
    ['dept', 'VARCHAR'],
    ['salary', 'INT'],
  ]),
  identity: ['name'],
  changes: 'salary',
  erases: false,
  draw: (prng) => {
    const drawn = peopleTable(
      prng,
      (name) => ({ name, dept: prng.pick(DEPARTMENTS), salary: prng.nextInt(28, 95) * 1000 }),
      (row) => row,
    );
    const salary = Number(drawn.rows[drawn.targetIndex]?.['salary']);
    const raise = prng.nextInt(MIN_RAISE_THOUSANDS, MAX_RAISE_THOUSANDS) * 1000;
    return { ...drawn, to: `${salary + raise}` };
  },
  neighbours: [
    neighbour(
      'departments',
      [
        ['name', 'VARCHAR'],
        ['head', 'VARCHAR'],
      ],
      oneEach(DEPARTMENTS, (name, _prng, person) => ({ name, head: person() })),
    ),
    neighbour(
      'expenses',
      [
        ['name', 'VARCHAR'],
        ['item', 'VARCHAR'],
        ['amount', 'INT'],
      ],
      eachRow((prng, person) => ({
        name: person(),
        item: prng.pick(['travel', 'meals', 'hotel', 'equipment', 'training']),
        amount: prng.nextInt(20, 2000),
      })),
    ),
  ],
};

const DRIVING_OFFENCES: readonly string[] = [
  'speeding',
  'red light',
  'no insurance',
  'careless driving',
  'mobile phone',
  'no seatbelt',
];

/** A motor registry's offences. The job wipes one offence's points, or the offence. */
const dmv: SettingRecords = {
  table: 'offences',
  columns: columnsOf([
    ['id', 'INT'],
    ['licence', 'VARCHAR'],
    ['name', 'VARCHAR'],
    ['offence', 'VARCHAR'],
    ['points', 'INT'],
  ]),
  identity: ['name'],
  changes: 'points',
  erases: true,
  draw: (prng) => ({
    ...peopleTable(
      prng,
      (name) => ({
        licence: licenceOf(prng),
        name,
        offence: prng.pick(DRIVING_OFFENCES),
        points: prng.nextInt(1, 12),
      }),
      (row) => ({ ...row, points: prng.nextInt(3, 12) }),
    ),
    to: '0',
  }),
  neighbours: [
    inspections,
    neighbour(
      'examiners',
      [
        ['name', 'VARCHAR'],
        ['station', 'VARCHAR'],
      ],
      eachRow((prng, person) => ({ name: person(), station: prng.pick(STATIONS) })),
    ),
  ],
};

const GAMES: readonly string[] = [
  'Rift Arena',
  'Iron Circuit',
  'Starfall',
  'Hexblade',
  'Neon Drift',
  'Deadlock Run',
];

const TEAMS: readonly string[] = [
  'Night Owls',
  'Red Comets',
  'Glass Wolves',
  'Static Kings',
  'Iron Herons',
  'Lucky Sevens',
  'Paper Tigers',
  'Silent Foxes',
  'Blue Vipers',
  'Grey Ravens',
  'Low Orbit',
  'Cold Front',
  'High Voltage',
  'Last Light',
  'Wild Cards',
];

/** A raise worth paying for, in fifties. */
const MIN_SCORE_RAISE_FIFTIES = 6;
const MAX_SCORE_RAISE_FIFTIES = 18;

/** An esports league's scores. The job lifts one player's score, or takes a rival's off. */
const tournament: SettingRecords = {
  table: 'scores',
  columns: columnsOf([
    ['id', 'INT'],
    ['player', 'VARCHAR'],
    ['game', 'VARCHAR'],
    ['score', 'INT'],
  ]),
  identity: ['player'],
  changes: 'score',
  erases: true,
  draw: (prng) => {
    const drawn = peopleTable(
      prng,
      (player) => ({ player, game: prng.pick(GAMES), score: prng.nextInt(80, 280) * 10 }),
      (row) => row,
    );
    const score = Number(drawn.rows[drawn.targetIndex]?.['score']);
    const raise = prng.nextInt(MIN_SCORE_RAISE_FIFTIES, MAX_SCORE_RAISE_FIFTIES) * 50;
    return { ...drawn, to: `${score + raise}` };
  },
  neighbours: [
    neighbour(
      'teams',
      [
        ['name', 'VARCHAR'],
        ['captain', 'VARCHAR'],
      ],
      oneEach(TEAMS, (name, _prng, person) => ({ name, captain: person() })),
    ),
    neighbour(
      'matches',
      [
        ['game', 'VARCHAR'],
        ['played', 'VARCHAR'],
        ['result', 'VARCHAR'],
      ],
      eachRow((prng) => ({
        game: prng.pick(GAMES),
        played: dateIn(prng, 2025, 2026),
        result: `${prng.nextInt(0, 5)}-${prng.nextInt(0, 5)}`,
      })),
    ),
  ],
};

const PROGRAMS: readonly string[] = [
  'Law',
  'Medicine',
  'Economics',
  'Architecture',
  'Engineering',
  'Physics',
  'History',
  'Chemistry',
  'Philosophy',
  'Nursing',
  'Mathematics',
  'Geography',
  'Music',
  'Biology',
  'Linguistics',
];

/** A university's applicants. The job admits a rejected one, or takes a rival's application
 *  out of the running. */
const admissions: SettingRecords = {
  table: 'applicants',
  columns: columnsOf([
    ['id', 'INT'],
    ['name', 'VARCHAR'],
    ['dob', 'VARCHAR'],
    ['program', 'VARCHAR'],
    ['status', 'VARCHAR'],
  ]),
  identity: ['name'],
  changes: 'status',
  erases: true,
  draw: (prng, action) => ({
    ...peopleTable(
      prng,
      (name) => ({
        name,
        dob: dateIn(prng, 2003, 2008),
        program: prng.pick(PROGRAMS),
        status: prng.pick(['admitted', 'rejected', 'waitlisted']),
      }),
      (row) => (action === 'change' ? { ...row, status: 'rejected' } : row),
    ),
    to: 'admitted',
  }),
  neighbours: [
    neighbour(
      'programs',
      [
        ['program', 'VARCHAR'],
        ['places', 'INT'],
      ],
      oneEach(PROGRAMS, (program, prng) => ({ program, places: prng.nextInt(20, 200) })),
    ),
    staffWith('office', ['Admissions', 'Registry', 'Finance', 'Faculty']),
  ],
};

/** The age a member is too young at, and the age the job asks them made. */
const UNDERAGE = 17;
const OF_AGE = 21;

/** A members club's list. The job ages up a member too young to join, or lifts a ban by
 *  taking the banned member off the list. */
const club: SettingRecords = {
  table: 'members',
  columns: columnsOf([
    ['id', 'INT'],
    ['name', 'VARCHAR'],
    ['age', 'INT'],
    ['tier', 'VARCHAR'],
    ['status', 'VARCHAR'],
  ]),
  identity: ['name'],
  changes: 'age',
  erases: true,
  draw: (prng, action) => ({
    ...peopleTable(
      prng,
      (name) => ({
        name,
        age: prng.nextInt(18, 70),
        tier: prng.pick(['standard', 'silver', 'gold']),
        status: prng.pick(['active', 'lapsed', 'banned']),
      }),
      (row) => (action === 'change' ? { ...row, age: UNDERAGE } : { ...row, status: 'banned' }),
    ),
    to: `${OF_AGE}`,
  }),
  neighbours: [
    neighbour(
      'events',
      [
        ['title', 'VARCHAR'],
        ['held', 'VARCHAR'],
      ],
      eachRow((prng) => ({
        title: prng.pick([
          'Quiz Night',
          'Wine Tasting',
          'Jazz Evening',
          'Members Dinner',
          'Poker Night',
        ]),
        held: dateIn(prng, 2025, 2026),
      })),
    ),
    staffWith('role', ['Manager', 'Bartender', 'Door', 'Host']),
  ],
};

const VEHICLES: readonly (readonly [string, string])[] = [
  ['Ford', 'Focus'],
  ['Toyota', 'Corolla'],
  ['Volkswagen', 'Golf'],
  ['Honda', 'Civic'],
  ['Skoda', 'Octavia'],
  ['Nissan', 'Qashqai'],
  ['Kia', 'Sportage'],
  ['Audi', 'A4'],
  ['Mazda', 'MX5'],
  ['Volvo', 'XC60'],
];

const DEALERS: readonly string[] = [
  'Northgate Motors',
  'Crown Autos',
  'Riverside Cars',
  'Eastfield Garage',
  'Summit Motors',
  'Kingsway Autos',
  'Harbour Car Sales',
  'Oakfield Motors',
  'Westend Garage',
  'Station Autos',
  'Millbrook Cars',
  'Greenway Motors',
  'Lakeside Autos',
  'Beacon Garage',
  'Fairview Motors',
];

const TOWNS: readonly string[] = ['Ridgemont', 'Halden', 'Ashby', 'Corran', 'Wexford', 'Lindell'];

/** A vehicle registry, each car keyed by its plate. The job puts a car in another name, or takes
 *  the one car flagged stolen off the register. */
const registry: SettingRecords = {
  table: 'vehicles',
  columns: columnsOf([
    ['plate', 'VARCHAR'],
    ['owner', 'VARCHAR'],
    ['make', 'VARCHAR'],
    ['model', 'VARCHAR'],
    ['status', 'VARCHAR'],
  ]),
  identity: ['plate'],
  changes: 'owner',
  erases: true,
  draw: (prng, action) => {
    const count = prng.nextInt(MIN_ROWS, MAX_ROWS);
    // One more person than the table holds: the new owner a change asks for, never already in it.
    const people = prng.pickN(PEOPLE, count + 1);
    const plates = platesOf(prng, count);
    const targetIndex = prng.nextInt(0, count - 1);
    const rows = plates.map((plate, index) => {
      const [make, model] = prng.pick(VEHICLES);
      return {
        plate,
        owner: people[index] ?? '',
        make,
        model,
        status: action === 'erase' && index === targetIndex ? 'stolen' : 'registered',
      };
    });
    return { rows, targetIndex, to: people[count] ?? '' };
  },
  neighbours: [
    neighbour(
      'dealers',
      [
        ['name', 'VARCHAR'],
        ['town', 'VARCHAR'],
      ],
      oneEach(DEALERS, (name, prng) => ({ name, town: prng.pick(TOWNS) })),
    ),
    inspections,
  ],
};

export const SETTING_RECORDS: Readonly<Record<RecordSetting, SettingRecords>> = {
  school,
  police,
  payroll,
  dmv,
  tournament,
  admissions,
  club,
  registry,
};
