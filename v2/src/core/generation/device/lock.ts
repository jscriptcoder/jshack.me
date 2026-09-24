/**
 * A smart lock: the door it is on, the keypad slots it keeps by name, and who it let in.
 * The people it lets in are the box's own; one who owns a phone on the network comes in
 * by that phone, and anyone else by the slot kept for them. A slot is a name and never a
 * code: the codes stay in the lock's own secure element, which no file holds.
 */

import type { Prng } from '../prng';
import { dir, file, ROOT_FILE, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import { generateHomeLan, isOnHomeLan, type LanHost } from '../generateHomeLan';
import type { MailPerson } from '../networkMail';
import { npcUsername } from '../remoteHostFs';
import { phoneModel } from '../share';
import { LOCK_DOORS, LOCK_MODELS, LOCK_ROLE_SLOTS } from '../pools/devices';
import { DAY_SECONDS, LAST_SECOND, stamp, userTree, type DeviceFiles } from './common';

const SLOTS_PATH = '/var/lib/lockd/slots.conf';
const LOG_PATH = '/var/log/lockd/access.log';

/** How many of the people the box knows live or work behind the door. */
const HOUSEHOLD = { min: 2, max: 5 } as const;
const ROLE_SLOTS = { min: 1, max: 2 } as const;
const UNLOCKS = { min: 10, max: 30 } as const;
const UNLOCK_WINDOW_SECONDS = 14 * DAY_SECONDS;
/** How often the door is opened by a role's slot rather than one of its people. */
const ROLE_CHANCE = 0.15;
const AUTO_LOCK_SECONDS: readonly number[] = [15, 30, 60, 120];

/** Somebody the lock lets in, and the phone they own on the network, where they own one. */
type Resident = { readonly fullName: string; readonly phone: LanHost | undefined };

const drawDistinct = <Item>(prng: Prng, pool: readonly Item[], count: number): readonly Item[] => {
  const chosen = new Set<Item>();
  while (chosen.size < Math.min(count, pool.length)) chosen.add(prng.pick(pool));
  return pool.filter((item) => chosen.has(item));
};

/** The people behind the door, each with the phone they own on its LAN. A lock below the
 *  LAN sees no phone, so everyone there uses the keypad. */
const residentsOf = ({
  prng,
  essid,
  host,
  people,
}: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly people: readonly MailPerson[];
}): readonly Resident[] => {
  const named = people.filter((person) => person.fullName !== '');
  const phones = isOnHomeLan(essid, host)
    ? generateHomeLan(essid).hosts.filter((neighbour) => phoneModel(essid, neighbour) !== undefined)
    : [];
  return drawDistinct(prng, named, prng.nextInt(HOUSEHOLD.min, HOUSEHOLD.max)).map((person) => ({
    fullName: person.fullName,
    phone: phones.find((phone) => npcUsername(essid, phone) === person.username),
  }));
};

/** One unlock, as the log writes it. */
const unlockLine = (at: number, resident: Resident | null, roleSlot: string): string => {
  if (resident === null) return `${stamp(at)} unlocked via keypad slot "${roleSlot}"`;
  const via =
    resident.phone === undefined
      ? `keypad slot "${resident.fullName}"`
      : `phone ${resident.phone.hostname} (${resident.phone.ip})`;
  return `${stamp(at)} unlocked by "${resident.fullName}" via ${via}`;
};

/** `/etc/lockd/lockd.conf`: the door, the lock, how soon it locks again, and where its
 *  slots and its log are. It names nobody: who may come in is the slots' business. */
const lockdConf = ({
  hostname,
  door,
  model,
  autoLock,
}: {
  readonly hostname: string;
  readonly door: string;
  readonly model: string;
  readonly autoLock: number;
}): string =>
  [
    `# lockd configuration for ${hostname}`,
    '[lock]',
    `name = ${door}`,
    `model = ${model}`,
    `auto_lock_seconds = ${autoLock}`,
    'bluetooth = on',
    'keypad = on',
    `slots = ${SLOTS_PATH}`,
    `log = ${LOG_PATH}`,
    '',
    '[mqtt]',
    'host = 127.0.0.1',
    'port = 1883',
    `topic = home/lock/${door.toLowerCase().replaceAll(' ', '-')}`,
    '',
  ].join('\n');

export const lockFiles = ({
  prng,
  essid,
  host,
  username,
  people,
}: {
  readonly prng: Prng;
  readonly essid: string;
  readonly host: LanHost;
  readonly username: string;
  readonly people: readonly MailPerson[];
}): DeviceFiles => {
  const door = prng.pick(LOCK_DOORS);
  const model = prng.pick(LOCK_MODELS);
  const autoLock = prng.pick(AUTO_LOCK_SECONDS);
  const residents = residentsOf({ prng, essid, host, people });
  const roles = drawDistinct(prng, LOCK_ROLE_SLOTS, prng.nextInt(ROLE_SLOTS.min, ROLE_SLOTS.max));
  const slots = [
    ...residents.filter((resident) => resident.phone === undefined).map((resident) => resident.fullName),
    ...roles,
  ];
  const lines = Array.from({ length: prng.nextInt(UNLOCKS.min, UNLOCKS.max) }, () =>
    prng.nextInt(LAST_SECOND - UNLOCK_WINDOW_SECONDS, LAST_SECOND),
  )
    .sort((earlier, later) => earlier - later)
    .map((at) =>
      residents.length === 0 || prng.next() < ROLE_CHANCE
        ? unlockLine(at, null, prng.pick(roles))
        : unlockLine(at, prng.pick(residents), ''),
    );
  return {
    etc: {
      lockd: dir(
        {
          'lockd.conf': file(
            lockdConf({ hostname: host.hostname, door, model, autoLock }),
            SERVICE_CONFIG_FILE,
          ),
        },
        TRAVERSABLE_DIR,
      ),
    },
    lib: {
      lockd: userTree(
        new Map([
          [
            'slots.conf',
            ['# keypad slots, by name: each code is held in the lock itself', ...slots, ''].join('\n'),
          ],
        ]),
        username,
      ),
    },
    // Rotated on the last morning like every log here: what the lock remembers is in the
    // rotated file, and a door opened a few times a day never filled it to its size.
    log: {
      lockd: dir(
        {
          'access.log': file('', ROOT_FILE),
          'access.log.1': file(lines.map((line) => `${line}\n`).join(''), ROOT_FILE),
        },
        TRAVERSABLE_DIR,
      ),
    },
    var: {},
    pages: new Map(),
    configPaths: ['/etc/lockd/lockd.conf'],
    printed: [],
  };
};
