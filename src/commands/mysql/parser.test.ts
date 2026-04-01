import { describe, it, expect } from 'vitest';
import { parseSql } from './parser';

describe('parseSql', () => {
  describe('exit/quit', () => {
    it('parses exit', () => {
      expect(parseSql('exit')).toEqual({ ok: true, parsed: { type: 'exit' } });
    });

    it('parses quit', () => {
      expect(parseSql('quit')).toEqual({ ok: true, parsed: { type: 'exit' } });
    });

    it('is case-insensitive', () => {
      expect(parseSql('EXIT')).toEqual({ ok: true, parsed: { type: 'exit' } });
      expect(parseSql('Quit')).toEqual({ ok: true, parsed: { type: 'exit' } });
    });
  });

  describe('SHOW TABLES', () => {
    it('parses SHOW TABLES', () => {
      expect(parseSql('SHOW TABLES')).toEqual({ ok: true, parsed: { type: 'show_tables' } });
    });

    it('parses with semicolon', () => {
      expect(parseSql('SHOW TABLES;')).toEqual({ ok: true, parsed: { type: 'show_tables' } });
    });

    it('is case-insensitive', () => {
      expect(parseSql('show tables')).toEqual({ ok: true, parsed: { type: 'show_tables' } });
    });

    it('handles extra whitespace', () => {
      expect(parseSql('  SHOW   TABLES  ;  ')).toEqual({
        ok: true,
        parsed: { type: 'show_tables' },
      });
    });
  });

  describe('DESCRIBE', () => {
    it('parses DESCRIBE table', () => {
      expect(parseSql('DESCRIBE users')).toEqual({
        ok: true,
        parsed: { type: 'describe', table: 'users' },
      });
    });

    it('parses DESC shorthand', () => {
      expect(parseSql('DESC users;')).toEqual({
        ok: true,
        parsed: { type: 'describe', table: 'users' },
      });
    });
  });

  describe('SELECT', () => {
    it('parses SELECT *', () => {
      expect(parseSql('SELECT * FROM users')).toEqual({
        ok: true,
        parsed: { type: 'select', table: 'users', columns: '*', where: [] },
      });
    });

    it('parses SELECT with specific columns', () => {
      expect(parseSql('SELECT id, username FROM users')).toEqual({
        ok: true,
        parsed: { type: 'select', table: 'users', columns: ['id', 'username'], where: [] },
      });
    });

    it('parses SELECT with WHERE', () => {
      expect(parseSql("SELECT * FROM users WHERE role = 'admin'")).toEqual({
        ok: true,
        parsed: {
          type: 'select',
          table: 'users',
          columns: '*',
          where: [{ column: 'role', value: 'admin' }],
        },
      });
    });

    it('parses SELECT with multiple WHERE conditions', () => {
      expect(parseSql("SELECT * FROM users WHERE role = 'admin' AND active = 'true'")).toEqual({
        ok: true,
        parsed: {
          type: 'select',
          table: 'users',
          columns: '*',
          where: [
            { column: 'role', value: 'admin' },
            { column: 'active', value: 'true' },
          ],
        },
      });
    });

    it('rejects SELECT without FROM', () => {
      const result = parseSql('SELECT *');
      expect(result.ok).toBe(false);
    });
  });

  describe('UPDATE', () => {
    it('parses UPDATE with SET and WHERE', () => {
      expect(parseSql("UPDATE users SET role = 'admin' WHERE username = 'jsmith'")).toEqual({
        ok: true,
        parsed: {
          type: 'update',
          table: 'users',
          sets: [{ column: 'role', value: 'admin' }],
          where: [{ column: 'username', value: 'jsmith' }],
        },
      });
    });

    it('parses UPDATE without WHERE', () => {
      expect(parseSql("UPDATE config SET value = 'true'")).toEqual({
        ok: true,
        parsed: {
          type: 'update',
          table: 'config',
          sets: [{ column: 'value', value: 'true' }],
          where: [],
        },
      });
    });

    it('parses UPDATE with multiple SET clauses', () => {
      expect(parseSql("UPDATE users SET role = 'admin', email = 'new@test.com'")).toEqual({
        ok: true,
        parsed: {
          type: 'update',
          table: 'users',
          sets: [
            { column: 'role', value: 'admin' },
            { column: 'email', value: 'new@test.com' },
          ],
          where: [],
        },
      });
    });
  });

  describe('DELETE', () => {
    it('parses DELETE FROM with WHERE', () => {
      expect(parseSql("DELETE FROM sessions WHERE user_id = '5'")).toEqual({
        ok: true,
        parsed: {
          type: 'delete',
          table: 'sessions',
          where: [{ column: 'user_id', value: '5' }],
        },
      });
    });

    it('parses DELETE FROM without WHERE', () => {
      expect(parseSql('DELETE FROM sessions')).toEqual({
        ok: true,
        parsed: { type: 'delete', table: 'sessions', where: [] },
      });
    });
  });

  describe('DROP TABLE', () => {
    it('parses DROP TABLE', () => {
      expect(parseSql('DROP TABLE users')).toEqual({
        ok: true,
        parsed: { type: 'drop_table', table: 'users' },
      });
    });

    it('parses with semicolon', () => {
      expect(parseSql('DROP TABLE users;')).toEqual({
        ok: true,
        parsed: { type: 'drop_table', table: 'users' },
      });
    });
  });

  describe('error handling', () => {
    it('returns syntax error for known keyword with bad syntax', () => {
      const result = parseSql('SELECT FROM');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('1064');
      }
    });

    it('returns syntax error for INSERT (known but unsupported keyword)', () => {
      const result = parseSql("INSERT INTO users VALUES ('test')");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('1064');
      }
    });

    it('returns unsupported error for completely unknown input', () => {
      const result = parseSql('HELLO WORLD');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Unsupported SQL syntax');
      }
    });

    it('returns error for empty input', () => {
      const result = parseSql('');
      expect(result.ok).toBe(false);
    });

    it('returns syntax error for CREATE TABLE', () => {
      const result = parseSql('CREATE TABLE foo (id INT)');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('1064');
      }
    });
  });
});
