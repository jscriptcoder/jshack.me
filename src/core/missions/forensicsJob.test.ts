import { describe, expect, it } from 'vitest';
import { forensicsIntruder } from './forensicsTrail.js';
import { missionFilePaths, missionFiles } from './missionLeak.js';
import { missionKind, missionShape } from './missionShape.js';
import { CLIENT_HANDLES } from './missionTerms.js';
import { forensicsJob } from './targetRoles.js';
import { isMissionNumber, missionEssid } from './missionNetwork.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { networkAt } from '../generation/world.js';
import { isBoardAddress, isMissionAddress, isPublicIp } from '../generation/ip.js';
import { ROOT_FILE } from '../generation/baseFs.js';
import { AUTH_LOG_PERMISSIONS } from '../logging/authLog.js';
import { asEpochMs, type EpochMs } from '../types.js';
import { DEPLOYMENT_SECRETS } from '../../test/passwords.js';

/**
 * What the server lays on a forensics job's machines: the intruder's trail in the rotated
 * `auth.log` among scanners and staff, and the calling card that names them. Reading is the job,
 * so each claim is about what a root reading those files can tell.
 */

const SECRET = 'test-mission-secret';
const OTHER_SECRET = 'another-deployment-secret';

const ENV = { keySecret: SECRET, rawSecrets: DEPLOYMENT_SECRETS };

/** A spread of forensics contracts, single- and two-hop, every machine among them. */
const FORENSICS_NUMBERS = Array.from({ length: 6000 }, (_unused, index) => index * 4153 + 9)
  .filter(isMissionNumber)
  .filter((missionNumber) => missionKind(missionNumber) === 'forensics');

const isTwoHop = (missionNumber: number): boolean => missionShape(missionNumber).frontBox !== null;

const SINGLE_HOP = FORENSICS_NUMBERS.filter((missionNumber) => !isTwoHop(missionNumber)).slice(
  0,
  40,
);
const TWO_HOP = FORENSICS_NUMBERS.filter(isTwoHop).slice(0, 40);

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** An offer posted in the afternoon, and one posted before dawn. */
const POSTED_AFTERNOON = asEpochMs(Date.UTC(2026, 10, 20, 14, 30, 0));
const POSTED_BEFORE_DAWN = asEpochMs(Date.UTC(2026, 10, 20, 3, 10, 0));

const startOfDay = (time: number): number => time - (time % DAY_MS);

const ROTATED_LOG = '/var/log/auth.log.1';

const target = (missionNumber: number) => ({ missionNumber, role: 'key' as const });
const front = (missionNumber: number) => ({ missionNumber, role: 'front' as const });

type Ref = ReturnType<typeof target> | ReturnType<typeof front>;

const laidOn = (ref: Ref, postedAt: EpochMs = POSTED_AFTERNOON) => missionFiles(ref, ENV, postedAt);

const laidAt = (ref: Ref, path: string, postedAt: EpochMs = POSTED_AFTERNOON) => {
  const laid = laidOn(ref, postedAt).find((each) => each.path === path);
  if (laid === undefined) throw new Error(`contract ${ref.missionNumber} lays nothing at ${path}`);
  return laid;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const LINE = /^(\w{3}) ([ \d]\d) (\d\d):(\d\d):(\d\d) (\S+) (\S+)\[(\d+)\]: (.*)$/;
const LOGIN = /^(Accepted|Failed) password for (\S+) from (\S+)$/;
const SESSION = /^pam_unix\(sshd:session\): session (opened|closed) for user root/;

type LogLine = {
  readonly time: number;
  readonly hostname: string;
  readonly service: string;
  readonly pid: string;
  readonly message: string;
};

type Login = {
  readonly time: number;
  readonly accepted: boolean;
  readonly user: string;
  readonly from: string;
};

/** The lines of a laid log, each with its time read back (every one falls in 2026). */
const logLines = (content: string): readonly LogLine[] =>
  content
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const match = LINE.exec(line);
      if (match === null) throw new Error(`not a syslog line: ${line}`);
      const [, month, day, hours, minutes, seconds, hostname, service, pid, message] = match;
      return {
        time: Date.UTC(
          2026,
          MONTHS.indexOf(month ?? ''),
          Number(day),
          Number(hours),
          Number(minutes),
          Number(seconds),
        ),
        hostname: hostname ?? '',
        service: service ?? '',
        pid: pid ?? '',
        message: message ?? '',
      };
    });

const rotatedLog = (ref: Ref, postedAt: EpochMs = POSTED_AFTERNOON): readonly LogLine[] =>
  logLines(laidAt(ref, ROTATED_LOG, postedAt).content);

const loginsIn = (lines: readonly LogLine[]): readonly Login[] =>
  lines.flatMap(({ time, message }) => {
    const match = LOGIN.exec(message);
    return match === null
      ? []
      : [{ time, accepted: match[1] === 'Accepted', user: match[2] ?? '', from: match[3] ?? '' }];
  });

type Session = { readonly from: string; readonly opened: number; readonly closed: number };

/** Every login that got in, from its line to the line closing its session. */
const sessionsIn = (lines: readonly LogLine[]): readonly Session[] =>
  lines.flatMap(({ time, pid, message }) => {
    const match = LOGIN.exec(message);
    if (match?.[1] !== 'Accepted') return [];
    const closed = lines.find(
      (line) => line.pid === pid && line.time >= time && /session closed/.test(line.message),
    );
    return [{ from: match[3] ?? '', opened: time, closed: closed?.time ?? Number.NaN }];
  });

/** Every address in a log, with the logins it made in time order. */
const byAddress = (logins: readonly Login[]): ReadonlyMap<string, readonly Login[]> =>
  logins.reduce(
    (map, login) => new Map([...map, [login.from, [...(map.get(login.from) ?? []), login]]]),
    new Map<string, readonly Login[]>(),
  );

const hourOf = (time: number): number => new Date(time).getUTCHours();

/** The night the intruder came: the posting's own day when it was posted after 05:00, the day
 *  before otherwise. */
const breakInNight = (postedAt: number): number =>
  hourOf(postedAt) >= 5 ? startOfDay(postedAt) : startOfDay(postedAt) - DAY_MS;

const hostnameAt = (missionNumber: number, octet: number): string => {
  const lan = generateHomeLan(missionEssid(missionNumber));
  const host = lan.hosts.find(({ ip }) => ip === `${lan.subnet}.${octet}`);
  if (host === undefined) throw new Error(`no box at .${octet} on contract ${missionNumber}`);
  return host.hostname;
};

const insideAddress = (missionNumber: number, octet: number): string =>
  `${generateHomeLan(missionEssid(missionNumber)).subnet}.${octet}`;

/** The box the gateway forwards onto, which the internet reaches. */
const edgeOf = (missionNumber: number): Ref =>
  isTwoHop(missionNumber) ? front(missionNumber) : target(missionNumber);

describe('the machine a forensics job is about', () => {
  // The briefing names the machine; the box the contractor lands on carries the name to match.
  it('names the target box for the machine it is, and the edge machine on two hops as any', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const { stem, keyBox, frontBox } = missionShape(missionNumber);
      const label = `contract ${missionNumber}`;

      expect(hostnameAt(missionNumber, keyBox.octet), label).toBe(
        `${stem}-${forensicsJob(missionNumber).role.suffix}`,
      );
      if (frontBox !== null) {
        expect(hostnameAt(missionNumber, frontBox.octet), label).toBe(`${stem}-web`);
      }
    }
  });
});

describe('what the server lays on a forensics job’s machines', () => {
  it('lays the trail in the rotated auth.log, readable as the live one is, and nothing in the live one', () => {
    expect(SINGLE_HOP.length).toBeGreaterThan(10);
    for (const missionNumber of SINGLE_HOP) {
      const laid = laidOn(target(missionNumber));

      expect(laidAt(target(missionNumber), ROTATED_LOG).perms).toEqual(AUTH_LOG_PERMISSIONS);
      expect(laid.map(({ path }) => path)).not.toContain('/var/log/auth.log');
    }
  });

  it('dates every line before the posting, in time order, within the five days before it', () => {
    for (const postedAt of [POSTED_AFTERNOON, POSTED_BEFORE_DAWN]) {
      for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
        const refs = isTwoHop(missionNumber)
          ? [front(missionNumber), target(missionNumber)]
          : [target(missionNumber)];
        for (const ref of refs) {
          const times = rotatedLog(ref, postedAt).map(({ time }) => time);
          const label = `${ref.role} of ${missionNumber}`;

          expect(times.length, label).toBeGreaterThan(0);
          expect(times, label).toEqual([...times].sort((first, second) => first - second));
          for (const time of times) {
            expect(time, label).toBeLessThan(postedAt);
            expect(time, label).toBeGreaterThanOrEqual(startOfDay(postedAt) - 5 * DAY_MS);
          }
        }
      }
    }
  });

  // A rotated log is readable by anyone on the box, so no line names an account but root.
  it('holds nothing but root’s ssh logins and their sessions, under the machine’s own name', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const { keyBox, frontBox } = missionShape(missionNumber);
      const boxes = frontBox === null ? [keyBox] : [frontBox, keyBox];
      for (const box of boxes) {
        const ref = box === keyBox ? target(missionNumber) : front(missionNumber);
        for (const line of rotatedLog(ref)) {
          const label = `${ref.role} of ${missionNumber}: ${line.message}`;
          expect(line.hostname, label).toBe(hostnameAt(missionNumber, box.octet));
          expect(line.service, label).toBe('sshd');
          expect(LOGIN.test(line.message) || SESSION.test(line.message), label).toBe(true);
        }
        for (const login of loginsIn(rotatedLog(ref))) expect(login.user).toBe('root');
      }
    }
  });

  it('gives one outside address away on the machine facing the internet: failed logins, then an accepted one at night', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const label = `contract ${missionNumber}`;
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const addresses = byAddress(loginsIn(rotatedLog(edgeOf(missionNumber))));
      const failedThenIn = [...addresses].filter(
        ([, logins]) =>
          logins.some(({ accepted }) => !accepted) && logins.some(({ accepted }) => accepted),
      );

      expect(
        failedThenIn.map(([address]) => address),
        label,
      ).toEqual([origin]);
      const intruder = addresses.get(origin) ?? [];
      const firstIn = intruder.findIndex(({ accepted }) => accepted);
      expect(intruder.slice(0, firstIn).length, label).toBeGreaterThanOrEqual(1);
      expect(intruder.slice(0, firstIn).length, label).toBeLessThanOrEqual(3);
      expect(intruder.slice(firstIn + 1), label).toEqual([]);
      const breakIn = intruder[firstIn]?.time ?? 0;
      expect(breakIn - breakInNight(POSTED_AFTERNOON), label).toBeGreaterThanOrEqual(HOUR_MS);
      expect(breakIn - breakInNight(POSTED_AFTERNOON), label).toBeLessThan(5 * HOUR_MS);
    }
  });

  it('puts the break-in on the night before a posting made before dawn', () => {
    for (const missionNumber of SINGLE_HOP) {
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const breakIn = loginsIn(rotatedLog(target(missionNumber), POSTED_BEFORE_DAWN)).find(
        ({ from, accepted }) => from === origin && accepted,
      );

      expect(breakIn?.time, `contract ${missionNumber}`).toBeGreaterThanOrEqual(
        breakInNight(POSTED_BEFORE_DAWN) + HOUR_MS,
      );
      expect(breakIn?.time, `contract ${missionNumber}`).toBeLessThan(
        breakInNight(POSTED_BEFORE_DAWN) + 5 * HOUR_MS,
      );
    }
  });

  it('fills the rest with scanners that never get in and staff who get in at the first try in working hours', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const label = `contract ${missionNumber}`;
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const lines = rotatedLog(edgeOf(missionNumber));
      const others = [...byAddress(loginsIn(lines))].filter(([address]) => address !== origin);
      const scanners = others.filter(([, logins]) => logins.every(({ accepted }) => !accepted));
      const staff = others.filter(([, logins]) => logins.every(({ accepted }) => accepted));

      expect(scanners.length + staff.length, label).toBe(others.length);
      expect(scanners.length, label).toBeGreaterThanOrEqual(3);
      expect(scanners.length, label).toBeLessThanOrEqual(6);
      for (const [, logins] of scanners) {
        expect(logins.length, label).toBeGreaterThanOrEqual(1);
        expect(logins.length, label).toBeLessThanOrEqual(4);
      }
      expect(staff.length, label).toBeGreaterThanOrEqual(1);
      expect(staff.length, label).toBeLessThanOrEqual(2);
      const staffLogins = staff.flatMap(([, logins]) => logins);
      const staffDays = new Set(staffLogins.map(({ time }) => startOfDay(time)));
      expect(staffDays.size, label).toBeGreaterThanOrEqual(2);
      expect(staffDays.size, label).toBeLessThanOrEqual(4);
      for (const { time } of staffLogins) {
        expect(hourOf(time), label).toBeGreaterThanOrEqual(9);
        expect(hourOf(time), label).toBeLessThan(18);
      }
      // Every login that got in opened a session, and closed it before the log was rotated.
      const accepted = loginsIn(lines).filter(({ accepted }) => accepted).length;
      expect(lines.filter(({ message }) => /session opened/.test(message)).length, label).toBe(
        accepted,
      );
      expect(lines.filter(({ message }) => /session closed/.test(message)).length, label).toBe(
        accepted,
      );
    }
  });

  it('on two hops, shows every login on the inside machine coming from the edge machine, the intruder’s at night minutes after they reached the edge', () => {
    expect(TWO_HOP.length).toBeGreaterThan(10);
    for (const missionNumber of TWO_HOP) {
      const label = `contract ${missionNumber}`;
      const { frontBox } = missionShape(missionNumber);
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const edge = insideAddress(missionNumber, frontBox?.octet ?? 0);
      const inside = loginsIn(rotatedLog(target(missionNumber)));
      const reachedEdge =
        loginsIn(rotatedLog(front(missionNumber))).find(
          ({ from, accepted }) => from === origin && accepted,
        )?.time ?? 0;

      expect(new Set(inside.map(({ from }) => from)), label).toEqual(new Set([edge]));
      const atNight = inside.filter(({ accepted, time }) => accepted && hourOf(time) < 6);
      expect(atNight.length, label).toBe(1);
      const hop = atNight[0]?.time ?? 0;
      expect(hop - reachedEdge, label).toBeGreaterThanOrEqual(2 * MINUTE_MS);
      expect(hop - reachedEdge, label).toBeLessThanOrEqual(9 * MINUTE_MS);
      expect(inside.filter(({ accepted }) => !accepted).length, label).toBeLessThanOrEqual(1);
      for (const { time, accepted } of inside) {
        if (accepted && time !== hop) {
          expect(hourOf(time), label).toBeGreaterThanOrEqual(9);
          expect(hourOf(time), label).toBeLessThan(18);
        }
      }
    }
  });

  it('has the intruder try a few seconds apart, get in seconds after the last try, and stay fifteen to forty minutes', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const label = `contract ${missionNumber}`;
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const lines = rotatedLog(edgeOf(missionNumber));
      const tries = loginsIn(lines)
        .filter(({ from }) => from === origin)
        .map(({ time }) => time);
      const stays = sessionsIn(lines).filter(({ from }) => from === origin);

      for (const [index, time] of tries.slice(1).entries()) {
        expect(time - (tries[index] ?? 0), label).toBeGreaterThanOrEqual(4_000);
        expect(time - (tries[index] ?? 0), label).toBeLessThanOrEqual(20_000);
      }
      expect(stays.length, label).toBe(1);
      expect((stays[0]?.closed ?? 0) - (stays[0]?.opened ?? 0), label).toBeGreaterThanOrEqual(
        15 * MINUTE_MS,
      );
      expect((stays[0]?.closed ?? 0) - (stays[0]?.opened ?? 0), label).toBeLessThanOrEqual(
        40 * MINUTE_MS,
      );
    }
  });

  // A trail always stamped at the same minute would give the intruder away without reading it.
  it('spreads the break-in over the small hours and the staff over the working day', () => {
    const edges = [...SINGLE_HOP, ...TWO_HOP].map((missionNumber) => {
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const logins = loginsIn(rotatedLog(edgeOf(missionNumber)));
      return {
        breakIn: logins.find(({ from, accepted }) => from === origin && accepted)?.time ?? 0,
        staff: logins.filter(({ from, accepted }) => from !== origin && accepted),
      };
    });
    const breakIns = edges.map(({ breakIn }) => breakIn);
    const staffLogins = edges.flatMap(({ staff }) => staff.map(({ time }) => time));

    expect(new Set(breakIns.map(hourOf))).toEqual(new Set([1, 2, 3]));
    expect(new Set(breakIns.map((time) => new Date(time).getUTCMinutes())).size).toBeGreaterThan(
      20,
    );
    expect(new Set(staffLogins.map(hourOf))).toEqual(new Set([9, 10, 11, 12, 13, 14, 15, 16]));
  });

  it('lets each staff session run ten minutes to an hour', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const staff = sessionsIn(rotatedLog(edgeOf(missionNumber))).filter(
        ({ from }) => from !== origin,
      );

      expect(staff.length).toBeGreaterThanOrEqual(2);
      for (const { opened, closed } of staff) {
        expect(closed - opened, `contract ${missionNumber}`).toBeGreaterThanOrEqual(10 * MINUTE_MS);
        expect(closed - opened, `contract ${missionNumber}`).toBeLessThanOrEqual(60 * MINUTE_MS);
      }
    }
  });

  it('on two hops, closes the intruder’s session on the inside machine a minute or more before the edge session it ran through', () => {
    for (const missionNumber of TWO_HOP) {
      const label = `contract ${missionNumber}`;
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const onEdge = sessionsIn(rotatedLog(front(missionNumber))).find(
        ({ from }) => from === origin,
      );
      const inside = sessionsIn(rotatedLog(target(missionNumber))).filter(
        ({ opened }) => hourOf(opened) < 6,
      );

      expect(inside.length, label).toBe(1);
      const [hop] = inside;
      expect((hop?.closed ?? 0) - (hop?.opened ?? 0), label).toBeGreaterThanOrEqual(MINUTE_MS);
      expect((onEdge?.closed ?? 0) - (hop?.closed ?? 0), label).toBeGreaterThanOrEqual(MINUTE_MS);
    }
  });

  it('on two hops, takes each staff login on to the inside machine one to five minutes later, for one to four minutes', () => {
    for (const missionNumber of TWO_HOP) {
      const label = `contract ${missionNumber}`;
      const { origin } = forensicsIntruder(missionNumber, SECRET);
      const byOpening = (first: Session, second: Session) => first.opened - second.opened;
      const staffOnEdge = sessionsIn(rotatedLog(front(missionNumber)))
        .filter(({ from }) => from !== origin)
        .toSorted(byOpening);
      const staffInside = sessionsIn(rotatedLog(target(missionNumber)))
        .filter(({ opened }) => hourOf(opened) >= 9)
        .toSorted(byOpening);

      expect(staffInside.length, label).toBe(staffOnEdge.length);
      for (const [index, { opened, closed }] of staffInside.entries()) {
        const after = opened - (staffOnEdge[index]?.opened ?? 0);
        expect(after, label).toBeGreaterThanOrEqual(MINUTE_MS);
        expect(after, label).toBeLessThanOrEqual(5 * MINUTE_MS);
        expect(closed - opened, label).toBeGreaterThanOrEqual(MINUTE_MS);
        expect(closed - opened, label).toBeLessThanOrEqual(4 * MINUTE_MS);
      }
    }
  });

  it('leaves a calling card on the target alone, root-only, naming the handle and never the origin', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const label = `contract ${missionNumber}`;
      const { handle, origin, card } = forensicsIntruder(missionNumber, SECRET);
      const laid = laidAt(target(missionNumber), card.path);

      expect(laid.perms, label).toEqual(ROOT_FILE);
      expect(`${card.path}\n${laid.content}`, label).toContain(handle);
      expect(laid.content, label).not.toContain(origin);
      expect(
        laidOn(target(missionNumber))
          .map(({ path }) => path)
          .sort(),
        label,
      ).toEqual([ROTATED_LOG, card.path].sort());
    }
    for (const missionNumber of TWO_HOP) {
      expect(laidOn(front(missionNumber)).map(({ path }) => path)).toEqual([ROTATED_LOG]);
    }
  });

  it('draws twelve calling cards, four of which name a drop host that is neither the origin nor in any log', () => {
    const intruders = FORENSICS_NUMBERS.map((missionNumber) => ({
      missionNumber,
      ...forensicsIntruder(missionNumber, SECRET),
    }));
    const shapes = new Set(
      intruders.map(({ handle, card }) => card.path.split(handle).join('<handle>')),
    );
    const naming = new Set(
      intruders
        .filter(({ card }) => card.dropHost !== null)
        .map(({ handle, card }) => card.path.split(handle).join('<handle>')),
    );

    expect(shapes.size).toBe(12);
    expect(naming.size).toBe(4);
    for (const { missionNumber, origin, card } of intruders.slice(0, 80)) {
      if (card.dropHost === null) continue;
      const label = `contract ${missionNumber}`;
      const logged = [edgeOf(missionNumber), target(missionNumber)].flatMap((ref) =>
        loginsIn(rotatedLog(ref)).map(({ from }) => from),
      );
      expect(laidAt(target(missionNumber), card.path).content, label).toContain(card.dropHost);
      expect(card.dropHost, label).not.toBe(origin);
      expect(logged, label).not.toContain(card.dropHost);
    }
  });

  it('draws every outside address from the world, none a network answers at, none twice', () => {
    for (const missionNumber of [...SINGLE_HOP, ...TWO_HOP]) {
      const { dropHost } = forensicsIntruder(missionNumber, SECRET).card;
      const outside = [...byAddress(loginsIn(rotatedLog(edgeOf(missionNumber))))].map(
        ([address]) => address,
      );
      const addresses = dropHost === null ? outside : [...outside, dropHost];

      for (const address of addresses) {
        expect(isPublicIp(address), address).toBe(true);
        expect(isMissionAddress(address), address).toBe(false);
        expect(isBoardAddress(address), address).toBe(false);
        expect(networkAt(address), address).toBeUndefined();
      }
      expect(new Set(addresses).size, `contract ${missionNumber}`).toBe(addresses.length);
    }
  });

  it('draws the handle from a pool of its own, none a client’s handle', () => {
    const handles = new Set(
      FORENSICS_NUMBERS.map((missionNumber) => forensicsIntruder(missionNumber, SECRET).handle),
    );

    expect(handles.size).toBeGreaterThanOrEqual(20);
    for (const handle of handles) {
      expect(handle).toMatch(/^[a-z0-9_]+$/);
      expect(CLIENT_HANDLES).not.toContain(handle);
    }
  });

  // Who broke in is the answer: a player holding the bundle must not work it out.
  it('draws the intruder from the secret, so another deployment names someone else', () => {
    const moved = FORENSICS_NUMBERS.filter(
      (missionNumber) =>
        forensicsIntruder(missionNumber, SECRET).origin !==
        forensicsIntruder(missionNumber, OTHER_SECRET).origin,
    );

    expect(moved.length / FORENSICS_NUMBERS.length).toBeGreaterThan(0.9);
  });

  it('lists both laid paths for the write gate, the card only with the secret', () => {
    for (const missionNumber of SINGLE_HOP.slice(0, 10)) {
      expect(missionFilePaths(target(missionNumber), SECRET)).toEqual(
        laidOn(target(missionNumber)).map(({ path }) => path),
      );
      expect(missionFilePaths(target(missionNumber), undefined)).toEqual([ROTATED_LOG]);
      expect(missionFilePaths(target(missionNumber), '')).toEqual([ROTATED_LOG]);
    }
    for (const missionNumber of TWO_HOP.slice(0, 10)) {
      expect(missionFilePaths(front(missionNumber), SECRET)).toEqual([ROTATED_LOG]);
    }
  });

  it('lays nothing without the mission secret', () => {
    const missionNumber = SINGLE_HOP[0] ?? 0;

    expect(() =>
      missionFiles(
        target(missionNumber),
        { keySecret: undefined, rawSecrets: DEPLOYMENT_SECRETS },
        POSTED_AFTERNOON,
      ),
    ).toThrow();
  });
});
