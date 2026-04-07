import { describe, it, expect } from 'vitest';
import { parseRedisCommand } from './parser';

describe('parseRedisCommand', () => {
  it('parses KEYS *', () => {
    const result = parseRedisCommand('KEYS *');
    expect(result).toEqual({ ok: true, command: { type: 'keys', pattern: '*' } });
  });

  it('parses KEYS with pattern', () => {
    const result = parseRedisCommand('KEYS sess:*');
    expect(result).toEqual({ ok: true, command: { type: 'keys', pattern: 'sess:*' } });
  });

  it('parses GET', () => {
    const result = parseRedisCommand('GET app:config');
    expect(result).toEqual({ ok: true, command: { type: 'get', key: 'app:config' } });
  });

  it('returns error for GET without key', () => {
    const result = parseRedisCommand('GET');
    expect(result.ok).toBe(false);
  });

  it('parses SET', () => {
    const result = parseRedisCommand('SET mykey myvalue');
    expect(result).toEqual({ ok: true, command: { type: 'set', key: 'mykey', value: 'myvalue' } });
  });

  it('parses SET with quoted value', () => {
    const result = parseRedisCommand('SET mykey "hello world"');
    expect(result).toEqual({
      ok: true,
      command: { type: 'set', key: 'mykey', value: 'hello world' },
    });
  });

  it('returns error for SET without value', () => {
    const result = parseRedisCommand('SET mykey');
    expect(result.ok).toBe(false);
  });

  it('parses DEL', () => {
    const result = parseRedisCommand('DEL mykey');
    expect(result).toEqual({ ok: true, command: { type: 'del', key: 'mykey' } });
  });

  it('parses DBSIZE', () => {
    const result = parseRedisCommand('DBSIZE');
    expect(result).toEqual({ ok: true, command: { type: 'dbsize' } });
  });

  it('parses AUTH', () => {
    const result = parseRedisCommand('AUTH secret123');
    expect(result).toEqual({ ok: true, command: { type: 'auth', password: 'secret123' } });
  });

  it('parses QUIT and EXIT', () => {
    expect(parseRedisCommand('QUIT')).toEqual({ ok: true, command: { type: 'quit' } });
    expect(parseRedisCommand('EXIT')).toEqual({ ok: true, command: { type: 'quit' } });
  });

  it('is case-insensitive', () => {
    expect(parseRedisCommand('keys *')).toEqual({ ok: true, command: { type: 'keys', pattern: '*' } });
    expect(parseRedisCommand('get foo')).toEqual({ ok: true, command: { type: 'get', key: 'foo' } });
  });

  it('returns error for unknown commands', () => {
    const result = parseRedisCommand('FLUSHALL');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('unknown command');
  });
});
