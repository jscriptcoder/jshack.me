import type { Prng } from '../prng';
import type { Difficulty, GeneratedMachine, MissionObjective } from '../types';
import type { FileNode } from '../../filesystem/types';
import type { ForensicsLogType } from '../pools';
import {
  forensicsCallingCardTemplates,
  forensicsLogTypes,
  forensicsNoiseCount,
  forensicsNoiseHttpPaths,
  forensicsNoiseIps,
  forensicsNoiseUsers,
} from '../pools';
import {
  formatSshAccepted,
  formatSshFailed,
  formatSuSuccess,
  formatFtpConnect,
  formatFtpLoginOk,
  formatFtpLoginFailed,
  formatAccessLog,
} from '../../logging/formatters';
import { mkFile, mkDir, buildNestedDirs } from './helpers';

// Generates SSH log lines (auth.log) for a forensics attack hop
const generateSshLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const pid = prng.nextInt(1000, 9999);
  const failedAttempts = prng.nextInt(1, 3);

  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + f) * 60000);
    const port = prng.nextInt(30000, 60000);
    return formatSshFailed({ date, hostname, pid, user: 'root', fromIp: sourceIp, port });
  });

  const successDate = new Date(baseDate.getTime() + (minuteOffset + failedAttempts) * 60000);
  const successPort = prng.nextInt(30000, 60000);
  const successLine = formatSshAccepted({
    date: successDate,
    hostname,
    pid,
    user: 'root',
    fromIp: sourceIp,
    port: successPort,
  });

  return { lines: [...failedLines, successLine], minutesUsed: failedAttempts + 2 };
};

// Generates FTP log lines (vsftpd.log) for a forensics attack hop
const generateFtpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const connectLine = formatFtpConnect(
    new Date(baseDate.getTime() + minuteOffset * 60000),
    sourceIp,
  );

  const failedAttempts = prng.nextInt(1, 2);
  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + 1 + f) * 60000);
    return formatFtpLoginFailed({ date, clientIp: sourceIp, user: 'admin' });
  });

  const successDate = new Date(baseDate.getTime() + (minuteOffset + 1 + failedAttempts) * 60000);
  const successLine = formatFtpLoginOk({ date: successDate, clientIp: sourceIp, user: 'root' });

  return {
    lines: [connectLine, ...failedLines, successLine],
    minutesUsed: 1 + failedAttempts + 2,
  };
};

// Generates HTTP log lines (access.log) for a forensics attack hop
const generateHttpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  // Reconnaissance requests
  const recon = ['/robots.txt', '/admin', '/login', '/.env', '/api/config'];
  const reconCount = prng.nextInt(2, 4);
  const reconLines = Array.from({ length: reconCount }, (_, r) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + r) * 60000);
    const path = prng.pick(recon);
    const status = path === '/admin' || path === '/login' ? 200 : 404;
    return formatAccessLog({
      date,
      clientIp: sourceIp,
      method: 'GET',
      path,
      status,
      size: prng.nextInt(200, 5000),
    });
  });

  // Successful exploit/auth
  const successLine = formatAccessLog({
    date: new Date(baseDate.getTime() + (minuteOffset + reconCount) * 60000),
    clientIp: sourceIp,
    method: 'POST',
    path: '/admin/login',
    status: 302,
    size: 0,
  });

  const shellLine = formatAccessLog({
    date: new Date(baseDate.getTime() + (minuteOffset + reconCount + 1) * 60000),
    clientIp: sourceIp,
    method: 'POST',
    path: '/admin/shell',
    status: 200,
    size: prng.nextInt(100, 2000),
  });

  return { lines: [...reconLines, successLine, shellLine], minutesUsed: reconCount + 3 };
};

// Maps a log type to its filename and line generator
const generateLogForType = (
  logType: ForensicsLogType,
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  sourceIp: string,
): {
  readonly fileName: string;
  readonly lines: readonly string[];
  readonly minutesUsed: number;
} => {
  if (logType === 'ftp') {
    const { lines, minutesUsed } = generateFtpLogLines(prng, baseDate, minuteOffset, sourceIp);
    return { fileName: 'vsftpd.log', lines, minutesUsed };
  }
  if (logType === 'http') {
    const { lines, minutesUsed } = generateHttpLogLines(prng, baseDate, minuteOffset, sourceIp);
    return { fileName: 'access.log', lines, minutesUsed };
  }
  const { lines, minutesUsed } = generateSshLogLines(
    prng,
    baseDate,
    minuteOffset,
    hostname,
    sourceIp,
  );
  return { fileName: 'auth.log', lines, minutesUsed };
};

// Generates red herring noise log lines for a given log type and difficulty
const generateNoiseLines = (
  prng: Prng,
  logType: ForensicsLogType,
  baseDate: Date,
  minuteOffset: number,
  hostname: string,
  difficulty: Difficulty,
): readonly string[] => {
  const [min, max] = forensicsNoiseCount[difficulty];
  const count = prng.nextInt(min, max);

  return Array.from({ length: count }, () => {
    // Noise happens at random times before/around the attack
    const offsetMinutes = prng.nextInt(-60, 120);
    const date = new Date(baseDate.getTime() + (minuteOffset + offsetMinutes) * 60000);
    const noiseIp = prng.pick(forensicsNoiseIps);
    const noiseUser = prng.pick(forensicsNoiseUsers);

    if (logType === 'ssh') {
      const port = prng.nextInt(30000, 60000);
      const pid = prng.nextInt(1000, 9999);
      const opts = { date, hostname, pid, user: noiseUser, fromIp: noiseIp, port };
      return prng.next() < 0.7 ? formatSshAccepted(opts) : formatSshFailed(opts);
    }
    if (logType === 'ftp') {
      const opts = { date, clientIp: noiseIp, user: noiseUser };
      return prng.next() < 0.7 ? formatFtpLoginOk(opts) : formatFtpLoginFailed(opts);
    }
    const path = prng.pick(forensicsNoiseHttpPaths);
    return formatAccessLog({
      date,
      clientIp: noiseIp,
      method: 'GET',
      path,
      status: 200,
      size: prng.nextInt(200, 5000),
    });
  });
};

// Builds the calling-card extras (deepest-machine drop) by reading from the
// configured templates and substituting the attacker handle. Returns a record
// keyed by the top-level directory the card lives under.
const buildCallingCardExtras = (
  prng: Prng,
  attackerHandle: string,
): Readonly<Record<string, FileNode>> => {
  const template = prng.pick(forensicsCallingCardTemplates);
  const cardPath = template.path.replace(/\{\{handle\}\}/g, attackerHandle);
  const cardContent = template.content.replace(/\{\{handle\}\}/g, attackerHandle);
  const segments = cardPath.split('/').filter(Boolean);
  const cardFileName = segments[segments.length - 1] ?? `.${attackerHandle}`;
  const cardFile = mkFile(cardFileName, cardContent);
  const topDir = segments[0] ?? 'tmp';
  return { [topDir]: buildNestedDirs(segments, cardFile) };
};

// Generates pre-populated log entries and calling card for forensics objectives.
// Returns a map of machineIp → extra files to merge into the filesystem.
export const generateForensicsEvidence = (
  prng: Prng,
  machines: readonly GeneratedMachine[],
  objective: MissionObjective,
  difficulty: Difficulty = 'medium',
): Readonly<Record<string, Readonly<Record<string, FileNode>>>> => {
  if (objective.type !== 'forensics' || !objective.attackerHandle || !objective.attackerIp) {
    return {};
  }

  const { attackerHandle, attackerIp } = objective;

  // Base date for the attack timeline (a few days ago)
  const baseDate = new Date('2026-03-20T02:30:00Z');

  // The attacker hops machine-by-machine; minuteOffset threads through the
  // reduce so each hop's log timestamps line up sequentially with the prior
  // hop's. PRNG sequence below mirrors the original imperative order exactly:
  // log-type pick → log-line PRNG calls → su decision (+ optional su pid) →
  // noise PRNG calls → (last hop only) calling-card pick.
  return machines.reduce<{
    readonly result: Readonly<Record<string, Readonly<Record<string, FileNode>>>>;
    readonly minuteOffset: number;
  }>(
    (acc, machine, i) => {
      const sourceIp = i === 0 ? attackerIp : (machines[i - 1]?.ip ?? attackerIp);

      const logType = prng.pick(forensicsLogTypes);
      const { fileName, lines, minutesUsed } = generateLogForType(
        logType,
        prng,
        baseDate,
        acc.minuteOffset,
        machine.hostname,
        sourceIp,
      );
      const offsetAfterAttack = acc.minuteOffset + minutesUsed;

      // su to root on non-entry machines (50% chance, only for SSH logs).
      // When su fires, advance the offset by one extra minute for the su line.
      const shouldSu = i > 0 && logType === 'ssh' && prng.next() < 0.5;
      const attackerLines = shouldSu
        ? [
            ...lines,
            formatSuSuccess({
              date: new Date(baseDate.getTime() + offsetAfterAttack * 60000),
              hostname: machine.hostname,
              pid: prng.nextInt(1000, 9999),
              targetUser: 'root',
              fromUser: 'operator',
            }),
          ]
        : lines;
      const offsetAfterSu = shouldSu ? offsetAfterAttack + 1 : offsetAfterAttack;

      // Red herring noise from other IPs
      const noiseLines = generateNoiseLines(
        prng,
        logType,
        baseDate,
        offsetAfterSu,
        machine.hostname,
        difficulty,
      );

      // Interleave noise before and after attacker lines
      const half = Math.ceil(noiseLines.length / 2);
      const allLines = [...noiseLines.slice(0, half), ...attackerLines, ...noiseLines.slice(half)];

      const logFile = mkFile(fileName, allLines.join('\n'));
      const varLog = mkDir('log', { [fileName]: logFile }, 'root', true);
      const varDir = mkDir('var', { log: varLog }, 'root', true);

      // Calling card lives on the deepest machine alongside the log file
      const isLast = i === machines.length - 1;
      const callingCardExtras = isLast ? buildCallingCardExtras(prng, attackerHandle) : {};
      const machineExtras = { var: varDir, ...callingCardExtras };

      return {
        result: { ...acc.result, [machine.ip]: machineExtras },
        minuteOffset: offsetAfterSu,
      };
    },
    { result: {}, minuteOffset: 0 },
  ).result;
};
