import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import { formatRedisAuth, formatRedisAuthDenied, formatRedisConnect } from '../formatters';
import { generatePid, resolveLogSourceIP } from '../utils';

export type RedisAuthDeps = {
  readonly sessionMachine: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly logFs: LogFileSystemDeps;
};

export type RedisConnectHandler = (targetIP: string, port: number) => void;
export type RedisAuthHandler = (success: boolean, targetIP: string, port: number) => void;

// Real Redis treats socket-open and AUTH as two events, one line each. The
// MySQL handler collapses both into a single callback because the MySQL
// protocol sends credentials in the connect handshake — for Redis we keep
// them separate so the log matches what a live `redis-server` would write.
const writeRedisLog = (
  deps: RedisAuthDeps,
  targetIP: string,
  port: number,
  build: (sourceIp: string, pid: number) => string,
): void => {
  const { ip: logIp } = deps.resolveNat(targetIP, port);
  const sourceIp = resolveLogSourceIP(
    deps.sessionMachine,
    targetIP,
    deps.getLocalIP(),
    deps.getPublicIP(),
  );
  const line = build(sourceIp, generatePid());
  appendToMachineLog(logIp, '/var/log/redis.log', line, deps.logFs);
};

export const createRedisConnectHandler =
  (deps: RedisAuthDeps): RedisConnectHandler =>
  (targetIP, port) => {
    writeRedisLog(deps, targetIP, port, (sourceIp, pid) =>
      formatRedisConnect({ date: new Date(), pid, sourceIp }),
    );
  };

export const createRedisAuthHandler =
  (deps: RedisAuthDeps): RedisAuthHandler =>
  (success, targetIP, port) => {
    writeRedisLog(deps, targetIP, port, (sourceIp, pid) => {
      const date = new Date();
      return success
        ? formatRedisAuth({ date, pid, sourceIp })
        : formatRedisAuthDenied({ date, pid, sourceIp });
    });
  };
