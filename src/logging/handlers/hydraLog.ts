import type { HydraBruteForceInfo, HydraSuccess } from '../../commands/hydra';
import { parseMysqlDatabase } from '../../commands/mysql/types';
import type { UserType } from '../../session/types';
import { appendToMachineLog, type LogFileSystemDeps } from '../appendToMachineLog';
import {
  formatFtpLoginOk,
  formatHydraBruteForceFtp,
  formatHydraBruteForceMysql,
  formatHydraBruteForceRedis,
  formatHydraBruteForceSnmp,
  formatHydraBruteForceSsh,
  formatMysqlConnect,
  formatRedisAuth,
  formatSnmpCommunityDiscovered,
  formatSshAccepted,
} from '../formatters';
import { generatePid, resolveHostname, resolveLogSourceIP } from '../utils';

export type HydraLogReadFile = (op: {
  readonly machineId: string;
  readonly path: string;
  readonly cwd: string;
  readonly userType: UserType;
}) => string | null;

export type HydraLogDeps = {
  readonly sessionMachine: string;
  readonly ownWorkstationId: string;
  readonly getLocalIP: () => string;
  readonly getPublicIP: () => string | null;
  readonly resolveNat: (ip: string, port: number) => { readonly ip: string; readonly port: number };
  readonly getMachine: (ip: string) => { readonly hostname: string } | undefined;
  readonly readFileFromMachine: HydraLogReadFile;
  readonly logFs: LogFileSystemDeps;
};

export type HydraLogHandler = (info: HydraBruteForceInfo) => void;

// Writes one aggregate brute-force line plus one normal auth-success line
// per cracked credential. The success lines are indistinguishable from a
// legitimate login (reusing formatSshAccepted, formatFtpLoginOk, etc.),
// so defenders must correlate the aggregate with the success entries to
// trace a breach.
//
// All lines for a given (machineId, logPath) are composed up-front and
// emitted via a single appendToMachineLog call. Splitting the burst into
// multiple synchronous appends would race: both reads observe the same
// pre-batch React state, both writes upsert the same patch row, and only
// the last line survives.
//
// NAT-aware: when the service port is forwarded (router:2222 → backend:22),
// all writes land on the backend where the daemon actually runs.
export const createHydraLogHandler =
  (deps: HydraLogDeps): HydraLogHandler =>
  (info) => {
    const { ip: logIp } = deps.resolveNat(info.targetIp, info.port);
    const hostname = resolveHostname(logIp, deps.getMachine);
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
      deps.ownWorkstationId,
      info.targetIp,
      deps.getLocalIP(),
      deps.getPublicIP(),
    );
    const date = new Date();
    const successes = info.successes.length;

    switch (info.service) {
      case 'ssh':
        writeSsh(deps, info, { logIp, hostname, sourceIp, date, successes });
        return;
      case 'ftp':
        writeFtp(deps, info, { logIp, sourceIp, date, successes });
        return;
      case 'mysql':
        writeMysql(deps, info, { logIp, sourceIp, date, successes });
        return;
      case 'redis':
        writeRedis(deps, info, { logIp, sourceIp, date, successes });
        return;
      case 'snmp':
        writeSnmp(deps, info, { logIp, hostname, sourceIp, date, successes });
        return;
    }
  };

type BaseCtx = {
  readonly logIp: string;
  readonly sourceIp: string;
  readonly date: Date;
  readonly successes: number;
};

type HostnameCtx = BaseCtx & { readonly hostname: string };

const randomEphemeralPort = (): number => Math.floor(Math.random() * 25536) + 40000;

const writeSsh = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: HostnameCtx): void => {
  const lines: string[] = [
    formatHydraBruteForceSsh({
      date: ctx.date,
      hostname: ctx.hostname,
      pid: generatePid(),
      sourceIp: ctx.sourceIp,
      attempts: info.attempts,
      successes: ctx.successes,
    }),
  ];

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.username) return;
    lines.push(
      formatSshAccepted({
        date: ctx.date,
        hostname: ctx.hostname,
        pid: generatePid(),
        user: s.username,
        fromIp: ctx.sourceIp,
        port: randomEphemeralPort(),
      }),
    );
  });

  appendToMachineLog(ctx.logIp, '/var/log/auth.log', lines, deps.logFs);
};

const writeFtp = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const lines: string[] = [
    formatHydraBruteForceFtp({
      date: ctx.date,
      sourceIp: ctx.sourceIp,
      attempts: info.attempts,
      successes: ctx.successes,
    }),
  ];

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.username) return;
    lines.push(formatFtpLoginOk({ date: ctx.date, clientIp: ctx.sourceIp, user: s.username }));
  });

  appendToMachineLog(ctx.logIp, '/var/log/vsftpd.log', lines, deps.logFs);
};

const writeMysql = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const lines: string[] = [
    formatHydraBruteForceMysql({
      date: ctx.date,
      threadId: generatePid(),
      sourceIp: ctx.sourceIp,
      attempts: info.attempts,
      successes: ctx.successes,
    }),
  ];

  if (info.successes.length > 0) {
    const dbJson = deps.readFileFromMachine({
      machineId: ctx.logIp,
      path: '/var/lib/mysql/data.json',
      cwd: '/',
      userType: 'root',
    });
    const dbName = dbJson ? (parseMysqlDatabase(dbJson)?.name ?? 'unknown') : 'unknown';

    info.successes.forEach((s: HydraSuccess) => {
      if (!s.username) return;
      lines.push(
        formatMysqlConnect({
          date: ctx.date,
          threadId: generatePid(),
          user: s.username,
          sourceIp: ctx.sourceIp,
          dbName,
        }),
      );
    });
  }

  appendToMachineLog(ctx.logIp, '/var/log/mysql.log', lines, deps.logFs);
};

const writeRedis = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const lines: string[] = [
    formatHydraBruteForceRedis({
      date: ctx.date,
      pid: generatePid(),
      sourceIp: ctx.sourceIp,
      attempts: info.attempts,
      successes: ctx.successes,
    }),
  ];

  info.successes.forEach(() => {
    lines.push(
      formatRedisAuth({
        date: ctx.date,
        pid: generatePid(),
        sourceIp: ctx.sourceIp,
      }),
    );
  });

  appendToMachineLog(ctx.logIp, '/var/log/redis.log', lines, deps.logFs);
};

const writeSnmp = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: HostnameCtx): void => {
  const lines: string[] = [
    formatHydraBruteForceSnmp({
      date: ctx.date,
      hostname: ctx.hostname,
      pid: generatePid(),
      sourceIp: ctx.sourceIp,
      attempts: info.attempts,
      successes: ctx.successes,
    }),
  ];

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.community) return;
    lines.push(
      formatSnmpCommunityDiscovered({
        date: ctx.date,
        hostname: ctx.hostname,
        pid: generatePid(),
        sourceIp: ctx.sourceIp,
        community: s.community,
      }),
    );
  });

  appendToMachineLog(ctx.logIp, '/var/log/syslog', lines, deps.logFs);
};
