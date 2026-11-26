/**
 * What an intruder left behind on a forensics job's machines, as the server lays it: their trail
 * in the rotated `auth.log` among internet scanners and the customer's own staff, and the calling
 * card they left on the target.
 *
 * SERVER ONLY by discipline. Who they are, where they came from, which card they left and every
 * address and time in the logs are drawn from the deployment's mission secret, so a player
 * holding the bundle cannot read the answer: reading the logs is the job.
 *
 * The trail lies in `auth.log.1` and never in the live `auth.log`: a real login appends to the
 * journal's own copy of the live log, which never holds what the server lays, so a laid live log
 * would be gone with the contractor's first login. A rotated log is appended to by nothing.
 *
 * Every line is dated from when the offer was posted: the log covers the three to five days
 * before it, and the break-in falls between 01:00 and 05:00 on the last night before it. Every
 * line is root's, as every rotated log a player can read is, and every card is story, never
 * working code.
 */

import { asGameTime } from '../types.js';
import type { Prng } from '../generation/prng.js';
import { generateHomeLan } from '../generation/generateHomeLan.js';
import { ROOT_FILE } from '../generation/baseFs.js';
import {
  AUTH_LOG_PERMISSIONS,
  formatRootSessionLine,
  formatSshdAuthLine,
} from '../logging/authLog.js';
import { missionTopology, type MissionBoxRef } from './missionShape.js';
import { missionEssid } from './missionNetwork.js';
import { lanSubnetPrefix } from '../network/lanAddress.js';
import { outsideHostOf, streamUnder } from './secretDraws.js';
import type { MissionFile } from './missionLeak.js';

/** Where the trail lies: the live log's last rotation. */
export const ROTATED_AUTH_LOG = '/var/log/auth.log.1';

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The names an intruder goes by: none a client's handle, a username or a service account. */
const HANDLES: readonly string[] = [
  'nullbyte',
  'k0rvax',
  'ashveil',
  'grimlock',
  'r3dshift',
  'xenoth',
  'lowtide',
  'sp3ctre',
  'duskline',
  'vantablk',
  'm0thwing',
  'quietfox',
  'hexwren',
  'blackfen',
  'c0ldsnap',
  'driftnet',
  'pyr0clast',
  'nightjar',
  'sk1mmer',
  'wraithe',
  'bitrot',
  'gl1tchd',
  'vesper_x',
  'saltmarsh',
];

/** A calling card as it is laid: where it sits, and what it says given who left it, the host
 *  they report to and when they came. */
type CardTemplate = {
  readonly pathOf: (handle: string) => string;
  /** Whether the card names the host the intruder reports to, which is not where they came
   *  from. */
  readonly namesDropHost: boolean;
  readonly contentOf: (handle: string, dropHost: string, breakIn: number) => string;
};

/** A moment as an intruder's own tools stamp it. */
const stamp = (time: number): string => new Date(time).toISOString().slice(0, 19).replace('T', ' ');

const textOf = (lines: readonly string[]): string => `${lines.join('\n')}\n`;

/** Legacy's calling cards, adapted: each names the handle, and four name the drop host. */
const CARDS: readonly CardTemplate[] = [
  {
    pathOf: (handle) => `/tmp/.${handle}`,
    namesDropHost: false,
    contentOf: (handle) => textOf([`${handle} was here`]),
  },
  {
    pathOf: (handle) => `/var/tmp/.${handle}.log`,
    namesDropHost: false,
    contentOf: (handle, _dropHost, breakIn) =>
      textOf([
        `[${stamp(breakIn)}] in as root`,
        `[${stamp(breakIn + 4 * MINUTE_MS)}] looked around, nothing worth keeping`,
        `[${stamp(breakIn + 9 * MINUTE_MS)}] covering tracks`,
        `-- ${handle}`,
      ]),
  },
  {
    pathOf: (handle) => `/etc/cron.d/.${handle}`,
    namesDropHost: false,
    contentOf: (handle) =>
      textOf([
        `# ${handle}: come back if they kick us`,
        `*/10 * * * * root /var/tmp/.${handle}-up.sh`,
      ]),
  },
  {
    pathOf: (handle) => `/tmp/.session_${handle}`,
    namesDropHost: false,
    contentOf: (handle, _dropHost, breakIn) =>
      textOf([`USER=${handle}`, `START=${stamp(breakIn)}`, 'EXFIL=complete']),
  },
  {
    pathOf: (handle) => `/var/log/.cleanup_${handle}.sh`,
    namesDropHost: false,
    contentOf: (handle) =>
      textOf([
        '#!/bin/sh',
        `# ${handle}: leave nothing behind`,
        ': > /var/log/auth.log',
        ': > /root/.bash_history',
      ]),
  },
  {
    pathOf: (handle) => `/tmp/.${handle}_exfil.tar.gz.part`,
    namesDropHost: true,
    contentOf: (handle, dropHost) =>
      textOf([`partial upload by ${handle}`, `to ${dropHost}:443`, 'sent 41% of /srv/data']),
  },
  {
    pathOf: (handle) => `/opt/.${handle}_pivot.conf`,
    namesDropHost: true,
    contentOf: (handle, dropHost) =>
      textOf([`# ${handle} tunnel`, 'listen 127.0.0.1:1080', `forward ${dropHost}:8443`]),
  },
  {
    pathOf: (handle) => `/tmp/.${handle}_tools/recon.sh`,
    namesDropHost: false,
    contentOf: (handle) =>
      textOf(['#!/bin/sh', `# ${handle} recon`, 'ifconfig', 'cat /etc/passwd', 'ls -la /root']),
  },
  {
    pathOf: (handle) => `/var/tmp/.${handle}_keylog`,
    namesDropHost: false,
    contentOf: (_handle, _dropHost, breakIn) =>
      textOf([
        `[${stamp(breakIn + 2 * MINUTE_MS)}] whoami`,
        `[${stamp(breakIn + 3 * MINUTE_MS)}] ls /root`,
        `[${stamp(breakIn + 5 * MINUTE_MS)}] cat /etc/shadow`,
      ]),
  },
  {
    pathOf: (handle) => `/root/.${handle}_note`,
    namesDropHost: false,
    contentOf: (handle) => textOf(['Your door was open. Lock it next time.', `-- ${handle}`]),
  },
  {
    pathOf: () => '/tmp/.rev.sh',
    namesDropHost: true,
    contentOf: (handle, dropHost) =>
      textOf([
        '#!/bin/sh',
        `# ${handle}`,
        `while :; do call-home ${dropHost} 4444; sleep 300; done`,
      ]),
  },
  {
    pathOf: (handle) => `/etc/systemd/system/.${handle}.service`,
    namesDropHost: true,
    contentOf: (handle, dropHost) =>
      textOf([
        '[Unit]',
        `Description=${handle} keepalive, reports to ${dropHost}`,
        '[Service]',
        'ExecStart=/tmp/.rev.sh',
        'Restart=always',
      ]),
  },
];

/** Who broke in, where from, and the card they left, as the client knows the answer. */
export type ForensicsIntruder = {
  readonly handle: string;
  readonly origin: string;
  readonly card: { readonly path: string; readonly dropHost: string | null };
};

/** Every outside party in the trail: the intruder, the host their card may name, the scanners
 *  that knocked and the staff's homes. */
type Cast = {
  readonly handle: string;
  readonly card: CardTemplate;
  readonly origin: string;
  readonly dropHost: string;
  readonly scanners: readonly string[];
  readonly staffHomes: readonly string[];
};

/** `count` more outside addresses, none already among `taken`. */
const moreAddresses = (prng: Prng, taken: readonly string[], count: number): readonly string[] =>
  Array.from({ length: count }).reduce<readonly string[]>((drawn) => {
    const next = (): string => {
      const candidate = outsideHostOf(prng);
      return [...taken, ...drawn].includes(candidate) ? next() : candidate;
    };
    return [...drawn, next()];
  }, []);

const castOf = (missionNumber: number, secret: string): Cast => {
  const prng = streamUnder(secret, `forensics-intruder-${missionNumber}`);
  const handle = prng.pick(HANDLES);
  const card = prng.pick(CARDS);
  const scannerCount = prng.nextInt(3, 6);
  const staffCount = prng.nextInt(1, 2);
  const [origin = '', dropHost = '', ...rest] = moreAddresses(
    prng,
    [],
    2 + scannerCount + staffCount,
  );
  return {
    handle,
    card,
    origin,
    dropHost,
    scanners: rest.slice(0, scannerCount),
    staffHomes: rest.slice(scannerCount),
  };
};

/** Who broke into the contract's target and where they came from, under this deployment's
 *  secret. */
export const forensicsIntruder = (missionNumber: number, secret: string): ForensicsIntruder => {
  const { handle, card, origin, dropHost } = castOf(missionNumber, secret);
  return {
    handle,
    origin,
    card: { path: card.pathOf(handle), dropHost: card.namesDropHost ? dropHost : null },
  };
};

/** One line of a log before it is written: when, and what. */
type LogEvent = {
  readonly time: number;
  readonly message: (hostname: string) => string;
};

const login =
  (accepted: boolean, fromIp: string, time: number, pid: number) =>
  (hostname: string): string =>
    formatSshdAuthLine({
      outcome: accepted ? 'success' : 'failure',
      user: 'root',
      fromIp,
      hostname,
      time: asGameTime(time),
      pid,
    });

const session =
  (phase: 'opened' | 'closed', time: number, pid: number) =>
  (hostname: string): string =>
    formatRootSessionLine({ time: asGameTime(time), hostname, service: 'sshd', pid, phase });

const pidOf = (prng: Prng): number => prng.nextInt(1_000, 32_000);

/** A root login that got in from `fromIp` at `time`, held open until `closedAt`. */
const sessionFrom = (
  prng: Prng,
  fromIp: string,
  time: number,
  closedAt: number,
): readonly LogEvent[] => {
  const pid = pidOf(prng);
  return [
    { time, message: login(true, fromIp, time, pid) },
    { time, message: session('opened', time, pid) },
    { time: closedAt, message: session('closed', closedAt, pid) },
  ];
};

/** `count` failed root logins from `fromIp`, the last a few seconds before `before`. */
const failuresFrom = (
  prng: Prng,
  fromIp: string,
  before: number,
  count: number,
): readonly LogEvent[] =>
  Array.from({ length: count })
    .reduce<readonly number[]>(
      (times) => [(times[0] ?? before) - prng.nextInt(4, 20) * SECOND_MS, ...times],
      [],
    )
    .map((time) => ({ time, message: login(false, fromIp, time, pidOf(prng)) }));

/** The two logs: the machine the internet reaches, and on two hops the target behind it. */
type Trail = {
  /** When the intruder got in on the machine the internet reaches. */
  readonly breakIn: number;
  readonly edge: readonly LogEvent[];
  readonly inside: readonly LogEvent[] | null;
};

const startOfDay = (time: number): number => time - (time % DAY_MS);

/** `count` of the `days` days, each once, in no order. */
const someDays = (prng: Prng, days: number, count: number): readonly number[] =>
  Array.from({ length: count }).reduce<readonly number[]>((chosen) => {
    const left = Array.from({ length: days }, (_unused, index) => index).filter(
      (day) => !chosen.includes(day),
    );
    return [...chosen, prng.pick(left)];
  }, []);

const trailOf = (
  missionNumber: number,
  secret: string,
  postedAt: number,
  edgeInsideAddress: string | null,
): Trail => {
  const { origin, scanners, staffHomes } = castOf(missionNumber, secret);
  const prng = streamUnder(secret, `forensics-trail-${missionNumber}`);
  const postedDay = startOfDay(postedAt);
  const night = postedAt - postedDay >= 5 * HOUR_MS ? postedDay : postedDay - DAY_MS;
  const spanDays = prng.nextInt(3, 5);
  const start = postedDay - spanDays * DAY_MS;

  // The intruder: failed tries, then in as root between 01:00 and 04:00, out within the hour,
  // so every line stays before an offer posted as early as 05:00.
  const breakIn = night + HOUR_MS + prng.nextInt(0, 3 * 3_600 - 1) * SECOND_MS;
  const edgeClosed = breakIn + prng.nextInt(15, 40) * MINUTE_MS;
  const intruderEdge = [
    ...failuresFrom(prng, origin, breakIn, prng.nextInt(1, 3)),
    ...sessionFrom(prng, origin, breakIn, edgeClosed),
  ];
  // On two hops, on to the target two to nine minutes in, the session there closed a minute or
  // more before the edge session it ran through.
  const hop = breakIn + prng.nextInt(120, 540) * SECOND_MS;
  const intruderInside =
    edgeInsideAddress === null
      ? []
      : [
          ...failuresFrom(prng, edgeInsideAddress, hop, prng.nextInt(0, 1)),
          ...sessionFrom(
            prng,
            edgeInsideAddress,
            hop,
            hop + prng.nextInt(60, (edgeClosed - hop) / SECOND_MS - 60) * SECOND_MS,
          ),
        ];

  // Staff: in at the first try from home, between 09:00 and 17:00 on two to four of the days,
  // and on two hops on to the target a few minutes later.
  const staff = someDays(prng, spanDays, Math.min(prng.nextInt(2, 4), spanDays)).map((day) => {
    const home = prng.pick(staffHomes);
    const loggedIn =
      start + day * DAY_MS + 9 * HOUR_MS + prng.nextInt(0, 8 * 3_600 - 1) * SECOND_MS;
    const closed = loggedIn + prng.nextInt(10, 60) * MINUTE_MS;
    const hopped = loggedIn + prng.nextInt(1, 5) * MINUTE_MS;
    return {
      edge: sessionFrom(prng, home, loggedIn, closed),
      inside:
        edgeInsideAddress === null
          ? []
          : sessionFrom(prng, edgeInsideAddress, hopped, hopped + prng.nextInt(1, 4) * MINUTE_MS),
    };
  });

  // Scanners: a few failed root logins each at any hour, never in, the earliest of four tries
  // still after the log's first second.
  const span = (postedAt - start) / SECOND_MS - 60;
  const knocks = scanners.flatMap((address) => {
    const lastTry = start + prng.nextInt(120, span) * SECOND_MS;
    return failuresFrom(prng, address, lastTry, prng.nextInt(1, 4));
  });

  return {
    breakIn,
    edge: [...intruderEdge, ...staff.flatMap(({ edge }) => edge), ...knocks],
    inside:
      edgeInsideAddress === null
        ? null
        : [...intruderInside, ...staff.flatMap(({ inside }) => inside)],
  };
};

/** The log as written: every line in time order, under the machine's own name. */
const logFile = (events: readonly LogEvent[], hostname: string): MissionFile => ({
  path: ROTATED_AUTH_LOG,
  content: [...events]
    .sort((first, second) => first.time - second.time)
    .map(({ message }) => `${message(hostname)}\n`)
    .join(''),
  perms: AUTH_LOG_PERMISSIONS,
});

/** The contract's trail, the edge machine's inside address on two hops the one the intruder
 *  and the staff hop on from. */
const trailFor = (missionNumber: number, secret: string, postedAt: number): Trail => {
  const { frontBoxOctet } = missionTopology(missionNumber);
  const edgeInsideAddress =
    frontBoxOctet === null
      ? null
      : `${lanSubnetPrefix(missionEssid(missionNumber))}.${frontBoxOctet}`;
  return trailOf(missionNumber, secret, postedAt, edgeInsideAddress);
};

/** When the intruder got into the machine facing the internet, as the operator's report prints
 *  it, given when the offer was posted. */
export const forensicsBreakIn = (missionNumber: number, secret: string, postedAt: number): string =>
  `${stamp(trailFor(missionNumber, secret, postedAt).breakIn)} UTC`;

/** The name of the box at each octet of the contract's LAN. */
const lanOf = (missionNumber: number) => {
  const lan = generateHomeLan(missionEssid(missionNumber));
  const hostnameAt = (octet: number): string => {
    const host = lan.hosts.find(({ ip }) => ip === `${lan.subnet}.${octet}`);
    if (host === undefined) throw new Error(`no box at .${octet} on contract ${missionNumber}`);
    return host.hostname;
  };
  return { hostnameAt };
};

/** What the server lays on a forensics job's box, given the secret and when the offer was
 *  posted: the rotated log on each box in scope, and the calling card on the target. */
export const forensicsFiles = (
  ref: MissionBoxRef,
  secret: string,
  postedAt: number,
): readonly MissionFile[] => {
  const { missionNumber, role } = ref;
  const { keyBoxOctet, frontBoxOctet } = missionTopology(missionNumber);
  const { hostnameAt } = lanOf(missionNumber);
  const trail = trailFor(missionNumber, secret, postedAt);
  if (role === 'front') {
    return frontBoxOctet === null ? [] : [logFile(trail.edge, hostnameAt(frontBoxOctet))];
  }
  const { handle, card, dropHost } = castOf(missionNumber, secret);
  return [
    logFile(trail.inside ?? trail.edge, hostnameAt(keyBoxOctet)),
    {
      path: card.pathOf(handle),
      content: card.contentOf(handle, dropHost, trail.breakIn),
      perms: ROOT_FILE,
    },
  ];
};

/** Where `forensicsFiles` lays on the box, the card only when given the secret, since only the
 *  secret says where it is. */
export const forensicsFilePaths = (ref: MissionBoxRef, secret?: string): readonly string[] => {
  if (ref.role === 'front') {
    return missionTopology(ref.missionNumber).frontBoxOctet === null ? [] : [ROTATED_AUTH_LOG];
  }
  if (secret === undefined || secret === '') return [ROTATED_AUTH_LOG];
  return [ROTATED_AUTH_LOG, forensicsIntruder(ref.missionNumber, secret).card.path];
};
