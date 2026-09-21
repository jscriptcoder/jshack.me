/**
 * What a generated box remembers of its last day before the world began.
 *
 * logrotate ran at `WORLD_EPOCH`, so the live logs start empty and every `.1` beside
 * them holds 2026-07-11: the jobs in the box's own crontab running on time, the daily
 * housekeeping, a restart if the box had one, and the neighbours that reached the
 * services it runs. Every line is built from something the box really is — its crontab,
 * its disk, its page, its database, its zone — so a player who reads a line can check it
 * on the box or reach what it names on the network.
 *
 * The files are readable by anyone on the box, like the live logs they rotated out of,
 * so no line names an account but root. A `.1` exists only when it holds a line, which
 * is logrotate's own rule for an empty log, and only beside the live log it came from.
 *
 * A box that is not on the home LAN (a deep-layer NPC) has no neighbours it can know
 * about, so its history is local only and its tree stays the same whether or not its
 * layer hangs a child. Everything here draws from the box's own `log-history` stream.
 */

import type { FileEntry } from '../filesystem/types';
import type { MysqlDatabase } from '../mysql/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import { asGameTime, type GameTime } from '../types';
import { file } from './baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from './generateHomeLan';
import { createPrng, type Prng } from './prng';
import { fillSlots } from './npcHome';
import type { HostService } from './remoteHostFs';
import { lanZoneName } from '../network/resolveName';
import { ZONE_SERIAL } from './generateDnsZone';
import { formatSyslogLine, SYSLOG_PERMISSIONS } from '../logging/syslog';
import {
  AUTH_LOG_PERMISSIONS,
  formatRootSessionLine,
  formatSshdAuthLine,
} from '../logging/authLog';
import { formatKernelLine, KERN_LOG_PERMISSIONS } from '../logging/kernLog';
import { ACCESS_LOG_PERMISSIONS, formatAccessLogLine } from '../logging/accessLog';
import {
  formatMysqlConnectLine,
  formatMysqlStatementLine,
  MYSQL_LOG_PERMISSIONS,
} from '../logging/mysqlLog';
import {
  formatRedisConnectLine,
  formatRedisNoticeLine,
  REDIS_LOG_PERMISSIONS,
} from '../logging/redisLog';
import {
  formatNamedControlLine,
  formatNamedZoneLoadedLine,
  NAMED_LOG_PERMISSIONS,
} from '../logging/namedLog';
import { daemonName } from '../services/pidfile';
import {
  DAILY_TIMERS,
  KERNEL_BOOT_LINES,
  LOGROTATE_TIMER,
  REDIS_SAVE_RULES,
  SERVICE_UNIT_DESCRIPTIONS,
  type DailyTimer,
} from './pools/logLines';

const DAY_SECONDS = 86_400;
const LAST_SECOND = DAY_SECONDS - 1;
const DAY_START = WORLD_EPOCH - DAY_SECONDS * 1000;
const SATURDAY = 6;
const LOOPBACK = '127.0.0.1';
const REBOOT_CHANCE = 0.15;

/** One line and the second of the day it was written. */
type Entry = { readonly second: number; readonly line: string };

const timeAt = (second: number): GameTime => asGameTime(DAY_START + second * 1000);

const laterBy = (second: number, seconds: number): number => Math.min(second + seconds, LAST_SECOND);

const pidFrom = (prng: Prng): number => prng.nextInt(1000, 99999);

/** A file's lines in the order they happened. The sort is stable, so lines written in
 *  the same second keep the order they were written in. */
const inOrder = (entries: readonly Entry[]): string =>
  [...entries]
    .sort((left, right) => left.second - right.second)
    .map(({ line }) => `${line}\n`)
    .join('');

type CronRun = { readonly second: number; readonly command: string };

/** When each job in the box's crontab ran on a Saturday, read from the file as built so
 *  the history and the crontab can never disagree. */
const cronRuns = (crontab: string): readonly CronRun[] =>
  crontab
    .split('\n')
    .filter((line) => /^\d/.test(line))
    .flatMap((line) => {
      const [minuteHour = '', days = '', , command = ''] = line.split('\t');
      const [minute = '0', hour = '*'] = minuteHour.split(' ');
      const weekday = days.split(' ')[2] ?? '*';
      if (weekday !== '*' && Number(weekday) !== SATURDAY) return [];
      const hours = hour === '*' ? Array.from({ length: 24 }, (_, index) => index) : [Number(hour)];
      return hours.map((runHour) => ({ second: runHour * 3600 + Number(minute) * 60, command }));
    });

/** The root filesystem's UUID, as `/etc/fstab` mounts it. */
const rootUuid = (fstab: string): string => /^UUID=(\S+) \/ /m.exec(fstab)?.[1] ?? '';

export type LogHistoryOptions = {
  readonly essid: string;
  readonly host: LanHost;
  readonly services: readonly HostService[];
  /** `/etc/crontab` as the box keeps it. */
  readonly crontab: string;
  /** `/etc/fstab` as the box keeps it. */
  readonly fstab: string;
  /** The page the box serves at `/`, or null when it serves none. */
  readonly page: string | null;
  /** The database the box keeps, or null when it runs no `mysqld`. */
  readonly database: MysqlDatabase | null;
  /** Whether the box is its network's name server. */
  readonly isNameServer: boolean;
};

/** `syslog` and every `.1` this box keeps, by name, for its `/var/log`. */
export const buildLogHistory = (options: LogHistoryOptions): Readonly<Record<string, FileEntry>> => {
  const { essid, host, services, crontab, fstab, page, database, isNameServer } = options;
  const prng = createPrng(`log-history-${essid}-${host.ip}`);
  const hostname = host.hostname;
  const runs = (service: string): HostService | undefined =>
    services.find(({ spec }) => spec.service === service);
  const neighbours = isOnHomeLan(essid, host)
    ? generateHomeLan(essid)
        .hosts.filter((candidate) => candidate.kind === 'machine' && candidate.ip !== host.ip)
        .map((candidate) => candidate.ip)
    : [];
  /** A client of this box: a neighbouring machine where it has one, or the box itself. */
  const client = (): string => (neighbours.length === 0 ? LOOPBACK : prng.pick(neighbours));
  const syslog = (second: number, service: string, pid: number, message: string): Entry => ({
    second,
    line: formatSyslogLine({ time: timeAt(second), hostname, service, pid, message }),
  });
  const rootSession = (
    second: number,
    service: 'CRON' | 'sshd',
    pid: number,
    phase: 'opened' | 'closed',
  ): Entry => ({
    second,
    line: formatRootSessionLine({ time: timeAt(second), hostname, service, pid, phase }),
  });

  const timer = (second: number, { description, unit }: DailyTimer): readonly Entry[] => {
    const finished = laterBy(second, prng.nextInt(1, 40));
    return [
      syslog(second, 'systemd', 1, `Starting ${description}...`),
      syslog(finished, 'systemd', 1, `${unit}: Deactivated successfully.`),
      syslog(finished, 'systemd', 1, `Finished ${description}.`),
    ];
  };
  const housekeeping = [
    ...timer(prng.nextInt(0, 5), LOGROTATE_TIMER),
    ...prng
      .pickN(DAILY_TIMERS, prng.nextInt(2, 4))
      .flatMap((daily) => timer(prng.nextInt(0, LAST_SECOND - 60), daily)),
  ];

  const cron = cronRuns(crontab).map(({ second, command }) => {
    const pid = pidFrom(prng);
    return {
      syslog: syslog(second, 'CRON', pid, `(root) CMD (${command})`),
      auth: [
        rootSession(second, 'CRON', pid, 'opened'),
        rootSession(laterBy(second, prng.nextInt(0, 30)), 'CRON', pid, 'closed'),
      ],
    };
  });

  const rebootAt = prng.next() < REBOOT_CHANCE ? prng.nextInt(0, LAST_SECOND - 60) : null;
  const boot =
    rebootAt === null
      ? { kern: [], syslog: [], auth: [] }
      : (() => {
          const slots: Readonly<Record<string, string>> = {
            uuid: rootUuid(fstab),
            cpus: String(prng.pick([1, 2, 4, 8])),
            available: String(prng.nextInt(1_900_000, 15_900_000)),
            total: String(prng.nextInt(16_000_000, 16_400_000)),
          };
          const ssh = runs('ssh');
          return {
            // A boot prints its lines over a few seconds, several to the second.
            kern: KERNEL_BOOT_LINES.map((template, index) => {
              const second = laterBy(rebootAt, Math.floor(index / 5));
              return {
                second,
                line: formatKernelLine({
                  time: timeAt(second),
                  hostname,
                  message: fillSlots(template, slots),
                }),
              };
            }),
            syslog: services.map(({ spec }) =>
              syslog(
                laterBy(rebootAt, prng.nextInt(5, 20)),
                'systemd',
                1,
                `Started ${SERVICE_UNIT_DESCRIPTIONS[spec.service]}.`,
              ),
            ),
            auth:
              ssh === undefined
                ? []
                : [
                    syslog(
                      laterBy(rebootAt, prng.nextInt(5, 20)),
                      daemonName(ssh.spec),
                      pidFrom(prng),
                      `Server listening on 0.0.0.0 port ${ssh.port}.`,
                    ),
                  ],
          };
        })();

  // An admin logging in from a desk on the LAN: only where sshd runs, and only where
  // there is a neighbour to have come from.
  const visits =
    runs('ssh') === undefined || neighbours.length === 0
      ? []
      : Array.from({ length: prng.nextInt(0, 3) }, () => {
          const second = prng.nextInt(0, LAST_SECOND - 60);
          const pid = pidFrom(prng);
          return [
            {
              second,
              line: formatSshdAuthLine({
                outcome: 'success',
                user: 'root',
                fromIp: prng.pick(neighbours),
                hostname,
                time: timeAt(second),
                pid,
              }),
            },
            rootSession(second, 'sshd', pid, 'opened'),
            rootSession(laterBy(second, prng.nextInt(60, 3600)), 'sshd', pid, 'closed'),
          ];
        }).flat();

  const access =
    page === null
      ? []
      : Array.from(
          { length: neighbours.length === 0 ? prng.nextInt(1, 6) : prng.nextInt(3, 30) },
          () => {
            const second = prng.nextInt(0, LAST_SECOND);
            return {
              second,
              line: formatAccessLogLine({
                time: timeAt(second),
                sourceIp: client(),
                path: '/',
                status: 200,
                size: page.length,
              }),
            };
          },
        );

  const queries =
    database === null
      ? []
      : Array.from({ length: prng.nextInt(1, 4) }, (_, session) => {
          const second = prng.nextInt(0, LAST_SECOND - 60);
          const pid = prng.nextInt(10, 99) + session * 100;
          const tables = Object.keys(database.tables);
          const statements = Array.from({ length: prng.nextInt(1, 4) }, () => {
            const table = prng.pick(tables);
            return prng.pick(['SHOW TABLES', `DESCRIBE ${table}`, `SELECT * FROM ${table}`]);
          });
          return [
            {
              second,
              line: formatMysqlConnectLine({
                user: 'root',
                fromIp: LOOPBACK,
                time: timeAt(second),
                pid,
                database: database.name,
              }),
            },
            ...statements.map((detail, index) => ({
              second: laterBy(second, index + 1),
              line: formatMysqlStatementLine({
                time: timeAt(laterBy(second, index + 1)),
                pid,
                tag: 'Query',
                detail,
              }),
            })),
          ];
        }).flat();

  const store = (() => {
    if (runs('redis') === undefined) return [];
    const pid = pidFrom(prng);
    const notice = (second: number, process: 'M' | 'C', processPid: number, message: string) => ({
      second,
      line: formatRedisNoticeLine({ pid: processPid, process, time: timeAt(second), message }),
    });
    const saves = Array.from({ length: prng.nextInt(1, 4) }, () => {
      const second = prng.nextInt(0, LAST_SECOND - 60);
      const child = pidFrom(prng);
      const { changes, seconds } = prng.pick(REDIS_SAVE_RULES);
      return [
        notice(second, 'M', pid, `${changes} changes in ${seconds} seconds. Saving...`),
        notice(second, 'M', pid, `Background saving started by pid ${child}`),
        notice(laterBy(second, 1), 'C', child, 'DB saved on disk'),
        notice(laterBy(second, 1), 'M', pid, 'Background saving terminated with success'),
      ];
    }).flat();
    const connects = Array.from({ length: prng.nextInt(1, 8) }, () => {
      const second = prng.nextInt(0, LAST_SECOND);
      return {
        second,
        line: formatRedisConnectLine({ fromIp: client(), time: timeAt(second), pid }),
      };
    });
    return [...saves, ...connects];
  })();

  // The admin reloading the zone they keep. Lookups themselves are not logged: BIND's
  // query log is off, as it is for the live log players write to.
  const zone =
    isNameServer && runs('domain') !== undefined
      ? (() => {
          const second = prng.nextInt(0, LAST_SECOND);
          return [
            { second, line: formatNamedControlLine({ time: timeAt(second), command: 'reload' }) },
            {
              second,
              line: formatNamedZoneLoadedLine({
                time: timeAt(second),
                zone: lanZoneName(essid),
                serial: ZONE_SERIAL,
              }),
            },
          ];
        })()
      : [];

  const rotations: readonly (readonly [string, readonly Entry[], FileEntry['perms']])[] = [
    ['syslog.1', [...housekeeping, ...cron.map((run) => run.syslog), ...boot.syslog], SYSLOG_PERMISSIONS],
    ['auth.log.1', [...cron.flatMap((run) => run.auth), ...boot.auth, ...visits], AUTH_LOG_PERMISSIONS],
    ['kern.log.1', boot.kern, KERN_LOG_PERMISSIONS],
    ['access.log.1', access, ACCESS_LOG_PERMISSIONS],
    ['mysql.log.1', queries, MYSQL_LOG_PERMISSIONS],
    ['redis.log.1', store, REDIS_LOG_PERMISSIONS],
    ['named.log.1', zone, NAMED_LOG_PERMISSIONS],
  ];
  return {
    syslog: file('', SYSLOG_PERMISSIONS),
    ...Object.fromEntries(
      rotations
        .filter(([, entries]) => entries.length > 0)
        .map(([name, entries, perms]) => [name, file(inOrder(entries), perms)]),
    ),
  };
};
