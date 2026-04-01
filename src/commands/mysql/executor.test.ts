import { describe, it, expect } from 'vitest';
import { executeSql } from './executor';
import type { MysqlDatabase, ParsedSql } from './types';

const createTestDb = (): MysqlDatabase => ({
  name: 'app_prod',
  tables: {
    users: {
      columns: [
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'username', type: 'VARCHAR', nullable: false },
        { name: 'role', type: 'VARCHAR', nullable: true, defaultValue: 'user' },
      ],
      rows: [
        { id: 1, username: 'admin', role: 'admin' },
        { id: 2, username: 'jsmith', role: 'user' },
        { id: 3, username: 'guest', role: 'guest' },
      ],
    },
    sessions: {
      columns: [
        { name: 'id', type: 'INT', nullable: false, key: 'PRI' },
        { name: 'user_id', type: 'INT', nullable: false },
        { name: 'token', type: 'VARCHAR', nullable: false },
      ],
      rows: [
        { id: 1, user_id: 1, token: 'abc123' },
        { id: 2, user_id: 2, token: 'def456' },
      ],
    },
  },
});

describe('executeSql', () => {
  describe('SHOW TABLES', () => {
    it('lists all tables', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'show_tables' });
      expect(result.kind).toBe('read');
      expect(result.output).toContain('users');
      expect(result.output).toContain('sessions');
      expect(result.output).toContain('2 rows in set');
    });
  });

  describe('DESCRIBE', () => {
    it('describes table columns', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'describe', table: 'users' });
      expect(result.kind).toBe('read');
      expect(result.output).toContain('id');
      expect(result.output).toContain('username');
      expect(result.output).toContain('role');
      expect(result.output).toContain('PRI');
    });

    it('returns error for nonexistent table', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'describe', table: 'nonexistent' });
      expect(result.output).toContain('ERROR 1146');
      expect(result.output).toContain("doesn't exist");
    });

    it('resolves table name case-insensitively', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'describe', table: 'USERS' });
      expect(result.kind).toBe('read');
      expect(result.output).toContain('username');
    });
  });

  describe('SELECT', () => {
    it('selects all columns with *', () => {
      const db = createTestDb();
      const parsed: ParsedSql = { type: 'select', table: 'users', columns: '*', where: [] };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('admin');
      expect(result.output).toContain('jsmith');
      expect(result.output).toContain('3 rows in set');
    });

    it('selects specific columns', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'select',
        table: 'users',
        columns: ['username', 'role'],
        where: [],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('admin');
      expect(result.output).not.toContain('| id');
    });

    it('filters with WHERE clause', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'select',
        table: 'users',
        columns: '*',
        where: [{ column: 'role', value: 'admin' }],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('admin');
      expect(result.output).toContain('1 row in set');
    });

    it('returns empty set when no rows match', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'select',
        table: 'users',
        columns: '*',
        where: [{ column: 'username', value: 'nobody' }],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toBe('Empty set (0.00 sec)');
    });

    it('returns error for unknown column in WHERE', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'select',
        table: 'users',
        columns: '*',
        where: [{ column: 'nonexistent', value: 'test' }],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('ERROR 1054');
      expect(result.output).toContain('nonexistent');
    });

    it('returns error for unknown column in field list', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'select',
        table: 'users',
        columns: ['nonexistent'],
        where: [],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('ERROR 1054');
    });
  });

  describe('UPDATE', () => {
    it('updates matching rows', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'update',
        table: 'users',
        sets: [{ column: 'role', value: 'admin' }],
        where: [{ column: 'username', value: 'jsmith' }],
      };
      const result = executeSql(db, parsed);
      expect(result.kind).toBe('mutation');
      expect(result.output).toContain('1 row affected');
      if (result.kind === 'mutation') {
        const updatedRow = result.mutatedDb.tables.users.rows.find((r) => r.username === 'jsmith');
        expect(updatedRow?.role).toBe('admin');
      }
    });

    it('reports 0 changed when value is already the same', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'update',
        table: 'users',
        sets: [{ column: 'role', value: 'admin' }],
        where: [{ column: 'username', value: 'admin' }],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('Changed: 0');
      expect(result.output).toContain('Rows matched: 1');
    });

    it('returns error for nonexistent table', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'update',
        table: 'nope',
        sets: [{ column: 'role', value: 'x' }],
        where: [],
      };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('ERROR 1146');
    });
  });

  describe('DELETE', () => {
    it('deletes matching rows', () => {
      const db = createTestDb();
      const parsed: ParsedSql = {
        type: 'delete',
        table: 'users',
        where: [{ column: 'role', value: 'guest' }],
      };
      const result = executeSql(db, parsed);
      expect(result.kind).toBe('mutation');
      expect(result.output).toContain('1 row affected');
      if (result.kind === 'mutation') {
        expect(result.mutatedDb.tables.users.rows).toHaveLength(2);
      }
    });

    it('deletes all rows without WHERE', () => {
      const db = createTestDb();
      const parsed: ParsedSql = { type: 'delete', table: 'users', where: [] };
      const result = executeSql(db, parsed);
      expect(result.output).toContain('3 rows affected');
      if (result.kind === 'mutation') {
        expect(result.mutatedDb.tables.users.rows).toHaveLength(0);
      }
    });
  });

  describe('DROP TABLE', () => {
    it('drops an existing table', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'drop_table', table: 'sessions' });
      expect(result.kind).toBe('mutation');
      expect(result.output).toContain('Query OK');
      if (result.kind === 'mutation') {
        expect(result.mutatedDb.tables).not.toHaveProperty('sessions');
        expect(result.mutatedDb.tables).toHaveProperty('users');
      }
    });

    it('returns error for nonexistent table', () => {
      const db = createTestDb();
      const result = executeSql(db, { type: 'drop_table', table: 'nope' });
      expect(result.output).toContain('ERROR 1051');
    });
  });
});
