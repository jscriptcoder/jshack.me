import { parseMysqlDatabase } from '../../commands/mysql/types';
import type { UserType } from '../../session/SessionContext';
import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatMysqlAccessDenied, formatMysqlConnect } from '../formatters';
import { generatePid, resolveLogSourceIP } from '../utils';

export type MysqlAuthReadFile = (op: {
  readonly machineId: string;
  readonly path: string;
  readonly cwd: string;
  readonly userType: UserType;
}) => string | null;

export type MysqlAuthDeps = {
  readonly sessionMachine: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly readFileFromMachine: MysqlAuthReadFile;
  readonly logFs: LogFileSystemDeps;
};

export type MysqlAuthHandler = (
  success: boolean,
  user: string,
  targetIP: string,
  port: number,
) => void;

// Writes a mysql.log entry to the MySQL daemon's host. When the public
// port is NAT-forwarded, the log lands on the backend where mysqld runs.
// The database name (needed in the "connect" line) is resolved from the
// backend's /var/lib/mysql/data.json after NAT translation.
export const createMysqlAuthHandler =
  (deps: MysqlAuthDeps): MysqlAuthHandler =>
  (success, user, targetIP, port) => {
    const { ip: logIp } = deps.resolveNat(targetIP, port);
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      targetIP,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const threadId = generatePid();
    const date = new Date();
    if (success) {
      const dbJson = deps.readFileFromMachine({
        machineId: logIp,
        path: '/var/lib/mysql/data.json',
        cwd: '/',
        userType: 'root',
      });
      const dbName = dbJson ? (parseMysqlDatabase(dbJson)?.name ?? 'unknown') : 'unknown';
      const logLine = formatMysqlConnect({ date, threadId, user, sourceIp, dbName });
      appendToMachineLog(logIp, '/var/log/mysql.log', logLine, deps.logFs);
    } else {
      const logLine = formatMysqlAccessDenied({ date, threadId, user, sourceIp });
      appendToMachineLog(logIp, '/var/log/mysql.log', logLine, deps.logFs);
    }
  };
