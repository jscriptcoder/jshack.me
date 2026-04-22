import type { HydraBruteForceInfo, HydraSuccess } from '../../commands/hydra';
import { parseMysqlDatabase } from '../../commands/mysql/types';
import type { UserType } from '../../session/SessionContext';
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
// NAT-aware: when the service port is forwarded (router:2222 → backend:22),
// all writes land on the backend where the daemon actually runs.
export const createHydraLogHandler =
  (deps: HydraLogDeps): HydraLogHandler =>
  (info) => {
    const { ip: logIp } = deps.resolveNat(info.targetIp, info.port);
    const hostname = resolveHostname(logIp, deps.getMachine);
    const sourceIp = resolveLogSourceIP(
      deps.sessionMachine,
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
  const aggregate = formatHydraBruteForceSsh({
    date: ctx.date,
    hostname: ctx.hostname,
    pid: generatePid(),
    sourceIp: ctx.sourceIp,
    attempts: info.attempts,
    successes: ctx.successes,
  });
  appendToMachineLog(ctx.logIp, '/var/log/auth.log', aggregate, deps.logFs);

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.username) return;
    const line = formatSshAccepted({
      date: ctx.date,
      hostname: ctx.hostname,
      pid: generatePid(),
      user: s.username,
      fromIp: ctx.sourceIp,
      port: randomEphemeralPort(),
    });
    appendToMachineLog(ctx.logIp, '/var/log/auth.log', line, deps.logFs);
  });
};

const writeFtp = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const aggregate = formatHydraBruteForceFtp({
    date: ctx.date,
    sourceIp: ctx.sourceIp,
    attempts: info.attempts,
    successes: ctx.successes,
  });
  appendToMachineLog(ctx.logIp, '/var/log/vsftpd.log', aggregate, deps.logFs);

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.username) return;
    const line = formatFtpLoginOk({ date: ctx.date, clientIp: ctx.sourceIp, user: s.username });
    appendToMachineLog(ctx.logIp, '/var/log/vsftpd.log', line, deps.logFs);
  });
};

const writeMysql = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const aggregate = formatHydraBruteForceMysql({
    date: ctx.date,
    threadId: generatePid(),
    sourceIp: ctx.sourceIp,
    attempts: info.attempts,
    successes: ctx.successes,
  });
  appendToMachineLog(ctx.logIp, '/var/log/mysql.log', aggregate, deps.logFs);

  if (info.successes.length === 0) return;

  const dbJson = deps.readFileFromMachine({
    machineId: ctx.logIp,
    path: '/var/lib/mysql/data.json',
    cwd: '/',
    userType: 'root',
  });
  const dbName = dbJson ? (parseMysqlDatabase(dbJson)?.name ?? 'unknown') : 'unknown';

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.username) return;
    const line = formatMysqlConnect({
      date: ctx.date,
      threadId: generatePid(),
      user: s.username,
      sourceIp: ctx.sourceIp,
      dbName,
    });
    appendToMachineLog(ctx.logIp, '/var/log/mysql.log', line, deps.logFs);
  });
};

const writeRedis = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: BaseCtx): void => {
  const aggregate = formatHydraBruteForceRedis({
    date: ctx.date,
    pid: generatePid(),
    sourceIp: ctx.sourceIp,
    attempts: info.attempts,
    successes: ctx.successes,
  });
  appendToMachineLog(ctx.logIp, '/var/log/redis.log', aggregate, deps.logFs);

  info.successes.forEach(() => {
    const line = formatRedisAuth({
      date: ctx.date,
      pid: generatePid(),
      sourceIp: ctx.sourceIp,
    });
    appendToMachineLog(ctx.logIp, '/var/log/redis.log', line, deps.logFs);
  });
};

const writeSnmp = (deps: HydraLogDeps, info: HydraBruteForceInfo, ctx: HostnameCtx): void => {
  const aggregate = formatHydraBruteForceSnmp({
    date: ctx.date,
    hostname: ctx.hostname,
    pid: generatePid(),
    sourceIp: ctx.sourceIp,
    attempts: info.attempts,
    successes: ctx.successes,
  });
  appendToMachineLog(ctx.logIp, '/var/log/syslog', aggregate, deps.logFs);

  info.successes.forEach((s: HydraSuccess) => {
    if (!s.community) return;
    const line = formatSnmpCommunityDiscovered({
      date: ctx.date,
      hostname: ctx.hostname,
      pid: generatePid(),
      sourceIp: ctx.sourceIp,
      community: s.community,
    });
    appendToMachineLog(ctx.logIp, '/var/log/syslog', line, deps.logFs);
  });
};
