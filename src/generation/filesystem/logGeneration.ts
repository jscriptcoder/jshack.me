import type { Prng } from '../prng';
import type { GeneratedMachine } from '../types';
import type { RemoteUser } from '../../network/types';
import {
  accessLogTemplates,
  authLogTemplates,
  kernLogTemplates,
  mailLogTemplates,
  mysqlLogTemplates,
  redisLogTemplates,
  syslogTemplates,
  vsftpdLogTemplates,
} from '../pools';
import { fillTemplate } from './helpers';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type LogPlaceholders = {
  readonly date: string;
  readonly pid: string;
  readonly user: string;
  readonly ip: string;
  readonly srcport: string;
  readonly service: string;
  readonly uptime: string;
  readonly apacheDate: string;
  readonly vsftpdDate: string;
  readonly mysqlDate: string;
  readonly redisDate: string;
  readonly size: string;
  readonly threadId: string;
  readonly filename: string;
};

const buildLogPlaceholders = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
): LogPlaceholders => {
  const usernames = users.length > 0 ? users.map((u) => u.username) : ['root'];
  const monthIdx = prng.nextInt(0, 11);
  const day = prng.nextInt(1, 28);
  const hour = prng.nextInt(0, 23).toString().padStart(2, '0');
  const minute = prng.nextInt(0, 59).toString().padStart(2, '0');
  const second = prng.nextInt(0, 59).toString().padStart(2, '0');
  const year = 2026;
  const monthShort = MONTHS[monthIdx] ?? 'Jan';
  return {
    date: `${monthShort} ${String(day).padStart(2, ' ')} ${hour}:${minute}:${second}`,
    pid: String(prng.nextInt(1000, 9999)),
    user: prng.pick(usernames),
    ip: machine.ip,
    srcport: String(prng.nextInt(40000, 65535)),
    service: prng.pick(['sshd', 'nginx', 'mysql', 'cron']),
    uptime: `${prng.nextInt(100, 99999)}.${prng.nextInt(100, 999)}`,
    apacheDate: `${String(day).padStart(2, '0')}/${monthShort}/${year}:${hour}:${minute}:${second} +0000`,
    vsftpdDate: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')} ${hour}:${minute}:${second}`,
    mysqlDate: `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}T${hour}:${minute}:${second}.000000Z`,
    redisDate: `${String(day).padStart(2, ' ')} ${monthShort} ${year} ${hour}:${minute}:${second}.000`,
    size: String(prng.nextInt(200, 8000)),
    threadId: String(prng.nextInt(10, 200)),
    filename: prng.pick(['report.pdf', 'data.csv', 'backup.tar.gz', 'notes.txt', 'image.png']),
  };
};

const generateLogLines = (
  prng: Prng,
  templates: readonly string[],
  lineCount: number,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
): string => {
  if (templates.length === 0) return '';
  return Array.from({ length: lineCount }, () => {
    const template = prng.pick(templates);
    return fillTemplate(template, buildLogPlaceholders(prng, machine, users));
  }).join('\n');
};

// Generates the full set of per-log-file seeded content for a machine, keyed by
// filename. Every machine gets auth.log, syslog, and kern.log. Role-specific
// service logs are added based on which daemons the machine actually runs.
export const generateLogsByFile = (
  prng: Prng,
  machine: GeneratedMachine,
  users: readonly RemoteUser[],
): Record<string, string> => {
  const files: Record<string, string> = {};
  files['auth.log'] = generateLogLines(prng, authLogTemplates, prng.nextInt(5, 15), machine, users);
  files['syslog'] = generateLogLines(prng, syslogTemplates, prng.nextInt(5, 15), machine, users);
  files['kern.log'] = generateLogLines(prng, kernLogTemplates, prng.nextInt(5, 12), machine, users);

  if (machine.role === 'webserver') {
    files['access.log'] = generateLogLines(
      prng,
      accessLogTemplates,
      prng.nextInt(8, 20),
      machine,
      users,
    );
  }
  if (machine.role === 'fileserver') {
    files['vsftpd.log'] = generateLogLines(
      prng,
      vsftpdLogTemplates,
      prng.nextInt(6, 14),
      machine,
      users,
    );
  }
  if (machine.role === 'database') {
    const hasMysql = machine.remoteMachine.ports.some((p) => p.service === 'mysql' && p.open);
    if (hasMysql) {
      files['mysql.log'] = generateLogLines(
        prng,
        mysqlLogTemplates,
        prng.nextInt(6, 14),
        machine,
        users,
      );
    }
    const hasRedis = machine.remoteMachine.ports.some((p) => p.service === 'redis' && p.open);
    if (hasRedis) {
      files['redis.log'] = generateLogLines(
        prng,
        redisLogTemplates,
        prng.nextInt(5, 12),
        machine,
        users,
      );
    }
  }
  if (machine.role === 'mailserver') {
    files['mail.log'] = generateLogLines(
      prng,
      mailLogTemplates,
      prng.nextInt(6, 14),
      machine,
      users,
    );
  }

  return files;
};
