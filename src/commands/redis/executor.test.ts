import { describe, it, expect } from 'vitest';
import { executeRedisCommand } from './executor';
import type { RedisStore } from './types';

const mockStore: RedisStore = {
  'sess:abc123': '{"username":"admin"}',
  'sess:def456': '{"username":"guest"}',
  'app:config': '{"db_url":"mysql://localhost"}',
  'stats:requests': '42000',
  'api:key:prod': 'sk_live_abc123',
};

describe('executeRedisCommand', () => {
  describe('KEYS', () => {
    it('returns all keys with *', () => {
      const result = executeRedisCommand({ type: 'keys', pattern: '*' }, mockStore, null, true);
      expect(result.kind).toBe('read');
      expect(result.output).toContain('sess:abc123');
      expect(result.output).toContain('app:config');
      expect(result.output).toContain('api:key:prod');
    });

    it('filters keys with glob pattern', () => {
      const result = executeRedisCommand(
        { type: 'keys', pattern: 'sess:*' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toContain('sess:abc123');
      expect(result.output).toContain('sess:def456');
      expect(result.output).not.toContain('app:config');
    });

    it('returns empty for no matches', () => {
      const result = executeRedisCommand(
        { type: 'keys', pattern: 'nonexistent:*' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toContain('empty list');
    });
  });

  describe('GET', () => {
    it('returns value for existing key', () => {
      const result = executeRedisCommand({ type: 'get', key: 'app:config' }, mockStore, null, true);
      expect(result.output).toContain('mysql://localhost');
    });

    it('returns nil for missing key', () => {
      const result = executeRedisCommand(
        { type: 'get', key: 'nonexistent' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toBe('(nil)');
    });
  });

  describe('SET', () => {
    it('creates a new key and returns OK', () => {
      const result = executeRedisCommand(
        { type: 'set', key: 'newkey', value: 'newvalue' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toBe('OK');
      expect(result.kind).toBe('mutation');
      if (result.kind === 'mutation') {
        expect(result.mutatedStore['newkey']).toBe('newvalue');
      }
    });

    it('overwrites existing key', () => {
      const result = executeRedisCommand(
        { type: 'set', key: 'stats:requests', value: '99999' },
        mockStore,
        null,
        true,
      );
      expect(result.kind).toBe('mutation');
      if (result.kind === 'mutation') {
        expect(result.mutatedStore['stats:requests']).toBe('99999');
      }
    });
  });

  describe('DEL', () => {
    it('deletes existing key and returns 1', () => {
      const result = executeRedisCommand(
        { type: 'del', key: 'stats:requests' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toBe('(integer) 1');
      expect(result.kind).toBe('mutation');
      if (result.kind === 'mutation') {
        expect(result.mutatedStore['stats:requests']).toBeUndefined();
      }
    });

    it('returns 0 for missing key', () => {
      const result = executeRedisCommand(
        { type: 'del', key: 'nonexistent' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toBe('(integer) 0');
      expect(result.kind).toBe('read');
    });
  });

  describe('DBSIZE', () => {
    it('returns key count', () => {
      const result = executeRedisCommand({ type: 'dbsize' }, mockStore, null, true);
      expect(result.output).toBe('(integer) 5');
    });
  });

  describe('AUTH', () => {
    it('returns OK for correct password', () => {
      const result = executeRedisCommand(
        { type: 'auth', password: 'secret' },
        mockStore,
        'secret',
        false,
      );
      expect(result.output).toBe('OK');
    });

    it('returns error for wrong password', () => {
      const result = executeRedisCommand(
        { type: 'auth', password: 'wrong' },
        mockStore,
        'secret',
        false,
      );
      expect(result.output).toContain('invalid password');
    });

    it('returns error when no password is set', () => {
      const result = executeRedisCommand(
        { type: 'auth', password: 'anything' },
        mockStore,
        null,
        true,
      );
      expect(result.output).toContain('no password is set');
    });
  });

  describe('NOAUTH blocking', () => {
    it('blocks commands when auth required but not authenticated', () => {
      const result = executeRedisCommand(
        { type: 'keys', pattern: '*' },
        mockStore,
        'secret',
        false,
      );
      expect(result.output).toContain('NOAUTH');
    });

    it('allows AUTH even when not authenticated', () => {
      const result = executeRedisCommand(
        { type: 'auth', password: 'secret' },
        mockStore,
        'secret',
        false,
      );
      expect(result.output).toBe('OK');
    });

    it('allows QUIT even when not authenticated', () => {
      const result = executeRedisCommand({ type: 'quit' }, mockStore, 'secret', false);
      expect(result.output).toBe('');
    });
  });
});
