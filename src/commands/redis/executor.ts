import type { ParsedRedisCommand, RedisResult, RedisStore } from './types';

// Converts a glob-style pattern (with * wildcards) to a regex
const globToRegex = (pattern: string): RegExp => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
};

export const executeRedisCommand = (
  command: ParsedRedisCommand,
  store: RedisStore,
  requirepass: string | null,
  isAuthenticated: boolean,
): RedisResult => {
  // AUTH command is always allowed
  if (command.type === 'auth') {
    if (requirepass === null) {
      return { kind: 'read', output: '(error) ERR Client sent AUTH, but no password is set' };
    }
    if (command.password === requirepass) {
      return { kind: 'read', output: 'OK' };
    }
    return { kind: 'read', output: '(error) ERR invalid password' };
  }

  // QUIT is always allowed
  if (command.type === 'quit') {
    return { kind: 'read', output: '' };
  }

  // Block all other commands if auth is required but not authenticated
  if (requirepass !== null && !isAuthenticated) {
    return { kind: 'read', output: '(error) NOAUTH Authentication required.' };
  }

  if (command.type === 'keys') {
    const regex = globToRegex(command.pattern);
    const matching = Object.keys(store).filter((k) => regex.test(k));
    if (matching.length === 0) return { kind: 'read', output: '(empty list or set)' };
    const lines = matching.map((k, i) => `${i + 1}) "${k}"`);
    return { kind: 'read', output: lines.join('\n') };
  }

  if (command.type === 'get') {
    const value = store[command.key];
    if (value === undefined) return { kind: 'read', output: '(nil)' };
    return { kind: 'read', output: `"${value}"` };
  }

  if (command.type === 'set') {
    const mutatedStore = { ...store, [command.key]: command.value };
    return { kind: 'mutation', output: 'OK', mutatedStore };
  }

  if (command.type === 'del') {
    if (store[command.key] === undefined) {
      return { kind: 'read', output: '(integer) 0' };
    }
    const { [command.key]: _, ...rest } = store;
    return { kind: 'mutation', output: '(integer) 1', mutatedStore: rest };
  }

  if (command.type === 'dbsize') {
    return { kind: 'read', output: `(integer) ${Object.keys(store).length}` };
  }

  return { kind: 'read', output: '(error) ERR unknown command' };
};
