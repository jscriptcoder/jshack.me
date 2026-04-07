import { useCallback, useRef } from 'react';
import { useSession } from '../session/SessionContext';
import { useFileSystem } from '../filesystem';
import { parseRedisCommand, executeRedisCommand } from '../commands/redis/index';
import type { RedisStore } from '../commands/redis/index';

type RedisExecuteResult =
  | { readonly type: 'output'; readonly text: string }
  | { readonly type: 'quit' }
  | { readonly type: 'auth_success' };

export const useRedisCommands = (): {
  readonly redisExecute: ((input: string) => RedisExecuteResult) | null;
} => {
  const { redisSession } = useSession();
  const { readFileFromMachine, writeFileToMachine } = useFileSystem();
  const authenticatedRef = useRef(false);

  const redisExecute = useCallback(
    (input: string): RedisExecuteResult => {
      if (!redisSession) {
        return { type: 'output', text: '(error) No active Redis session' };
      }

      const trimmed = input.trim();
      if (!trimmed) {
        return { type: 'output', text: '' };
      }

      const parseResult = parseRedisCommand(trimmed);
      if (!parseResult.ok) {
        return { type: 'output', text: parseResult.error };
      }

      if (parseResult.command.type === 'quit') {
        authenticatedRef.current = false;
        return { type: 'quit' };
      }

      // Read store from filesystem
      const storeJson = readFileFromMachine({
        machineId: redisSession.machineId,
        path: '/var/lib/redis/data.json',
        cwd: '/',
        userType: 'root',
      });
      if (!storeJson) {
        return { type: 'output', text: '(error) ERR Redis data unavailable' };
      }

      const store = JSON.parse(storeJson) as RedisStore;

      // Read requirepass from config
      const confContent = readFileFromMachine({
        machineId: redisSession.machineId,
        path: '/etc/redis/redis.conf',
        cwd: '/',
        userType: 'root',
      });
      const requirepass = confContent
        ?.split('\n')
        .find((l) => l.startsWith('requirepass '))
        ?.slice('requirepass '.length)
        .trim() ?? null;

      const result = executeRedisCommand(
        parseResult.command,
        store,
        requirepass,
        authenticatedRef.current,
      );

      // Track AUTH success
      if (parseResult.command.type === 'auth' && result.output === 'OK') {
        authenticatedRef.current = true;
        return { type: 'auth_success' };
      }

      // Persist mutations
      if (result.kind === 'mutation') {
        writeFileToMachine({
          machineId: redisSession.machineId,
          path: '/var/lib/redis/data.json',
          cwd: '/',
          content: JSON.stringify(result.mutatedStore),
          userType: 'root',
        });
      }

      return { type: 'output', text: result.output };
    },
    [redisSession, readFileFromMachine, writeFileToMachine],
  );

  return { redisExecute: redisSession ? redisExecute : null };
};
