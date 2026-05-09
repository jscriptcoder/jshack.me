import { describe, it, expect } from 'vitest';
import { findMysqlCredential } from './mysqlDataHelpers';

const mkDb = (
  creds: ReadonlyArray<{
    username: string;
    passwordHash: string;
    userType: 'root' | 'user' | 'guest';
  }>,
) =>
  JSON.stringify({
    name: 'app',
    tables: {},
    credentials: creds,
  });

describe('findMysqlCredential', () => {
  it('returns the credential for a present username', () => {
    const content = mkDb([
      { username: 'admin', passwordHash: 'hash-admin', userType: 'root' },
      { username: 'reader', passwordHash: 'hash-reader', userType: 'guest' },
    ]);

    expect(findMysqlCredential(content, 'admin')).toEqual({
      passwordHash: 'hash-admin',
      userType: 'root',
    });
    expect(findMysqlCredential(content, 'reader')).toEqual({
      passwordHash: 'hash-reader',
      userType: 'guest',
    });
  });

  it('returns undefined when the username is absent from credentials', () => {
    const content = mkDb([{ username: 'admin', passwordHash: 'h', userType: 'root' }]);
    expect(findMysqlCredential(content, 'unknown')).toBeUndefined();
  });

  it('returns undefined for null content', () => {
    expect(findMysqlCredential(null, 'admin')).toBeUndefined();
  });

  it('returns undefined for empty content', () => {
    expect(findMysqlCredential('', 'admin')).toBeUndefined();
  });

  it('returns undefined for malformed JSON instead of throwing', () => {
    expect(findMysqlCredential('not-json', 'admin')).toBeUndefined();
    expect(findMysqlCredential('{"incomplete":', 'admin')).toBeUndefined();
  });

  it('returns undefined when credentials array is missing', () => {
    const content = JSON.stringify({ name: 'app', tables: {} });
    expect(findMysqlCredential(content, 'admin')).toBeUndefined();
  });

  it('matches usernames exactly (no prefix/substring confusion)', () => {
    const content = mkDb([
      { username: 'admin', passwordHash: 'h1', userType: 'root' },
      { username: 'administrator', passwordHash: 'h2', userType: 'user' },
    ]);
    expect(findMysqlCredential(content, 'admin')?.passwordHash).toBe('h1');
    expect(findMysqlCredential(content, 'administrator')?.passwordHash).toBe('h2');
  });
});
