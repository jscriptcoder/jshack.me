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
  const lines: string[] = [];
  let offset = 0;

  const failedAttempts = prng.nextInt(1, 3);
  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + f) * 60000);
    const port = prng.nextInt(30000, 60000);
    return formatSshFailed(date, hostname, pid, 'root', sourceIp, port);
  });
  lines.push(...failedLines);
  offset += failedAttempts;

  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  const successPort = prng.nextInt(30000, 60000);
  lines.push(formatSshAccepted(successDate, hostname, pid, 'root', sourceIp, successPort));
  offset += 2;

  return { lines, minutesUsed: offset };
};

// Generates FTP log lines (vsftpd.log) for a forensics attack hop
const generateFtpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const lines: string[] = [];
  let offset = 0;

  const connectDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatFtpConnect(connectDate, sourceIp));
  offset += 1;

  const failedAttempts = prng.nextInt(1, 2);
  const failedLines = Array.from({ length: failedAttempts }, (_, f) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + f) * 60000);
    return formatFtpLoginFailed(date, sourceIp, 'admin');
  });
  lines.push(...failedLines);
  offset += failedAttempts;

  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatFtpLoginOk(successDate, sourceIp, 'root'));
  offset += 2;

  return { lines, minutesUsed: offset };
};

// Generates HTTP log lines (access.log) for a forensics attack hop
const generateHttpLogLines = (
  prng: Prng,
  baseDate: Date,
  minuteOffset: number,
  sourceIp: string,
): { readonly lines: readonly string[]; readonly minutesUsed: number } => {
  const lines: string[] = [];
  let offset = 0;

  // Reconnaissance requests
  const recon = ['/robots.txt', '/admin', '/login', '/.env', '/api/config'];
  const reconCount = prng.nextInt(2, 4);
  const reconLines = Array.from({ length: reconCount }, (_, r) => {
    const date = new Date(baseDate.getTime() + (minuteOffset + offset + r) * 60000);
    const path = prng.pick(recon);
    const status = path === '/admin' || path === '/login' ? 200 : 404;
    return formatAccessLog(date, sourceIp, 'GET', path, status, prng.nextInt(200, 5000));
  });
  lines.push(...reconLines);
  offset += reconCount;

  // Successful exploit/auth
  const successDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(formatAccessLog(successDate, sourceIp, 'POST', '/admin/login', 302, 0));
  offset += 1;

  const shellDate = new Date(baseDate.getTime() + (minuteOffset + offset) * 60000);
  lines.push(
    formatAccessLog(shellDate, sourceIp, 'POST', '/admin/shell', 200, prng.nextInt(100, 2000)),
  );
  offset += 2;

  return { lines, minutesUsed: offset };
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
      return prng.next() < 0.7
        ? formatSshAccepted(date, hostname, pid, noiseUser, noiseIp, port)
        : formatSshFailed(date, hostname, pid, noiseUser, noiseIp, port);
    }
    if (logType === 'ftp') {
      return prng.next() < 0.7
        ? formatFtpLoginOk(date, noiseIp, noiseUser)
        : formatFtpLoginFailed(date, noiseIp, noiseUser);
    }
    const path = prng.pick(forensicsNoiseHttpPaths);
    return formatAccessLog(date, noiseIp, 'GET', path, 200, prng.nextInt(200, 5000));
  });
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
  const result: Record<string, Record<string, FileNode>> = {};

  // Base date for the attack timeline (a few days ago)
  const baseDate = new Date('2026-03-20T02:30:00Z');
  let minuteOffset = 0;

  for (let i = 0; i < machines.length; i++) {
    const machine = machines[i] as GeneratedMachine;
    const sourceIp = i === 0 ? attackerIp : (machines[i - 1] as GeneratedMachine).ip;

    // Pick a log type for this machine
    const logType = prng.pick(forensicsLogTypes);
    const { fileName, lines, minutesUsed } = generateLogForType(
      logType,
      prng,
      baseDate,
      minuteOffset,
      machine.hostname,
      sourceIp,
    );
    minuteOffset += minutesUsed;

    // su to root on non-entry machines (50% chance, only for SSH logs)
    const attackerLines =
      i > 0 && logType === 'ssh' && prng.next() < 0.5
        ? [
            ...lines,
            formatSuSuccess(
              new Date(baseDate.getTime() + minuteOffset++ * 60000),
              machine.hostname,
              prng.nextInt(1000, 9999),
              'root',
              'operator',
            ),
          ]
        : [...lines];

    // Add red herring noise entries from other IPs
    const noiseLines = generateNoiseLines(
      prng,
      logType,
      baseDate,
      minuteOffset,
      machine.hostname,
      difficulty,
    );

    // Interleave noise before and after attacker lines
    const allLines = [
      ...noiseLines.slice(0, Math.ceil(noiseLines.length / 2)),
      ...attackerLines,
      ...noiseLines.slice(Math.ceil(noiseLines.length / 2)),
    ];

    const logFile = mkFile(fileName, allLines.join('\n'));
    const varLog = mkDir('log', { [fileName]: logFile }, 'root', true);
    const varDir = mkDir('var', { log: varLog }, 'root', true);

    result[machine.ip] = { var: varDir };

    // Place calling card on the deepest machine
    if (i === machines.length - 1) {
      const template = prng.pick(forensicsCallingCardTemplates);
      const cardPath = template.path.replace(/\{\{handle\}\}/g, attackerHandle);
      const cardContent = template.content.replace(/\{\{handle\}\}/g, attackerHandle);
      const segments = cardPath.split('/').filter(Boolean);
      const fileName = segments[segments.length - 1] ?? `.${attackerHandle}`;
      const cardFile = mkFile(fileName, cardContent);
      const topDir = segments[0] ?? 'tmp';
      result[machine.ip] = {
        ...result[machine.ip],
        [topDir]: buildNestedDirs(segments, cardFile),
      };
    }
  }

  return result;
};
