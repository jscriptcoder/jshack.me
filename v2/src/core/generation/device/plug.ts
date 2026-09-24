/**
 * A smart plug: the appliance it switches, the weekly schedule it switches it to, and the
 * energy the appliance drew each day, which is nothing on a day no rule turned it on.
 */

import type { Prng } from '../prng';
import { dir, file, SERVICE_CONFIG_FILE, TRAVERSABLE_DIR } from '../baseFs';
import type { LanHost } from '../generateHomeLan';
import { PLUG_APPLIANCES, PLUG_DAYS } from '../pools/devices';
import { DAY_SECONDS, LAST_SECOND, pad2, stamp, userTree, type DeviceFiles } from './common';

const SCHEDULE_PATH = '/var/lib/plugd/schedule.conf';
const ENERGY_PATH = '/var/lib/plugd/energy.csv';

const KEEP_DAYS = 30;
const RULES = { min: 1, max: 3 } as const;
/** A rule switches on at a half hour from 05:00 to 22:00, for one to eight hours. */
const ON_SLOTS = { min: 10, max: 44 } as const;
const ON_HALF_HOURS = { min: 2, max: 16 } as const;
const MINUTES_IN_DAY = 24 * 60;
/** How much of its load an appliance really draws while switched on: a heater's
 *  thermostat and a coffee machine's element cut in and out. */
const DUTY = { min: 30, max: 100 } as const;

/** The days of the week, by `getUTCDay()`, each days field covers. */
const WEEKDAYS: Readonly<Record<string, readonly number[]>> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  'mon-fri': [1, 2, 3, 4, 5],
  'sat-sun': [0, 6],
  sun: [0],
  mon: [1],
  tue: [2],
  wed: [3],
  thu: [4],
  fri: [5],
  sat: [6],
};

/** On `days`, switched on and off at these minutes after midnight. */
type Rule = { readonly days: string; readonly on: number; readonly off: number };

const rulesOf = (prng: Prng): readonly Rule[] =>
  Array.from({ length: prng.nextInt(RULES.min, RULES.max) }, () => {
    const days = prng.pick(PLUG_DAYS);
    const on = prng.nextInt(ON_SLOTS.min, ON_SLOTS.max) * 30;
    const off = Math.min(on + prng.nextInt(ON_HALF_HOURS.min, ON_HALF_HOURS.max) * 30, MINUTES_IN_DAY);
    return { days, on, off };
  });

const clock = (minutes: number): string => `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;

const scheduleFile = (rules: readonly Rule[]): string =>
  [
    '# on/off schedule: days, on, off',
    ...rules.map(({ days, on, off }) => `${days} ${clock(on)} ${clock(off)}`),
    '',
  ].join('\n');

/** The minutes the rules keep the plug on during a day of the week, where rules overlap
 *  counted once. */
const minutesOn = (rules: readonly Rule[], weekday: number): number => {
  const on = new Set<number>();
  rules
    .filter((rule) => WEEKDAYS[rule.days]?.includes(weekday))
    .forEach((rule) => {
      for (let minute = rule.on; minute < rule.off; minute += 1) on.add(minute);
    });
  return on.size;
};

/** The last thirty whole days before the world began, each with what the appliance drew:
 *  its load for as long as it was on, less what its own switching left off. */
const energyFile = (prng: Prng, rules: readonly Rule[], watts: number): string => {
  const lastDay = Math.floor((LAST_SECOND + 1) / DAY_SECONDS) * DAY_SECONDS - DAY_SECONDS;
  const rows = Array.from({ length: KEEP_DAYS }, (_, index) => {
    const day = lastDay - (KEEP_DAYS - 1 - index) * DAY_SECONDS;
    const minutes = minutesOn(rules, new Date(day * 1000).getUTCDay());
    const duty = prng.nextInt(DUTY.min, DUTY.max) / 100;
    const kwh = minutes === 0 ? 0 : Math.max(0.001, (watts * minutes * duty) / 60 / 1000);
    return `${stamp(day).slice(0, 10)},${kwh.toFixed(3)}`;
  });
  return ['date,kwh', ...rows, ''].join('\n');
};

/** `/etc/plugd/plugd.conf`: what it switches and at what load, where its schedule and
 *  its energy are kept, and the broker on the board itself it reports to. */
const plugdConf = (hostname: string, appliance: (typeof PLUG_APPLIANCES)[number]): string =>
  [
    `# plugd configuration for ${hostname}`,
    '[plug]',
    `name = ${appliance.name}`,
    `load_watts = ${appliance.watts}`,
    'relay = gpio4',
    `schedule = ${SCHEDULE_PATH}`,
    '',
    '[log]',
    `energy = ${ENERGY_PATH}`,
    `keep_days = ${KEEP_DAYS}`,
    '',
    '[mqtt]',
    'host = 127.0.0.1',
    'port = 1883',
    `topic = home/plug/${appliance.name.toLowerCase().replaceAll(' ', '-')}`,
    '',
  ].join('\n');

export const plugFiles = ({
  prng,
  host,
  username,
}: {
  readonly prng: Prng;
  readonly host: LanHost;
  readonly username: string;
}): DeviceFiles => {
  const appliance = prng.pick(PLUG_APPLIANCES);
  const rules = rulesOf(prng);
  return {
    etc: {
      plugd: dir(
        { 'plugd.conf': file(plugdConf(host.hostname, appliance), SERVICE_CONFIG_FILE) },
        TRAVERSABLE_DIR,
      ),
    },
    lib: {
      plugd: userTree(
        new Map([
          ['schedule.conf', scheduleFile(rules)],
          ['energy.csv', energyFile(prng, rules, appliance.watts)],
        ]),
        username,
      ),
    },
    log: {},
    var: {},
    pages: new Map(),
    configPaths: ['/etc/plugd/plugd.conf'],
    printed: [],
  };
};
