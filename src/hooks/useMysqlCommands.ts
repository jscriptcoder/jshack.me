import { useCallback } from 'react';
import { useSession } from '../session/SessionContext';
import { useFileSystem } from '../filesystem';
import { parseSql, executeSql } from '../commands/mysql/index';
import type { MysqlDatabase } from '../commands/mysql/index';

type MysqlExecuteResult =
  | { readonly type: 'output'; readonly text: string }
  | { readonly type: 'quit' };

export const useMysqlCommands = (): {
  readonly mysqlExecute: ((input: string) => MysqlExecuteResult) | null;
} => {
  const { mysqlSession } = useSession();
  const { readFileFromMachine, writeFileToMachine } = useFileSystem();

  const mysqlExecute = useCallback(
    (input: string): MysqlExecuteResult => {
      if (!mysqlSession) {
        return { type: 'output', text: 'ERROR: No active MySQL session' };
      }

      const trimmed = input.trim();
      if (!trimmed) {
        return { type: 'output', text: '' };
      }

      // Parse SQL
      const parseResult = parseSql(trimmed);
      if (!parseResult.ok) {
        return { type: 'output', text: parseResult.error };
      }

      // Handle exit/quit
      if (parseResult.parsed.type === 'exit') {
        return { type: 'quit' };
      }

      // Read database from filesystem
      const dbJson = readFileFromMachine({
        machineId: mysqlSession.machineId,
        path: '/var/lib/mysql/data.json',
        cwd: '/',
        userType: 'root',
      });
      if (!dbJson) {
        return {
          type: 'output',
          text: `ERROR 1049 (42000): Unknown database on '${mysqlSession.targetIP}'`,
        };
      }

      const db = JSON.parse(dbJson) as MysqlDatabase;

      // Execute SQL
      const result = executeSql(db, parseResult.parsed);

      // If mutation, persist back to filesystem
      if (result.kind === 'mutation') {
        writeFileToMachine({
          machineId: mysqlSession.machineId,
          path: '/var/lib/mysql/data.json',
          cwd: '/',
          content: JSON.stringify(result.mutatedDb),
          userType: 'root',
        });
      }

      return { type: 'output', text: result.output };
    },
    [mysqlSession, readFileFromMachine, writeFileToMachine],
  );

  return { mysqlExecute: mysqlSession ? mysqlExecute : null };
};
