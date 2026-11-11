/**
 * The records a tamper job's box holds, and the one change the client wants made to them, a pure
 * function of the contract's number as its network is.
 *
 * Nothing here is secret: a player holding the number could draw the same rows, and the server
 * draws them again when the contractor mails in, to tell the row the job asked for from every row
 * it did not. What proves the job is the box, never anything the contractor says.
 *
 * A school's grades: a handful of students, each with one grade in each of a handful of subjects.
 * The client wants one student's failing or middling grade in one subject raised.
 */

import { createPrng } from '../generation/prng.js';
import { databaseIn } from '../mysql/datadir.js';
import type { Directory } from '../filesystem/types.js';
import type { MysqlRow, MysqlTable } from '../mysql/types.js';

/** The one row the client wants changed: whose, in what, the grade it holds and the grade it
 *  should. `rowId` is the row's own id, which the briefing never gives. */
export type RecordChange = {
  readonly rowId: number;
  readonly student: string;
  readonly subject: string;
  readonly from: string;
  readonly to: string;
};

export type MissionRecords = {
  readonly grades: MysqlTable;
  readonly target: RecordChange;
};

/** The people any setting's records name. Drawn without replacement within one table. */
const PEOPLE: readonly string[] = [
  'Aiden Marsh',
  'Amara Okafor',
  'Ben Holloway',
  'Chloe Varga',
  'Daniel Reyes',
  'Elena Petrov',
  'Ethan Cole',
  'Fatima Haddad',
  'Finn Gallagher',
  'Grace Lindqvist',
  'Hannah Brooks',
  'Isaac Mendel',
  'Jade Nakamura',
  'Jonah Price',
  'Kara Whitlock',
  'Leo Albescu',
  'Lily Santos',
  'Marcus Bell',
  'Maya Kowalski',
  'Nadia Rahman',
  'Noah Fairburn',
  'Olivia Dunn',
  'Omar Siddiqui',
  'Priya Raman',
  'Quinn Harlow',
  'Rosa Delgado',
  'Ryan Thorne',
  'Sofia Ricci',
  'Tobias Engel',
  'Una Kerrigan',
  'Victor Osei',
  'Willa Grant',
  'Yusuf Demir',
  'Zoe Lambert',
];

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

/** Five to eight students and four or five subjects: twenty to forty rows. */
const MIN_STUDENTS = 5;
const MAX_STUDENTS = 8;
const MIN_SUBJECTS = 4;
const MAX_SUBJECTS = 5;

const GRADES_COLUMNS: MysqlTable['columns'] = [
  { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
  { name: 'student', type: 'VARCHAR', nullable: false },
  { name: 'subject', type: 'VARCHAR', nullable: false },
  { name: 'grade', type: 'VARCHAR', nullable: false },
];

export const missionRecords = (missionNumber: number): MissionRecords => {
  const prng = createPrng(`mission-records-${missionNumber}`);
  const students = prng.pickN(PEOPLE, prng.nextInt(MIN_STUDENTS, MAX_STUDENTS));
  const subjects = prng.pickN(SUBJECTS, prng.nextInt(MIN_SUBJECTS, MAX_SUBJECTS));
  const graded = students.flatMap((student) =>
    subjects.map((subject) => ({ student, subject, grade: prng.pick(LETTER_GRADES) })),
  );
  const targetIndex = prng.nextInt(0, graded.length - 1);
  const from = prng.pick(GRADES_TO_RAISE);
  const to = prng.pick(GRADES_ASKED_FOR);
  const rows = graded.map((row, index) => ({
    id: index + 1,
    ...row,
    grade: index === targetIndex ? from : row.grade,
  }));
  const targetRow = graded[targetIndex];
  if (targetRow === undefined) throw new Error(`contract ${missionNumber} drew no target row`);
  return {
    grades: { columns: GRADES_COLUMNS, rows },
    target: {
      rowId: targetIndex + 1,
      student: targetRow.student,
      subject: targetRow.subject,
      from,
      to,
    },
  };
};

/** Whether two rows hold the same values in the same columns, each read as the text the
 *  database prints: a statement writes every value as text, so `3` and `'3'` are one id. */
const sameRow = (live: MysqlRow, generated: MysqlRow): boolean => {
  const columns = Object.keys(generated);
  return (
    Object.keys(live).length === columns.length &&
    columns.every((column) => column in live && `${live[column]}` === `${generated[column]}`)
  );
};

/** What the client sees when the contractor mails in: the box's records as they stand now.
 *  They read right when the target row holds the grade asked for, trimmed and case-sensitive,
 *  and every other row is exactly the row the number drew. Anything else reads wrong:
 *  the old grade, another value, a row touched or gone beside it, or no records at all. */
export const recordsLookRight = (missionNumber: number, fs: Directory): boolean => {
  const live = databaseIn(fs)?.tables['grades']?.rows;
  if (live === undefined) return false;
  const { grades, target } = missionRecords(missionNumber);
  return (
    live.length === grades.rows.length &&
    grades.rows.every((generated, index) => {
      const row = live[index];
      if (row === undefined) return false;
      if (generated['id'] !== target.rowId) return sameRow(row, generated);
      return (
        sameRow({ ...row, grade: target.from }, generated) && `${row['grade']}`.trim() === target.to
      );
    })
  );
};
