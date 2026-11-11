import { describe, expect, it } from 'vitest';
import { missionRecords, recordsLookRight, type RecordTarget } from './missionRecords.js';
import { missionFiles } from './missionLeak.js';
import { missionShape } from './missionShape.js';
import { mysqlTableSchema, type MysqlDatabase } from '../mysql/types.js';
import { runStatement } from '../mysql/statements.js';
import { DATADIR_PATH, databaseIn } from '../mysql/datadir.js';
import { buildMissionKeyBoxFs } from '../generation/missionKeyBoxFs.js';
import { DATADIR_FILE, file, withFiles } from '../generation/baseFs.js';
import { materializeMachineFs } from '../network/materializeMachineFs.js';
import type { Directory } from '../filesystem/types.js';

/** A spread of contract numbers whose last octet is a host octet (2–254). */
const SAMPLE_NUMBERS = Array.from({ length: 400 }, (_unused, index) => index * 41893 + 7).filter(
  (missionNumber) => missionNumber % 256 >= 2 && missionNumber % 256 <= 254,
);

const LETTER_GRADES = ['A', 'B', 'C', 'D', 'F'];

const isChange = (missionNumber: number): boolean =>
  missionRecords(missionNumber).target.action === 'change';

const CHANGE_NUMBERS = SAMPLE_NUMBERS.filter(isChange);
const ERASE_NUMBERS = SAMPLE_NUMBERS.filter((missionNumber) => !isChange(missionNumber));

/** The row a change job asks changed, failing the test on an erase job. */
const changeTargetOf = (
  missionNumber: number,
): Extract<RecordTarget, { readonly action: 'change' }> => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'change') throw new Error(`contract ${missionNumber} is not a change`);
  return target;
};

/** The row an erase job asks gone, failing the test on a change job. */
const eraseTargetOf = (
  missionNumber: number,
): Extract<RecordTarget, { readonly action: 'erase' }> => {
  const { target } = missionRecords(missionNumber);
  if (target.action !== 'erase') throw new Error(`contract ${missionNumber} is not an erase`);
  return target;
};

describe('missionRecords', () => {
  it('draws the same records for the same number', () => {
    expect(missionRecords(66051)).toEqual(missionRecords(66051));
  });

  it('draws different records for different numbers', () => {
    expect(missionRecords(66051).grades).not.toEqual(missionRecords(66052).grades);
  });

  it('keeps a grades table a database can hold: id, student, subject and grade', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { grades } = missionRecords(missionNumber);

      expect(mysqlTableSchema.parse(grades)).toEqual(grades);
      expect(grades.columns.map(({ name }) => name)).toEqual(['id', 'student', 'subject', 'grade']);
      expect(grades.columns).toEqual([
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'student', type: 'VARCHAR', nullable: false },
        { name: 'subject', type: 'VARCHAR', nullable: false },
        { name: 'grade', type: 'VARCHAR', nullable: false },
      ]);
    }
  });

  it('names every student by a first and last name and every subject by one word', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      for (const { student, subject } of missionRecords(missionNumber).grades.rows) {
        expect(student).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
        expect(subject).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });

  it('holds 20 to 40 rows, numbered from 1, reaching both ends', () => {
    const counts = SAMPLE_NUMBERS.map((missionNumber) => {
      const { rows } = missionRecords(missionNumber).grades;
      expect(rows.map(({ id }) => id)).toEqual(rows.map((_row, index) => index + 1));
      return rows.length;
    });

    expect(Math.min(...counts)).toBe(20);
    expect(Math.max(...counts)).toBe(40);
  });

  it('gives every student one grade per subject, every one a letter from A to F', () => {
    for (const missionNumber of SAMPLE_NUMBERS) {
      const { rows } = missionRecords(missionNumber).grades;
      const pairs = rows.map(({ student, subject }) => `${student}/${subject}`);

      expect(new Set(pairs).size, `contract ${missionNumber}`).toBe(rows.length);
      for (const { grade } of rows) expect(LETTER_GRADES).toContain(grade);
    }
  });

  it('leaves every other row the grade it drew, A and B among them', () => {
    const others = SAMPLE_NUMBERS.flatMap((missionNumber) => {
      const { grades, target } = missionRecords(missionNumber);
      return grades.rows.filter(({ id }) => id !== target.rowId).map(({ grade }) => grade);
    });

    expect(new Set(others)).toEqual(new Set(LETTER_GRADES));
  });

  it('asks about half the contracts to erase a record and the rest to change one', () => {
    expect(ERASE_NUMBERS.length).toBeGreaterThan(SAMPLE_NUMBERS.length * 0.4);
    expect(CHANGE_NUMBERS.length).toBeGreaterThan(SAMPLE_NUMBERS.length * 0.4);
  });

  it('names a change target holding the old grade, the only row for that student and subject', () => {
    for (const missionNumber of CHANGE_NUMBERS) {
      const { grades } = missionRecords(missionNumber);
      const target = changeTargetOf(missionNumber);
      const matching = grades.rows.filter(
        ({ student, subject }) => student === target.student && subject === target.subject,
      );

      expect(matching, `contract ${missionNumber}`).toEqual([
        { id: target.rowId, student: target.student, subject: target.subject, grade: target.from },
      ]);
    }
  });

  // The briefing calls the grade failing, so the row it names must hold the one failing grade.
  it('names an erase target holding an F, the only row for that student and subject', () => {
    for (const missionNumber of ERASE_NUMBERS) {
      const { grades } = missionRecords(missionNumber);
      const target = eraseTargetOf(missionNumber);
      const matching = grades.rows.filter(
        ({ student, subject }) => student === target.student && subject === target.subject,
      );

      expect(target.grade).toBe('F');
      expect(matching, `contract ${missionNumber}`).toEqual([
        { id: target.rowId, student: target.student, subject: target.subject, grade: 'F' },
      ]);
    }
  });

  it('asks for a failing or middling grade to be raised to an A or a B', () => {
    const asked = CHANGE_NUMBERS.map(changeTargetOf);

    expect(new Set(asked.map(({ from }) => from))).toEqual(new Set(['C', 'D', 'F']));
    expect(new Set(asked.map(({ to }) => to))).toEqual(new Set(['A', 'B']));
  });

  it('targets rows anywhere in the table, not only the first or the last', () => {
    const positions = SAMPLE_NUMBERS.map((missionNumber) => {
      const { grades, target } = missionRecords(missionNumber);
      return target.rowId === 1 ? 'first' : target.rowId === grades.rows.length ? 'last' : 'inside';
    });

    expect(new Set(positions)).toContain('inside');
    expect(positions.filter((position) => position === 'inside').length).toBeGreaterThan(
      SAMPLE_NUMBERS.length * 0.8,
    );
  });
});

/** A tamper job whose records box falls to hydra, so its datadir is laid with no secret. */
const hydraTamperNumber = (numbers: readonly number[]): number => {
  const [found] = numbers.filter((missionNumber) => {
    const shape = missionShape(missionNumber);
    return shape.kind === 'tamper' && shape.keyBox.route === 'hydra';
  });
  if (found === undefined) throw new Error('no tamper hydra contract in the sample');
  return found;
};

const withDatadir = (box: Directory, content: string): Directory =>
  withFiles(box, [[DATADIR_PATH, file(content, DATADIR_FILE)]]);

type Rows = readonly Record<string, unknown>[];

/** A records box as the server lays it; as it stands after the application account ran each
 *  statement, each one landing; and after that with its grades rewritten by hand, as a root on
 *  the box can. */
const recordsBoxOf = (missionNumber: number) => {
  const laid = (): Directory =>
    withFiles(
      buildMissionKeyBoxFs(missionNumber),
      missionFiles(
        { missionNumber, role: 'key' },
        { keySecret: undefined, rawSecrets: undefined },
      ).map(({ path, content, perms }) => [path, file(content, perms)] as const),
    );
  const after = (...lines: readonly string[]): Directory => {
    const box = laid();
    const database = lines.reduce<MysqlDatabase | null>((current, line) => {
      if (current === null) return null;
      const result = runStatement({
        database: current,
        line,
        username: current.credentials.find(({ userType }) => userType === 'user')?.username ?? '',
        userType: 'user',
        sourceIp: '198.51.100.7',
      });
      if (result.database === undefined) throw new Error(`did not land: ${line}`);
      return result.database;
    }, databaseIn(box));
    return withDatadir(box, JSON.stringify(database));
  };
  const rewritten = (lines: readonly string[], rewrite: (rows: Rows) => Rows): Directory => {
    const database = databaseIn(after(...lines));
    if (database === null) throw new Error('the datadir could not be read');
    const grades = database.tables['grades'];
    if (grades === undefined) throw new Error('the datadir has no grades');
    return withDatadir(
      laid(),
      JSON.stringify({
        ...database,
        tables: { ...database.tables, grades: { ...grades, rows: rewrite(grades.rows) } },
      }),
    );
  };
  return { laid, after, rewritten };
};

describe('recordsLookRight on a change job', () => {
  const TAMPER_NUMBER = hydraTamperNumber(CHANGE_NUMBERS);
  const target = changeTargetOf(TAMPER_NUMBER);
  const AT_TARGET = `WHERE student = '${target.student}' AND subject = '${target.subject}'`;
  const { laid: laidBox, after: boxAfter, rewritten } = recordsBoxOf(TAMPER_NUMBER);

  /** A grade that is neither the old one nor the one asked for. */
  const THIRD_GRADE = ['A', 'B', 'C', 'D', 'F'].find(
    (grade) => grade !== target.from && grade !== target.to,
  );

  it('reads right once the target grade is the one asked for and nothing else moved', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`),
      ),
    ).toBe(true);
  });

  it('reads right with the new grade padded, since the client reads it trimmed', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '  ${target.to} ' ${AT_TARGET}`),
      ),
    ).toBe(true);
  });

  it('reads right after the row was set to something else and then to the grade asked for', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${THIRD_GRADE}' ${AT_TARGET}`,
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
        ),
      ),
    ).toBe(true);
  });

  it('reads wrong while the target still holds the old grade', () => {
    expect(recordsLookRight(TAMPER_NUMBER, laidBox())).toBe(false);
  });

  it('reads wrong with a grade that is not the one asked for', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${THIRD_GRADE}' ${AT_TARGET}`),
      ),
    ).toBe(false);
  });

  it('reads wrong with the grade in the wrong case', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(`UPDATE grades SET grade = '${target.to.toLowerCase()}' ${AT_TARGET}`),
      ),
    ).toBe(false);
  });

  it('reads wrong when every row was given the new grade', () => {
    expect(
      recordsLookRight(TAMPER_NUMBER, boxAfter(`UPDATE grades SET grade = '${target.to}'`)),
    ).toBe(false);
  });

  it('reads wrong when the target was changed and another row touched too', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `UPDATE grades SET student = 'Someone Else' WHERE id = '${otherId}'`,
        ),
      ),
    ).toBe(false);
  });

  it("reads wrong when the target's grade is right but its student was renamed", () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `UPDATE grades SET student = 'Someone Else' WHERE id = '${target.rowId}'`,
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when another row is gone', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxAfter(
          `UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`,
          `DELETE FROM grades WHERE id = '${otherId}'`,
        ),
      ),
    ).toBe(false);
  });

  /** The right change made, then the datadir rewritten by hand. */
  const boxRewritten = (rewrite: (rows: Rows) => Rows): Directory =>
    rewritten([`UPDATE grades SET grade = '${target.to}' ${AT_TARGET}`], rewrite);

  it('reads right after the change when the datadir is rewritten by hand unchanged', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) => rows),
      ),
    ).toBe(true);
  });

  it('reads wrong when a row was added beside the change', () => {
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) => [
          ...rows,
          { id: rows.length + 1, student: target.student, subject: 'Latin', grade: 'A' },
        ]),
      ),
    ).toBe(false);
  });

  it('reads wrong when another row gained a cell the records never had', () => {
    const otherId = target.rowId === 1 ? 2 : 1;
    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        boxRewritten((rows) =>
          rows.map((row) => (row['id'] === otherId ? { ...row, note: 'retake' } : row)),
        ),
      ),
    ).toBe(false);
  });

  it('reads wrong when the target row is gone', () => {
    expect(recordsLookRight(TAMPER_NUMBER, boxAfter(`DELETE FROM grades ${AT_TARGET}`))).toBe(
      false,
    );
  });

  it('reads wrong when the grades table is gone', () => {
    const database = databaseIn(laidBox());
    if (database === null) throw new Error('the datadir could not be read');
    const { grades: _grades, ...others } = database.tables;

    expect(
      recordsLookRight(
        TAMPER_NUMBER,
        withDatadir(laidBox(), JSON.stringify({ ...database, tables: others })),
      ),
    ).toBe(false);
  });

  it('reads wrong when the datadir is not a database any more', () => {
    expect(recordsLookRight(TAMPER_NUMBER, withDatadir(laidBox(), 'not a database'))).toBe(false);
  });

  it("reads wrong once a root's rm took the datadir", () => {
    const removed = materializeMachineFs(laidBox(), [
      {
        path: DATADIR_PATH,
        content: null,
        owner: 'root',
        permissions: null,
        node_type: null,
        updated_at: '2026-11-11T12:00:00Z',
        writer_key: 'a-root-on-the-box',
      },
    ]);

    expect(databaseIn(removed)).toBeNull();
    expect(recordsLookRight(TAMPER_NUMBER, removed)).toBe(false);
  });
});

describe('recordsLookRight on an erase job', () => {
  const ERASE_NUMBER = hydraTamperNumber(ERASE_NUMBERS);
  const target = eraseTargetOf(ERASE_NUMBER);
  const AT_TARGET = `WHERE student = '${target.student}' AND subject = '${target.subject}'`;
  const RIGHT_DELETE = `DELETE FROM grades ${AT_TARGET}`;
  const OTHER_ID = target.rowId === 1 ? 2 : 1;
  const { laid, after, rewritten } = recordsBoxOf(ERASE_NUMBER);

  it('reads right once the target row is gone and nothing else moved', () => {
    expect(recordsLookRight(ERASE_NUMBER, after(RIGHT_DELETE))).toBe(true);
  });

  it('reads right when the target row was deleted by its id', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`DELETE FROM grades WHERE id = '${target.rowId}'`)),
    ).toBe(true);
  });

  it('reads right after the delete when the datadir is rewritten by hand unchanged', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        rewritten([RIGHT_DELETE], (rows) => rows),
      ),
    ).toBe(true);
  });

  it('reads wrong while the target row is still there', () => {
    expect(recordsLookRight(ERASE_NUMBER, laid())).toBe(false);
  });

  it('reads wrong when every row was deleted', () => {
    expect(recordsLookRight(ERASE_NUMBER, after('DELETE FROM grades'))).toBe(false);
  });

  it('reads wrong when the target was given a passing grade instead of deleted', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`UPDATE grades SET grade = 'A' ${AT_TARGET}`)),
    ).toBe(false);
  });

  it('reads wrong when another row went with the target', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        after(RIGHT_DELETE, `DELETE FROM grades WHERE id = '${OTHER_ID}'`),
      ),
    ).toBe(false);
  });

  it('reads wrong when only another row is gone', () => {
    expect(
      recordsLookRight(ERASE_NUMBER, after(`DELETE FROM grades WHERE id = '${OTHER_ID}'`)),
    ).toBe(false);
  });

  it('reads wrong when the target is gone and another row was touched', () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        after(RIGHT_DELETE, `UPDATE grades SET grade = 'A' WHERE id = '${OTHER_ID}'`),
      ),
    ).toBe(false);
  });

  it("reads wrong when a row was added in the target row's place", () => {
    expect(
      recordsLookRight(
        ERASE_NUMBER,
        rewritten([RIGHT_DELETE], (rows) => [
          ...rows,
          { id: target.rowId, student: target.student, subject: 'Latin', grade: 'A' },
        ]),
      ),
    ).toBe(false);
  });

  it('reads wrong when the grades table is gone', () => {
    const database = databaseIn(laid());
    if (database === null) throw new Error('the datadir could not be read');
    const { grades: _grades, ...others } = database.tables;

    expect(
      recordsLookRight(
        ERASE_NUMBER,
        withDatadir(laid(), JSON.stringify({ ...database, tables: others })),
      ),
    ).toBe(false);
  });
});
