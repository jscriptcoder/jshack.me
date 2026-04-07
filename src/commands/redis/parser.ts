import type { ParsedRedisCommand } from './types';

type ParseResult =
  | { readonly ok: true; readonly command: ParsedRedisCommand }
  | { readonly ok: false; readonly error: string };

export const parseRedisCommand = (input: string): ParseResult => {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, command: { type: 'quit' } };

  const parts = trimmed.match(/(?:[^\s"]+|"[^"]*")/g) ?? [];
  const cmd = (parts[0] ?? '').toUpperCase();

  if (cmd === 'KEYS') {
    const pattern = parts[1] ?? '*';
    return { ok: true, command: { type: 'keys', pattern } };
  }

  if (cmd === 'GET') {
    const key = parts[1];
    if (!key)
      return { ok: false, error: "(error) ERR wrong number of arguments for 'get' command" };
    return { ok: true, command: { type: 'get', key } };
  }

  if (cmd === 'SET') {
    const key = parts[1];
    const value = parts.slice(2).join(' ');
    if (!key || value === '')
      return { ok: false, error: "(error) ERR wrong number of arguments for 'set' command" };
    // Strip surrounding quotes from value if present
    const unquoted = value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    return { ok: true, command: { type: 'set', key, value: unquoted } };
  }

  if (cmd === 'DEL') {
    const key = parts[1];
    if (!key)
      return { ok: false, error: "(error) ERR wrong number of arguments for 'del' command" };
    return { ok: true, command: { type: 'del', key } };
  }

  if (cmd === 'DBSIZE') {
    return { ok: true, command: { type: 'dbsize' } };
  }

  if (cmd === 'AUTH') {
    const password = parts[1];
    if (!password)
      return { ok: false, error: "(error) ERR wrong number of arguments for 'auth' command" };
    return { ok: true, command: { type: 'auth', password } };
  }

  if (cmd === 'QUIT' || cmd === 'EXIT') {
    return { ok: true, command: { type: 'quit' } };
  }

  return { ok: false, error: `(error) ERR unknown command '${parts[0]}'` };
};
