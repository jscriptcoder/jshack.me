import { describe, expect, it } from 'vitest';
import { buildRemoteHostFs, hostServices, npcUsername } from './remoteHostFs';
import { buildDeepHostFs } from './deepHostFs';
import { crackableEssidPool } from './generateWifi';
import { generateHomeLan } from './generateHomeLan';
import { roleOfHostname } from './pools/hostnames';
import { createFsView } from '../filesystem/fsView';
import { parseMysqlDatabase } from '../mysql/types';
import { lanZoneName } from '../network/resolveName';
import { asAbsPath } from '../types';
import type { Directory, FileEntry } from '../filesystem/types';
import { WORLD_EPOCH } from '../cve/worldClock';
import {
  ALL_ESSIDS,
  deepBoxes,
  filesUnder,
  lanBoxes,
  softwareVersionsIn,
  type Box,
} from '../../test/worldContent';

/**
 * What a generated box remembers of its last day before the world began: the rotated
 * `.1` logs beside the live ones, read the way a player reads them — `ls /var/log`,
 * then `cat` — and checked against the rest of the box and the network it stands on.
 */

const DAY_MS = 86_400_000;
const LAST_DAY_START = WORLD_EPOCH - DAY_MS;

type Built = { readonly box: Box; readonly tree: Directory; readonly onLan: boolean };

let population: readonly Built[] | null = null;

/** Every NPC box on every catalog and non-catalog network, LAN and deep — built once,
 *  on first use, so a mutant that breaks the builder fails the tests that use it
 *  rather than the file's import. */
const everyBox = (): readonly Built[] => {
  population ??= [
    ...lanBoxes(ALL_ESSIDS).map((box) => ({
      box,
      tree: buildRemoteHostFs(box.essid, box.host),
      onLan: true,
    })),
    ...deepBoxes(crackableEssidPool).map(({ essid, host }) => ({
      box: { essid, host },
      tree: buildDeepHostFs(essid, host),
      onLan: false,
    })),
  ];
  return population;
};

const varLogOf = (tree: Directory): Directory => {
  const node = createFsView(tree, { userType: 'root' }).stat(asAbsPath('/var/log'));
  if (node?.kind !== 'directory') throw new Error('no /var/log');
  return node;
};

const logsOf = (tree: Directory): ReadonlyMap<string, string> => filesUnder(varLogOf(tree));

const rotatedOf = (tree: Directory): ReadonlyMap<string, string> =>
  new Map([...logsOf(tree)].filter(([name]) => name.endsWith('.1')));

const linesOf = (content: string): readonly string[] =>
  content.split('\n').filter((line) => line !== '');

const fileAt = (tree: Directory, path: string): string => {
  const result = createFsView(tree, { userType: 'root' }).read(asAbsPath(path));
  if (!result.ok) throw new Error(`${path}: ${result.error}`);
  return result.content;
};

const daemonsRunningOn = (box: Box): readonly string[] =>
  hostServices(box.essid, box.host).map(({ spec }) => spec.service);

/** How each rotated file stamps its lines on 2026-07-11, and where the stamp sits. */
const STAMPS: Readonly<Record<string, RegExp>> = {
  syslog: /^Jul 11 (\d\d):(\d\d):(\d\d) /,
  'auth.log': /^Jul 11 (\d\d):(\d\d):(\d\d) /,
  'kern.log': /^Jul 11 (\d\d):(\d\d):(\d\d) /,
  'access.log': /\[11\/Jul\/2026:(\d\d):(\d\d):(\d\d) \+0000\]/,
  'mysql.log': /^2026-07-11T(\d\d):(\d\d):(\d\d)\.000000Z/,
  'redis.log': /^\d+:[MC] 11 Jul 2026 (\d\d):(\d\d):(\d\d)\.000/,
  'named.log': /^11-Jul-2026 (\d\d):(\d\d):(\d\d)\.\d{3} /,
};

const stampOf = (rotatedName: string): RegExp => {
  const stamp = STAMPS[rotatedName.slice(0, -'.1'.length)];
  if (stamp === undefined) throw new Error(`no stamp known for ${rotatedName}`);
  return stamp;
};

/** Seconds into 2026-07-11, or null for a line not dated that day in its file's format. */
const secondOfDay = (rotatedName: string, line: string): number | null => {
  const match = stampOf(rotatedName).exec(line);
  if (match === null) return null;
  const [hours, minutes, seconds] = match.slice(1, 4).map(Number);
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
};

/** A line with its date taken out, so a clock's decimals never read as a version — and
 *  the protocol a web request names, which is the request's, not the server's. */
const withoutStamp = (rotatedName: string, line: string): string =>
  line.replace(stampOf(rotatedName), '').replace(' HTTP/1.1"', '"');

type CronJob = {
  readonly minute: number;
  readonly hour: number | null;
  readonly weekday: number | null;
  readonly command: string;
};

/** The jobs `/etc/crontab` schedules, read back from the file a player can `cat`. */
const cronJobsOf = (tree: Directory): readonly CronJob[] =>
  linesOf(fileAt(tree, '/etc/crontab'))
    .filter((line) => /^\d/.test(line))
    .map((line) => {
      const [minuteHour = '', dayFields = '', , command = ''] = line.split('\t');
      const [minute, hour] = minuteHour.split(' ');
      const weekday = dayFields.split(' ')[2];
      return {
        minute: Number(minute),
        hour: hour === '*' ? null : Number(hour),
        weekday: weekday === '*' || weekday === undefined ? null : Number(weekday),
        command,
      };
    });

const SATURDAY = 6;

/** Every `HH:MM (root) CMD (job)` a Saturday's cron should have run, sorted. */
const expectedCronRuns = (jobs: readonly CronJob[]): readonly string[] =>
  jobs
    .filter((job) => job.weekday === null || job.weekday === SATURDAY)
    .flatMap((job) =>
      (job.hour === null ? Array.from({ length: 24 }, (_, hour) => hour) : [job.hour]).map(
        (hour) =>
          `${String(hour).padStart(2, '0')}:${String(job.minute).padStart(2, '0')} ${job.command}`,
      ),
    )
    .sort();

const CRON_LINE = /^Jul 11 (\d\d:\d\d):\d\d \S+ CRON\[\d+\]: \(root\) CMD \((.*)\)$/;

const cronRunsIn = (syslog: string): readonly string[] =>
  linesOf(syslog)
    .map((line) => CRON_LINE.exec(line))
    .filter((match) => match !== null)
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

describe('what a box remembers of its last day', () => {
  it('keeps an empty live syslog beside a syslog.1 that holds the day', () => {
    everyBox().forEach(({ tree }) => {
      const logs = logsOf(tree);
      expect(logs.get('syslog')).toBe('');
      expect(linesOf(logs.get('syslog.1') ?? '').length).toBeGreaterThan(0);
    });
  });

  it('keeps an auth.log.1 on every box whose cron ran something that day', () => {
    everyBox().forEach(({ tree }) => {
      if (expectedCronRuns(cronJobsOf(tree)).length === 0) return;
      expect(rotatedOf(tree).has('auth.log.1')).toBe(true);
    });
  });

  it('rotates a log only beside the live log it came from', () => {
    everyBox().forEach(({ tree }) => {
      const logs = logsOf(tree);
      [...rotatedOf(tree).keys()].forEach((rotated) => {
        expect(logs.get(rotated.slice(0, -'.1'.length))).toBe('');
      });
    });
  });

  it('never keeps an empty rotation, and ends every line it keeps', () => {
    everyBox().forEach(({ tree }) => {
      rotatedOf(tree).forEach((content) => {
        expect(content).not.toBe('');
        expect(content.endsWith('\n')).toBe(true);
      });
    });
  });

  it('keeps every live log empty, for players to fill', () => {
    everyBox().forEach(({ tree }) => {
      [...logsOf(tree)]
        .filter(([name]) => !name.endsWith('.1'))
        .forEach(([, content]) => expect(content).toBe(''));
    });
  });

  it('dates every line to the last day before the world began, in the order it happened', () => {
    expect(new Date(LAST_DAY_START).toISOString()).toBe('2026-07-11T00:00:00.000Z');
    everyBox().forEach(({ tree }) => {
      rotatedOf(tree).forEach((content, name) => {
        const seconds = linesOf(content).map((line) => secondOfDay(name, line));
        seconds.forEach((second) => expect(second).not.toBeNull());
        const sorted = [...seconds].sort((left, right) => (left ?? 0) - (right ?? 0));
        expect(seconds).toEqual(sorted);
      });
    });
  });

  it('gives each rotation its live log’s permissions and owner, and syslog the same tier', () => {
    everyBox().forEach(({ tree }) => {
      const directory = varLogOf(tree);
      const entry = (name: string): FileEntry => {
        const node = directory.entries.get(name);
        if (node?.kind !== 'file') throw new Error(`no ${name}`);
        return node;
      };
      [...rotatedOf(tree).keys()].forEach((rotated) => {
        const live = entry(rotated.slice(0, -'.1'.length));
        expect(entry(rotated).perms).toEqual(live.perms);
        expect(entry(rotated).owner).toBe(live.owner);
      });
      expect(entry('syslog').perms).toEqual(entry('auth.log').perms);
      expect(entry('syslog').owner).toBe('root');
    });
  });
});

describe('the jobs a box ran', () => {
  it('runs every job in its crontab at every time it fires on a Saturday, and nothing else', () => {
    everyBox().forEach(({ tree }) => {
      expect(cronRunsIn(logsOf(tree).get('syslog.1') ?? '')).toEqual(
        expectedCronRuns(cronJobsOf(tree)),
      );
    });
  });

  it('meets every shape of schedule somewhere in the world', () => {
    const jobs = everyBox().flatMap(({ tree }) => cronJobsOf(tree));
    expect(jobs.some((job) => job.hour === null)).toBe(true);
    expect(jobs.some((job) => job.hour !== null && job.weekday === null)).toBe(true);
    expect(jobs.some((job) => job.weekday === SATURDAY)).toBe(true);
    expect(jobs.some((job) => job.weekday !== null && job.weekday !== SATURDAY)).toBe(true);
  });

  it('opens and closes a root session around every run, in auth.log.1', () => {
    everyBox().forEach(({ tree }) => {
      const runs = cronRunsIn(logsOf(tree).get('syslog.1') ?? '').length;
      const auth = linesOf(logsOf(tree).get('auth.log.1') ?? '');
      const opened = auth.filter((line) =>
        / CRON\[\d+\]: pam_unix\(cron:session\): session opened for user root\(uid=0\) by \(uid=0\)$/.test(line),
      );
      const closed = auth.filter((line) =>
        / CRON\[\d+\]: pam_unix\(cron:session\): session closed for user root$/.test(line),
      );
      expect(opened.length).toBe(runs);
      expect(closed.length).toBe(runs);
    });
  });

  it('runs the day’s housekeeping timers, rotating the logs first thing', () => {
    everyBox().forEach(({ tree }) => {
      const syslog = linesOf(logsOf(tree).get('syslog.1') ?? '');
      expect(syslog.some((line) => / systemd\[1\]: Starting Rotate log files\.\.\.$/.test(line))).toBe(
        true,
      );
      expect(syslog.some((line) => / systemd\[1\]: Finished Rotate log files\.$/.test(line))).toBe(true);
    });
  });
});

describe('who reached a box that day', () => {
  it('names only neighbouring machines on its own LAN, or the box itself through loopback', () => {
    everyBox().forEach(({ box, tree, onLan }) => {
      const neighbours = onLan
        ? generateHomeLan(box.essid)
            .hosts.filter((host) => host.kind === 'machine' && host.ip !== box.host.ip)
            .map((host) => host.ip)
        : [];
      rotatedOf(tree).forEach((content) => {
        (content.match(IPV4) ?? []).forEach((ip) => {
          // `0.0.0.0` is every interface a daemon listens on, not a host.
          expect(['127.0.0.1', '0.0.0.0', ...neighbours]).toContain(ip);
        });
      });
    });
  });

  it('lets root in over ssh only where sshd runs, from a neighbour, and never on a deep layer', () => {
    everyBox().forEach(({ box, tree, onLan }) => {
      const auth = linesOf(rotatedOf(tree).get('auth.log.1') ?? '');
      const visits = auth.filter((line) => / sshd\[\d+\]: Accepted password for root from /.test(line));
      if (!onLan || !daemonsRunningOn(box).includes('ssh')) expect(visits).toEqual([]);
      const sessions = auth.filter((line) =>
        / sshd\[\d+\]: pam_unix\(sshd:session\): session opened for user root\(uid=0\) by \(uid=0\)$/.test(line),
      );
      expect(sessions.length).toBe(visits.length);
    });
  });

  it('shows some admins logging in that day and some not, up to three visits', () => {
    const visitCounts = everyBox()
      .filter(({ box, onLan }) => onLan && daemonsRunningOn(box).includes('ssh'))
      .map(({ tree }) =>
        linesOf(rotatedOf(tree).get('auth.log.1') ?? '').filter((line) =>
          line.includes('Accepted password for root from'),
        ).length,
      );
    expect(visitCounts).toContain(0);
    expect(visitCounts).toContain(3);
    expect(Math.max(...visitCounts)).toBe(3);
  });

  it('records page fetches only where the box serves, each the size of the page it serves', () => {
    everyBox().forEach(({ box, tree }) => {
      const access = rotatedOf(tree).get('access.log.1');
      if (!daemonsRunningOn(box).includes('http')) {
        expect(access).toBeUndefined();
        return;
      }
      const size = fileAt(tree, '/var/www/html/index.html').length;
      expect(access).toBeDefined();
      linesOf(access ?? '').forEach((line) => {
        expect(line.endsWith(`"GET / HTTP/1.1" 200 ${size}`)).toBe(true);
      });
    });
  });

  it('shows the database answering root on the box itself, about tables it really keeps', () => {
    everyBox().forEach(({ box, tree }) => {
      const log = rotatedOf(tree).get('mysql.log.1');
      if (!daemonsRunningOn(box).includes('mysql')) {
        expect(log).toBeUndefined();
        return;
      }
      const database = parseMysqlDatabase(fileAt(tree, '/var/lib/mysql/data.json'));
      if (database === null) throw new Error('unreadable datadir');
      const tables = Object.keys(database.tables);
      const lines = linesOf(log ?? '');
      expect(lines.some((line) => line.includes(' Connect\t'))).toBe(true);
      lines.forEach((line) => {
        const [, detail = ''] = line.split(/\t\d+ (?:Connect|Query)\t/);
        if (line.includes(' Connect\t')) {
          expect(detail).toBe(`root@127.0.0.1 on ${database.name} using TCP/IP`);
          return;
        }
        expect(detail).toMatch(/^(SHOW TABLES|DESCRIBE \w+|SELECT \* FROM \w+)$/);
        const table = /(?:DESCRIBE|FROM) (\w+)$/.exec(detail)?.[1];
        if (table !== undefined) expect(tables).toContain(table);
      });
    });
  });

  it('shows the store saving itself, and clients reaching it, only where it runs', () => {
    everyBox().forEach(({ box, tree }) => {
      const log = rotatedOf(tree).get('redis.log.1');
      if (!daemonsRunningOn(box).includes('redis')) {
        expect(log).toBeUndefined();
        return;
      }
      expect(log).toContain('* DB saved on disk');
    });
  });

  it('shows a name server reloading the zone it keeps, at the serial its zone file carries', () => {
    const nameServers = everyBox().filter(({ box }) => roleOfHostname(box.host.hostname) === 'dns');
    expect(nameServers.length).toBeGreaterThan(0);
    everyBox().forEach(({ box, tree }) => {
      const log = rotatedOf(tree).get('named.log.1');
      const isServing =
        roleOfHostname(box.host.hostname) === 'dns' && daemonsRunningOn(box).includes('domain');
      if (!isServing) {
        expect(log).toBeUndefined();
        return;
      }
      const zoneFile = [...filesUnder(zonesOf(tree)).values()][0] ?? '';
      const serial = /(\d+)\s*;\s*serial/.exec(zoneFile)?.[1];
      expect(serial).toBeDefined();
      const lines = linesOf(log ?? '');
      expect(lines.some((line) => line.endsWith("received control channel command 'reload'"))).toBe(
        true,
      );
      expect(
        lines.some((line) => line.endsWith(`zone ${lanZoneName(box.essid)}/IN: loaded serial ${serial}`)),
      ).toBe(true);
    });
  });

  it('keeps a kernel log only for a box that restarted, booting the kernel and disk it has', () => {
    const rebooted = everyBox().filter(({ tree }) => rotatedOf(tree).has('kern.log.1'));
    expect(rebooted.length).toBeGreaterThan(0);
    expect(rebooted.length).toBeLessThan(everyBox().length);
    everyBox().forEach(({ box, tree }) => {
      const kern = rotatedOf(tree).get('kern.log.1');
      const syslog = linesOf(logsOf(tree).get('syslog.1') ?? '');
      const started = syslog.filter((line) => / systemd\[1\]: Started /.test(line));
      if (kern === undefined) {
        expect(started).toEqual([]);
        return;
      }
      const rootUuid = /^UUID=(\S+) \/ /m.exec(fileAt(tree, '/etc/fstab'))?.[1];
      expect(kern).toContain(`Command line: BOOT_IMAGE=/boot/vmlinuz root=UUID=${rootUuid} ro quiet`);
      expect(fileAt(tree, '/boot/vmlinuz')).not.toBe('');
      expect(started.length).toBe(daemonsRunningOn(box).length);
    });
  });
});

/** Where a name server keeps its zone file. */
const zonesOf = (tree: Directory): Directory => {
  const node = createFsView(tree, { userType: 'root' }).stat(asAbsPath('/etc/bind/zones'));
  if (node?.kind !== 'directory') throw new Error('no /etc/bind/zones');
  return node;
};

describe('what a box’s logs never say', () => {
  it('names no account but root, since anyone on the box can read them', () => {
    // Every place a line of these formats puts an account: a PAM session, an ssh login,
    // a cron job's owner, a database client, a home directory. A daemon may share its
    // name with an account (`vsftpd`), so the rule is read at those places.
    const accountPositions = [
      /for user ([\w.-]+)/g,
      /Accepted password for ([\w.-]+)/g,
      /\(([\w.-]+)\) CMD/g,
      /\t([\w.-]+)@\S+ on /g,
      /\/home\/([\w.-]+)/g,
    ];
    const accounts = new Set<string>();
    everyBox().forEach(({ box, tree }) => {
      const username = npcUsername(box.essid, box.host);
      rotatedOf(tree).forEach((content) => {
        accountPositions.forEach((position) => {
          [...content.matchAll(position)].forEach(([, account]) => {
            accounts.add(account ?? '');
            expect(account).not.toBe(username);
          });
        });
      });
    });
    expect([...accounts]).toEqual(['root']);
  });

  it('carries no software version', () => {
    everyBox().forEach(({ tree }) => {
      rotatedOf(tree).forEach((content, name) => {
        linesOf(content).forEach((line) => {
          expect(softwareVersionsIn(withoutStamp(name, line))).toEqual([]);
        });
      });
    });
  });
});

describe('no two boxes lived the same day', () => {
  it('gives no two boxes on one network the same rotated log', () => {
    ALL_ESSIDS.forEach((essid) => {
      const rotations = everyBox()
        .filter(({ box, onLan }) => onLan && box.essid === essid)
        .flatMap(({ tree }) => [...rotatedOf(tree)].map(([name, content]) => `${name}\n${content}`));
      expect(new Set(rotations).size).toBe(rotations.length);
    });
  });

  it('keeps each day distinct across every catalog network', () => {
    const catalog = everyBox().filter(
      ({ box, onLan }) => onLan && crackableEssidPool.includes(box.essid),
    );
    const syslogs = catalog.map(({ tree }) => logsOf(tree).get('syslog.1'));
    const auths = catalog.flatMap(({ tree }) => rotatedOf(tree).get('auth.log.1') ?? []);
    expect(new Set(syslogs).size / syslogs.length).toBeGreaterThanOrEqual(0.95);
    expect(new Set(auths).size / auths.length).toBeGreaterThanOrEqual(0.9);
  });
});

