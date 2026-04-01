import { describe, it, expect } from 'vitest';
import {
  formatMysqlTable,
  formatShowTables,
  formatDescribeTable,
  formatSelectResult,
  formatMutationResult,
  formatDropResult,
} from './formatter';
import type { MysqlColumn, MysqlRow } from './types';

describe('formatMysqlTable', () => {
  it('formats a simple table', () => {
    const result = formatMysqlTable(
      ['id', 'name'],
      [
        ['1', 'alice'],
        ['2', 'bob'],
      ],
      [true, false],
    );
    expect(result).toContain('+----+-------+');
    expect(result).toContain('| id | name  |');
    expect(result).toContain('|  1 | alice |');
    expect(result).toContain('|  2 | bob   |');
  });

  it('right-aligns numeric columns', () => {
    const result = formatMysqlTable(['count'], [['1'], ['100']], [true]);
    expect(result).toContain('|     1 |');
    expect(result).toContain('|   100 |');
  });
});

describe('formatShowTables', () => {
  it('formats table list with count', () => {
    const result = formatShowTables(['users', 'sessions'], 'app_prod');
    expect(result).toContain('Tables_in_app_prod');
    expect(result).toContain('users');
    expect(result).toContain('sessions');
    expect(result).toContain('2 rows in set (0.00 sec)');
  });

  it('uses singular "row" for single table', () => {
    const result = formatShowTables(['users'], 'mydb');
    expect(result).toContain('1 row in set (0.00 sec)');
  });
});

describe('formatDescribeTable', () => {
  it('formats column definitions', () => {
    const columns: MysqlColumn[] = [
      { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
      { name: 'username', type: 'VARCHAR', nullable: false },
      { name: 'role', type: 'VARCHAR', nullable: true, defaultValue: 'user' },
    ];
    const result = formatDescribeTable(columns);
    expect(result).toContain('Field');
    expect(result).toContain('Type');
    expect(result).toContain('id');
    expect(result).toContain('int');
    expect(result).toContain('varchar(255)');
    expect(result).toContain('PRI');
    expect(result).toContain('user');
    expect(result).toContain('3 rows in set (0.00 sec)');
  });
});

describe('formatSelectResult', () => {
  it('formats rows with count', () => {
    const columns: MysqlColumn[] = [
      { name: 'id', type: 'INT', nullable: false },
      { name: 'name', type: 'VARCHAR', nullable: false },
    ];
    const rows: MysqlRow[] = [
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ];
    const result = formatSelectResult(columns, ['id', 'name'], rows);
    expect(result).toContain('alice');
    expect(result).toContain('bob');
    expect(result).toContain('2 rows in set (0.00 sec)');
  });

  it('returns empty set for no rows', () => {
    const result = formatSelectResult([], ['id'], []);
    expect(result).toBe('Empty set (0.00 sec)');
  });

  it('displays NULL for null values', () => {
    const columns: MysqlColumn[] = [{ name: 'value', type: 'VARCHAR', nullable: true }];
    const rows: MysqlRow[] = [{ value: null }];
    const result = formatSelectResult(columns, ['value'], rows);
    expect(result).toContain('NULL');
  });
});

describe('formatMutationResult', () => {
  it('formats with rows affected', () => {
    const result = formatMutationResult(3, 5);
    expect(result).toContain('3 rows affected');
    expect(result).toContain('Rows matched: 5');
    expect(result).toContain('Changed: 3');
  });

  it('uses singular "row" for 1 affected', () => {
    const result = formatMutationResult(1);
    expect(result).toContain('1 row affected');
  });
});

describe('formatDropResult', () => {
  it('formats drop table result', () => {
    expect(formatDropResult()).toContain('Query OK');
  });
});
